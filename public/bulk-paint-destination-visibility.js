import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

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
const db = getDatabase(app);
let syncQueued = false;
let requestVersion = 0;

function currentProjectId() {
  return document.querySelector('#globalProjectSelect')?.value
    || localStorage.getItem('obraflow.currentProject')
    || '';
}

function selectedBulkIds() {
  return [...document.querySelectorAll('#view [data-bulk-purchase-item]:checked')]
    .map(input => input.dataset.bulkPurchaseItem)
    .filter(Boolean);
}

function requiresPainting(material = {}) {
  return material.paintingRequired === true
    || material.paintingRequired === 1
    || material.paintingRequired === 'true';
}

async function syncBulkPaintingDestination() {
  syncQueued = false;
  const form = document.querySelector('#bulkPurchaseForm');
  const field = form?.querySelector('#bulkPaintingDestination');
  if (!form || !field) return;

  const select = field.querySelector('[name="paintingDeliveryDestination"]');
  field.hidden = true;
  if (select) {
    select.disabled = true;
    select.value = 'empresa';
  }

  const projectId = currentProjectId();
  const materialIds = selectedBulkIds();
  if (!projectId || !materialIds.length) return;

  const version = ++requestVersion;
  try {
    const snapshot = await get(ref(db, `materials/${projectId}`));
    if (version !== requestVersion || !form.isConnected) return;

    const materials = snapshot.val() || {};
    const hasPaintingItem = materialIds.some(materialId => requiresPainting(materials[materialId]));
    field.hidden = !hasPaintingItem;
    if (select) {
      select.disabled = !hasPaintingItem;
      if (!hasPaintingItem) select.value = 'empresa';
    }
  } catch (error) {
    console.error('Falha ao verificar itens de pintura da compra em lote:', error);
  }
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => setTimeout(syncBulkPaintingDestination, 0));
}

document.addEventListener('change', event => {
  if (event.target.matches?.('[data-bulk-purchase-item], #globalProjectSelect')) queueSync();
}, true);

document.addEventListener('click', event => {
  if (event.target.closest?.('#bulkPurchaseBtn')) {
    setTimeout(queueSync, 0);
    setTimeout(queueSync, 80);
  }
}, true);

const modalRoot = document.querySelector('#modalRoot');
if (modalRoot) {
  new MutationObserver(queueSync).observe(modalRoot, { childList: true, subtree: true });
}

window.addEventListener('hashchange', queueSync);
queueSync();
