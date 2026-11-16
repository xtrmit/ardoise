/* L'Ardoise — stockage des notes (IndexedDB) et règles partagées entre l'app et le service worker.
   Une base par environnement (local / test / prod) : les données ne se mélangent jamais. */
(function (G) {
  'use strict';
  const MORDER = ['journee', 'matin', 'midi', 'apresmidi', 'soir'];
  const MOMENTS = { journee: 'Journée', matin: 'Matin', midi: 'Midi', apresmidi: 'Après-midi', soir: 'Soir' };
  const TYPES = { tache: 'Tâche', rdv: 'Rendez-vous', rappel: 'Rappel', action: 'Action', memo: 'Pense-bête' };

  function envDe(url) {
    const u = new URL(url);
    if (!/github\.io$/.test(u.hostname)) return 'local';
    return /\/[^/]*-test\//.test(u.pathname) ? 'test' : 'prod';
  }

  /* ---------- Dates (heure locale du téléphone) ---------- */
  function key(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fromKey(k) { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(k, n) { const d = fromKey(k); d.setDate(d.getDate() + n); return key(d); }
  function today() { return key(new Date()); }
  function joursEntre(a, b) { return Math.round((fromKey(b) - fromKey(a)) / 86400000); }
  function heureFr(h) { if (!h) return ''; const p = h.split(':'); return (+p[0]) + ' h' + (p[1] !== '00' ? ' ' + p[1] : ''); }

  /* ---------- IndexedDB ---------- */
  function open(env) {
    return new Promise((res, rej) => {
      const r = indexedDB.open('ardoise-' + env, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('attente')) db.createObjectStore('attente', { keyPath: 'id' });
        // meta : de quoi permettre au service worker de vérifier seul l'abonnement aux notifications (jeton, adresse de l'API, clé, horaires)
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function req(db, store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      let out;
      const r = fn(t.objectStore(store));
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = t.onabort = () => rej(t.error);
    });
  }
  const all = (db, s) => req(db, s, 'readonly', st => st.getAll());
  const put = (db, s, o) => req(db, s, 'readwrite', st => st.put(o));
  const del = (db, s, id) => req(db, s, 'readwrite', st => st.delete(id));
  function remplacer(db, s, liste) {
    return req(db, s, 'readwrite', st => { st.clear(); liste.forEach(o => st.put(o)); });
  }
  function putMany(db, s, liste) {
    return req(db, s, 'readwrite', st => { liste.forEach(o => st.put(o)); });
  }

  const getMeta = (db, k) => req(db, 'meta', 'readonly', st => st.get(k));
  const cleBytes = b64 => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };

  /* Vérifie l'abonnement push et le répare si besoin (abonnement effacé par n8n, ou adresse différente).
     Utilisé par l'app (à l'ouverture) et par le service worker (contrôle périodique, changement d'abonnement). */
  async function verifierAbonnement(reg, m, source) {
    if (!m || !m.jeton || !m.api) return 'sans-jeton';
    const appel = async body => {
      const r = await fetch(m.api, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ardoise-jeton': m.jeton }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.erreur || 'serveur');
      return j;
    };
    const info = await appel({ action: 'cle' });
    let s = await reg.pushManager.getSubscription();
    if (s && !info.abonne) { await s.unsubscribe().catch(() => {}); s = null; }
    if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleBytes(info.cle) });
    if (!info.abonne || info.fin !== s.endpoint.slice(-16)) {
      await appel({ action: 'abonner', abonnement: s.toJSON(), horaires: m.horaires, source });
      return 'repare';
    }
    return 'ok';
  }

  /* Report : une note non faite d'un jour passé passe à aujourd'hui (« Reportée ×N »). */
  async function reporter(db, jour) {
    const notes = await all(db, 'notes');
    const maj = [];
    notes.forEach(n => {
      if (!n.done && n.date < jour) { n.reports = (n.reports || 0) + Math.max(1, joursEntre(n.date, jour)); n.date = jour; maj.push(n); }
    });
    if (maj.length) await putMany(db, 'notes', maj);
    return maj.length;
  }

  function trier(a, b) {
    return MORDER.indexOf(a.moment) - MORDER.indexOf(b.moment) || (a.heure || '99').localeCompare(b.heure || '99') || (a.cree || 0) - (b.cree || 0);
  }

  /* Texte des récaps, composé sur le téléphone : matin (la journée) ou soir (demain). */
  function recap(notes, jour, kind) {
    const s = (n, m) => n > 1 ? m + 's' : m;
    const liste = l => {
      let c = l.slice(0, 4).map(n => '• ' + n.resume + (n.heure ? ' (' + heureFr(n.heure) + ')' : '')).join('\n');
      if (l.length > 4) c += `\n… et ${l.length - 4} ${s(l.length - 4, 'autre')}`;
      return c;
    };
    if (kind === 'soir') {
      const dem = addDays(jour, 1);
      const l = notes.filter(n => n.date === dem && !n.done).sort(trier);
      const reste = notes.filter(n => n.date <= jour && !n.done).length;
      const titre = l.length ? `Demain : ${l.length} ${s(l.length, 'note')}` : 'Rien de prévu demain';
      const corps = [liste(l), reste ? `Encore ${reste} à faire aujourd'hui` : ''].filter(Boolean).join('\n');
      return { titre, corps, nombre: l.length };
    }
    const l = notes.filter(n => n.date === jour && !n.done).sort(trier);
    const rep = l.filter(n => n.reports > 0).length;
    const titre = l.length ? `Ta journée : ${l.length} ${s(l.length, 'note')}${rep ? `, dont ${rep} ${s(rep, 'reportée')}` : ''}` : "Rien de prévu aujourd'hui";
    return { titre, corps: liste(l), nombre: l.length };
  }

  G.ArdoiseStore = { getMeta, verifierAbonnement, cleBytes, MORDER, MOMENTS, TYPES, envDe, key, fromKey, addDays, today, heureFr, open, all, put, del, remplacer, putMany, reporter, trier, recap };
})(self);
