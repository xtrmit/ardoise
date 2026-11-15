/* L'Ardoise — logique de l'app : cartes du jour et de demain, dictée, analyse IA via n8n, aperçu,
   gestes (barrer, modifier, reporter, supprimer), purge, réglages et notifications.
   Les notes restent sur le téléphone (IndexedDB, voir js/store.js). */
'use strict';
const ENV = window.ARDOISE_ENV || 'local';
const VERSION = self.ARDOISE_VERSION || '?';
const St = self.ArdoiseStore;
const API = 'https://monn8n06.duckdns.org/webhook/' + (ENV === 'prod' ? 'ardoise' : 'ardoise-test') + '/api';
const KEY = 'ardoise:' + ENV + ':reglages';
const $ = s => document.querySelector(s);

/* ================== Icônes (trait fin) ================== */
const P = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  gear: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  broom: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  pin: '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3zM12 14v7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  next: '<path d="M5 12h12M13 7l5 5-5 5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  wait: '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0"/><path d="M3 3l18 18"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M7 5l12 7-12 7z"/>'
};
const ico = k => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${P[k]}</svg>`;
const TYPES = {
  tache: { label: 'Tâche', c: 'var(--t-tache)', i: 'check' },
  rdv: { label: 'Rendez-vous', c: 'var(--t-rdv)', i: 'cal' },
  rappel: { label: 'Rappel', c: 'var(--t-rappel)', i: 'bell' },
  action: { label: 'Action', c: 'var(--t-action)', i: 'bolt' },
  memo: { label: 'Pense-bête', c: 'var(--t-memo)', i: 'pin' }
};
const MOMENTS = St.MOMENTS, MORDER = St.MORDER;

/* ================== État ================== */
let R = { theme: 'auto', jeton: '' };
try { R = Object.assign(R, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
function saveR() { try { localStorage.setItem(KEY, JSON.stringify(R)); } catch (e) {} }

let db = null, N = [], A = [];          // N : notes, A : saisies en attente d'analyse
let jour = St.today();
let voirTard = false;                    // liste « plus tard » affichée à la demande, remasquée en quittant l'app
if (!R.premierUsage) { R.premierUsage = Date.now(); saveR(); }
const uid = () => (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nice = k => St.fromKey(k).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const niceLong = k => { const s = St.fromKey(k).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); return s[0].toUpperCase() + s.slice(1); };
const plur = (n, m) => n > 1 ? m.replace(/(\S+)/g, '$1s') : m;
function heureNow() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

async function persist(n) { try { await St.put(db, 'notes', n); } catch (e) { toast("Impossible d'enregistrer sur le téléphone"); } }
async function snapshot() {
  const snap = JSON.stringify(N);
  return async () => { N = JSON.parse(snap); await St.remplacer(db, 'notes', N); render(); };
}

/* ================== Rendu ================== */
function cardHTML(n) {
  const t = TYPES[n.type] || TYPES.tache, late = n.reports > 0 && !n.done;
  const meta = [`<span>${ico('clock')}${MOMENTS[n.moment] || 'Journée'}${n.heure ? ' · ' + St.heureFr(n.heure) : ''}</span>`];
  if (n.personne) meta.push(`<span>${ico('user')}${esc(n.personne)}</span>`);
  if (late) meta.push(`<span class="rep">Reportée ×${n.reports}</span>`);
  const droite = n.date <= jour ? 'Demain' : '+1 jour';
  return `<div class="cw"><div class="sw-bg"><span class="sw-l">${ico('next')}${droite}</span><span class="sw-r">Supprimer${ico('trash')}</span></div>
    <div class="card ${n.done ? 'done' : ''} ${late ? 'late' : ''}" data-id="${n.id}" style="--tc:${t.c}">
    <div class="body"><div class="res">${esc(n.resume)}</div><div class="meta">${meta.join('')}</div></div>
    <div class="ticon" title="${t.label}">${ico(t.i)}</div></div></div>`;
}
function render() {
  const t1 = St.addDays(jour, 1);
  $('#todayLabel').textContent = niceLong(jour);
  document.body.classList.toggle('offline', !navigator.onLine);
  const today = N.filter(n => n.date === jour || (n.date < jour && n.done)).sort(St.trier);
  const tom = N.filter(n => n.date === t1).sort(St.trier);
  const later = N.filter(n => n.date > t1).length;
  const lateCount = today.filter(n => n.reports > 0 && !n.done).length;
  const todo = today.filter(n => !n.done).length;
  const doneCount = N.filter(n => n.done).length;
  const pb = $('#purgeBtn');
  pb.innerHTML = ico('broom') + 'Purger' + (doneCount ? ' (' + doneCount + ')' : '');
  pb.disabled = !doneCount;

  let h = '';
  if (!R.jeton) h += `<div class="notice"><span>Saisis ton jeton pour activer la dictée et l'analyse.</span><button data-go="jeton">Réglages</button></div>`;
  else if (N.length && Date.now() - (R.sauvegarde || R.premierUsage) > 30 * 86400000 && Date.now() > (R.repousseSauvegarde || 0))
    h += `<div class="notice"><span>Tes notes ne sont que sur ce téléphone : pense à exporter une sauvegarde.</span><button data-go="exp">Exporter</button><button data-go="snooze">Plus tard</button></div>`;
  h += `<div class="sec-head"><h2>Aujourd'hui</h2><span class="d">${nice(jour)}</span><span class="sp"></span>${lateCount ? `<span class="late-dot" title="Reportées">${lateCount}</span>` : ''}<span class="count">${todo}</span></div>`;
  A.slice().sort((a, b) => a.cree - b.cree).forEach(p => {
    const lib = p.kind === 'voice' ? 'Note vocale · ' + p.len : '« ' + esc(p.texte) + ' »';
    const etat = p.etat === 'analyse' ? 'Analyse en cours…' : p.etat === 'valider' ? 'À valider' : (navigator.onLine && R.jeton ? 'En attente d\'analyse · toucher pour les options' : 'En attente du réseau, analysée au retour');
    h += `<div class="card pending" data-pid="${p.id}"><div class="body"><div class="res">${lib}</div><div class="meta"><span>${ico('wait')}${etat}</span></div></div></div>`;
  });
  h += today.length ? today.map(cardHTML).join('') : (A.length ? '' : `<div class="empty">Rien pour aujourd'hui. Maintiens le micro pour noter quelque chose.</div>`);
  h += `<div class="sec-head"><h2>Demain</h2><span class="d">${nice(t1)}</span><span class="sp"></span><span class="count">${tom.length}</span></div>`;
  h += `<div class="tomorrow">${tom.length ? tom.map(cardHTML).join('') : '<div class="empty">Rien de prévu pour demain.</div>'}</div>`;
  if (later) {
    h += `<button class="later" data-tard>${ico('eye')}<span>${later} ${plur(later, 'note programmée')} plus tard, ${plur(later, 'visible')} la veille</span><b>${voirTard ? 'Masquer' : 'Afficher'}</b></button>`;
    if (voirTard) {
      const tard = N.filter(n => n.date > t1).sort((a, b) => a.date.localeCompare(b.date) || St.trier(a, b));
      let d = '';
      h += '<div class="tard">';
      tard.forEach(n => { if (n.date !== d) { d = n.date; h += `<div class="tard-d">${niceLong(d)}</div>`; } h += cardHTML(n); });
      h += '</div>';
    }
  }
  $('#list').innerHTML = h;
  syncMic();
}

