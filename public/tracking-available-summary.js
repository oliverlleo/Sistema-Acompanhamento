import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  allocation,
  clamp,
  purchaseCommitted,
  quantityNumber
} from './material-flow.js?v=20260803-1648';

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
const $ = (selector, root = document) => root.querySelector(selector);

let projectId = '';
let materials = [];
let requestVersion = 0;
let patchQueued = false;
let lastSignature = '';

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function formatQuantity(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value || 0);
}

function quantitySummary() {
  let totalRequiredQty = 0;
  let availableQty = 0;
  let stockPendingItems = 0;
  let purchasedItems = 0;
  let receivedPurchaseItems = 0;

  materials.forEach(material => {
    const alloc = allocation(material);
    const received = clamp(
      quantityNumber(material, material.qtyReceived),
      0,
      alloc.purchaseQty
    );

    // Disponibilidade calculada por quantidade e por origem.
    // Estoque já conta. Compra sem pintura conta quando recebida.
    // Compra que precisa de pintura só conta quando retorna da pintura.
    const stockAvailable = clamp(alloc.stockQty, 0, alloc.required);
    let purchaseAvailable = received;

    if (material.paintingRequired && alloc.purchaseQty > 0) {
      purchaseAvailable = clamp(
        quantityNumber(material, material.paintingReturnedQty),
        0,
        alloc.purchaseQty
      );
    }

    const materialAvailable = clamp(
      stockAvailable + purchaseAvailable,
      0,
      alloc.required
    );

    totalRequiredQty += alloc.required;
    availableQty += materialAvailable;

    if (stockAvailable > 0) stockPendingItems += 1;

    if (alloc.purchaseQty > 0 && purchaseCommitted(material)) {
      purchasedItems += 1;
      if (received > 0) receivedPurchaseItems += 1;
    }
  });

  return {
    totalItems: materials.length,
    totalRequiredQty,
    availableQty,
    stockPendingItems,
    purchasedItems,
    receivedPurchaseItems
  };
}

function metric(label, value, note = '') {
  const article = document.createElement('article');
  article.className = 'trk-metric';

  const labelElement = document.createElement('span');
  labelElement.textContent = label;

  const strong = document.createElement('strong');
  strong.textContent = value;

  article.append(labelElement, strong);

  if (note) {
    const small = document.createElement('small');
    small.textContent = note;
    article.appendChild(small);
  }

  return article;
}

function patch() {
  patchQueued = false;
  if (currentRoute() !== 'estoque' || !projectId) return;

  const activeStage = $('[data-tracking-stage].active')?.dataset.trackingStage;
  if (activeStage !== 'disponivel') return;

  const summary = $('.trk-summary');
  if (!summary) return;

  const data = quantitySummary();
  const signature = [
    data.totalItems,
    data.totalRequiredQty,
    data.availableQty,
    data.stockPendingItems,
    data.purchasedItems,
    data.receivedPurchaseItems
  ].join('|');

  if (lastSignature === signature && summary.dataset.availableSummary === signature) return;

  lastSignature = signature;
  summary.dataset.availableSummary = signature;
  summary.style.gridTemplateColumns = 'repeat(4,minmax(0,1fr))';
  summary.replaceChildren(
    metric(
      'Total de itens',
      `${data.totalItems} itens`,
      'materiais cadastrados na obra'
    ),
    metric(
      'Itens em estoque',
      `${data.stockPendingItems} itens`,
      'materiais com saldo de estoque ainda não separado'
    ),
    metric(
      'Recebidos das compras',
      `${data.receivedPurchaseItems} de ${data.purchasedItems} itens`,
      'itens comprados com recebimento registrado'
    ),
    metric(
      'Quantidade conferida e ainda não separada',
      `${formatQuantity(data.availableQty)} de ${formatQuantity(data.totalRequiredQty)} un`,
      'quantidade disponível na empresa'
    )
  );
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(() => setTimeout(patch, 0));
}

async function loadProject(id) {
  if (!id) return;
  const version = ++requestVersion;
  projectId = id;
  lastSignature = '';

  try {
    const snapshot = await get(ref(db, `materials/${id}`));
    if (version !== requestVersion || currentRoute() !== 'estoque') return;
    materials = Object.values(snapshot.val() || {});
    queuePatch();
  } catch (error) {
    console.error('Falha ao calcular materiais conferidos:', error);
  }
}

document.addEventListener('click', event => {
  const card = event.target.closest?.('[data-separated-project]');
  if (card && currentRoute() === 'estoque') loadProject(card.dataset.separatedProject);
  if (event.target.closest?.('[data-tracking-stage]')) queuePatch();
}, true);

document.addEventListener('keydown', event => {
  const card = event.target.closest?.('[data-separated-project]');
  if (card && currentRoute() === 'estoque' && (event.key === 'Enter' || event.key === ' ')) {
    loadProject(card.dataset.separatedProject);
  }
}, true);

new MutationObserver(queuePatch).observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('hashchange', () => {
  if (currentRoute() !== 'estoque') {
    requestVersion += 1;
    projectId = '';
    materials = [];
    lastSignature = '';
  }
});
