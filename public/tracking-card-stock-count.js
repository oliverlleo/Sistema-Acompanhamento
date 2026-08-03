import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { allocation } from './material-flow.js?v=20260803-1648';

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

function stockItemCount(projectId) {
  return Object.values(materialsByProject[projectId] || {})
    .filter(material => allocation(material).stockQty > 0)
    .length;
}

function patchCards() {
  patchQueued = false;
  if (currentRoute() !== 'estoque') return;

  document.querySelectorAll('[data-separated-project]').forEach(card => {
    const stats = card.querySelectorAll('.sep-stat');
    if (stats.length < 3) return;

    const projectId = card.dataset.separatedProject || '';
    const value = stockItemCount(projectId);
    const valueElement = stats[2].querySelector('strong');
    const labelElement = stats[2].querySelector('span');

    if (valueElement && valueElement.textContent !== String(value)) valueElement.textContent = String(value);
    if (labelElement && labelElement.textContent !== 'itens em estoque') labelElement.textContent = 'itens em estoque';
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
  }, error => console.error('Falha ao contar itens em estoque por obra:', error));
});

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="estoque"]')) {
    setTimeout(queuePatch, 80);
    setTimeout(queuePatch, 300);
  }
});

window.addEventListener('hashchange', queuePatch);

const view = document.querySelector('#view');
if (view) new MutationObserver(queuePatch).observe(view, { childList: true, subtree: true });