/* ================== Toast + annuler ================== */
let toastT, undoFn;
function toast(msg, undo) {
  $('#toastMsg').textContent = msg; undoFn = undo; $('#toastUndo').style.display = undo ? '' : 'none';
  $('#toast').classList.add('on'); clearTimeout(toastT);
  toastT = setTimeout(() => { $('#toast').classList.remove('on'); undoFn = null; }, undo ? 5000 : 3500);
}
$('#toastUndo').onclick = () => { const f = undoFn; undoFn = null; $('#toast').classList.remove('on'); if (f) f(); };

/* ================== Feuilles (avec le bouton retour d'Android) ================== */
let sheetOpen = false, onSheetClose = null;
function openSheet(html, opts) {
  opts = opts || {};
  $('#sheet').innerHTML = '<div class="grab"></div>' + (opts.noClose ? '' : `<button class="sheet-x" data-close aria-label="Fermer">${ico('x')}</button>`) + html;
  $('#sheet').dataset.noclose = opts.noClose ? '1' : '';
  $('#sheet').scrollTop = 0;
  $('#sheet').onclick = null; $('#sheet').onchange = null;
  $('#sheet').classList.add('on'); $('#backdrop').classList.add('on');
  $('#backdrop').dataset.lock = opts.lock ? '1' : '';
  onSheetClose = opts.onClose || null;
  if (!sheetOpen) { try { history.pushState({ ardoiseSheet: 1 }, ''); } catch (e) {} }
  sheetOpen = true;
}
function hideSheet() {
  $('#sheet').classList.remove('on'); $('#backdrop').classList.remove('on');
  const f = onSheetClose; onSheetClose = null; sheetOpen = false;
  if (f) f();
  setTimeout(() => { ouvrirSuivant(); traiterAttente(); }, 400);
}
function closeSheet(silent) {
  if (!sheetOpen) return;
  if (silent) onSheetClose = null;
  hideSheet();
  if (history.state && history.state.ardoiseSheet) { try { history.back(); } catch (e) {} }
}
window.addEventListener('popstate', () => { if (sheetOpen) hideSheet(); });
$('#backdrop').onclick = () => { if (!$('#backdrop').dataset.lock) closeSheet(); };
$('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) { e.stopImmediatePropagation(); closeSheet(); } }, true);
/* Glisser la feuille vers le bas pour la fermer */
(function () {
  const sh = $('#sheet'); let g = null;
  sh.addEventListener('touchstart', e => {
    if (sh.dataset.noclose || sh.scrollTop > 0 || e.target.closest('input,textarea,select')) { g = null; return; }
    g = { y: e.touches[0].clientY, dy: 0 };
  }, { passive: true });
  sh.addEventListener('touchmove', e => {
    if (!g) return;
    const dy = e.touches[0].clientY - g.y;
    if (dy <= 0 || sh.scrollTop > 0) { if (g.dy) { sh.style.transform = ''; g.dy = 0; } if (dy < -6) g = null; return; }
    e.preventDefault(); g.dy = dy; sh.style.transition = 'none'; sh.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  sh.addEventListener('touchend', () => {
    if (!g) return; const fermer = g.dy > 90; g = null;
    sh.style.transition = ''; sh.style.transform = '';
    if (fermer) closeSheet();
  });
})();

/* ================== Gestes sur les cartes ================== */
let pressT, pressEl, longDone, startX, startY, swipe = false, dxSw = 0;
const SEUIL = 80;
$('#list').addEventListener('pointerdown', e => {
  const c = e.target.closest('.card[data-id]'); if (!c) return;
  pressEl = c; longDone = false; swipe = false; dxSw = 0; startX = e.clientX; startY = e.clientY; c.classList.add('pressing');
  pressT = setTimeout(() => {
    if (swipe) return;
    longDone = true; c.classList.remove('pressing');
    if (navigator.vibrate) navigator.vibrate(15);
    openActions(c.dataset.id);
  }, 480);
});
$('#list').addEventListener('pointermove', e => {
  if (!pressEl) return;
  const dx = e.clientX - startX, dy = e.clientY - startY;
  if (!swipe && !longDone && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
    swipe = true; clearTimeout(pressT); pressEl.classList.remove('pressing'); pressEl.classList.add('swiping');
    try { pressEl.setPointerCapture(e.pointerId); } catch (err) {}
  }
  if (swipe) {
    dxSw = dx;
    pressEl.style.transform = `translateX(${dx}px)`;
    const w = pressEl.parentElement;
    w.classList.toggle('sw-right', dx > 0); w.classList.toggle('sw-left', dx < 0);
    w.classList.toggle('sw-armed', Math.abs(dx) > SEUIL);
    return;
  }
  // Mouvement vertical franc : c'est un défilement de la liste, pas un geste sur la carte.
  if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { clearTimeout(pressT); pressEl.classList.remove('pressing'); pressEl = null; }
  else if (Math.abs(dx) > 6 || Math.abs(dy) > 6) clearTimeout(pressT);   // le doigt bouge : pas d'appui long
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('#list').addEventListener(ev, async () => {
  if (ev === 'pointerleave' && swipe) return;          // doigt capturé : le geste continue hors de la liste
  clearTimeout(pressT); if (!pressEl) return;
  const el = pressEl; pressEl = null; el.classList.remove('pressing');
  if (swipe) {
    swipe = false;
    const n = N.find(x => x.id === el.dataset.id), dx = ev === 'pointercancel' ? 0 : dxSw;
    el.classList.remove('swiping');
    if (n && Math.abs(dx) > SEUIL) {
      el.style.transform = `translateX(${dx > 0 ? 110 : -110}%)`;
      if (navigator.vibrate) navigator.vibrate(12);
      setTimeout(() => (dx > 0 ? repousser(n) : supprimerNote(n)), 160);
    } else {
      el.style.transform = '';
      setTimeout(() => el.parentElement && el.parentElement.classList.remove('sw-right', 'sw-left', 'sw-armed'), 200);
    }
    return;
  }
  if (ev === 'pointerup' && !longDone) {
    const n = N.find(x => x.id === el.dataset.id);
    if (n) { n.done = !n.done; render(); await persist(n); }
  }
}));
async function repousser(n) {
  const u = await snapshot();
  n.date = St.addDays(n.date < jour ? jour : n.date, 1); n.reports = 0;
  await persist(n); render();
  toast(n.date === St.addDays(jour, 1) ? 'Reportée à demain' : 'Repoussée au ' + nice(n.date) + (n.date > St.addDays(jour, 1) ? ' · visible la veille' : ''), u);
}
async function supprimerNote(n) {
  const u = await snapshot();
  N = N.filter(x => x !== n); await St.del(db, 'notes', n.id); render();
  toast('Note supprimée', u);
}
$('#list').addEventListener('contextmenu', e => e.preventDefault());
$('#list').addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) {
    if (go.dataset.go === 'exp') exporter();
    else if (go.dataset.go === 'snooze') { R.repousseSauvegarde = Date.now() + 7 * 86400000; saveR(); render(); }
    else openSettings();
    return;
  }
  if (e.target.closest('[data-tard]')) { voirTard = !voirTard; render(); return; }
  const p = e.target.closest('.card[data-pid]'); if (p) openPending(p.dataset.pid);
});

function openActions(id) {
  const n = N.find(x => x.id === id); if (!n) return;
  openSheet(`<h3>${esc(n.resume)}</h3><div class="sub">${(TYPES[n.type] || TYPES.tache).label} · ${nice(n.date)} · ${MOMENTS[n.moment] || 'Journée'}${n.heure ? ' · ' + St.heureFr(n.heure) : ''}${n.personne ? ' · ' + esc(n.personne) : ''}</div>
    <button class="act" data-a="edit">${ico('edit')}Modifier</button>
    ${n.date < St.addDays(jour, 1) ? `<button class="act" data-a="tomorrow">${ico('next')}Reporter à demain</button>` : ''}
    <button class="act" data-a="pick">${ico('cal')}Choisir une date</button>
    <div id="pickRow" style="display:none;padding:4px 6px 10px"><input type="date" class="txt" id="pickDate" value="${n.date}" min="${jour}"></div>
    <button class="act danger" data-a="del">${ico('trash')}Supprimer</button>`);
  $('#sheet').onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'edit') { openEditor([Object.assign({}, n)], { mode: 'edit' }); return; }
    if (a === 'pick') {
      $('#pickRow').style.display = 'block';
      const inp = $('#pickDate');
      inp.onchange = async () => {
        if (!inp.value) return;
        if (inp.value < jour) { inp.value = n.date; toast('Choisis aujourd\'hui ou une date à venir'); return; }
        const u = await snapshot(); n.date = inp.value; n.reports = 0; closeSheet(); render(); await persist(n);
        toast('Reportée au ' + nice(n.date) + (n.date > St.addDays(jour, 1) ? ' · visible la veille' : ''), u);
      };
      try { inp.showPicker(); } catch (err) { inp.focus(); }
      return;
    }
    closeSheet();
    if (a === 'tomorrow') return repousser(n);
    if (a === 'del') return supprimerNote(n);
  };
}

