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
const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
const $$ = (selector, root = document) => root?.querySelectorAll ? [...root.querySelectorAll(selector)] : [];

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

function formatDate(value) {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR').format(date);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function availabilityForMaterial(material) {
  const alloc = allocation(material);
  const received = clamp(
    quantityNumber(material, material.qtyReceived),
    0,
    alloc.purchaseQty
  );
  const sourceAvailable = clamp(
    alloc.stockQty + received,
    0,
    alloc.required || Number.MAX_SAFE_INTEGER
  );
  const sentToPainting = clamp(
    quantityNumber(material, material.paintingSentQty),
    0,
    alloc.required || Number.MAX_SAFE_INTEGER
  );
  const returnedFromPainting = clamp(
    quantityNumber(material, material.paintingReturnedQty),
    0,
    sentToPainting || Number.MAX_SAFE_INTEGER
  );
  const deliveredToSite = clamp(
    quantityNumber(material, material.siteDeliveredQty),
    0,
    alloc.required || Number.MAX_SAFE_INTEGER
  );
  const awayAtPainting = Math.max(0, sentToPainting - returnedFromPainting);
  const available = Math.max(0, sourceAvailable - awayAtPainting - deliveredToSite);

  return {
    material,
    alloc,
    received,
    awayAtPainting,
    deliveredToSite,
    available
  };
}

function quantitySummary() {
  let totalRequiredQty = 0;
  let availableQty = 0;
  let availableItems = 0;
  let purchasedItems = 0;
  let receivedPurchaseItems = 0;

  const availableRows = materials.map(availabilityForMaterial);

  availableRows.forEach(row => {
    totalRequiredQty += row.alloc.required;
    availableQty += row.available;
    if (row.available > 0) availableItems += 1;

    if (row.alloc.purchaseQty > 0 && purchaseCommitted(row.material)) {
      purchasedItems += 1;
      if (row.received > 0) receivedPurchaseItems += 1;
    }
  });

  return {
    totalItems: materials.length,
    totalRequiredQty,
    availableQty,
    availableItems,
    purchasedItems,
    receivedPurchaseItems,
    availableRows: availableRows.filter(row => row.available > 0)
  };
}

