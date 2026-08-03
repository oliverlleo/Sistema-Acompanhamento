import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue, get, update, push, set } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  allocation,
  clamp,
  deriveStatus,
  number,
  summaryForMaterials
} from './material-flow.js?v=20260803-0959';

const config = {
  apiKey: 'AIzaSyDtfxhvronefOV9MoDj-GvUUiJ3TLfb8qc',
  authDomain: 'sistemsquared.firebaseapp.com',
  databaseURL: 'https://sistemsquared-default-rtdb.firebaseio.com',
  projectId: 'sistemsquared',
  storageBucket: 'sistemsquared.firebasestorage.app',
  messagingSenderId: '43452051582',
  appId: '1:43452051582:web:08a19296448eb66d0b282f'
};

const app = getApps().length ? getApp() : initializeApp(config);
const auth = getAuth(app);
const db = getDatabase(app);
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  projectId: '',
  materials: {},
  selected: new Set(),
  unsubscribe: null,
  decorateTimer: 0
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function formatQty(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(number(value));
}

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function currentProjectId() {
  return $('#globalProjectSelect')?.value || localStorage.getItem('obraflow.currentProject') || '';
}

function closeModal() {
  const root = $('#modalRoot');
  if (root) root.innerHTML = '';
}

function toast(message, type = 'success') {
  const host = $('#toastHost');
  if (!host) return;
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  host.appendChild(element);
  setTimeout(() => element.remove(), 4200);
}

function stopListening() {
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.projectId = '';
  state.materials = {};
  state.selected.clear();
}

function listenCurrentProject() {
  if (currentRoute() !== 'materiais') {
    stopListening();
    return;
  }

  const projectId = currentProjectId();
  if (!projectId || projectId === state.projectId) return;

  state.unsubscribe?.();
  state.projectId = projectId;
  state.materials = {};
  state.selected.clear();
  state.unsubscribe = onValue(ref(db, `materials/${projectId}`), snapshot => {
    state.materials = snapshot.val() || {};
    [...state.selected].forEach(materialId => {
      if (!state.materials[materialId]) state.selected.delete(materialId);
    });
    scheduleDecorate(0);
  }, error => console.error('Falha ao ler materiais para definir origem:', error));
}

function materialIdFromRow(row) {
  return $('[data-material-id]', row)?.dataset.materialId
    || $('[data-edit-material]', row)?.dataset.editMaterial
    || $('[data-delete-material]', row)?.dataset.deleteMaterial
    || '';
}

function materialRows() {
  if (currentRoute() !== 'materiais') return [];
  return $$('.data-table tbody tr').filter(row => materialIdFromRow(row));
}

function addCheckbox(row, materialId) {
  const firstCell = $('td', row);
  if (!firstCell || $('[data-source-batch-id]', row)) return;

  const label = document.createElement('label');
  label.style.cssText = 'display:inline-flex;align-items:center;margin-right:10px;vertical-align:middle;cursor:pointer';
  label.title = 'Selecionar para definir compra, estoque ou divisão';
  label.innerHTML = `<input type="checkbox" data-source-batch-id="${escapeHtml(materialId)}" aria-label="Selecionar material">`;
  const checkbox = $('input', label);
  checkbox.checked = state.selected.has(materialId);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selected.add(materialId);
    else state.selected.delete(materialId);
    updateButtons();
  });
  firstCell.insertBefore(label, firstCell.firstChild);
}

function visibleMaterialIds() {
  return $$('[data-source-batch-id]')
    .filter(input => input.offsetParent !== null)
    .map(input => input.dataset.sourceBatchId)
    .filter(materialId => state.materials[materialId]);
}

function selectedMaterialIds() {
  return [...state.selected].filter(materialId => state.materials[materialId]);
}

function updateButtons() {
  const visible = visibleMaterialIds();
  const selected = selectedMaterialIds();
  const selectButton = $('#selectVisibleSourceV2');
  const applyButton = $('#applySourceV2');

  if (selectButton) {
    const allSelected = visible.length > 0 && visible.every(materialId => state.selected.has(materialId));
    selectButton.disabled = !visible.length;
    selectButton.textContent = allSelected
      ? `Desmarcar visíveis (${visible.length})`
      : `Selecionar visíveis (${visible.length})`;
  }

  if (applyButton) {
    applyButton.disabled = !selected.length;
    applyButton.textContent = `Definir compra/estoque (${selected.length})`;
  }
}

