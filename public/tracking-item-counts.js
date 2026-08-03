import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  allocation, purchaseCommitted, availableQty, number, clamp, quantityNumber} from './material-flow.js?v=20260803-1648';

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
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let projectId = '';
let materials = [];
let requestVersion = 0;
let patchQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function formatQty(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(number(value));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR').format(date);
}

function percent(value, total) {
  if (!(total > 0)) return { value: 0, label: '0%' };
  const exact = clamp((value / total) * 100, 0, 100);
  return {
    value: exact > 0 ? Math.max(1.2, exact) : 0,
    label: exact > 0 && exact < 1 ? '<1%' : `${Math.round(exact)}%`
  };
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setStyle(element, property, value) {
  if (element && element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value);
  }
}

function stageData() {
  const totalItems = materials.length;
  let purchaseItems = 0;
  let purchasedItems = 0;
  let purchaseRequiredQty = 0;
  let purchasedQty = 0;
  let nearestDeliveryEta = '';
  let paintingRequiredItems = 0;
  let inPaintingItems = 0;
  let paintingRequiredQty = 0;
  let inPaintingQty = 0;
  let paintingReturnedQty = 0;
  let nearestPaintingEta = '';
  let checkedItems = 0;
  let separatedItems = 0;

  materials.forEach(material => {
    const alloc = allocation(material);
    const required = alloc.required;
    const separated = clamp(quantityNumber(material, material.separatedQty), 0, required || Number.MAX_SAFE_INTEGER);
    const paintSent = clamp(quantityNumber(material, material.paintingSentQty), 0, required || Number.MAX_SAFE_INTEGER);
    const paintReturned = clamp(quantityNumber(material, material.paintingReturnedQty), 0, paintSent || Number.MAX_SAFE_INTEGER);
    const inPaint = Math.max(0, paintSent - paintReturned);
    const checkedPending = Math.max(0, availableQty(material) - inPaint - separated);

    if (alloc.purchaseQty > 0) {
      purchaseItems += 1;
      purchaseRequiredQty += alloc.purchaseQty;
      if (purchaseCommitted(material)) {
        purchasedItems += 1;
        purchasedQty += alloc.purchaseQty;
      }
      if (material.deliveryEta && (!nearestDeliveryEta || material.deliveryEta < nearestDeliveryEta)) {
        nearestDeliveryEta = material.deliveryEta;
      }
    }

    if (material.paintingRequired) {
      paintingRequiredItems += 1;
      paintingRequiredQty += required;
      inPaintingQty += inPaint;
      paintingReturnedQty += paintReturned;
      if (inPaint > 0) inPaintingItems += 1;
      if (inPaint > 0 && material.paintingEta && (!nearestPaintingEta || material.paintingEta < nearestPaintingEta)) {
        nearestPaintingEta = material.paintingEta;
      }
    }

    if (checkedPending > 0) checkedItems += 1;
    if (separated > 0) separatedItems += 1;
  });

  return {
    comprado: { current: purchasedItems, total: purchaseItems },
    pintura: { current: inPaintingItems, total: paintingRequiredItems },
    disponivel: { current: checkedItems, total: totalItems },
    separado: { current: separatedItems, total: totalItems },
    purchaseItems,
    purchasedItems,
    purchaseRequiredQty,
    purchasedQty,
    missingPurchaseItems: Math.max(0, purchaseItems - purchasedItems),
    missingPurchaseQty: Math.max(0, purchaseRequiredQty - purchasedQty),
    nearestDeliveryEta,
    paintingRequiredItems,
    inPaintingItems,
    paintingRequiredQty,
    inPaintingQty,
    paintingReturnedQty,
    nearestPaintingEta
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

function patchSummary(activeStage, data) {
  const summary = $('.trk-summary');
  if (!summary) return;

  if (activeStage === 'comprado') {
    const signature = [
      activeStage, data.purchasedItems, data.purchaseItems, data.purchasedQty,
      data.purchaseRequiredQty, data.missingPurchaseItems, data.missingPurchaseQty,
      data.nearestDeliveryEta
    ].join('|');
    if (summary.dataset.itemSummarySignature === signature) return;
    summary.dataset.itemSummarySignature = signature;
    summary.style.gridTemplateColumns = 'repeat(3,minmax(0,1fr))';
    summary.replaceChildren(
      metric('Itens comprados', `${data.purchasedItems} de ${data.purchaseItems}`),
      metric(
        'Quantidade comprada',
        `${formatQty(quantityNumber(data, data.purchasedQty))} un de ${formatQty(quantityNumber(data, data.purchaseRequiredQty))} un`,
        data.nearestDeliveryEta ? `Próximo prazo: ${formatDate(data.nearestDeliveryEta)}` : 'Sem prazo registrado'
      ),
      metric('Falta comprar', `${data.missingPurchaseItems} itens — ${formatQty(quantityNumber(data, data.missingPurchaseQty))} unidades`)
    );
    return;
  }

  summary.style.gridTemplateColumns = '';
  if (activeStage === 'pintura') {
    const signature = [
      activeStage, data.inPaintingItems, data.paintingRequiredItems,
      data.inPaintingQty, data.paintingRequiredQty,
      data.paintingReturnedQty, data.nearestPaintingEta
    ].join('|');
    if (summary.dataset.itemSummarySignature === signature) return;
    summary.dataset.itemSummarySignature = signature;
    summary.replaceChildren(
      metric('Itens em pintura agora', `${data.inPaintingItems} de ${data.paintingRequiredItems}`),
      metric('Quantidade em pintura', `${formatQty(quantityNumber(data, data.inPaintingQty))} un de ${formatQty(quantityNumber(data, data.paintingRequiredQty))} un`),
      metric('Quantidade já retornada', `${formatQty(quantityNumber(data, data.paintingReturnedQty))} un`),
      metric('Próximo retorno', formatDate(data.nearestPaintingEta))
    );
  }
}

function patch() {
  patchQueued = false;
  if (currentRoute() !== 'estoque' || !projectId) return;
  const buttons = $$('[data-tracking-stage]');
  if (!buttons.length) return;

  const data = stageData();
  buttons.forEach(button => {
    const key = button.dataset.trackingStage;
    const stage = data[key];
    if (!stage) return;
    const pct = percent(stage.current, stage.total);
    const donut = $('.trk-donut', button);
    setStyle(donut, '--value', String(pct.value));
    setText($('.trk-donut strong', button), pct.label);
    setText($('.trk-stage-copy span', button), `${stage.current} de ${stage.total} itens`);
  });

  const activeButton = $('[data-tracking-stage].active');
  const activeStage = activeButton?.dataset.trackingStage;
  const stage = data[activeStage];
  if (stage) {
    const pct = percent(stage.current, stage.total);
    setText($('.trk-progress-head strong'), `${pct.label} · ${stage.current} de ${stage.total} itens`);
    setStyle($('.trk-progress i'), 'width', `${pct.value}%`);
    patchSummary(activeStage, data);
  }
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
  try {
    const snapshot = await get(ref(db, `materials/${id}`));
    if (version !== requestVersion || currentRoute() !== 'estoque') return;
    materials = Object.values(snapshot.val() || {});
    queuePatch();
  } catch (error) {
    console.error('Falha ao calcular acompanhamento por itens:', error);
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
  }
});
