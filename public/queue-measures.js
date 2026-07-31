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
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let requestVersion = 0;
let scheduled = 0;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function currentProjectId() {
  return $('#globalProjectSelect')?.value || localStorage.getItem('obraflow.currentProject') || '';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function formatNumber(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number)) return '';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(number);
}

function firstUseful(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function measureText(material = {}) {
  const explicit = firstUseful(material.dimensions, material.medidas, material.measurements);
  if (explicit) return String(explicit).trim();

  const width = firstUseful(material.width, material.largura, material.sourceDetails?.LARGURA, material.sourceDetails?.L);
  const height = firstUseful(material.height, material.altura, material.sourceDetails?.ALTURA, material.sourceDetails?.A, material.sourceDetails?.H);
  const length = firstUseful(material.length, material.comprimento, material.medida, material.sourceDetails?.COMPRIMENTO, material.sourceDetails?.MEDIDA);

  const parts = [width, height, length]
    .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
    .map(value => formatNumber(value) || String(value).trim());

  if (parts.length) return parts.join(' × ');

  const area = firstUseful(material.area, material.areaM2, material.m2, material.sourceDetails?.AREA, material.sourceDetails?.M2_COMPRA, material.sourceDetails?.M2_CORTE);
  if (area !== undefined && area !== null && String(area).trim() !== '') {
    return `${formatNumber(area) || String(area).trim()} m²`;
  }

  return '—';
}

function insertHeader(table) {
  const headerRow = $('thead tr', table);
  if (!headerRow || $('[data-queue-measures-header]', headerRow)) return;

  const materialHeader = $('th', headerRow);
  if (!materialHeader) return;

  const header = document.createElement('th');
  header.dataset.queueMeasuresHeader = 'true';
  header.textContent = 'Medidas';
  materialHeader.insertAdjacentElement('afterend', header);
}

function insertRowMeasure(row, material) {
  const firstCell = $('td', row);
  if (!firstCell) return;

  let cell = $('[data-queue-measures-cell]', row);
  if (!cell) {
    cell = document.createElement('td');
    cell.dataset.queueMeasuresCell = 'true';
    cell.className = 'nowrap';
    firstCell.insertAdjacentElement('afterend', cell);
  }

  const measures = measureText(material);
  const color = String(material?.color || '').trim();
  cell.innerHTML = `<span class="cell-main">${escapeHtml(measures)}</span>${color ? `<span class="cell-sub">${escapeHtml(color)}</span>` : ''}`;
}

async function decorateQueue() {
  const route = currentRoute();
  if (!['compras', 'recebimento'].includes(route)) return;

  const view = $('#view');
  const table = $('.data-table', view);
  const projectId = currentProjectId();
  if (!view || !table || !projectId) return;

  const version = ++requestVersion;
  try {
    const snapshot = await get(ref(db, `materials/${projectId}`));
    if (version !== requestVersion || currentRoute() !== route) return;

    const materials = snapshot.val() || {};
    insertHeader(table);

    $$('tbody tr', table).forEach(row => {
      const action = $('[data-material-id]', row);
      const materialId = action?.dataset.materialId;
      if (!materialId || !materials[materialId]) return;
      insertRowMeasure(row, materials[materialId]);
    });
  } catch (error) {
    console.error('Não foi possível exibir as medidas na fila:', error);
  }
}

function scheduleDecorate(delay = 0) {
  clearTimeout(scheduled);
  scheduled = setTimeout(decorateQueue, delay);
}

const view = $('#view');
if (view) {
  const observer = new MutationObserver(() => scheduleDecorate(0));
  observer.observe(view, { childList: true });
}

document.addEventListener('change', event => {
  if (event.target.matches?.('#globalProjectSelect')) scheduleDecorate(80);
  if (['compras', 'recebimento'].includes(currentRoute()) && event.target.closest?.('#view')) scheduleDecorate(40);
});

document.addEventListener('input', event => {
  if (['compras', 'recebimento'].includes(currentRoute()) && event.target.closest?.('#view')) scheduleDecorate(80);
});

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="compras"], [data-route="recebimento"]')) scheduleDecorate(120);
});

scheduleDecorate(0);
setTimeout(() => scheduleDecorate(0), 300);
