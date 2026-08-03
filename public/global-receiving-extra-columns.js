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

let materialsByProject = {};
let stopMaterials = null;
let patchQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function firstUseful(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function formatMeasurePart(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const parsed = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(parsed)
    : raw;
}

function measureText(material = {}) {
  const explicit = firstUseful(material.dimensions, material.medidas, material.measurements);
  if (explicit) return String(explicit).trim();

  const details = material.sourceDetails || {};
  const width = firstUseful(material.width, material.largura, details.LARGURA, details.L);
  const height = firstUseful(material.height, material.altura, details.ALTURA, details.A, details.H);
  const length = firstUseful(
    material.length,
    material.comprimento,
    material.medida,
    details.COMPRIMENTO,
    details.MEDIDA
  );
  const parts = [width, height, length]
    .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
    .map(formatMeasurePart);

  if (parts.length) return parts.join(' × ');

  const area = firstUseful(
    material.area,
    material.areaM2,
    material.m2,
    details.AREA,
    details.M2_COMPRA,
    details.M2_CORTE
  );
  return area !== undefined && area !== null && String(area).trim() !== ''
    ? `${formatMeasurePart(area)} m²`
    : '—';
}

function colorText(material = {}) {
  const details = material.sourceDetails || {};
  return String(firstUseful(material.color, details.COR, details.Cor, details.cor) || '—').trim() || '—';
}

function ensureStyle() {
  if (document.querySelector('#globalReceivingExtraColumnsStyle')) return;
  const style = document.createElement('style');
  style.id = 'globalReceivingExtraColumnsStyle';
  style.textContent = `
    #globalReceivingRoot .gr-table{min-width:1540px}
    #globalReceivingRoot .gr-extra-code{min-width:110px;max-width:170px}
    #globalReceivingRoot .gr-extra-measure{min-width:160px;max-width:260px}
    #globalReceivingRoot .gr-extra-color{min-width:115px;max-width:190px}
    #globalReceivingRoot .gr-extra-value{display:block;color:#0f172a;font-size:12px;font-weight:700;white-space:normal;overflow-wrap:anywhere}
  `;
  document.head.appendChild(style);
}

function headerCell(label, key, className) {
  const cell = document.createElement('th');
  cell.textContent = label;
  cell.dataset.grExtraHeader = key;
  cell.className = className;
  return cell;
}

function dataCell(value, key, className) {
  const cell = document.createElement('td');
  cell.dataset.grExtraCell = key;
  cell.className = className;
  const span = document.createElement('span');
  span.className = 'gr-extra-value';
  span.textContent = value || '—';
  span.title = value || '—';
  cell.appendChild(span);
  return cell;
}

function parseReference(button) {
  const value = button?.dataset.globalReceive || '';
  const separator = value.indexOf(':');
  if (separator < 1) return null;
  return {
    projectId: value.slice(0, separator),
    materialId: value.slice(separator + 1)
  };
}

function patchHeader(table) {
  const row = table.tHead?.rows?.[0];
  if (!row || row.querySelector('[data-gr-extra-header]')) return;

  const cells = [...row.cells];
  const workHeader = cells.find(cell => cell.textContent.trim() === 'Obra');
  const materialHeader = cells.find(cell => cell.textContent.trim() === 'Material');
  if (!workHeader || !materialHeader) return;

  const code = headerCell('Código', 'code', 'gr-extra-code');
  workHeader.insertAdjacentElement('afterend', code);

  const measure = headerCell('Medida', 'measure', 'gr-extra-measure');
  const color = headerCell('Cor', 'color', 'gr-extra-color');
  materialHeader.insertAdjacentElement('afterend', measure);
  measure.insertAdjacentElement('afterend', color);
}

function patchRow(row) {
  if (row.querySelector('[data-gr-extra-cell]')) return;

  const button = row.querySelector('[data-global-receive]');
  const reference = parseReference(button);
  if (!reference) return;

  const material = materialsByProject[reference.projectId]?.[reference.materialId];
  if (!material) return;

  const workCell = row.cells[0];
  const materialCell = row.cells[1];
  if (!workCell || !materialCell) return;

  const code = dataCell(String(material.code || '—').trim() || '—', 'code', 'gr-extra-code');
  workCell.insertAdjacentElement('afterend', code);

  const measure = dataCell(measureText(material), 'measure', 'gr-extra-measure');
  const color = dataCell(colorText(material), 'color', 'gr-extra-color');
  materialCell.insertAdjacentElement('afterend', measure);
  measure.insertAdjacentElement('afterend', color);
}

function patchTable() {
  patchQueued = false;
  if (currentRoute() !== 'recebimento') return;

  const table = document.querySelector('#globalReceivingRoot .gr-table');
  if (!table) return;

  ensureStyle();
  patchHeader(table);
  [...(table.tBodies?.[0]?.rows || [])].forEach(patchRow);
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(() => setTimeout(patchTable, 0));
}

onAuthStateChanged(auth, user => {
  stopMaterials?.();
  stopMaterials = null;
  materialsByProject = {};

  if (!user) return;
  stopMaterials = onValue(ref(db, 'materials'), snapshot => {
    materialsByProject = snapshot.val() || {};
    queuePatch();
  }, error => console.error('Falha ao carregar colunas extras do recebimento:', error));
});

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="recebimento"]')) {
    setTimeout(queuePatch, 80);
    setTimeout(queuePatch, 300);
  }
});

window.addEventListener('hashchange', queuePatch);

const view = document.querySelector('#view');
if (view) new MutationObserver(queuePatch).observe(view, { childList: true, subtree: true });

queuePatch();
