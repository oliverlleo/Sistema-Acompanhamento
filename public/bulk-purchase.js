import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase, ref, get, update, push, set
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDtfxhvronefOV9MoDj-GvUUiJ3TLfb8qc',
  authDomain: 'sistemsquared.firebaseapp.com',
  databaseURL: 'https://sistemsquared-default-rtdb.firebaseio.com',
  projectId: 'sistemsquared',
  storageBucket: 'sistemsquared.firebasestorage.app',
  messagingSenderId: '43452051582',
  appId: '1:43452051582:web:08a19296448eb66d0b282f'
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const num = (value) => {
  const parsed = Number(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};
const isPast = (date) => Boolean(date) && new Date(`${date}T23:59:59`).getTime() < Date.now();

function deriveStatus(material) {
  const required = Math.max(0, num(material.qtyRequired));
  const delivered = num(material.siteDeliveredQty);
  const separated = num(material.separatedQty);
  const received = num(material.qtyReceived);
  const reserved = num(material.stockReservedQty);
  const available = material.source === 'estoque' ? reserved : received;
  const paintSent = num(material.paintingSentQty);
  const paintReturned = num(material.paintingReturnedQty);

  if (required > 0 && delivered >= required) return 'enviado_obra';
  if (delivered > 0) return 'enviado_parcial';
  if (required > 0 && separated >= required) return 'separado';
  if (separated > 0) return 'separado_parcial';

  if (material.paintingRequired) {
    if (required > 0 && paintReturned >= required) return 'pronto_separar';
    if (paintReturned > 0 && paintReturned >= Math.min(required || paintSent, paintSent || required)) return 'pronto_separar';
    if (paintSent > 0) return isPast(material.paintingEta) ? 'pintura_atrasada' : 'em_pintura';
  }

  if (required > 0 && available >= required) return material.paintingRequired ? 'aguarda_pintura' : 'pronto_separar';
  if (available > 0) return 'recebido_parcial';
  if (material.source === 'estoque') return 'reservar_estoque';
  if (!material.purchaseDate && !material.orderNumber) return 'comprar';
  return isPast(material.deliveryEta) ? 'compra_atrasada' : 'aguardando_entrega';
}

const stageByStatus = {
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

async function recalculateProjectSummary(projectId) {
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

  let progressSum = 0;
  materials.forEach((material) => {
    const status = deriveStatus(material);
    progressSum += stageByStatus[status] ?? 0;
    if (status === 'enviado_obra') {
      summary.completed += 1;
      summary.enviados += 1;
    } else {
      summary.pending += 1;
    }
    if (status === 'comprar' || status === 'reservar_estoque') summary.comprar += 1;
    if (status === 'aguardando_entrega' || status === 'recebido_parcial') summary.aguardandoEntrega += 1;
    if (status === 'compra_atrasada') summary.comprasAtrasadas += 1;
    if (status === 'aguarda_pintura' || status === 'em_pintura') summary.pintura += 1;
    if (status === 'pintura_atrasada') summary.pinturaAtrasada += 1;
    if (status === 'pronto_separar' || status === 'separado_parcial') summary.separar += 1;
    if (status === 'separado') summary.separados += 1;
  });

  summary.progress = materials.length ? Math.round(progressSum / materials.length) : 0;
  await set(ref(db, `projectSummaries/${projectId}`), summary);
}

function toast(message, type = 'success') {
  const host = $('#toastHost');
  if (!host) return;
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  host.appendChild(element);
  setTimeout(() => element.remove(), 3600);
}

function isPurchasesScreen() {
  return location.hash === '#compras' || $('#pageTitle')?.textContent.trim() === 'Compras';
}

function selectedIds(root) {
  return $$('[data-bulk-purchase-item]:checked', root).map((input) => input.dataset.bulkPurchaseItem);
}

function syncBulkButton(root) {
  const button = $('#bulkPurchaseBtn', root);
  const all = $$('[data-bulk-purchase-item]', root);
  const selected = selectedIds(root);
  const label = `Registrar compra em lote (${selected.length})`;

  if (button) {
    if (button.textContent !== label) button.textContent = label;
    const shouldDisable = selected.length === 0;
    if (button.disabled !== shouldDisable) button.disabled = shouldDisable;
  }

  const selectAll = $('#selectAllPurchases', root);
  if (selectAll) {
    selectAll.checked = all.length > 0 && selected.length === all.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < all.length;
  }
}

function bindBulkControls(root) {
  const button = $('#bulkPurchaseBtn', root);
  if (button && !button.dataset.bound) {
    button.dataset.bound = 'true';
    button.addEventListener('click', () => openBulkPurchaseModal(selectedIds(root)));
  }

  const selectAll = $('#selectAllPurchases', root);
  if (selectAll && !selectAll.dataset.bound) {
    selectAll.dataset.bound = 'true';
    selectAll.addEventListener('change', () => {
      $$('[data-bulk-purchase-item]', root).forEach((input) => {
        input.checked = selectAll.checked;
      });
      syncBulkButton(root);
    });
  }

  $$('[data-bulk-purchase-item]', root).forEach((input) => {
    if (input.dataset.bound) return;
    input.dataset.bound = 'true';
    input.addEventListener('change', () => syncBulkButton(root));
  });

  syncBulkButton(root);
}

let injecting = false;
function injectBulkPurchaseUi() {
  if (injecting || !isPurchasesScreen()) return;

  const view = $('#view');
  const table = $('.data-table', view);
  const actions = $('.page-head .page-actions', view);
  if (!view || !table || !actions) return;

  injecting = true;
  try {
    let button = $('#bulkPurchaseBtn', view);
    if (!button) {
      button = document.createElement('button');
      button.id = 'bulkPurchaseBtn';
      button.type = 'button';
      button.className = 'btn btn-secondary';
      button.disabled = true;
      button.textContent = 'Registrar compra em lote (0)';
      actions.prepend(button);
    }

    const headerRow = table.tHead?.rows?.[0];
    if (headerRow && !headerRow.querySelector('[data-bulk-header]')) {
      const header = document.createElement('th');
      header.dataset.bulkHeader = 'true';
      header.style.width = '44px';
      header.style.textAlign = 'center';
      header.innerHTML = '<input id="selectAllPurchases" type="checkbox" aria-label="Selecionar todos os itens que precisam comprar" />';
      headerRow.prepend(header);
    }

    const rows = [...(table.tBodies?.[0]?.rows || [])];
    rows.forEach((row) => {
      if (row.querySelector('[data-bulk-cell]')) return;
      const purchaseButton = row.querySelector('[data-quick-action="purchase"][data-material-id]');
      const cell = document.createElement('td');
      cell.dataset.bulkCell = 'true';
      cell.style.textAlign = 'center';
      if (purchaseButton?.dataset.materialId) {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.bulkPurchaseItem = purchaseButton.dataset.materialId;
        input.setAttribute('aria-label', 'Selecionar item para compra em lote');
        cell.appendChild(input);
      }
      row.prepend(cell);
    });

    bindBulkControls(view);
  } finally {
    injecting = false;
  }
}

function closeBulkModal() {
  const modalRoot = $('#modalRoot');
  if (modalRoot) modalRoot.innerHTML = '';
}

function openBulkPurchaseModal(materialIds) {
  if (!materialIds.length) {
    toast('Selecione pelo menos um item que precisa comprar.', 'error');
    return;
  }

  const modalRoot = $('#modalRoot');
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal modal-sm" role="dialog" aria-modal="true" aria-label="Registrar compra em lote">
        <header class="modal-head">
          <div><h2>Registrar compra em lote</h2><p>${materialIds.length} item(ns) selecionado(s)</p></div>
          <button class="icon-btn modal-close" type="button" data-bulk-close aria-label="Fechar">×</button>
        </header>
        <div class="modal-body">
          <form id="bulkPurchaseForm" class="form-grid">
            <label class="field full"><span>Fornecedor *</span><input name="supplier" required /></label>
            <label class="field full"><span>Pedido / OC</span><input name="orderNumber" /></label>
            <label class="field"><span>Data da compra *</span><input name="purchaseDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
            <label class="field"><span>Previsão de chegada *</span><input name="deliveryEta" type="date" required /></label>
            <div class="import-note full">Os mesmos dados serão aplicados aos ${materialIds.length} itens. Quantidade, categoria e pintura continuam individuais.</div>
          </form>
        </div>
        <footer class="modal-foot">
          <button class="btn btn-ghost" type="button" data-bulk-close>Cancelar</button>
          <button id="saveBulkPurchaseBtn" class="btn btn-primary" type="button">Registrar compra</button>
        </footer>
      </section>
    </div>`;

  $$('[data-bulk-close]', modalRoot).forEach((button) => button.addEventListener('click', closeBulkModal));
  $('#saveBulkPurchaseBtn', modalRoot)?.addEventListener('click', async () => {
    const form = $('#bulkPurchaseForm', modalRoot);
    if (!form?.reportValidity()) return;

    const projectId = localStorage.getItem('obraflow.currentProject') || '';
    const user = auth.currentUser;
    if (!projectId) {
      toast('Selecione uma obra antes de registrar a compra.', 'error');
      return;
    }
    if (!user) {
      toast('Sua sessão expirou. Entre novamente.', 'error');
      return;
    }

    const saveButton = $('#saveBulkPurchaseBtn', modalRoot);
    const originalLabel = saveButton.textContent;
    saveButton.disabled = true;
    saveButton.textContent = 'Registrando...';

    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const updates = {};
      let updatedCount = 0;

      for (const materialId of materialIds) {
        const snapshot = await get(ref(db, `materials/${projectId}/${materialId}`));
        if (!snapshot.exists()) continue;
        const material = snapshot.val();
        if (material.source !== 'compra' || deriveStatus(material) !== 'comprar') continue;

        const merged = {
          ...material,
          ...data,
          updatedAt: Date.now(),
          updatedBy: user.uid
        };
        const status = deriveStatus(merged);
        const basePath = `materials/${projectId}/${materialId}`;
        updates[`${basePath}/supplier`] = data.supplier;
        updates[`${basePath}/orderNumber`] = data.orderNumber || '';
        updates[`${basePath}/purchaseDate`] = data.purchaseDate;
        updates[`${basePath}/deliveryEta`] = data.deliveryEta;
        updates[`${basePath}/status`] = status;
        updates[`${basePath}/updatedAt`] = merged.updatedAt;
        updates[`${basePath}/updatedBy`] = user.uid;
        updatedCount += 1;
      }

      if (!updatedCount) throw new Error('Nenhum item selecionado ainda precisava de compra.');

      await update(ref(db), updates);
      const activityRef = push(ref(db, `activities/${projectId}`));
      await set(activityRef, {
        type: 'compra_em_lote',
        message: `Compra registrada para ${updatedCount} item(ns) · ${data.supplier}`,
        materialId: '',
        userId: user.uid,
        userName: user.email || 'Usuário',
        createdAt: Date.now()
      });
      await recalculateProjectSummary(projectId);

      closeBulkModal();
      toast(`Compra registrada para ${updatedCount} item(ns).`);
    } catch (error) {
      toast(error?.message || 'Não foi possível registrar a compra em lote.', 'error');
    } finally {
      if (saveButton?.isConnected) {
        saveButton.disabled = false;
        saveButton.textContent = originalLabel;
      }
    }
  });
}

const observer = new MutationObserver(() => queueMicrotask(injectBulkPurchaseUi));
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener('hashchange', () => setTimeout(injectBulkPurchaseUi, 0));
setTimeout(injectBulkPurchaseUi, 0);
