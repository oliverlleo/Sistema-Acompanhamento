import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue, get, update, push, set } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

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
  decorateTimer: null
};

const stages = {
  comprar: 0,
  reservar_estoque: 5,
  aguardando_entrega: 25,
  compra_atrasada: 25,
  recebido_parcial: 38,
  aguarda_pintura: 48,
  em_pintura: 60,
  pintura_atrasada: 60,
  pronto_separar: 74,
  separado_parcial: 80,
  separado: 90,
  enviado_parcial: 94,
  enviado_obra: 100
};

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value ?? '').trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function isPast(date) {
  return Boolean(date) && new Date(`${date}T23:59:59`).getTime() < Date.now();
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
  if (!host) {
    alert(message);
    return;
  }
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  host.appendChild(element);
  setTimeout(() => element.remove(), 4200);
}

function deriveStatus(material) {
  if (!material.source || material.source === 'pendente') return 'comprar';
  const required = Math.max(0, number(material.qtyRequired));
  const delivered = number(material.siteDeliveredQty);
  const separated = number(material.separatedQty);
  const received = number(material.qtyReceived);
  const reserved = number(material.stockReservedQty);
  const available = material.source === 'estoque' ? reserved : received;
  const sent = number(material.paintingSentQty);
  const returned = number(material.paintingReturnedQty);

  if (required > 0 && delivered >= required) return 'enviado_obra';
  if (delivered > 0) return 'enviado_parcial';
  if (required > 0 && separated >= required) return 'separado';
  if (separated > 0) return 'separado_parcial';

  if (material.paintingRequired) {
    if (required > 0 && returned >= required) return 'pronto_separar';
    if (returned > 0 && returned >= Math.min(required || sent, sent || required)) return 'pronto_separar';
    if (sent > 0) return isPast(material.paintingEta) ? 'pintura_atrasada' : 'em_pintura';
  }

  if (required > 0 && available >= required) return material.paintingRequired ? 'aguarda_pintura' : 'pronto_separar';
  if (available > 0) return 'recebido_parcial';
  if (material.source === 'estoque') return 'reservar_estoque';
  if (!material.purchaseDate && !material.orderNumber) return 'comprar';
  return isPast(material.deliveryEta) ? 'compra_atrasada' : 'aguardando_entrega';
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
  });
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
  label.title = 'Selecionar para definir compra ou estoque em lote';
  label.innerHTML = `<input type="checkbox" data-source-batch-id="${escapeHtml(materialId)}" aria-label="Selecionar material">`;
  const checkbox = $('input', label);
  checkbox.checked = state.selected.has(materialId);
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

    $('#applySourceV2', group).addEventListener('click', openBulkSourceModal);
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

