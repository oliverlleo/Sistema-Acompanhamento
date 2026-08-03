import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { allocation, availableQty } from './material-flow.js?v=20260803-1648';

const firebaseConfig = {
  apiKey: 'AIzaSyDtfxhvronefOV9MoDj-GvUUiJ3TLfb8qc',
  authDomain: 'sistemsquared.firebaseapp.com',
  databaseURL: 'https://sistemsquared-default-rtdb.firebaseio.com',
  projectId: 'sistemsquared',
  storageBucket: 'sistemsquared.firebasestorage.app',
  messagingSenderId: '43452051582',
  appId: '1:43452051582:web:08a19296448eb66d0b282f'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let materialsByProject = {};
let stopMaterials = null;
let patchQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function percentage(value, total) {
  if (!(total > 0)) return { visual: 0, label: '0%' };
  const exact = Math.min(100, Math.max(0, (value / total) * 100));
  return {
    visual: exact > 0 ? Math.max(1.2, exact) : 0,
    label: exact > 0 && exact < 1 ? '<1%' : `${Math.round(exact)}%`
  };
}

function availabilityForProject(projectId) {
  let required = 0;
  let available = 0;

  Object.values(materialsByProject[projectId] || {}).forEach(material => {
    const alloc = allocation(material);
    required += alloc.required;
    available += availableQty(material);
  });

  return { required, available, ...percentage(available, required) };
}

function patchCards() {
  patchQueued = false;
  if (currentRoute() !== 'estoque') return;

  document.querySelectorAll('[data-separated-project]').forEach(card => {
    const projectId = card.dataset.separatedProject || '';
    const donut = card.querySelector('.sep-donut');
    if (!donut || !projectId) return;

    const data = availabilityForProject(projectId);
    const strong = donut.querySelector('.sep-donut-label strong');
    const small = donut.querySelector('.sep-donut-label small');

    if (donut.style.getPropertyValue('--value') !== String(data.visual)) {
      donut.style.setProperty('--value', String(data.visual));
    }
    if (strong && strong.textContent !== data.label) strong.textContent = data.label;
    if (small && small.textContent !== 'disponível') small.textContent = 'disponível';

    const aria = `${data.label} disponível: estoque e compras recebidas`;
    if (donut.getAttribute('aria-label') !== aria) donut.setAttribute('aria-label', aria);
  });
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(patchCards);
}

onAuthStateChanged(auth, user => {
  stopMaterials?.();
  stopMaterials = null;
  materialsByProject = {};

  if (!user) return;
  stopMaterials = onValue(ref(db, 'materials'), snapshot => {
    materialsByProject = snapshot.val() || {};
    queuePatch();
  }, error => console.error('Falha ao calcular disponibilidade por obra:', error));
});

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="estoque"]')) {
    setTimeout(queuePatch, 80);
    setTimeout(queuePatch, 320);
  }
});

window.addEventListener('hashchange', queuePatch);

const view = document.querySelector('#view');
if (view) new MutationObserver(queuePatch).observe(view, { childList: true, subtree: true });
