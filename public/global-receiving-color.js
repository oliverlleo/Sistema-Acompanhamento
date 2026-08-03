import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

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

function firstUseful(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function materialColor(material = {}) {
  const details = material.sourceDetails || {};
  return String(firstUseful(material.color, details.COR, details.Cor, details.cor) || '').trim();
}

function materialReference(button) {
  const value = button?.dataset.globalReceive || '';
  const separator = value.indexOf(':');
  if (separator < 1) return null;
  return {
    projectId: value.slice(0, separator),
    materialId: value.slice(separator + 1)
  };
}

function patchRows() {
  patchQueued = false;
  if (currentRoute() !== 'recebimento') return;

  document.querySelectorAll('#globalReceivingRoot .gr-table tbody tr').forEach(row => {
    const button = row.querySelector('[data-global-receive]');
    const reference = materialReference(button);
    if (!reference) return;

    const material = materialsByProject[reference.projectId]?.[reference.materialId];
    const color = materialColor(material);
    const materialCell = row.cells[1];
    if (!materialCell) return;

    let colorLine = materialCell.querySelector('[data-receiving-material-color]');
    if (!color) {
      colorLine?.remove();
      return;
    }

    if (!colorLine) {
      colorLine = document.createElement('span');
      colorLine.className = 'gr-sub';
      colorLine.dataset.receivingMaterialColor = 'true';
      materialCell.appendChild(colorLine);
    }

    const label = `Cor: ${color}`;
    if (colorLine.textContent !== label) colorLine.textContent = label;
  });
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(() => setTimeout(patchRows, 0));
}

onAuthStateChanged(auth, user => {
  stopMaterials?.();
  stopMaterials = null;
  materialsByProject = {};

  if (!user) return;
  stopMaterials = onValue(ref(db, 'materials'), snapshot => {
    materialsByProject = snapshot.val() || {};
    queuePatch();
  }, error => console.error('Falha ao carregar cores no recebimento:', error));
});

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="recebimento"]')) {
    setTimeout(queuePatch, 80);
    setTimeout(queuePatch, 300);
  }
});

window.addEventListener('hashchange', queuePatch);

const view = document.querySelector('#view');
if (view) new MutationObserver(queuePatch).observe(view, { childList: true, subtree: true });

queuePatch();
