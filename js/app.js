/* L'Ardoise — socle : environnement, thème, hors ligne et mises à jour (repris de Cabas).
   Les fonctions (cartes, dictée, récap) arrivent dans la version suivante. */
'use strict';
const ENV = window.ARDOISE_ENV || 'local';
const VERSION = self.ARDOISE_VERSION || '?';
const KEY = 'ardoise:' + ENV + ':reglages';   // données séparées par environnement (local / test / prod)

let R = { theme: 'auto' };
try { R = Object.assign(R, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
function save() { try { localStorage.setItem(KEY, JSON.stringify(R)); } catch (e) {} }

function toast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3500);
}

const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
document.getElementById('today').textContent = today.charAt(0).toUpperCase() + today.slice(1);
document.getElementById('ver').textContent = "L'Ardoise v" + VERSION + (ENV !== 'prod' ? ' · ' + ENV.toUpperCase() : '');
if (ENV !== 'prod') {
  const t = document.getElementById('envTag'); t.textContent = ENV.toUpperCase(); t.hidden = false; t.classList.add('env-' + ENV);
  document.getElementById('brandLogo').src = 'icons/test-icon-192.png';
}

/* ================== Hors ligne & mises à jour ================== */
let swReg = null;
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { swReg = r; }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && swReg) swReg.update().catch(() => {}); });
}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

if (R.lastV && R.lastV !== VERSION) R.updNote = VERSION;   // nouvelle version installée : on l'annonce
R.lastV = VERSION; save();
if (R.updNote === VERSION) setTimeout(() => { toast("L'Ardoise mise à jour (v" + VERSION + ')'); setTimeout(() => { delete R.updNote; save(); }, 4000); }, 500);