function ensureActions() {
  const current = $('#sourceBatchActionsV2');
  if (currentRoute() !== 'materiais' || !materialRows().length) {
    current?.remove();
    return;
  }

  const actions = $('.page-head .page-actions');
  if (!actions) return;

  if (!current) {
    const group = document.createElement('div');
    group.id = 'sourceBatchActionsV2';
    group.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
    group.innerHTML = '<button id="selectVisibleSourceV2" class="btn btn-ghost" type="button">Selecionar visíveis</button><button id="applySourceV2" class="btn btn-secondary" type="button" disabled>Definir compra/estoque (0)</button>';
    actions.insertBefore(group, actions.firstChild);

    $('#selectVisibleSourceV2', group).addEventListener('click', () => {
      const materialIds = visibleMaterialIds();
      const allSelected = materialIds.length > 0 && materialIds.every(materialId => state.selected.has(materialId));
      materialIds.forEach(materialId => {
        if (allSelected) state.selected.delete(materialId);
        else state.selected.add(materialId);
      });
      $$('[data-source-batch-id]').forEach(input => {
        input.checked = state.selected.has(input.dataset.sourceBatchId);
      });
      updateButtons();
    });

    $('#applySourceV2', group).addEventListener('click', openSourceChoiceModal);
  }

  updateButtons();
}

function decorateMaterialsPage() {
  if (currentRoute() !== 'materiais') {
    $('#sourceBatchActionsV2')?.remove();
    return;
  }

  listenCurrentProject();
  materialRows().forEach(row => {
    const materialId = materialIdFromRow(row);
    if (materialId && state.materials[materialId]) addCheckbox(row, materialId);
  });
  ensureActions();
  updateButtons();
}

function scheduleDecorate(delay = 40) {
  clearTimeout(state.decorateTimer);
  state.decorateTimer = setTimeout(decorateMaterialsPage, delay);
}

function categorySummary(materialIds) {
  const counts = new Map();
  materialIds.forEach(materialId => {
    const category = state.materials[materialId]?.category || 'Sem categoria';
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => `<li><strong>${escapeHtml(category)}</strong>: ${count}</li>`)
    .join('');
}

function openSourceChoiceModal() {
  const materialIds = selectedMaterialIds();
  if (!materialIds.length) {
    toast('Selecione pelo menos um material.', 'error');
    return;
  }

  const root = $('#modalRoot');
  if (!root) return;
  root.innerHTML = `
    <div class="modal-backdrop" data-source-v2-backdrop>
      <section class="modal modal-sm" role="dialog" aria-modal="true">
        <header class="modal-head">
          <div><h2>Definir compra ou estoque</h2><p>${materialIds.length} item(ns) selecionado(s)</p></div>
          <button class="icon-btn modal-close" type="button" data-source-v2-close>×</button>
        </header>
        <div class="modal-body">
          <p class="muted" style="margin:0 0 12px">Escolha como a quantidade necessária de cada material será atendida.</p>
          <ul style="margin:0 0 18px;padding-left:20px;max-height:150px;overflow:auto">${categorySummary(materialIds)}</ul>
          <div class="grid" style="grid-template-columns:1fr;gap:10px">
            <button class="btn btn-primary" type="button" data-source-mode="compra" style="min-height:58px">Comprar toda a quantidade</button>
            <button class="btn btn-secondary" type="button" data-source-mode="estoque" style="min-height:58px">Usar toda a quantidade do estoque</button>
            <button class="btn btn-ghost" type="button" data-source-mode="misto" style="min-height:58px;border:1px solid var(--border)">Dividir entre compra + estoque</button>
          </div>
        </div>
        <footer class="modal-foot"><button class="btn btn-ghost" type="button" data-source-v2-close>Cancelar</button></footer>
      </section>
    </div>`;

  $('[data-source-v2-backdrop]', root).addEventListener('click', event => {
    if (event.target === event.currentTarget) closeModal();
  });
  $$('[data-source-v2-close]', root).forEach(button => button.addEventListener('click', closeModal));
  $$('[data-source-mode]', root).forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.sourceMode;
    if (mode === 'misto') openSplitAllocationModal(materialIds);
    else saveAllocations(materialIds, mode, {}, button);
  }));
}