/* ================== Éditeur : aperçu après analyse, ou modification ================== */
function draftHTML(d, i, mode) {
  const t1 = St.addDays(jour, 1), t = TYPES[d.type] || TYPES.tache;
  const chipD = (v, l) => `<button class="chip ${d.date === v ? 'on' : ''}" data-f="date" data-v="${v}">${l}</button>`;
  return `<div class="draft" data-i="${i}" style="--tc:${t.c}">
    ${mode === 'preview' ? `<button class="x" data-rm="${i}" aria-label="Retirer cette note">${ico('x')}</button>` : ''}
    <input class="txt" data-f="resume" value="${esc(d.resume)}" placeholder="Résumé" style="font-weight:600;${mode === 'preview' ? 'width:calc(100% - 32px)' : ''}">
    <div class="lbl">Quand</div>
    <div class="row">${chipD(jour, "Aujourd'hui")}${chipD(t1, 'Demain')}<input type="date" class="mini" data-f="datepick" value="${d.date}" min="${jour}"></div>
    <div class="lbl">Moment</div>
    <div class="chips">${MORDER.map(m => `<button class="chip ${d.moment === m ? 'on' : ''}" data-f="moment" data-v="${m}">${MOMENTS[m]}</button>`).join('')}</div>
    <div class="row" style="margin-top:10px;gap:10px;flex-wrap:nowrap">
      <div style="flex:1;min-width:0"><div class="lbl" style="margin-top:0">Personne</div><input class="txt" data-f="personne" value="${esc(d.personne)}" placeholder="—"></div>
      <div style="width:118px;flex:none"><div class="lbl" style="margin-top:0">Heure</div><input type="time" class="txt" data-f="heure" value="${d.heure || ''}"></div>
    </div>
    ${mode === 'edit' ? `<div class="lbl">Type</div><div class="row">${Object.entries(TYPES).map(([k, x]) => `<button class="tdot ${d.type === k ? 'on' : ''}" style="--tc:${x.c}" data-f="type" data-v="${k}" aria-label="${x.label}"><i></i></button>`).join('')}<span style="font-size:13px;color:var(--muted)">${t.label}</span></div>` : ''}
  </div>`;
}
function openEditor(drafts, opts) {
  const mode = opts.mode;
  let saved = false;
  const fermer = () => {
    if (mode !== 'preview' || saved) return;
    if (opts.ids) supprimerAttente(opts.ids);
    toast(drafts.length > 1 ? 'Notes abandonnées' : 'Note abandonnée', () => openEditor(drafts, Object.assign({}, opts, { ids: null })));
  };
  const draw = () => {
    if (!drafts.length) { closeSheet(); return; }
    openSheet(`${mode === 'preview'
      ? `<h3>${drafts.length > 1 ? drafts.length + ' notes détectées' : 'Note détectée'}</h3>${opts.said ? `<div class="said">« ${esc(opts.said)} »</div>` : ''}${opts.warn ? `<div class="warn">${esc(opts.warn)}</div>` : ''}`
      : '<h3>Modifier la note</h3><div class="sub"></div>'}
      ${drafts.map((d, i) => draftHTML(d, i, mode)).join('')}
      <div class="btns"><button class="btn" data-b="cancel">Annuler</button><button class="btn primary" data-b="ok">${mode === 'preview' ? (drafts.length > 1 ? 'Tout enregistrer' : 'Enregistrer') : 'Valider'}</button></div>`,
    { lock: mode === 'preview', onClose: fermer });
    const sh = $('#sheet');
    sh.onclick = async e => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { lire(); drafts.splice(+rm.dataset.rm, 1); if (!drafts.length) { closeSheet(); return; } draw(); return; }
      const f = e.target.closest('button[data-f]');
      if (f) { const i = +f.closest('.draft').dataset.i; lire(); drafts[i][f.dataset.f] = f.dataset.v; draw(); return; }
      const b = e.target.closest('[data-b]')?.dataset.b; if (!b) return;
      if (b === 'cancel') { closeSheet(); return; }
      lire();
      const vides = drafts.filter(d => !d.resume.trim());
      if (vides.length) { toast('Ajoute un résumé à chaque note'); return; }
      const u = await snapshot();
      saved = true;
      if (mode === 'edit') {
        const n = N.find(x => x.id === drafts[0].id);
        if (n) { const avant = n.date; Object.assign(n, drafts[0]); if (n.date !== avant) n.reports = 0; await persist(n); }
        toast('Note modifiée', u);
      } else {
        const nouvelles = drafts.map(d => ({ id: uid(), resume: d.resume.trim(), personne: (d.personne || '').trim(), type: TYPES[d.type] ? d.type : 'tache',
          date: d.date < jour ? jour : d.date, moment: MOMENTS[d.moment] ? d.moment : 'journee', heure: d.heure || '', done: false, reports: 0, cree: Date.now() }));
        N.push(...nouvelles);
        await St.putMany(db, 'notes', nouvelles);
        if (opts.ids) supprimerAttente(opts.ids);
        const far = nouvelles.filter(d => d.date > St.addDays(jour, 1));
        toast(nouvelles.length > 1 ? `${nouvelles.length} notes enregistrées` + (far.length ? ` · ${far.length} ${plur(far.length, 'visible')} la veille` : '')
          : far.length ? `Enregistrée pour ${nice(far[0].date)} · visible la veille` : 'Note enregistrée', u);
      }
      closeSheet(); render();
    };
    sh.onchange = e => {
      const el = e.target;
      if (el.dataset.f === 'datepick' && el.value) {
        const i = +el.closest('.draft').dataset.i; lire();
        if (el.value < jour) { toast('Choisis aujourd\'hui ou une date à venir'); draw(); return; }
        drafts[i].date = el.value; draw();
      }
    };
  };
  function lire() {
    $('#sheet').querySelectorAll('.draft').forEach(dv => {
      const d = drafts[+dv.dataset.i]; if (!d) return;
      dv.querySelectorAll('input[data-f]').forEach(inp => { if (inp.dataset.f !== 'datepick') d[inp.dataset.f] = inp.value; });
    });
  }
  draw();
}

