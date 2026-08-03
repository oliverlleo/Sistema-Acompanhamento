import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, get, update, push, set } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  allocation,
  deriveStatus,
  purchaseNeedsAction,
  summaryForMaterials
} from './material-flow.js?v=20260803-0959';

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
let scheduled = 0;

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

function currentProjectId() {
  return $('#globalProjectSelect')?.value || localStorage.getItem('obraflow.currentProject') || '';
}

function selectedIds(root) {
  return $$('[data-bulk-purchase-item]:checked', root).map(input => input.dataset.bulkPurchaseItem);
}

function syncBulkButton(root) {
  const button = $('#bulkPurchaseBtn', root);
  const all = $$('[data-bulk-purchase-item]', root);
  const selected = selectedIds(root);
  if (button) {
    button.textContent = `Registrar compra em lote (${selected.length})`;
    button.disabled = selected.length === 0;
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
      $$('[data-bulk-purchase-item]', root).forEach(input => { input.checked = selectAll.checked; });
      syncBulkButton(root);
    });
  }

  $$('[data-bulk-purchase-item]', root).forEach(input => {
    if (input.dataset.bound) return;
    input.dataset.bound = 'true';
    input.addEventListener('change', () => syncBulkButton(root));
  });

  syncBulkButton(root);
}

function injectBulkPurchaseUi() {
  if (!isPurchasesScreen()) return;
  const view = $('#view');
  const table = $('.data-table', view);
  const actions = $('.page-head .page-actions', view);
  if (!view || !table || !actions) return;

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

  [...(table.tBodies?.[0]?.rows || [])].forEach(row => {
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
}

function scheduleInject(delay = 0) {
  clearTimeout(scheduled);
  scheduled = setTimeout(injectBulkPurchaseUi, delay);
}

function closeBulkModal() {
  const modalRoot = $('#modalRoot');
  if (modalRoot) modalRoot.innerHTML = '';
}

async function recalculateProjectSummary(projectId) {
  const snapshot = await get(ref(db, `materials/${projectId}`));
  const summary = summaryForMaterials(snapshot.val() || {});
  await set(ref(db, `projectSummaries/${projectId}`), summary);
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
            <div class="import-note full">Em itens mistos, estes dados serão aplicados somente à parcela que precisa ser comprada.</div>
          </form>
        </div>
        <footer class="modal-foot">
          <button class="btn btn-ghost" type="button" data-bulk-close>Cancelar</button>
          <button id="saveBulkPurchaseBtn" class="btn btn-primary" type="button">Registrar compra</button>
        </footer>
      </section>
    </div>`;

  $$('[data-bulk-close]', modalRoot).forEach(button => button.addEventListener('click', closeBulkModal));
  $('#saveBulkPurchaseBtn', modalRoot)?.addEventListener('click', async () => {
    const form = $('#bulkPurchaseForm', modalRoot);
    if (!form?.reportValidity()) return;

    const projectId = currentProjectId();
    const user = auth.currentUser;
    if (!projectId || !user) {
      toast(!projectId ? 'Selecione uma obra antes de registrar a compra.' : 'Sua sessão expirou. Entre novamente.', 'error');
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
        const alloc = allocation(material);
        if (alloc.purchaseQty <= 0 || !purchaseNeedsAction(material)) continue;

        const merged = { ...material, ...data, updatedAt: Date.now(), updatedBy: user.uid };
        const basePath = `materials/${projectId}/${materialId}`;
        updates[`${basePath}/supplier`] = data.supplier;
        updates[`${basePath}/orderNumber`] = data.orderNumber || '';
        updates[`${basePath}/purchaseDate`] = data.purchaseDate;
        updates[`${basePath}/deliveryEta`] = data.deliveryEta;
        updates[`${basePath}/status`] = deriveStatus(merged);
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

const view = $('#view');
if (view) new MutationObserver(() => scheduleInject(0)).observe(view, { childList: true });
document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="compras"]')) scheduleInject(100);
});
document.addEventListener('input', event => {
  if (isPurchasesScreen() && event.target.closest?.('#view')) scheduleInject(220);
});
window.addEventListener('hashchange', () => scheduleInject(80));
scheduleInject(0);