function openBulkSourceModal() {
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
          <p class="muted" style="margin:0 0 12px">A escolha será aplicada a todos os selecionados.</p>
          <ul style="margin:0 0 18px;padding-left:20px;max-height:180px;overflow:auto">${categorySummary(materialIds)}</ul>
          <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
            <button class="btn btn-primary" type="button" data-source-v2="compra" style="min-height:72px">Comprar</button>
            <button class="btn btn-secondary" type="button" data-source-v2="estoque" style="min-height:72px">Usar estoque</button>
          </div>
        </div>
        <footer class="modal-foot"><button class="btn btn-ghost" type="button" data-source-v2-close>Cancelar</button></footer>
      </section>
    </div>`;

  $('[data-source-v2-backdrop]', root).addEventListener('click', event => {
    if (event.target === event.currentTarget) closeModal();
  });
  $$('[data-source-v2-close]', root).forEach(button => button.addEventListener('click', closeModal));
  $$('[data-source-v2]', root).forEach(button => button.addEventListener('click', () => {
    saveSourceInBulk(materialIds, button.dataset.sourceV2, button);
  }));
}

async function recalculateSummary(projectId) {
  const snapshot = await get(ref(db, `materials/${projectId}`));
  const materials = Object.values(snapshot.val() || {});
  const summary = {
    total: materials.length,
    completed: 0,
    pending: 0,
    comprar: 0,
    aguardandoEntrega: 0,
    comprasAtrasadas: 0,
    pintura: 0,
    pinturaAtrasada: 0,
    separar: 0,
    separados: 0,
    enviados: 0,
    progress: 0,
    updatedAt: Date.now()
  };

  let progress = 0;
  materials.forEach(material => {
    if (!material.source || material.source === 'pendente') {
      summary.pending += 1;
      return;
    }
    const current = deriveStatus(material);
    progress += stages[current] || 0;
    if (current === 'enviado_obra') {
      summary.completed += 1;
      summary.enviados += 1;
    } else summary.pending += 1;
    if (['comprar', 'reservar_estoque'].includes(current)) summary.comprar += 1;
    if (['aguardando_entrega', 'recebido_parcial'].includes(current)) summary.aguardandoEntrega += 1;
    if (current === 'compra_atrasada') summary.comprasAtrasadas += 1;
    if (['aguarda_pintura', 'em_pintura'].includes(current)) summary.pintura += 1;
    if (current === 'pintura_atrasada') summary.pinturaAtrasada += 1;
    if (['pronto_separar', 'separado_parcial'].includes(current)) summary.separar += 1;
    if (current === 'separado') summary.separados += 1;
  });

  summary.progress = materials.length ? Math.round(progress / materials.length) : 0;
  await set(ref(db, `projectSummaries/${projectId}`), summary);
}

async function saveSourceInBulk(materialIds, source, button) {
  const user = auth.currentUser;
  const projectId = state.projectId || currentProjectId();
  const validIds = materialIds.filter(materialId => state.materials[materialId]);
  if (!user || !projectId || !validIds.length) {
    toast('Não foi possível localizar os itens selecionados.', 'error');
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Salvando...';

  try {
    const timestamp = Date.now();
    const changes = {};
    validIds.forEach(materialId => {
      const base = `materials/${projectId}/${materialId}`;
      changes[`${base}/source`] = source;
      changes[`${base}/status`] = deriveStatus({ ...state.materials[materialId], source });
      changes[`${base}/updatedAt`] = timestamp;
      changes[`${base}/updatedBy`] = user.uid;
      changes[`${base}/sourceDecisionAt`] = timestamp;
      changes[`${base}/sourceDecisionBy`] = user.uid;
    });

    await update(ref(db), changes);
    await set(push(ref(db, `activities/${projectId}`)), {
      type: 'origem_definida_em_lote',
      message: `${validIds.length} item(ns) definido(s) como ${source === 'estoque' ? 'estoque' : 'compra'}`,
      materialId: '',
      userId: user.uid,
      userName: user.email || 'Usuário',
      createdAt: timestamp
    });

    validIds.forEach(materialId => state.selected.delete(materialId));
    await recalculateSummary(projectId);
    closeModal();
    toast(`${validIds.length} item(ns) marcado(s) para ${source === 'estoque' ? 'estoque' : 'compra'}.`);
    scheduleDecorate(100);
  } catch (error) {
    console.error(error);
    toast(error?.message || 'Não foi possível definir a origem em lote.', 'error');
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

document.addEventListener('change', event => {
  const checkbox = event.target.closest?.('[data-source-batch-id]');
  if (checkbox) {
    if (checkbox.checked) state.selected.add(checkbox.dataset.sourceBatchId);
    else state.selected.delete(checkbox.dataset.sourceBatchId);
    updateButtons();
    return;
  }

  if (event.target.matches?.('#globalProjectSelect')) {
    stopListening();
    scheduleDecorate(80);
    scheduleDecorate(350);
    return;
  }

  if (currentRoute() === 'materiais' && event.target.closest?.('#view')) {
    scheduleDecorate(80);
  }
});

document.addEventListener('input', event => {
  if (currentRoute() === 'materiais' && event.target.closest?.('#view')) scheduleDecorate(120);
});

document.addEventListener('click', event => {
  const routeButton = event.target.closest?.('[data-route="materiais"]');
  if (routeButton) {
    scheduleDecorate(80);
    setTimeout(() => scheduleDecorate(0), 300);
  }
});

window.addEventListener('hashchange', () => {
  state.selected.clear();
  if (currentRoute() !== 'materiais') {
    stopListening();
    $('#sourceBatchActionsV2')?.remove();
    return;
  }
  scheduleDecorate(80);
  setTimeout(() => scheduleDecorate(0), 350);
});

scheduleDecorate(120);
setTimeout(() => scheduleDecorate(0), 500);