/* ================== Appel à n8n ================== */
class ErreurApi extends Error { constructor(type, msg) { super(msg || type); this.type = type; } }
async function api(body, timeoutMs) {
  if (!R.jeton) throw new ErreurApi('jeton');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs || 20000);
  let r;
  try {
    r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ardoise-jeton': R.jeton }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) { throw new ErreurApi('reseau'); } finally { clearTimeout(t); }
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (r.status === 401) throw new ErreurApi('jeton');
  if (!r.ok || !j.ok) { const err = new ErreurApi(j.erreur || 'serveur'); err.texte = j.texte; throw err; }
  return j;
}
function blobB64(b) {
  return new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).replace(/^data:[^,]*,/, '')); f.onerror = () => rej(f.error); f.readAsDataURL(b); });
}
async function analyser(item) {
  const body = { action: 'analyser', date: item.date, heure: item.heure };
  if (item.kind === 'voice') { body.audio = await blobB64(item.audio); body.mime = item.mime; } else body.texte = item.texte;
  return api(body, 45000);
}

/* ================== Saisies et file d'attente ================== */
async function ajouterAttente(item) { A.push(item); try { await St.put(db, 'attente', item); } catch (e) {} render(); }
function supprimerAttente(ids) {
  A = A.filter(p => !ids.includes(p.id));
  ids.forEach(id => St.del(db, 'attente', id).catch(() => {}));
  render();
}
async function nouvelleSaisie(item) {
  Object.assign(item, { id: uid(), cree: Date.now(), date: St.today(), heure: heureNow() });
  await ajouterAttente(item);
  if (!R.jeton) { toast('Note gardée : saisis ton jeton dans les Réglages pour l\'analyser'); return; }
  if (!navigator.onLine) { toast('Pas de réseau : note gardée, analysée au retour du réseau'); return; }
  analyserUne(item, true);          // en arrière-plan : on peut enchaîner une autre saisie
}
/* Analyse d'une saisie. Renvoie false si l'erreur est passagère (réseau, jeton, serveur) : on réessaiera. */
async function analyserUne(item, direct) {
  item.etat = 'analyse'; render();
  try {
    const r = await analyser(item);
    item.etat = '';
    await appliquer(r.notes, r.texte, [item.id], direct ? '' : 'Note saisie plus tôt, à valider.');
    return true;
  } catch (e) {
    item.etat = ''; render();
    return gererErreur(e, item, direct);
  }
}

