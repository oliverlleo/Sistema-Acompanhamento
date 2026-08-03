import { getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const forwardedEvents = new WeakSet();
const pendingTimers = new WeakMap();
const composingInputs = new WeakSet();

let activeProjectId = '';
let materials = {};
let stopMaterials = null;
let lastMaterialQuery = '';

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

function materialSearchText(material = {}, rowText = '') {
  const width = material.width ?? material.largura ?? material.sourceDetails?.LARGURA ?? material.sourceDetails?.L;
  const height = material.height ?? material.altura ?? material.sourceDetails?.ALTURA ?? material.sourceDetails?.A ?? material.sourceDetails?.H;
  const length = material.length ?? material.comprimento ?? material.medida ?? material.sourceDetails?.COMPRIMENTO ?? material.sourceDetails?.MEDIDA;
  const area = material.area ?? material.areaM2 ?? material.m2 ?? material.sourceDetails?.AREA ?? material.sourceDetails?.M2_COMPRA ?? material.sourceDetails?.M2_CORTE;
  const dimensionParts = [width, height, length].filter(value => value !== undefined && value !== null && String(value).trim() !== '');

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
    dimensionParts.length ? dimensionParts.join(' x ') : '',
    ...flattenValues(material.sourceDetails)
  ].filter(value => value !== undefined && value !== null && String(value).trim() !== '').join(' ');
}

function currentProjectId() {
  return document.querySelector('#globalProjectSelect')?.value
    || localStorage.getItem('obraflow.currentProject')
    || '';
}

function ensureMaterialsListener() {
  const projectId = currentProjectId();
  if (!projectId || projectId === activeProjectId) return;
  if (!getApps().length) return;

  stopMaterials?.();
  activeProjectId = projectId;
  materials = {};

  const db = getDatabase(getApp());
  stopMaterials = onValue(ref(db, `materials/${projectId}`), snapshot => {
    materials = snapshot.val() || {};
    if (lastMaterialQuery) setTimeout(() => applyMaterialFilter(lastMaterialQuery), 0);
  }, error => console.error('Falha ao carregar medidas para a busca:', error));
}

