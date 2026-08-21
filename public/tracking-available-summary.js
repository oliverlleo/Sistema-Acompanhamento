import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  allocation,
  clamp,
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

function percentage(value, total) {
  if (!(total > 0)) return { exact: 0, visual: 0, label: '0%' };
  const exact = Math.min(100, Math.max(0, (value / total) * 100));
  return {
    exact,
    visual: exact > 0 ? Math.max(1.2, exact) : 0,
    label: exact > 0 && exact < 1 ? '<1%' : `${Math.round(exact)}%`
  };
}

function availabilityForMaterial(material = {}) {
  const alloc = allocation(material);
  const required = alloc.required;
  if (!(required > 0)) {
    return { required: 0, stock: 0, purchase: 0, painting: 0, total: 0 };
  }

  if (material.paintingRequired) {
    const painting = clamp(
      quantityNumber(material, material.paintingReturnedQty),
      0,
      required
    );
    return { required, stock: 0, purchase: 0, painting, total: painting };
  }

  const stock = clamp(alloc.stockQty, 0, required);
  const purchase = clamp(
    quantityNumber(material, material.qtyReceived),
    0,
    alloc.purchaseQty
  );
  const total = clamp(stock + purchase, 0, required);

  return { required, stock, purchase, painting: 0, total };
}