/* Notes à valider : ouvertes une par une, dès qu'aucune fenêtre ni dictée n'est en cours. */
const aValider = [];
function proposer(x) {
  x.ids.forEach(id => { const p = A.find(q => q.id === id); if (p) p.etat = 'valider'; });
  aValider.push(x); render(); ouvrirSuivant();
}
function ouvrirSuivant() {
  if (sheetOpen || rec || !aValider.length || document.activeElement === inp) return;
  const x = aValider.shift();
  openEditor(x.notes, { mode: 'preview', said: x.said, ids: x.ids, warn: x.warn });
}

/* Résultat d'analyse : les notes complètes (action claire + jour + heure ou moment) sont enregistrées
   directement, avec « Annuler » ; les autres passent par la carte d'aperçu. */
async function appliquer(notes, said, ids, warn) {
  // Sans date (ou date passée) : aujourd'hui. Seule une note incomprise passe par la fiche à compléter.
  notes.forEach(n => { if (!n.date || n.date < jour) n.date = jour; });
  const ok = notes.filter(n => n.complete && (n.resume || '').trim());
  const reste = notes.filter(n => !ok.includes(n));
  if (ok.length) {
    const nouvelles = ok.map(d => ({ id: uid(), resume: d.resume.trim(), personne: (d.personne || '').trim(), type: TYPES[d.type] ? d.type : 'tache',
      date: d.date, moment: MOMENTS[d.moment] ? d.moment : 'journee', heure: d.heure || '', done: false, reports: 0, cree: Date.now() }));
    N.push(...nouvelles);
    await St.putMany(db, 'notes', nouvelles);
    const idsN = nouvelles.map(n => n.id);
    const undo = async () => { N = N.filter(n => !idsN.includes(n.id)); for (const id of idsN) await St.del(db, 'notes', id); render(); };
    const quand = n => (n.date === jour ? "aujourd'hui" : n.date === St.addDays(jour, 1) ? 'demain' : nice(n.date) + ', visible la veille');
    toast(nouvelles.length > 1 ? `${nouvelles.length} notes enregistrées` : `Enregistrée pour ${quand(nouvelles[0])} : ${nouvelles[0].resume}`, undo);
  }
  if (reste.length) proposer({ notes: reste, said, ids, warn: (ok.length ? `${ok.length} ${plur(ok.length, 'note enregistrée')}. ` : '') + "Je n'ai pas tout compris : complète." });
  else supprimerAttente(ids);
  render();
}
function brouillonDe(item, texte) {
  return { resume: (texte || '').trim(), personne: '', type: 'tache', date: item.date < jour ? jour : item.date, moment: 'journee', heure: '' };
}
function gererErreur(e, item, direct) {
  switch (e.type) {
    case 'vide': supprimerAttente([item.id]); toast(item.kind === 'voice' ? "Je n'ai rien entendu. Réessaie en parlant près du micro." : 'Note vide'); return true;
    case 'trop-long': supprimerAttente([item.id]); toast('Dictée trop longue : fais plusieurs notes plus courtes'); return true;
    case 'incompris': proposer({ notes: [brouillonDe(item, e.texte || item.texte)], said: e.texte || item.texte, ids: [item.id], warn: "Je n'ai pas tout compris : complète la note." }); return true;
    case 'jeton': if (direct) toast('Jeton refusé : vérifie-le dans les Réglages. Note gardée.'); return false;
    case 'reseau': if (direct) toast('Pas de réseau : note gardée, analysée au retour du réseau'); return false;
    default: if (direct) toast("Analyse impossible pour le moment. Note gardée, réessai plus tard."); return false;
  }
}
let attenteEnCours = false;
async function traiterAttente() {
  ouvrirSuivant();
  if (attenteEnCours || !navigator.onLine || !R.jeton) return;
  const liste = A.filter(p => !p.etat).sort((a, b) => a.cree - b.cree);
  if (!liste.length) return;
  attenteEnCours = true;
  try {
    for (const item of liste) {
      if (!navigator.onLine || !A.includes(item)) continue;
      if (await analyserUne(item, false) === false) break;   // passager : on réessaiera plus tard
    }
  } finally { attenteEnCours = false; render(); }
}
function openPending(pid) {
  const p = A.find(x => x.id === pid); if (!p || p.etat === 'analyse' || p.etat === 'valider') return;
  openSheet(`<h3>${p.kind === 'voice' ? 'Note vocale · ' + p.len : '« ' + esc(p.texte) + ' »'}</h3>
    <div class="sub">Saisie le ${nice(p.date)} à ${St.heureFr(p.heure)}. Elle sera analysée dès que possible.</div>
    ${navigator.onLine && R.jeton ? `<button class="act" data-a="go">${ico('play')}Analyser maintenant</button>` : ''}
    ${p.kind === 'text' ? `<button class="act" data-a="hand">${ico('edit')}Saisir à la main</button>` : ''}
    <button class="act danger" data-a="del">${ico('trash')}Supprimer</button>`);
  $('#sheet').onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'go') { closeSheet(); setTimeout(() => analyserUne(p, true), 300); }
    if (a === 'hand') openEditor([brouillonDe(p, p.texte)], { mode: 'preview', said: p.texte, ids: [p.id] });
    if (a === 'del') { closeSheet(); supprimerAttente([p.id]); toast('Note supprimée'); }
  };
}

