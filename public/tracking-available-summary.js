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
const $ = (selector, root = document) => root.querySelector(selector);

let projectId = '';
let materials = [];
let requestVersion = 0;
let patchQueued = false;
let lastSignature = '';

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function normalizedUnit(material = {}) {
  return String(material.unit || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isDecimalMeasure(material = {}) {
  const unit = normalizedUnit(material);
  return ['m', 'm2', 'm²', 'metro', 'metros', 'kg'].includes(unit);
}

function parseQuantity(material, value) {
  if (value === null || value === undefined || value === '') return 0;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    if (isDecimalMeasure(material) && Number.isInteger(value) && Math.abs(value) >= 1000) {
      return value / 1000;
    }
    return value;
  }

  let text = String(value).trim().replace(/\s/g, '');
  if (!text) return 0;

  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function allocation(material = {}) {
  const required = Math.max(0, parseQuantity(material, material.qtyRequired));
  const source = material.source || 'pendente';

  if (source === 'estoque') {
    return { required, stockQty: required, purchaseQty: 0 };
  }
  if (source === 'compra') {
    return { required, stockQty: 0, purchaseQty: required };
  }
  if (source === 'misto') {
    const stockQty = clamp(parseQuantity(material, material.stockRequiredQty), 0, required);
    const hasPurchase = material.purchaseRequiredQty !== undefined
      && material.purchaseRequiredQty !== null
      && material.purchaseRequiredQty !== '';
    const purchaseQty = clamp(
      hasPurchase ? parseQuantity(material, material.purchaseRequiredQty) : required - stockQty,
      0,
      required - stockQty
    );
    return { required, stockQty, purchaseQty };
  }
  return { required, stockQty: 0, purchaseQty: 0 };
}

function itemCounts() {
  let checkedItems = 0;
  let stockItems = 0;
  let receivedPurchaseItems = 0;

  materials.forEach(material => {
    const alloc = allocation(material);
    const received = clamp(parseQuantity(material, material.qtyReceived), 0, alloc.purchaseQty);
    const separated = clamp(parseQuantity(material, material.separatedQty), 0, alloc.required || Number.MAX_SAFE_INTEGER);
    const sentToPainting = clamp(parseQuantity(material, material.paintingSentQty), 0, alloc.required || Number.MAX_SAFE_INTEGER);
    const returnedFromPainting = clamp(parseQuantity(material, material.paintingReturnedQty), 0, sentToPainting || Number.MAX_SAFE_INTEGER);
    const awayAtPainting = Math.max(0, sentToPainting - returnedFromPainting);
    const alreadyUnavailable = separated + awayAtPainting;

    const stockRemaining = Math.max(0, alloc.stockQty - alreadyUnavailable);
    const usedBeyondStock = Math.max(0, alreadyUnavailable - alloc.stockQty);
    const purchaseRemaining = Math.max(0, received - usedBeyondStock);

    if (stockRemaining > 0 || purchaseRemaining > 0) checkedItems += 1;
    if (stockRemaining > 0) stockItems += 1;
    if (purchaseRemaining > 0) receivedPurchaseItems += 1;
  });

  return {
    totalItems: materials.length,
    checkedItems,
    stockItems,
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

  const data = itemCounts();
  const signature = [
    data.totalItems,
    data.checkedItems,
    data.stockItems,
    data.receivedPurchaseItems
  ].join('|');

  if (lastSignature === signature && summary.dataset.availableSummary === signature) return;

  lastSignature = signature;
  summary.dataset.availableSummary = signature;
  summary.style.gridTemplateColumns = 'repeat(3,minmax(0,1fr))';
  summary.replaceChildren(
    metric('Itens conferidos e ainda não separados', `${data.checkedItems} de ${data.totalItems}`, 'itens da obra'),
    metric('Vindos do estoque', `${data.stockItems} itens`),
    metric('Recebidos da compra', `${data.receivedPurchaseItems} itens`)
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
    console.error('Falha ao contar materiais conferidos:', error);
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

new MutationObserver(queuePatch).observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('hashchange', () => {
  if (currentRoute() !== 'estoque') {
    requestVersion += 1;
    projectId = '';
    materials = [];
    lastSignature = '';
  }
});