function findCurrentInput(input) {
  if (input.id) return document.getElementById(input.id);
  if (input.name) {
    const escapedName = typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(input.name)
      : input.name.replace(/["\\]/g, '\\$&');
    return document.querySelector(`input[type="search"][name="${escapedName}"]`);
  }
  return input.isConnected ? input : null;
}

function restoreSelection(input, snapshot) {
  const replacement = findCurrentInput(input);
  if (!isSearchInput(replacement) || replacement.value !== snapshot.value) return;

  const limit = replacement.value.length;
  const start = Math.min(snapshot.start, limit);
  const end = Math.min(snapshot.end, limit);

  replacement.focus({ preventScroll: true });
  replacement.setSelectionRange(start, end, snapshot.direction);
}

function updateVisibleCount() {
  const rows = [...document.querySelectorAll('#view .data-table tbody tr')];
  const visible = rows.filter(row => !row.classList.contains('material-search-hidden') && !row.hidden).length;
  const counter = document.querySelector('#view .toolbar .status-pill.status-neutral');
  if (counter) counter.textContent = `${visible} item(ns)`;
}

function applyMaterialFilter(query) {
  ensureMaterialsListener();

  const normalizedQuery = normalize(query);
  const compactQuery = compact(query);
  const rows = document.querySelectorAll('#view .data-table tbody tr');

  rows.forEach(row => {
    const materialId = row.querySelector('[data-material-id]')?.dataset.materialId;
    const material = materialId ? materials[materialId] || {} : {};
    const searchable = materialSearchText(material, row.textContent || '');
    const matches = !normalizedQuery
      || normalize(searchable).includes(normalizedQuery)
      || (compactQuery && compact(searchable).includes(compactQuery));

    row.classList.toggle('material-search-hidden', !matches);
  });

  updateVisibleCount();
}

function installSearchStyle() {
  if (document.getElementById('materialSearchFilterStyle')) return;
  const style = document.createElement('style');
  style.id = 'materialSearchFilterStyle';
  style.textContent = '.material-search-hidden{display:none!important}';
  document.head.appendChild(style);
}

function dispatchStandardSearch(input) {
  if (!isSearchInput(input) || !input.isConnected) return;

  const snapshot = {
    value: input.value,
    start: input.selectionStart ?? input.value.length,
    end: input.selectionEnd ?? input.selectionStart ?? input.value.length,
    direction: input.selectionDirection || 'none'
  };

  const forwarded = new Event('input', { bubbles: true, composed: true });
  forwardedEvents.add(forwarded);
  input.dispatchEvent(forwarded);

  queueMicrotask(() => restoreSelection(input, snapshot));
  requestAnimationFrame(() => restoreSelection(input, snapshot));
  setTimeout(() => restoreSelection(input, snapshot), 0);
  setTimeout(() => restoreSelection(input, snapshot), 40);
}

function dispatchMaterialSearch(input) {
  if (!isSearchInput(input) || !input.isConnected) return;

  const snapshot = {
    value: input.value,
    start: input.selectionStart ?? input.value.length,
    end: input.selectionEnd ?? input.selectionStart ?? input.value.length,
    direction: input.selectionDirection || 'none'
  };
  lastMaterialQuery = snapshot.value;

  input.value = '';
  const forwarded = new Event('input', { bubbles: true, composed: true });
  forwardedEvents.add(forwarded);
  input.dispatchEvent(forwarded);

  const restoreAndFilter = () => {
    const replacement = document.getElementById('materialSearch');
    if (!isSearchInput(replacement)) return;
    replacement.value = snapshot.value;
    const limit = replacement.value.length;
    replacement.focus({ preventScroll: true });
    replacement.setSelectionRange(
      Math.min(snapshot.start, limit),
      Math.min(snapshot.end, limit),
      snapshot.direction
    );
    applyMaterialFilter(snapshot.value);
  };

  queueMicrotask(restoreAndFilter);
  requestAnimationFrame(restoreAndFilter);
  setTimeout(restoreAndFilter, 0);
  setTimeout(restoreAndFilter, 60);
}

function scheduleFilter(input, delay = 140) {
  const previous = pendingTimers.get(input);
  if (previous) clearTimeout(previous);

  const timer = setTimeout(() => {
    pendingTimers.delete(input);
    if (input.id === 'materialSearch') dispatchMaterialSearch(input);
    else dispatchStandardSearch(input);
  }, delay);

  pendingTimers.set(input, timer);
}

installSearchStyle();
setTimeout(ensureMaterialsListener, 500);
setTimeout(ensureMaterialsListener, 1500);

document.addEventListener('compositionstart', event => {
  if (isSearchInput(event.target)) composingInputs.add(event.target);
}, true);

document.addEventListener('compositionend', event => {
  const input = event.target;
  if (!isSearchInput(input)) return;
  composingInputs.delete(input);
  scheduleFilter(input, 0);
}, true);

document.addEventListener('input', event => {
  if (forwardedEvents.has(event)) return;

  const input = event.target;
  if (!isSearchInput(input)) return;

  event.stopImmediatePropagation();
  event.stopPropagation();

  if (event.isComposing || composingInputs.has(input)) return;
  scheduleFilter(input);
}, true);

document.addEventListener('change', event => {
  if (event.target.matches?.('#globalProjectSelect')) {
    activeProjectId = '';
    ensureMaterialsListener();
  }

  if (event.target.matches?.('#statusFilter, #categoryFilter')) {
    setTimeout(() => {
      const input = document.getElementById('materialSearch');
      if (!isSearchInput(input)) return;
      input.value = lastMaterialQuery;
      applyMaterialFilter(lastMaterialQuery);
    }, 0);
  }
}, true);

document.addEventListener('click', event => {
  if (!event.target.closest?.('[data-route]')) return;
  setTimeout(() => {
    ensureMaterialsListener();
    const input = document.getElementById('materialSearch');
    if (!isSearchInput(input)) return;
    input.value = lastMaterialQuery;
    applyMaterialFilter(lastMaterialQuery);
  }, 120);
}, true);