/* ================== Saisie texte ================== */
const mic = $('#mic'), inp = $('#textInput');
function syncMic() {
  const t = !!inp.value.trim();
  mic.innerHTML = ico(t ? 'send' : 'mic');
  mic.setAttribute('aria-label', t ? 'Envoyer' : 'Maintenir pour dicter');
}
inp.addEventListener('input', syncMic);
inp.addEventListener('blur', () => setTimeout(ouvrirSuivant, 300));
$('#textForm').onsubmit = e => { e.preventDefault(); envoyerTexte(); };
function envoyerTexte() {
  const t = inp.value.trim(); if (!t) return;
  inp.value = ''; syncMic(); inp.blur();
  nouvelleSaisie({ kind: 'text', texte: t.slice(0, 2000) });
}

/* ================== Dictée : appui maintenu pendant qu'on parle ================== */
let rec = null;
const MAX_MS = 60000;
function mimeAudio() {
  if (!self.MediaRecorder) return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
function recUI(on, phase) {
  $('#rec').classList.toggle('on', on);
  $('#rec').classList.toggle('starting', phase === 'starting');
  mic.classList.toggle('recording', on && phase === 'rec');
  if (!on) mic.classList.remove('cancel');
  $('#recTip').textContent = phase === 'starting' ? 'Préparation du micro…' : 'Parle, puis relâche pour envoyer · glisse vers le haut pour annuler';
}
mic.addEventListener('contextmenu', e => e.preventDefault());
mic.addEventListener('pointerdown', e => {
  if (inp.value.trim()) return;                 // un texte est tapé : le bouton sert à envoyer
  e.preventDefault();
  if (rec) return;
  const mime = mimeAudio();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !mime) { toast("Dictée indisponible ici : utilise le micro du clavier"); return; }
  try { mic.setPointerCapture(e.pointerId); } catch (err) {}
  const r = rec = { phase: 'starting', up: false, cancel: false, y: e.clientY, mime };
  recUI(true, 'starting');
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(stream => {
    if (rec !== r) { stream.getTracks().forEach(t => t.stop()); return; }
    if (r.up) {                                   // relâché avant que le micro soit prêt (souvent : première autorisation)
      stream.getTracks().forEach(t => t.stop()); rec = null; recUI(false);
      toast('Micro prêt : maintiens le bouton pendant que tu parles'); return;
    }
    const chunks = [];
    const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    mr.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    mr.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const dur = Date.now() - r.t0;
      if (r.cancel) { toast('Dictée annulée'); return; }
      if (dur < 600) { toast('Maintiens le bouton pendant que tu parles'); return; }
      const s = Math.round(dur / 1000);
      nouvelleSaisie({ kind: 'voice', audio: new Blob(chunks, { type: mime.split(';')[0] }), mime, len: Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') });
      setTimeout(ouvrirSuivant, 300);
    };
    r.mr = mr; r.t0 = Date.now(); r.phase = 'rec';
    mr.start(250);
    recUI(true, 'rec');
    if (navigator.vibrate) navigator.vibrate(20);
    const tick = () => { const s = Math.floor((Date.now() - r.t0) / 1000); $('#recTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    tick(); r.timer = setInterval(tick, 250);
    r.max = setTimeout(() => { if (rec === r) { toast('Une minute maximum par dictée'); stopRec(); } }, MAX_MS);
  }).catch(() => {
    if (rec === r) { rec = null; recUI(false); }
    toast("Micro refusé. Autorise-le : Paramètres du téléphone → Applications → L'Ardoise → Autorisations → Micro.");
  });
});
mic.addEventListener('pointermove', e => {
  if (!rec) return;
  rec.cancel = (rec.y - e.clientY) > 70;
  mic.classList.toggle('cancel', rec.cancel);
  $('#rec').classList.toggle('cancelling', rec.cancel);
  if (rec.phase === 'rec') $('#recTip').textContent = rec.cancel ? 'Relâche pour annuler' : 'Parle, puis relâche pour envoyer · glisse vers le haut pour annuler';
});
function stopRec() {
  const r = rec; if (!r) return;
  rec = null; clearInterval(r.timer); clearTimeout(r.max); recUI(false);
  $('#rec').classList.remove('cancelling'); $('#recTime').textContent = '0:00';
  if (r.mr && r.mr.state !== 'inactive') r.mr.stop();
  setTimeout(ouvrirSuivant, 400);
}
mic.addEventListener('pointerup', () => {
  if (rec) { if (rec.phase === 'rec') stopRec(); else rec.up = true; return; }
  if (inp.value.trim()) envoyerTexte();
});
mic.addEventListener('pointercancel', () => { if (rec) { rec.cancel = true; if (rec.phase === 'rec') stopRec(); else rec.up = true; } });

/* ================== Purge ================== */
$('#purgeBtn').onclick = async () => {
  const n = N.filter(x => x.done).length; if (!n) return;
  const u = await snapshot();
  const ids = N.filter(x => x.done).map(x => x.id);
  N = N.filter(x => !x.done); render();
  for (const id of ids) await St.del(db, 'notes', id);
  toast(`${n} ${plur(n, 'carte barrée')} ${n > 1 ? 'supprimées' : 'supprimée'}`, u);
};

/* ================== Notifications (Web Push via n8n) ================== */
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function cleBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
const horaires = () => ({ matin: R.matin === undefined ? '07:00' : R.matin, soir: R.soir || '' });
function optionsHeures(de, a, val) {
  let o = `<option value="" ${val ? '' : 'selected'}>Désactivé</option>`;
  for (let h = de; h <= a; h++) for (const m of ['00', '15', '30', '45']) {
    const v = String(h).padStart(2, '0') + ':' + m;
    o += `<option value="${v}" ${v === val ? 'selected' : ''}>${h} h ${m === '00' ? '' : m}</option>`;
  }
  return o;
}
async function abonnement() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('sw')), 2000))]);
  return reg.pushManager.getSubscription();
}
async function activerNotifs() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error("Notifications refusées. Pour les autoriser : Paramètres du téléphone → Applications → L'Ardoise → Notifications.");
  const info = await api({ action: 'cle' });
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !info.abonne) { await sub.unsubscribe().catch(() => {}); sub = null; }   // ancien abonnement peut-être expiré : on repart d'un neuf
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleBytes(info.cle) });
  if (R.matin === undefined && info.horaires) { R.matin = info.horaires.matin; R.soir = info.horaires.soir; }
  await api({ action: 'abonner', abonnement: sub.toJSON(), horaires: horaires() });
  R.notifs = true; saveR();
}
/* Vérifie l'abonnement aux notifications au démarrage et au retour dans l'app (au plus une fois par heure).
   Si n8n l'a effacé (abonnement expiré chez Google, réponse 410), l'ancien est jeté et un nouveau est créé. */