function splitRows(materialIds) {
  return materialIds.map(materialId => {
    const material = state.materials[materialId];
    const alloc = allocation(material);
    const initialStock = material.source === 'estoque' ? alloc.required : material.source === 'misto' ? alloc.stockQty : 0;
    const initialPurchase = Math.max(0, alloc.required - initialStock);
    return `
      <div data-split-row="${escapeHtml(materialId)}" style="display:grid;grid-template-columns:minmax(180px,1fr) 130px 130px;gap:10px;align-items:end;padding:12px 0;border-bottom:1px solid var(--border)">
        <div><strong style="display:block">${escapeHtml(material.description || 'Material')}</strong><small class="muted">Necessário: ${formatQty(alloc.required)} ${escapeHtml(material.unit || 'un')}</small></div>
        <label class="field"><span>Do estoque</span><input data-stock-allocation type="number" step="0.001" min="0" max="${alloc.required}" value="${initialStock}" required></label>
        <label class="field"><span>Comprar</span><input data-purchase-allocation type="number" value="${initialPurchase}" readonly tabindex="-1"></label>
      </div>`;
  }).join('');
}

function openSplitAllocationModal(materialIds) {
  const root = $('#modalRoot');
  if (!root) return;
  root.innerHTML = `
    <div class="modal-backdrop" data-source-v2-backdrop>
      <section class="modal" role="dialog" aria-modal="true" style="max-width:900px">
        <header class="modal-head">
          <div><h2>Dividir entre compra e estoque</h2><p>Informe quanto já existe no estoque. O restante será calculado para compra.</p></div>
          <button class="icon-btn modal-close" type="button" data-source-v2-close>×</button>
        </header>
        <div class="modal-body">
          <div class="import-note" style="margin-bottom:12px">Cada item continuará sendo um único material. As telas operacionais mostrarão somente a parcela correspondente a cada etapa.</div>
          <form id="splitAllocationForm" style="max-height:55vh;overflow:auto;padding-right:6px">${splitRows(materialIds)}</form>
          <p id="splitAllocationError" class="form-message" style="margin-top:12px" aria-live="polite"></p>
        </div>
        <footer class="modal-foot">
          <button class="btn btn-ghost" type="button" data-source-v2-close>Cancelar</button>
          <button id="saveSplitAllocation" class="btn btn-primary" type="button">Salvar divisão</button>
        </footer>
      </section>
    </div>`;

  const syncRow = row => {
    const materialId = row.dataset.splitRow;
    const required = allocation(state.materials[materialId]).required;
    const stockInput = $('[data-stock-allocation]', row);
    const purchaseInput = $('[data-purchase-allocation]', row);
    const stock = clamp(number(stockInput.value), 0, required);
    purchaseInput.value = Math.max(0, required - stock);
  };

  $$('[data-split-row]', root).forEach(row => {
    $('[data-stock-allocation]', row).addEventListener('input', () => syncRow(row));
  });
  $('[data-source-v2-backdrop]', root).addEventListener('click', event => {
    if (event.target === event.currentTarget) closeModal();
  });
  $$('[data-source-v2-close]', root).forEach(button => button.addEventListener('click', closeModal));
  $('#saveSplitAllocation', root).addEventListener('click', button => {
    const stockById = {};
    let invalid = '';
    $$('[data-split-row]', root).forEach(row => {
      const materialId = row.dataset.splitRow;
      const material = state.materials[materialId];
      const required = allocation(material).required;
      const stock = number($('[data-stock-allocation]', row).value);
      if (!(stock > 0 && stock < required)) {
        invalid = `${material.description || 'Material'}: para dividir, a quantidade de estoque precisa ser maior que zero e menor que ${formatQty(required)}.`;
        return;
      }
      stockById[materialId] = stock;
    });

    if (invalid) {
      $('#splitAllocationError', root).textContent = invalid;
      return;
    }
    saveAllocations(materialIds, 'misto', stockById, button.currentTarget);
  });
}

function hasOperationalMovement(material = {}) {
  return Boolean(
    material.purchaseDate || material.orderNumber || number(material.qtyReceived) > 0
    || number(material.paintingSentQty) > 0 || number(material.paintingReturnedQty) > 0
    || number(material.separatedQty) > 0 || number(material.siteDeliveredQty) > 0
  );
}

