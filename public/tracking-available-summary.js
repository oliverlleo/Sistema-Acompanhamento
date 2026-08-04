import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  allocation,
  availableQty,
  clamp,
  quantityNumber,
  receivedPurchaseQty
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
  const requiredLimit = alloc.required || Number.MAX_SAFE_INTEGER;
  const received = receivedPurchaseQty(material);
  const paintSent = clamp(quantityNumber(material, material.paintingSentQty), 0, requiredLimit);
  const paintReturned = clamp(
    quantityNumber(material, material.paintingReturnedQty),
    0,
    paintSent || Number.MAX_SAFE_INTEGER
  );
  const delivered = clamp(quantityNumber(material, material.siteDeliveredQty), 0, requiredLimit);
  const inPainting = Math.max(0, paintSent - paintReturned);

  // Quantidade separada em produção não é descontada.
  const available = Math.max(0, availableQty(material) - inPainting - delivered);

  return {
    material,
    alloc,
    received,
    available
  };
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

function applySearch() {
  const input = $('#trackingSearch');
  const count = $('#trackingCount');
  const tbody = $('.trk-table tbody');
  if (!input || !tbody) return;

  const query = normalize(input.value || '');
  let visible = 0;
  $$('[data-tracking-row]', tbody).forEach(row => {
    const match = !query || String(row.dataset.search || '').includes(query);
    row.hidden = !match;
    if (match) visible += 1;
  });

  if (count) count.textContent = `${visible} item${visible === 1 ? '' : 's'}`;
  const empty = $('#trackingEmpty', tbody);
  if (empty) empty.hidden = visible !== 0;
}

function patch() {
  patchQueued = false;
  if (currentRoute() !== 'estoque' || !projectId) return;
  if ($('[data-tracking-stage].active')?.dataset.trackingStage !== 'disponivel') return;

  const table = $('.trk-table');
  const tbody = $('tbody', table);
  if (!table || !tbody) return;

  const rows = materials
    .map(availabilityForMaterial)
    .filter(row => row.available > 0)
    .sort((a, b) => String(a.material.category || '').localeCompare(String(b.material.category || ''), 'pt-BR')
      || String(a.material.description || '').localeCompare(String(b.material.description || ''), 'pt-BR'));

  const headers = $$('thead th', table);
  if (headers[5]) headers[5].textContent = 'Quantidade disponível';

  const signature = rows.map(row => [
    row.material.id || row.material.code || row.material.description || '',
    row.alloc.stockQty,
    row.received,
    row.available,
    row.material.updatedAt || ''
  ].join(':')).join('|');

  if (tbody.dataset.companyAvailabilitySignature !== signature) {
    tbody.dataset.companyAvailabilitySignature = signature;
    tbody.innerHTML = `${rows.map(rowHtml).join('')}
      <tr id="trackingEmpty" hidden><td colspan="7"><div class="trk-empty"><strong>Nenhum item encontrado</strong>Ajuste a busca ou escolha outra etapa.</div></td></tr>`;
  }

  const input = $('#trackingSearch');
  if (input && !input.dataset.companyAvailabilityBound) {
    input.dataset.companyAvailabilityBound = 'true';
    input.addEventListener('input', applySearch);
  }
  applySearch();
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
    console.error('Falha ao carregar a tabela de materiais disponíveis:', error);
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
  }
});