let dernierControle = 0;
async function rafraichirAbonnement(force) {
  if (!pushOk() || !R.jeton || !R.notifs || Notification.permission !== 'granted' || !navigator.onLine) return;
  if (!force && Date.now() - dernierControle < 3600000) return;
  dernierControle = Date.now();
  try {
    const info = await api({ action: 'cle' });
    const reg = await navigator.serviceWorker.ready;
    let s = await reg.pushManager.getSubscription();
    if (s && !info.abonne) { await s.unsubscribe().catch(() => {}); s = null; }
    if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleBytes(info.cle) });
    await api({ action: 'abonner', abonnement: s.toJSON(), horaires: horaires() });
  } catch (e) { dernierControle = 0; }
}

/* ================== Réglages ================== */
function themeApply() {
  if (R.theme === 'light' || R.theme === 'dark') document.documentElement.setAttribute('data-theme', R.theme);
  else document.documentElement.removeAttribute('data-theme');
}
async function openSettings() {
  const sub = pushOk() ? await abonnement().catch(() => null) : null;
  const notifOn = !!(sub && R.notifs && Notification.permission === 'granted');
  const jetonAff = R.jeton ? '••••••' + esc(R.jeton.slice(-4)) : 'non saisi';
  let notifHTML;
  if (!pushOk()) notifHTML = '<span class="v">Indisponible sur ce navigateur</span>';
  else if (notifOn) notifHTML = `<button class="chip" data-x="essai">Essai</button><button class="chip" data-x="notifOff">Désactiver</button>
      <div class="hrow"><span>Récap du matin</span><select class="mini" data-h="matin">${optionsHeures(5, 11, horaires().matin)}</select></div>
      <div class="hrow"><span>Récap du soir (demain)</span><select class="mini" data-h="soir">${optionsHeures(17, 23, horaires().soir)}</select></div>`;
  else notifHTML = `<button class="chip on" data-x="notifOn">Activer</button>`;
  openSheet(`<h3>Réglages</h3><div class="sub">Ces réglages et toutes les notes restent sur ce téléphone.</div>
    <div class="set"><span class="k">Thème</span><div class="seg">${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => `<button data-th="${k}" class="${R.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="set"><span class="k">Notifications</span>${notifHTML}
      ${self.Notification && Notification.permission === 'denied' ? '<div class="note" style="color:var(--late)">Notifications bloquées : Paramètres du téléphone → Applications → L\'Ardoise → Notifications.</div>' : '<div class="note">Le matin, la liste du jour ; le soir, celle de demain. Les notes non faites passent automatiquement au lendemain.</div>'}</div>
    <div class="set" id="jetonRow"><span class="k">Jeton</span><span class="v">${jetonAff}</span><button class="chip" data-x="jeton">${R.jeton ? 'Modifier' : 'Saisir'}</button></div>
    <div class="set"><span class="k">Sauvegarde</span><button class="chip" data-x="exp">Exporter</button><button class="chip" data-x="imp">Importer</button>
      <input type="file" id="impFile" accept="application/json,.json" hidden></div>
    <div class="lbl" style="margin-top:16px">Couleurs des types</div>
    <div class="legend">${Object.values(TYPES).map(t => `<span style="--tc:${t.c}"><i></i>${t.label}</span>`).join('')}</div>
    <div class="set" style="border:0"><span class="k">L'Ardoise v${VERSION}${ENV !== 'prod' ? ' · ' + ENV.toUpperCase() : ''}</span><button class="chip" data-x="maj">Mise à jour</button><span class="note" id="majOut"></span></div>`);
  $('#sheet').onchange = async e => {
    const h = e.target.closest('[data-h]'); if (!h) return;
    const avant = { matin: R.matin, soir: R.soir };
    R[h.dataset.h] = h.value; saveR();
    try {
      const r = await api({ action: 'horaires', horaires: horaires() });
      toast(h.value ? `Récap du ${h.dataset.h === 'matin' ? 'matin' : 'soir'} à ${St.heureFr(h.value)}` : `Récap du ${h.dataset.h} désactivé`);
      if (r.horaires) { R.matin = r.horaires.matin; R.soir = r.horaires.soir; saveR(); }
    } catch (err) {
      R.matin = avant.matin; R.soir = avant.soir; saveR();
      toast(err.type === 'reseau' ? 'Pas de réseau : horaire non modifié' : 'Horaire non modifié'); openSettings();
    }
  };
  $('#sheet').onclick = async e => {
    const th = e.target.closest('[data-th]');
    if (th) { R.theme = th.dataset.th; saveR(); themeApply(); openSettings(); return; }
    const x = e.target.closest('[data-x]')?.dataset.x; if (!x) return;
    if (x === 'jeton') return saisirJeton();
    if (x === 'exp') return exporter();
    if (x === 'imp') { const f = $('#impFile'); f.onchange = () => f.files[0] && importer(f.files[0]); f.click(); return; }
    if (x === 'maj') return checkUpdate($('#majOut'));
    try {
      if (x === 'notifOn') { e.target.disabled = true; await activerNotifs(); toast('Notifications activées'); openSettings(); }
      if (x === 'notifOff') { const s = await abonnement(); if (s) await s.unsubscribe().catch(() => {}); await api({ action: 'desabonner' }).catch(() => {}); R.notifs = false; saveR(); toast('Notifications désactivées'); openSettings(); }
      if (x === 'essai') { await api({ action: 'essai', kind: 'essai' }); toast("Notification d'essai envoyée : elle arrive dans quelques secondes"); }
    } catch (err) {
      toast(err.type === 'jeton' ? 'Jeton refusé : vérifie-le' : err.type === 'reseau' ? 'Pas de réseau pour le moment' : (err.message || 'Erreur'));
      openSettings();
    }
  };
}
function saisirJeton() {
  const row = $('#jetonRow');
  row.innerHTML = `<span class="k">Jeton</span><input class="txt" id="jetonInp" placeholder="Colle ton jeton" autocomplete="off" autocapitalize="off" spellcheck="false" style="flex-basis:100%">
    <button class="chip on" data-j="ok">Vérifier et enregistrer</button><span class="note" id="jetonOut"></span>`;
  const i = $('#jetonInp'); i.focus();
  row.onclick = async e => {
    if (!e.target.closest('[data-j]')) return;
    e.stopPropagation();
    const v = i.value.trim(); if (!v) return;
    const old = R.jeton; R.jeton = v;
    $('#jetonOut').textContent = 'Vérification…';
    try { await api({ action: 'ping' }); saveR(); toast('Jeton enregistré'); render(); openSettings(); traiterAttente(); }
    catch (err) {
      R.jeton = old;
      $('#jetonOut').textContent = err.type === 'jeton' ? 'Jeton refusé.' : 'Impossible de vérifier (réseau). Réessaie plus tard.';
    }
  };
}
function exporter() {
  const data = { app: 'ardoise', version: VERSION, env: ENV, exporte: new Date().toISOString(), notes: N };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'ardoise-' + St.today() + '.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  R.sauvegarde = Date.now(); saveR(); render();
  toast('Sauvegarde enregistrée dans Téléchargements');
}
async function importer(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!d || d.app !== 'ardoise' || !Array.isArray(d.notes)) throw new Error();
    const ok = d.notes.filter(n => n && n.id && n.resume && /^\d{4}-\d{2}-\d{2}$/.test(n.date));
    const u = await snapshot();
    const ids = new Set(N.map(n => n.id));
    const nouv = ok.filter(n => !ids.has(n.id));
    N.push(...nouv); await St.putMany(db, 'notes', nouv);
    await St.reporter(db, jour); N = await St.all(db, 'notes');
    closeSheet(); render(); toast(`${nouv.length} ${plur(nouv.length, 'note importée')}`, u);
  } catch (e) { toast('Fichier de sauvegarde illisible'); }
}

