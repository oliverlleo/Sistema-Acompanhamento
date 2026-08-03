import { getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

let activeProjectId = '';
let materials = {};
let stopMaterials = null;
let currentQuery = '';
let reapplyTimer = null;

function isSearchInput(element) {
  return element instanceof HTMLInputElement && element.type === 'search';
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[×*]/g, 'x')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function compact(value = '') {
  return normalize(value).replace(/\s+/g, '');
}

function flattenValues(value, output = []) {
  if (value === null || value === undefined || value === '') return output;
  if (Array.isArray(value)) {
    value.forEach(item => flattenValues(item, output));
    return output;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach(item => flattenValues(item, output));
    return output;
  }
  output.push(String(value));
  return output;
}

function currentProjectId() {
  return document.querySelector('#globalProjectSelect')?.value
    || localStorage.getItem('obraflow.currentProject')
    || '';
}

function materialIdFromRow(row) {
  return row.querySelector('[data-material-id]')?.dataset.materialId
    || row.querySelector('[data-edit-material]')?.dataset.editMaterial
    || row.querySelector('[data-delete-material]')?.dataset.deleteMaterial
    || row.querySelector('[data-stable-source-id]')?.dataset.stableSourceId
    || row.querySelector('[data-stable-purchase-id]')?.dataset.stablePurchaseId
    || '';
}

function materialSearchText(material = {}, rowText = '') {
  const details = material.sourceDetails || {};
  const width = material.width ?? material.largura ?? details.LARGURA ?? details.L;
  const height = material.height ?? material.altura ?? details.ALTURA ?? details.A ?? details.H;
  const length = material.length ?? material.comprimento ?? material.medida ?? details.COMPRIMENTO ?? details.MEDIDA;
  const area = material.area ?? material.areaM2 ?? material.m2 ?? details.AREA ?? details.M2_COMPRA ?? details.M2_CORTE;
  const dimensions = [width, height, length]
    .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
    .join(' x ');

  return [
    rowText,
    material.code,
    material.description,
    material.type,
    material.color,
    material.category,
    material.supplier,
    material.orderNumber,
    material.notes,
    material.dimensions,
    material.medidas,
    material.measurements,
    width,
    height,
    length,
    area,
    dimensions,
    ...flattenValues(details)
  ].filter(value => value !== undefined && value !== null && String(value).trim() !== '').join(' ');
}

function ensureStyle() {
  if (document.getElementById('obrafowLocalSearchStyle')) return;
  const style = document.createElement('style');
  style.id = 'obrafowLocalSearchStyle';
  style.textContent = '.obrafow-search-hidden{display:none!important}';
  document.head.appendChild(style);
}

function updateVisibleCount() {
  const rows = [...document.querySelectorAll('#view .data-table tbody tr')];
  const visible = rows.filter(row => !row.classList.contains('obrafow-search-hidden') && !row.hidden).length;
  const counters = document.querySelectorAll('#view .toolbar .status-pill.status-neutral');
  counters.forEach(counter => {
    if (/item/i.test(counter.textContent || '')) counter.textContent = `${visible} item(ns)`;
  });
}

function applySearch(query = currentQuery) {
  currentQuery = String(query ?? '');
  const normalizedQuery = normalize(currentQuery);
  const compactQuery = compact(currentQuery);
  const rows = document.querySelectorAll('#view .data-table tbody tr');

  rows.forEach(row => {
    const materialId = materialIdFromRow(row);
    const material = materialId ? materials[materialId] || {} : {};
    const searchable = materialSearchText(material, row.textContent || '');
    const matches = !normalizedQuery
      || normalize(searchable).includes(normalizedQuery)
      || (compactQuery && compact(searchable).includes(compactQuery));

    row.classList.toggle('obrafow-search-hidden', !matches);
  });

  updateVisibleCount();
}

function scheduleReapply(delay = 0) {
  clearTimeout(reapplyTimer);
  reapplyTimer = setTimeout(() => {
    const search = document.querySelector('#view input[type="search"]');
    if (isSearchInput(search)) currentQuery = search.value;
    applySearch(currentQuery);
  }, delay);
}

function listenMaterials() {
  const projectId = currentProjectId();
  if (!projectId || projectId === activeProjectId || !getApps().length) return;

  stopMaterials?.();
  activeProjectId = projectId;
  materials = {};

  const db = getDatabase(getApp());
  stopMaterials = onValue(ref(db, `materials/${projectId}`), snapshot => {
    materials = snapshot.val() || {};
    scheduleReapply(0);
  }, error => console.error('Falha ao carregar materiais para a busca:', error));
}

ensureStyle();
setTimeout(listenMaterials, 400);
setTimeout(listenMaterials, 1200);

// O filtro é local. Não limpa o campo, não recria o input e não restaura texto antigo.
document.addEventListener('input', event => {
  const input = event.target;
  if (!isSearchInput(input)) return;

  event.stopImmediatePropagation();
  event.stopPropagation();

  currentQuery = input.value;
  applySearch(currentQuery);
}, true);

document.addEventListener('search', event => {
  const input = event.target;
  if (!isSearchInput(input)) return;
  currentQuery = input.value;
  applySearch(currentQuery);
}, true);

document.addEventListener('change', event => {
  if (event.target.matches?.('#globalProjectSelect')) {
    stopMaterials?.();
    stopMaterials = null;
    activeProjectId = '';
    materials = {};
    currentQuery = '';
    setTimeout(listenMaterials, 0);
    scheduleReapply(80);
    return;
  }

  if (event.target.matches?.('#statusFilter, #categoryFilter')) {
    scheduleReapply(0);
    setTimeout(() => scheduleReapply(0), 80);
  }
}, true);

document.addEventListener('click', event => {
  if (!event.target.closest?.('[data-route]')) return;
  currentQuery = '';
  setTimeout(listenMaterials, 80);
  scheduleReapply(160);
}, true);

window.addEventListener('hashchange', () => {
  currentQuery = '';
  setTimeout(listenMaterials, 80);
  scheduleReapply(180);
});