function percentage(value, total) {
  const exact = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return {
    visual: exact > 0 ? Math.max(1.2, exact) : 0,
    label: exact > 0 && exact < 1 ? '<1%' : `${Math.round(exact)}%`
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

function patchStageAndProgress(data) {
  const meta = percentage(data.availableQty, data.totalRequiredQty);
  const stage = $('[data-tracking-stage="disponivel"]');
  const donut = $('.trk-donut', stage);
  const donutLabel = $('.trk-donut strong', stage);
  const stageQuantity = $('.trk-stage-copy span', stage);

  if (donut) donut.style.setProperty('--value', String(meta.visual));
  if (donutLabel) donutLabel.textContent = meta.label;
  if (stageQuantity) {
    stageQuantity.textContent = `${formatQuantity(data.availableQty)} de ${formatQuantity(data.totalRequiredQty)}`;
  }

  if (!stage?.classList.contains('active')) return;
  const progress = $('.trk-progress-card');
  const progressStrong = $('.trk-progress-head strong', progress);
  const progressBar = $('.trk-progress i', progress);
  if (progressStrong) {
    progressStrong.textContent = `${meta.label} · ${formatQuantity(data.availableQty)} de ${formatQuantity(data.totalRequiredQty)}`;
  }
  if (progressBar) progressBar.style.width = `${meta.visual}%`;
}

function originMeta(source) {
  if (source === 'misto') return ['Compra + estoque', 'warn'];
  if (source === 'estoque') return ['Estoque', 'violet'];
  return ['Compra', 'info'];
}

function receivedDate(material) {
  return material.receivedDate
    || material.directPaintingDeliveredDate
    || material.paintingReturnDate
    || '';
}

function rowHtml(row) {
  const { material, alloc, received, available } = row;
  const [origin, tone] = originMeta(alloc.source);
  const description = material.description || 'Sem descrição';
  const sub = [material.code, material.type].filter(Boolean).join(' · ') || 'Sem código';
  const search = normalize([
    material.code,
    material.description,
    material.category,
    material.color,
    material.dimensions,
    origin,
    receivedDate(material)
  ].filter(Boolean).join(' '));

  return `<tr data-tracking-row data-search="${escapeHtml(search)}">
    <td><span class="trk-main" title="${escapeHtml(description)}">${escapeHtml(description)}</span><span class="trk-sub">${escapeHtml(sub)}</span></td>
    <td>${escapeHtml(material.category || 'Sem categoria')}</td>
    <td><span class="trk-pill trk-${tone}">${escapeHtml(origin)}</span></td>
    <td class="trk-qty">${formatQuantity(alloc.stockQty)} ${escapeHtml(material.unit || 'un')}</td>
    <td class="trk-qty">${formatQuantity(received)} ${escapeHtml(material.unit || 'un')}</td>
    <td class="trk-qty">${formatQuantity(available)} ${escapeHtml(material.unit || 'un')}</td>
    <td>${formatDate(receivedDate(material))}</td>
  </tr>`;
}

function applyAvailableSearch() {
  const input = $('#trackingSearch');
  const count = $('#trackingCount');
  const tbody = $('.trk-table tbody');
  if (!input || !tbody) return;

  const query = normalize(input.value || '');
  const rows = $$('[data-tracking-row]', tbody);
  let visible = 0;

  rows.forEach(row => {
    const match = !query || String(row.dataset.search || '').includes(query);
    row.hidden = !match;
    if (match) visible += 1;
  });

  if (count) count.textContent = `${visible} item${visible === 1 ? '' : 's'}`;
  const empty = $('#trackingEmpty', tbody);
  if (empty) empty.hidden = visible !== 0;
}

function patchAvailableRows(data) {
  const table = $('.trk-table');
  const tbody = $('tbody', table);
  if (!table || !tbody) return;

  const headers = $$('thead th', table);
  if (headers[5]) headers[5].textContent = 'Disponível na empresa';

  const rowsSignature = data.availableRows
    .map(row => [
      row.material.id || row.material.code || row.material.description || '',
      row.alloc.stockQty,
      row.received,
      row.available,
      row.material.updatedAt || ''
    ].join(':'))
    .join('|');

  if (tbody.dataset.companyAvailabilitySignature !== rowsSignature) {
    tbody.dataset.companyAvailabilitySignature = rowsSignature;
    tbody.innerHTML = `${data.availableRows
      .sort((a, b) => String(a.material.category || '').localeCompare(String(b.material.category || ''), 'pt-BR')
        || String(a.material.description || '').localeCompare(String(b.material.description || ''), 'pt-BR'))
      .map(rowHtml).join('')}
      <tr id="trackingEmpty" hidden><td colspan="7"><div class="trk-empty"><strong>Nenhum item encontrado</strong>Ajuste a busca ou escolha outra etapa.</div></td></tr>`;
  }

  const input = $('#trackingSearch');
  if (input && !input.dataset.companyAvailabilityBound) {
    input.dataset.companyAvailabilityBound = 'true';
    input.addEventListener('input', applyAvailableSearch);
  }
  applyAvailableSearch();
}

function patch() {
  patchQueued = false;
  if (currentRoute() !== 'estoque' || !projectId) return;

  const data = quantitySummary();
  patchStageAndProgress(data);

  const activeStage = $('[data-tracking-stage].active')?.dataset.trackingStage;
  if (activeStage !== 'disponivel') return;

  const summary = $('.trk-summary');
  if (!summary) return;

  const signature = [
    data.totalItems,
    data.totalRequiredQty,
    data.availableQty,
    data.availableItems,
    data.purchasedItems,
    data.receivedPurchaseItems
  ].join('|');

  if (lastSignature !== signature || summary.dataset.availableSummary !== signature) {
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
        'Itens disponíveis na empresa',
        `${data.availableItems} itens`,
        'inclui materiais separados em produção'
      ),
      metric(
        'Recebidos das compras',
        `${data.receivedPurchaseItems} de ${data.purchasedItems} itens`,
        'itens comprados com recebimento registrado'
      ),
      metric(
        'Quantidade disponível na empresa',
        `${formatQuantity(data.availableQty)} de ${formatQuantity(data.totalRequiredQty)} un`,
        'só desconta pintura em andamento e envio para a obra'
      )
    );
  }

  patchAvailableRows(data);
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
    console.error('Falha ao calcular materiais disponíveis:', error);
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