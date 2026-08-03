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
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let materialsByProject = {};
let openedProjectId = '';
let stopMaterials = null;
let frame = 0;

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;
  let text = String(value).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatQty(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(number(value));
}

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function purchaseQuantity(material = {}) {
  const required = Math.max(0, number(material.qtyRequired));
  if (material.source === 'compra') return required;
  if (material.source !== 'misto') return 0;

  const stock = clamp(number(material.stockRequiredQty), 0, required);
  const explicit = material.purchaseRequiredQty !== undefined
    && material.purchaseRequiredQty !== null
    && material.purchaseRequiredQty !== '';
  return clamp(explicit ? number(material.purchaseRequiredQty) : required - stock, 0, required - stock);
}

function purchaseWasRegistered(material = {}) {
  if (purchaseQuantity(material) <= 0) return false;
  if (material.purchaseDate || material.orderNumber) return true;
  if (number(material.qtyReceived) > 0 || number(material.directPaintingDeliveredQty) > 0) return true;

  return new Set([
    'aguardando_entrega', 'compra_atrasada', 'recebido_parcial',
    'aguarda_pintura', 'em_pintura', 'pintura_atrasada',
    'pronto_separar', 'separado_parcial', 'separado',
    'enviado_parcial', 'enviado_obra'
  ]).has(material.status);
}

function projectStats(projectId) {
  const items = Object.values(materialsByProject[projectId] || {});
  let purchased = 0;
  let separated = 0;
  let requiredQty = 0;
  let separatedQty = 0;

  items.forEach(material => {
    const required = Math.max(0, number(material.qtyRequired));
    const separatedForItem = clamp(number(material.separatedQty), 0, required || Number.MAX_SAFE_INTEGER);
    if (purchaseWasRegistered(material)) purchased += 1;
    if (separatedForItem > 0) separated += 1;
    requiredQty += required;
    separatedQty += Math.min(separatedForItem, required || separatedForItem);
  });

  return { total: items.length, purchased, separated, requiredQty, separatedQty };
}

function metric(value, label) {
  return `<div class="sep-stat"><strong>${value}</strong><span>${label}</span></div>`;
}

function detailMetric(label, value) {
  return `<article class="sep-detail-metric"><span>${label}</span><strong>${value}</strong></article>`;
}

function patchCards(view) {
  $$('[data-separated-project]', view).forEach(card => {
    const projectId = card.dataset.separatedProject;
    const stats = projectStats(projectId);
    const signature = `${stats.total}:${stats.purchased}:${stats.separated}`;
    const container = $('.sep-stats', card);
    if (!container || container.dataset.metricsSignature === signature) return;

    container.dataset.metricsSignature = signature;
    container.innerHTML = [
      metric(stats.total, 'itens da obra'),
      metric(stats.purchased, 'itens comprados'),
      metric(stats.separated, 'itens separados')
    ].join('');
  });
}

function patchDetail(view) {
  const container = $('.sep-detail-summary', view);
  if (!container || !openedProjectId) return;

  const stats = projectStats(openedProjectId);
  const signature = `${stats.total}:${stats.purchased}:${stats.separated}:${stats.separatedQty}:${stats.requiredQty}`;
  if (container.dataset.metricsSignature === signature) return;

  container.dataset.metricsSignature = signature;
  container.innerHTML = [
    detailMetric('Itens da obra', stats.total),
    detailMetric('Itens comprados', stats.purchased),
    detailMetric('Itens separados', stats.separated),
    detailMetric('Quantidade separada', `${formatQty(stats.separatedQty)} / ${formatQty(stats.requiredQty)}`)
  ].join('');
}

function patch() {
  frame = 0;
  if (currentRoute() !== 'estoque') return;
  const view = $('#view');
  if (!view) return;
  patchCards(view);
  patchDetail(view);
}

function schedulePatch() {
  if (frame) return;
  frame = requestAnimationFrame(patch);
}

const view = $('#view');
if (view) new MutationObserver(schedulePatch).observe(view, { childList: true });

document.addEventListener('click', event => {
  const card = event.target.closest?.('[data-separated-project]');
  if (card) {
    openedProjectId = card.dataset.separatedProject || '';
    setTimeout(schedulePatch, 0);
    return;
  }

  if (event.target.closest?.('#backSeparatedProjects, [data-route="estoque"]')) {
    openedProjectId = '';
    setTimeout(schedulePatch, 0);
  }
}, true);

window.addEventListener('hashchange', () => {
  if (currentRoute() !== 'estoque') openedProjectId = '';
  schedulePatch();
});

onAuthStateChanged(auth, user => {
  stopMaterials?.();
  stopMaterials = null;
  materialsByProject = {};

  if (!user) {
    schedulePatch();
    return;
  }

  stopMaterials = onValue(ref(db, 'materials'), snapshot => {
    materialsByProject = snapshot.val() || {};
    schedulePatch();
  }, error => console.error('Falha ao atualizar indicadores de separados:', error));
});

schedulePatch();