/* ================== Hors ligne & mises à jour ================== */
let swReg = null;
async function checkUpdate(out) {
  if (!swReg) { out.textContent = 'Mises à jour indisponibles ici.'; return; }
  out.textContent = 'Recherche…';
  try { await swReg.update(); } catch (e) { out.textContent = 'Pas de réseau.'; return; }
  setTimeout(() => { if (!swReg.installing && !swReg.waiting) out.textContent = "L'Ardoise v" + VERSION + ' est à jour.'; }, 1500);
}
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { swReg = r; }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (sheetOpen || rec) { onSheetClose = (f => () => { if (f) f(); location.reload(); })(onSheetClose); return; }
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'recap') nouvelleJournee(); });
}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

/* ================== Changement de jour et réseau ================== */
async function nouvelleJournee() {
  jour = St.today();
  const n = await St.reporter(db, jour);
  N = await St.all(db, 'notes');
  render();
  if (n) toast(n > 1 ? `${n} notes non faites reportées à aujourd'hui` : `1 note non faite reportée à aujourd'hui`);
}
function planifierMinuit() {
  const d = new Date(); const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 5);
  setTimeout(() => { nouvelleJournee(); planifierMinuit(); }, m - d);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { if (voirTard) { voirTard = false; render(); } return; }
  if (swReg) swReg.update().catch(() => {});
  if (St.today() !== jour) nouvelleJournee(); else render();
  traiterAttente();
  rafraichirAbonnement();
});
window.addEventListener('online', () => { render(); traiterAttente(); rafraichirAbonnement(); });
window.addEventListener('offline', render);

/* ================== Mise en page stable ================== */
function recaler() { if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0); }
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(recaler, 50));
document.addEventListener('focusout', () => setTimeout(recaler, 100));
window.addEventListener('popstate', () => setTimeout(recaler, 50));

/* ================== Démarrage ================== */
$('#setBtn').innerHTML = ico('gear');
$('#setBtn').onclick = openSettings;
if (ENV !== 'prod') {
  const t = $('#envTag'); t.textContent = ENV.toUpperCase(); t.hidden = false; t.classList.add('env-' + ENV);
  $('#brandLogo').src = 'icons/test-icon-192.png';
}
themeApply();
(async () => {
  try {
    db = await St.open(ENV);
    await St.reporter(db, jour);
    N = await St.all(db, 'notes');
    A = await St.all(db, 'attente');
  } catch (e) { toast('Stockage du téléphone indisponible'); }
  render();
  planifierMinuit();
  if (R.lastV && R.lastV !== VERSION) R.updNote = VERSION;
  R.lastV = VERSION; saveR();
  if (R.updNote === VERSION) setTimeout(() => { toast("L'Ardoise mise à jour (v" + VERSION + ')'); setTimeout(() => { delete R.updNote; saveR(); }, 4000); }, 500);
  /* Texte partagé depuis une autre app (Partager → L'Ardoise) ou raccourci « Écrire une note » */
  const qs = new URLSearchParams(location.search);
  if (qs.has('texte') || qs.has('titre') || qs.has('lien') || qs.has('ecrire')) {
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    const t = [qs.get('titre'), qs.get('texte'), qs.get('lien')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (t) { nouvelleSaisie({ kind: 'text', texte: t.slice(0, 2000) }); toast('Texte partagé reçu : analyse en cours'); }
    else if (qs.has('ecrire')) setTimeout(() => inp.focus(), 350);
  }
  setTimeout(traiterAttente, 800);
  setTimeout(() => rafraichirAbonnement(true), 3000);
})();