function allocationChanges(material, mode, stockValue, userId, timestamp) {
  const old = allocation(material);
  const required = old.required;
  const stockQty = mode === 'estoque' ? required : mode === 'misto' ? clamp(number(stockValue), 0, required) : 0;
  const purchaseQty = mode === 'compra' ? required : mode === 'misto' ? required - stockQty : 0;
  const source = mode;
  const base = {
    source,
    stockRequiredQty: stockQty,
    purchaseRequiredQty: purchaseQty,
    stockReservedQty: stockQty,
    qtyReceived: clamp(number(material.qtyReceived), 0, purchaseQty),
    updatedAt: timestamp,
    updatedBy: userId
  };

  if (old.purchaseQty <= 0 && purchaseQty > 0) {
    Object.assign(base, {
      supplier: '',
      orderNumber: '',
      purchaseDate: '',
      deliveryEta: '',
      receivedDate: '',
      receiptNotes: '',
      qtyReceived: 0
    });
  }

  const merged = { ...material, ...base };
  base.status = deriveStatus(merged);
  return base;
}

async function recalculateSummary(projectId) {
  const snapshot = await get(ref(db, `materials/${projectId}`));
  await set(ref(db, `projectSummaries/${projectId}`), summaryForMaterials(snapshot.val() || {}));
}

async function saveAllocations(materialIds, mode, stockById, button) {
  const user = auth.currentUser;
  const projectId = state.projectId || currentProjectId();
  const validIds = materialIds.filter(materialId => state.materials[materialId]);
  if (!user || !projectId || !validIds.length) {
    toast('Não foi possível localizar os itens selecionados.', 'error');
    return;
  }

  for (const materialId of validIds) {
  const material = state.materials[materialId];
  const old = allocation(material);
  const targetStock = mode === 'estoque' ? old.required : mode === 'misto' ? clamp(number(stockById[materialId]), 0, old.required) : 0;
  const targetPurchase = mode === 'compra' ? old.required : mode === 'misto' ? old.required - targetStock : 0;
  const changed = old.source !== mode
    || Math.abs(old.stockQty - targetStock) > 0.000001
    || Math.abs(old.purchaseQty - targetPurchase) > 0.000001;
  if (changed && hasOperationalMovement(material)) {
    toast(`${material.description || 'Material'} já possui movimentação e não pode ter a divisão alterada.`, 'error');
    return;
  }
}

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Salvando...';

  try {
    const timestamp = Date.now();
    const changes = {};
    let stockTotal = 0;
    let purchaseTotal = 0;

    validIds.forEach(materialId => {
      const material = state.materials[materialId];
      const values = allocationChanges(material, mode, stockById[materialId], user.uid, timestamp);
      const base = `materials/${projectId}/${materialId}`;
      Object.entries(values).forEach(([field, value]) => { changes[`${base}/${field}`] = value; });
      stockTotal += values.stockRequiredQty;
      purchaseTotal += values.purchaseRequiredQty;
    });

    await update(ref(db), changes);
    const activityRef = push(ref(db, `activities/${projectId}`));
    const description = mode === 'compra'
      ? 'definidos integralmente para compra'
      : mode === 'estoque'
        ? 'definidos integralmente para estoque'
        : `divididos entre estoque (${formatQty(stockTotal)}) e compra (${formatQty(purchaseTotal)})`;
    await set(activityRef, {
      type: mode === 'misto' ? 'origem_dividida' : 'origem_em_lote',
      message: `${validIds.length} item(ns) ${description}`,
      materialId: '',
      userId: user.uid,
      userName: user.email || 'Usuário',
      createdAt: timestamp
    });
    await recalculateSummary(projectId);

    state.selected.clear();
    closeModal();
    toast(mode === 'misto' ? 'Divisão entre compra e estoque salva.' : 'Origem dos materiais atualizada.');
    scheduleDecorate(120);
  } catch (error) {
    toast(error?.message || 'Não foi possível atualizar a origem dos materiais.', 'error');
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

const view = $('#view');
if (view) new MutationObserver(() => scheduleDecorate(0)).observe(view, { childList: true });

document.addEventListener('change', event => {
  if (event.target.matches?.('#globalProjectSelect')) {
    stopListening();
    scheduleDecorate(80);
  }
});

document.addEventListener('input', event => {
  if (currentRoute() === 'materiais' && event.target.closest?.('#view')) scheduleDecorate(220);
});

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="materiais"]')) scheduleDecorate(100);
});

window.addEventListener('hashchange', () => scheduleDecorate(80));
scheduleDecorate(0);
