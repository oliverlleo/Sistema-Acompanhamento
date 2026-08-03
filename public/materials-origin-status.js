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
const CUSTOM_FILTER = 'definir_origem_ui';

let materials = {};
let projectId = '';
let stopMaterials = null;
let customFilterActive = false;
let bypassNativeChange = false;
let patchQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function currentProjectId() {
  return document.querySelector('#globalProjectSelect')?.value
    || localStorage.getItem('obraflow.currentProject')
    || '';
}

function unresolved(materialId) {
  const material = materials[materialId];
  return Boolean(material && allocation(material).unallocatedQty > 0);
}

function rowMaterialId(row) {
  return row.querySelector('[data-material-id]')?.dataset.materialId
    || row.querySelector('[data-edit-material]')?.dataset.editMaterial
    || '';
}

function ensureFilterOption(select) {
  if (!select || select.querySelector(`option[value="${CUSTOM_FILTER}"]`)) return;
  const option = document.createElement('option');
  option.value = CUSTOM_FILTER;
  option.textContent = 'Definir compra/estoque';

  const purchaseOption = select.querySelector('option[value="comprar"]');
  if (purchaseOption) purchaseOption.insertAdjacentElement('beforebegin', option);
  else select.appendChild(option);
}

function patchMaterialRows() {
  patchQueued = false;
  if (currentRoute() !== 'materiais') return;

  const select = document.querySelector('#statusFilter');
  ensureFilterOption(select);
  if (customFilterActive && select?.value !== CUSTOM_FILTER) select.value = CUSTOM_FILTER;

  const purchaseFilterActive = !customFilterActive && select?.value === 'comprar';
  const rows = [...document.querySelectorAll('.data-table tbody tr')];
  let visible = 0;

  rows.forEach(row => {
    const materialId = rowMaterialId(row);
    if (!materialId) return;

    const isUnresolved = unresolved(materialId);
    if (isUnresolved) {
      const statusCell = row.cells?.[4];
      const pill = statusCell?.querySelector('.status-pill');
      if (pill) {
        if (pill.textContent !== 'Definir compra/estoque') pill.textContent = 'Definir compra/estoque';
        pill.className = 'status-pill status-warning';
      }
    }

    if (customFilterActive) row.hidden = !isUnresolved;
    else if (purchaseFilterActive && isUnresolved) row.hidden = true;

    if (!row.hidden) visible += 1;
  });

  const count = document.querySelector('.toolbar .status-pill.status-neutral');
  if ((customFilterActive || purchaseFilterActive) && count) {
    const text = `${visible} item(ns)`;
    if (count.textContent !== text) count.textContent = text;
  }
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(() => setTimeout(patchMaterialRows, 0));
}

function subscribeProject(nextProjectId) {
  if (!nextProjectId || nextProjectId === projectId) {
    queuePatch();
    return;
  }

  stopMaterials?.();
  stopMaterials = null;
  projectId = nextProjectId;
  materials = {};

  stopMaterials = onValue(ref(db, `materials/${projectId}`), snapshot => {
    materials = snapshot.val() || {};
    queuePatch();
  }, error => console.error('Falha ao identificar materiais sem origem:', error));
}

function syncRoute() {
  if (currentRoute() !== 'materiais') {
    customFilterActive = false;
    return;
  }
  subscribeProject(currentProjectId());
  queuePatch();
}

onAuthStateChanged(auth, user => {
  stopMaterials?.();
  stopMaterials = null;
  projectId = '';
  materials = {};
  customFilterActive = false;
  bypassNativeChange = false;
  if (user) syncRoute();
});

document.addEventListener('change', event => {
  const target = event.target;

  if (target?.id === 'globalProjectSelect') {
    setTimeout(() => {
      projectId = '';
      subscribeProject(currentProjectId());
    }, 0);
    return;
  }

  if (target?.id !== 'statusFilter' || currentRoute() !== 'materiais') return;

  if (bypassNativeChange) {
    bypassNativeChange = false;
    return;
  }

  if (target.value === CUSTOM_FILTER) {
    customFilterActive = true;
    event.preventDefault();
    event.stopImmediatePropagation();

    bypassNativeChange = true;
    target.value = 'todos';
    target.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(queuePatch, 0);
    return;
  }

  customFilterActive = false;
  setTimeout(queuePatch, 0);
}, true);

document.addEventListener('input', event => {
  if (currentRoute() === 'materiais' && event.target?.id === 'materialSearch') {
    setTimeout(queuePatch, 0);
  }
}, true);

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="materiais"]')) {
    setTimeout(syncRoute, 80);
    setTimeout(syncRoute, 300);
  }
});

window.addEventListener('hashchange', () => setTimeout(syncRoute, 0));

const view = document.querySelector('#view');
if (view) new MutationObserver(queuePatch).observe(view, { childList: true, subtree: true });