function quantitySummary() {
  const summary = {
    totalItems: materials.length,
    totalRequiredQty: 0,
    availableQty: 0,
    stockAvailableQty: 0,
    purchaseAvailableQty: 0,
    paintingAvailableQty: 0,
    availableItems: 0
  };

  materials.forEach(material => {
    const availability = availabilityForMaterial(material);
    summary.totalRequiredQty += availability.required;
    summary.availableQty += availability.total;
    summary.stockAvailableQty += availability.stock;
    summary.purchaseAvailableQty += availability.purchase;
    summary.paintingAvailableQty += availability.painting;
    if (availability.total > 0) summary.availableItems += 1;
  });

  summary.percent = percentage(summary.availableQty, summary.totalRequiredQty);
  return summary;
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

function patchStageIndicator(data) {
  const stage = $('[data-tracking-stage="disponivel"]');
  if (!stage) return;

  const donut = $('.trk-donut', stage);
  const percentLabel = $('.trk-donut strong', stage);
  const quantityLabel = $('.trk-stage-copy span', stage);

  if (donut && donut.style.getPropertyValue('--value') !== String(data.percent.visual)) {
    donut.style.setProperty('--value', String(data.percent.visual));
  }
  if (percentLabel && percentLabel.textContent !== data.percent.label) {
    percentLabel.textContent = data.percent.label;
  }

  const quantityText = `${formatQuantity(data.availableQty)} de ${formatQuantity(data.totalRequiredQty)}`;
  if (quantityLabel && quantityLabel.textContent !== quantityText) quantityLabel.textContent = quantityText;
}

function patchProgress(data) {
  const progressTitle = $('.trk-progress-head span');
  const progressValue = $('.trk-progress-head strong');
  const progressBar = $('.trk-progress i');

  if (progressTitle && progressTitle.textContent !== 'Disponível') progressTitle.textContent = 'Disponível';

  const valueText = `${data.percent.label} · ${formatQuantity(data.availableQty)} de ${formatQuantity(data.totalRequiredQty)}`;
  if (progressValue && progressValue.textContent !== valueText) progressValue.textContent = valueText;
  if (progressBar && progressBar.style.width !== `${data.percent.visual}%`) {
    progressBar.style.width = `${data.percent.visual}%`;
  }
}

function materialLabel(material = {}) {
  const description = material.description || 'Sem descrição';
  const sub = [material.code, material.type].filter(Boolean).join(' · ') || 'Sem código';
  return `<span class="trk-main" title="${escapeHtml(description)}">${escapeHtml(description)}</span><span class="trk-sub">${escapeHtml(sub)}</span>`;
}

function originLabel(availability) {
  if (availability.painting > 0) return ['Retorno da pintura', 'ok'];
  if (availability.stock > 0 && availability.purchase > 0) return ['Estoque + compra', 'warn'];
  if (availability.stock > 0) return ['Estoque', 'violet'];
  return ['Compra', 'info'];
}

function availabilityDate(material, availability) {
  if (availability.painting > 0) {
    return material.paintingReturnDate || material.paintingReturnedDate || '';
  }
  if (availability.purchase > 0) return material.receivedDate || '';
  return '';
}

function availableRowsHtml() {
  return materials
    .map(material => ({ material, availability: availabilityForMaterial(material) }))
    .filter(row => row.availability.total > 0)
    .sort((a, b) => String(a.material.category || '').localeCompare(String(b.material.category || ''), 'pt-BR')
      || String(a.material.description || '').localeCompare(String(b.material.description || ''), 'pt-BR'))
    .map(({ material, availability }) => {
      const [origin, tone] = originLabel(availability);
      const date = availabilityDate(material, availability);
      const search = normalize([
        material.code,
        material.description,
        material.category,
        material.color,
        origin,
        date
      ].filter(Boolean).join(' '));

      return `<tr data-tracking-row data-search="${escapeHtml(search)}">
        <td>${materialLabel(material)}</td>
        <td>${escapeHtml(material.category || 'Sem categoria')}</td>
        <td><span class="trk-pill trk-${tone}">${escapeHtml(origin)}</span></td>
        <td class="trk-qty">${formatQuantity(availability.stock)} ${escapeHtml(material.unit || 'un')}</td>
        <td class="trk-qty">${formatQuantity(availability.purchase)} ${escapeHtml(material.unit || 'un')}</td>
        <td class="trk-qty">${formatQuantity(availability.painting)} ${escapeHtml(material.unit || 'un')}</td>
        <td class="trk-qty">${formatQuantity(availability.total)} ${escapeHtml(material.unit || 'un')}</td>
        <td>${formatDate(date)}</td>
      </tr>`;
    }).join('');
}

function bindAvailableSearch() {
  const input = $('#trackingSearch');
  const count = $('#trackingCount');
  if (!input || input.dataset.availabilitySearchBound === '1') return;
  input.dataset.availabilitySearchBound = '1';

  const apply = () => {
    const query = normalize(input.value || '');
    const rows = [...document.querySelectorAll('[data-tracking-row]')];
    let visible = 0;
    rows.forEach(row => {
      const match = !query || String(row.dataset.search || '').includes(query);
      row.hidden = !match;
      if (match) visible += 1;
    });
    if (count) count.textContent = `${visible} item${visible === 1 ? '' : 's'}`;
    const empty = $('#trackingEmpty');
    if (empty) empty.hidden = visible !== 0;
  };

  input.addEventListener('input', apply);
  apply();
}

function patchAvailableTable(data) {
  const table = $('.trk-table');
  if (!table) return;

  const signature = [
    data.availableQty,
    data.stockAvailableQty,
    data.purchaseAvailableQty,
    data.paintingAvailableQty,
    data.totalRequiredQty,
    materials.length
  ].join('|');
  if (table.dataset.availabilityRule === signature) return;
  table.dataset.availabilityRule = signature;

  const headers = [
    'Material',
    'Categoria',
    'Origem disponível',
    'Estoque disponível',
    'Recebido sem pintura',
    'Retornado da pintura',
    'Disponível',
    'Data de recebimento / retorno'
  ];

  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  if (!thead || !tbody) return;

  thead.innerHTML = `<tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr>`;
  tbody.innerHTML = `${availableRowsHtml()}<tr id="trackingEmpty" hidden><td colspan="${headers.length}"><div class="trk-empty"><strong>Nenhum item disponível</strong>Entram aqui estoque disponível, compras recebidas sem pintura e materiais que já retornaram da pintura.</div></td></tr>`;

  bindAvailableSearch();
}

function patch() {
  patchQueued = false;
  if (currentRoute() !== 'estoque' || !projectId) return;

  const data = quantitySummary();
  patchStageIndicator(data);

  const activeStage = $('[data-tracking-stage].active')?.dataset.trackingStage;
  if (activeStage !== 'disponivel') return;

  const panelDescription = $('.trk-panel-head p');
  if (panelDescription) {
    const description = 'Estoque disponível, compras recebidas sem pintura e materiais que já retornaram da pintura.';
    if (panelDescription.textContent !== description) panelDescription.textContent = description;
  }

  const summary = $('.trk-summary');
  if (!summary) return;

  const signature = [
    data.totalItems,
    data.totalRequiredQty,
    data.availableQty,
    data.stockAvailableQty,
    data.purchaseAvailableQty,
    data.paintingAvailableQty
  ].join('|');

  if (lastSignature !== signature || summary.dataset.availableSummary !== signature) {
    lastSignature = signature;
    summary.dataset.availableSummary = signature;
    summary.style.gridTemplateColumns = 'repeat(4,minmax(0,1fr))';
    summary.replaceChildren(
      metric(
        'Itens disponíveis',
        `${data.availableItems} de ${data.totalItems} itens`,
        'itens que já atingiram a etapa de disponibilidade'
      ),
      metric(
        'Disponível do estoque',
        formatQuantity(data.stockAvailableQty),
        'quantidade já disponível em estoque'
      ),
      metric(
        'Recebido sem pintura',
        formatQuantity(data.purchaseAvailableQty),
        'compras recebidas que não precisam de pintura'
      ),
      metric(
        'Retornado da pintura',
        formatQuantity(data.paintingAvailableQty),
        'quantidade que já voltou da pintura'
      )
    );
  }

  patchProgress(data);
  patchAvailableTable(data);
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
