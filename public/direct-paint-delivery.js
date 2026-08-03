import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue, update, push, set } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDtfxhvronefOV9MoDj-GvUUiJ3TLfb8qc',
  authDomain: 'sistemsquared.firebaseapp.com',
  databaseURL: 'https://sistemsquared-default-rtdb.firebaseio.com',
  projectId: 'sistemsquared',
  storageBucket: 'sistemsquared.firebasestorage.app',
  messagingSenderId: '43452051582',
  appId: '1:43452051582:web:08a19296448eb66d0b282f'
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const number = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;
  let text = String(value).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const formatQty = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(number(value));
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const isPast = date => Boolean(date) && new Date(`${date}T23:59:59`).getTime() < Date.now();

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let materials = {};
let activeProjectId = '';
let stopMaterials = null;
let pendingMaterialId = '';
let decorateTimer = null;
let bulkIntent = null;

function toast(message, type = 'success') {
  const host = $('#toastHost');
  if (!host) return;
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  host.appendChild(element);
  setTimeout(() => element.remove(), 3600);
}

function currentProjectId() {
  return $('#globalProjectSelect')?.value || localStorage.getItem('obraflow.currentProject') || '';
}

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function allocation(material = {}) {
  const required = Math.max(0, number(material.qtyRequired));
  const source = material.source || 'pendente';
  if (source === 'estoque') return { required, stockQty: required, purchaseQty: 0 };
  if (source === 'compra') return { required, stockQty: 0, purchaseQty: required };
  if (source === 'misto') {
    const stockQty = clamp(number(material.stockRequiredQty), 0, required);
    const purchaseQty = clamp(
      material.purchaseRequiredQty === undefined || material.purchaseRequiredQty === null || material.purchaseRequiredQty === ''
        ? required - stockQty
        : number(material.purchaseRequiredQty),
      0,
      required - stockQty
    );
    return { required, stockQty, purchaseQty };
  }
  return { required, stockQty: 0, purchaseQty: 0 };
}

function directToPainting(material = {}) {
  return Boolean(
    material.paintingRequired
    && allocation(material).purchaseQty > 0
    && material.purchaseDeliveryDestination === 'pintura'
  );
}

function directDelivered(material = {}) {
  return clamp(number(material.directPaintingDeliveredQty), 0, allocation(material).purchaseQty);
}

function deriveLegacyStatus(material = {}) {
  const alloc = allocation(material);
  const required = alloc.required;
  const received = clamp(number(material.qtyReceived), 0, alloc.purchaseQty);
  const available = clamp(alloc.stockQty + received, 0, required);
  const sent = clamp(number(material.paintingSentQty), 0, available || Number.MAX_SAFE_INTEGER);
  const returned = clamp(number(material.paintingReturnedQty), 0, sent || Number.MAX_SAFE_INTEGER);
  const separated = number(material.separatedQty);
  const delivered = number(material.siteDeliveredQty);

  if (required > 0 && delivered >= required) return 'enviado_obra';
  if (delivered > 0) return 'enviado_parcial';
  if (required > 0 && separated >= required) return 'separado';
  if (separated > 0) return 'separado_parcial';

  if (material.paintingRequired) {
    if (required > 0 && returned >= required) return 'pronto_separar';
    if (returned > 0) return 'pronto_separar';
    if (sent > 0) return isPast(material.paintingEta) ? 'pintura_atrasada' : 'em_pintura';
  }

  if (required > 0 && available >= required) return material.paintingRequired ? 'aguarda_pintura' : 'pronto_separar';
  if (available > 0) return material.paintingRequired ? 'aguarda_pintura' : 'recebido_parcial';
  if (alloc.purchaseQty > 0) {
    if (!material.purchaseDate && !material.orderNumber) return 'comprar';
    return isPast(material.deliveryEta) ? 'compra_atrasada' : 'aguardando_entrega';
  }
  if (alloc.stockQty > 0) return material.paintingRequired ? 'aguarda_pintura' : 'pronto_separar';
  return 'comprar';
}

function scheduleDecorate(delay = 0) {
  clearTimeout(decorateTimer);
  decorateTimer = setTimeout(decorate, delay);
}

function listenProject() {
  const projectId = currentProjectId();
  if (!projectId || projectId === activeProjectId) return;
  stopMaterials?.();
  activeProjectId = projectId;
  materials = {};
  stopMaterials = onValue(ref(db, `materials/${projectId}`), snapshot => {
    materials = snapshot.val() || {};
    scheduleDecorate(0);
    applyBulkIntent();
  }, error => console.error('Falha ao carregar materiais para entrega direta:', error));
}

function addRowNote(button, direct) {
  const cell = button.closest('td');
  if (!cell) return;
  let note = $('.direct-paint-row-note', cell);
  if (!direct) {
    note?.remove();
    return;
  }
  if (!note) {
    note = document.createElement('span');
    note.className = 'cell-sub direct-paint-row-note';
    note.style.marginTop = '5px';
    cell.appendChild(note);
  }
  note.textContent = 'Fornecedor entrega direto na pintura';
}

function decorateRows() {
  const route = currentRoute();
  $$('[data-quick-action][data-material-id]', $('#view')).forEach(button => {
    const material = materials[button.dataset.materialId];
    if (!material) return;
    const direct = directToPainting(material);

    if (route === 'recebimento') {
      if (direct) {
        button.dataset.quickAction = 'receive-paint-direct';
        button.textContent = 'Confirmar entrega na pintura';
      } else if (button.dataset.quickAction === 'receive-paint-direct') {
        button.dataset.quickAction = 'receive';
        button.textContent = 'Confirmar chegada';
      }
    }

    addRowNote(button, direct);
  });
}

function ensureQuickPurchaseDestination(form) {
  if ($('#directPurchaseDestination', form)) return;
  const material = materials[pendingMaterialId];
  if (!material?.paintingRequired || allocation(material).purchaseQty <= 0) return;

  const label = document.createElement('label');
  label.id = 'directPurchaseDestination';
  label.className = 'field full';
  label.innerHTML = `
    <span>Destino da entrega</span>
    <select name="purchaseDeliveryDestination">
      <option value="empresa" ${material.purchaseDeliveryDestination !== 'pintura' ? 'selected' : ''}>Receber na empresa e depois enviar para pintura</option>
      <option value="pintura" ${material.purchaseDeliveryDestination === 'pintura' ? 'selected' : ''}>Fornecedor entrega diretamente na pintura</option>
    </select>
    <small class="muted">Esta opção existe somente porque o item está marcado para pintura.</small>`;
  form.appendChild(label);
}

function ensureMaterialDestination(form) {
  if ($('#materialPurchaseDestination', form)) return;
  const paintingFields = $('#paintingFields', form);
  if (!paintingFields) return;

  const material = materials[pendingMaterialId] || {};
  const label = document.createElement('label');
  label.id = 'materialPurchaseDestination';
  label.className = 'field';
  label.innerHTML = `
    <span>Destino da compra</span>
    <select name="purchaseDeliveryDestination">
      <option value="empresa" ${material.purchaseDeliveryDestination !== 'pintura' ? 'selected' : ''}>Receber na empresa</option>
      <option value="pintura" ${material.purchaseDeliveryDestination === 'pintura' ? 'selected' : ''}>Fornecedor entrega direto na pintura</option>
    </select>`;
  paintingFields.prepend(label);

  const sync = () => {
    const painting = $('#paintingRequired', form)?.checked;
    const source = $('#materialSource', form)?.value;
    const usesPurchase = source === 'compra' || source === 'misto';
    label.hidden = !(painting && usesPurchase);
    if (label.hidden) $('select', label).value = 'empresa';
  };

  $('#paintingRequired', form)?.addEventListener('change', sync);
  $('#materialSource', form)?.addEventListener('change', sync);
  sync();
}

function ensureBulkDestination(form) {
  if ($('#bulkPaintingDestination', form)) return;
  const label = document.createElement('label');
  label.id = 'bulkPaintingDestination';
  label.className = 'field full';
  label.innerHTML = `
    <span>Destino dos itens marcados para pintura</span>
    <select name="paintingDeliveryDestination">
      <option value="empresa">Receber na empresa e depois enviar</option>
      <option value="pintura">Fornecedor entrega diretamente na pintura</option>
    </select>
    <small class="muted">Itens sem pintura continuam com entrega normal.</small>`;
  form.appendChild(label);
}

function decorateModal() {
  const quickForm = $('#quickActionForm');
  if (quickForm && $('[name="supplier"]', quickForm) && $('[name="purchaseDate"]', quickForm)) {
    ensureQuickPurchaseDestination(quickForm);
  }

  const materialForm = $('#materialForm');
  if (materialForm) ensureMaterialDestination(materialForm);

  const bulkForm = $('#bulkPurchaseForm');
  if (bulkForm) ensureBulkDestination(bulkForm);
}

function decorate() {
  listenProject();
  decorateRows();
  decorateModal();
}

function closeDirectModal() {
  const root = $('#modalRoot');
  if (root) root.innerHTML = '';
}

function openDirectDeliveryModal(material) {
  const alloc = allocation(material);
  const previousDirect = directDelivered(material);
  const root = $('#modalRoot');
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop" data-direct-paint-backdrop>
      <section class="modal modal-sm" role="dialog" aria-modal="true" aria-label="Confirmar entrega direta na pintura">
        <header class="modal-head">
          <div><h2>Confirmar entrega direta na pintura</h2><p>${escapeHtml(material.description || 'Material')} · parcela comprada ${formatQty(alloc.purchaseQty)} ${escapeHtml(material.unit || 'un')}</p></div>
          <button class="icon-btn modal-close" type="button" data-direct-paint-close>×</button>
        </header>
        <div class="modal-body">
          <form id="directPaintDeliveryForm" class="form-grid">
            <label class="field"><span>Quantidade total entregue na pintura</span><input name="directPaintingDeliveredQty" type="number" step="0.001" min="${previousDirect}" max="${alloc.purchaseQty}" value="${Math.max(previousDirect, alloc.purchaseQty)}" required /></label>
            <label class="field"><span>Data da entrega na pintura</span><input name="directPaintingDeliveredDate" type="date" value="${escapeHtml(material.directPaintingDeliveredDate || todayISO())}" required /></label>
            <label class="field"><span>Empresa de pintura</span><input name="paintingSupplier" value="${escapeHtml(material.paintingSupplier || '')}" required /></label>
            <label class="field"><span>Previsão de retorno</span><input name="paintingEta" type="date" value="${escapeHtml(material.paintingEta || '')}" required /></label>
            <label class="field full"><span>Observações da entrega</span><textarea name="directPaintingNotes">${escapeHtml(material.directPaintingNotes || '')}</textarea></label>
            <div class="import-note full">Esta confirmação registra a parcela comprada como entregue pelo fornecedor diretamente na pintura. Ela não cria um recebimento físico na empresa.</div>
          </form>
        </div>
        <footer class="modal-foot">
          <button class="btn btn-ghost" type="button" data-direct-paint-close>Cancelar</button>
          <button id="saveDirectPaintDelivery" class="btn btn-primary" type="button">Confirmar entrega</button>
        </footer>
      </section>
    </div>`;

  $$('[data-direct-paint-close]', root).forEach(button => button.addEventListener('click', closeDirectModal));
  $('[data-direct-paint-backdrop]', root)?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeDirectModal();
  });

  $('#saveDirectPaintDelivery', root)?.addEventListener('click', async event => {
    const form = $('#directPaintDeliveryForm', root);
    if (!form?.reportValidity()) return;
    const button = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const quantity = number(data.directPaintingDeliveredQty);

    if (quantity < previousDirect - 0.000001) {
      toast(`A quantidade total não pode diminuir. O valor atual é ${formatQty(previousDirect)} ${material.unit || 'un'}.`, 'error');
      return;
    }
    if (quantity > alloc.purchaseQty + 0.000001) {
      toast(`A entrega direta não pode ultrapassar a parcela comprada (${formatQty(alloc.purchaseQty)} ${material.unit || 'un'}).`, 'error');
      return;
    }

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Salvando...';

    try {
      const internalPaintingSent = Math.max(0, number(material.paintingSentQty) - previousDirect);
      const paintingSentQty = clamp(internalPaintingSent + quantity, 0, alloc.required);
      const merged = {
        ...material,
        purchaseDeliveryDestination: 'pintura',
        directPaintingDeliveredQty: quantity,
        directPaintingDeliveredDate: data.directPaintingDeliveredDate,
        directPaintingNotes: data.directPaintingNotes || '',
        paintingSupplier: data.paintingSupplier,
        paintingEta: data.paintingEta,
        qtyReceived: quantity,
        paintingSentQty
      };
      const status = deriveLegacyStatus(merged);
      const base = `materials/${activeProjectId}/${material.id}`;
      const timestamp = Date.now();
      await update(ref(db), {
        [`${base}/purchaseDeliveryDestination`]: 'pintura',
        [`${base}/directPaintingDeliveredQty`]: quantity,
        [`${base}/directPaintingDeliveredDate`]: data.directPaintingDeliveredDate,
        [`${base}/directPaintingNotes`]: data.directPaintingNotes || '',
        [`${base}/paintingSupplier`]: data.paintingSupplier,
        [`${base}/paintingEta`]: data.paintingEta,
        [`${base}/qtyReceived`]: quantity,
        [`${base}/paintingSentQty`]: paintingSentQty,
        [`${base}/status`]: status,
        [`${base}/updatedAt`]: timestamp,
        [`${base}/updatedBy`]: auth.currentUser?.uid || ''
      });

      const activity = push(ref(db, `activities/${activeProjectId}`));
      await set(activity, {
        type: 'entrega_direta_pintura',
        message: `Entrega direta na pintura registrada: ${material.description || 'Material'} · ${formatQty(quantity)} ${material.unit || 'un'}`,
        materialId: material.id,
        userId: auth.currentUser?.uid || '',
        userName: auth.currentUser?.email || 'Usuário',
        createdAt: timestamp
      });

      closeDirectModal();
      toast('Entrega direta na pintura registrada.');
    } catch (error) {
      toast(error?.message || 'Não foi possível registrar a entrega direta na pintura.', 'error');
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  });
}

function selectedBulkIds() {
  return $$('[data-bulk-purchase-item]:checked', $('#view')).map(input => input.dataset.bulkPurchaseItem);
}

function captureBulkIntent(form) {
  if (!form?.reportValidity()) return;
  const ids = selectedBulkIds();
  if (!ids.length) return;
  const data = Object.fromEntries(new FormData(form).entries());
  bulkIntent = {
    ids,
    destination: data.paintingDeliveryDestination === 'pintura' ? 'pintura' : 'empresa',
    purchaseDate: data.purchaseDate || '',
    attempts: 0
  };
  setTimeout(applyBulkIntent, 250);
}

async function applyBulkIntent() {
  if (!bulkIntent || !activeProjectId) return;
  const ready = bulkIntent.ids.every(id => {
    const material = materials[id];
    return !material || !bulkIntent.purchaseDate || material.purchaseDate === bulkIntent.purchaseDate;
  });

  if (!ready && bulkIntent.attempts < 10) {
    bulkIntent.attempts += 1;
    setTimeout(applyBulkIntent, 250);
    return;
  }

  const changes = {};
  bulkIntent.ids.forEach(id => {
    const material = materials[id];
    if (!material) return;
    const destination = material.paintingRequired ? bulkIntent.destination : 'empresa';
    changes[`materials/${activeProjectId}/${id}/purchaseDeliveryDestination`] = destination;
  });

  const intent = bulkIntent;
  bulkIntent = null;
  if (!Object.keys(changes).length) return;
  try {
    await update(ref(db), changes);
    if (intent.destination === 'pintura') toast('Destino direto para pintura aplicado aos itens de pintura da compra em lote.');
  } catch (error) {
    console.error('Falha ao aplicar destino da compra em lote:', error);
  }
}

function movementExists(material = {}) {
  return Boolean(
    number(material.qtyReceived) > 0
    || number(material.directPaintingDeliveredQty) > 0
    || number(material.paintingSentQty) > 0
    || number(material.paintingReturnedQty) > 0
    || number(material.separatedQty) > 0
    || number(material.siteDeliveredQty) > 0
  );
}

document.addEventListener('click', event => {
  const quick = event.target.closest?.('[data-quick-action][data-material-id]');
  if (quick) {
    pendingMaterialId = quick.dataset.materialId;
    const material = materials[pendingMaterialId];
    if (material && currentRoute() === 'recebimento' && directToPainting(material)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      openDirectDeliveryModal(material);
      return;
    }
    setTimeout(() => scheduleDecorate(0), 0);
  }

  const edit = event.target.closest?.('[data-edit-material]');
  if (edit) {
    pendingMaterialId = edit.dataset.editMaterial || '';
    setTimeout(() => scheduleDecorate(0), 0);
  }

  if (event.target.closest?.('[data-action="new-material"], #quickAddBtn')) {
    pendingMaterialId = '';
    setTimeout(() => scheduleDecorate(0), 0);
  }

  const saveMaterial = event.target.closest?.('#saveMaterialBtn');
  if (saveMaterial && pendingMaterialId) {
    const material = materials[pendingMaterialId];
    const form = $('#materialForm');
    const select = $('[name="purchaseDeliveryDestination"]', form);
    const nextDirect = Boolean($('#paintingRequired', form)?.checked && select?.value === 'pintura');
    if (material && movementExists(material) && nextDirect !== directToPainting(material)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      toast('O destino da compra não pode ser alterado depois que o material já teve recebimento, pintura, separação ou envio.', 'error');
      return;
    }
  }

  const saveBulk = event.target.closest?.('#saveBulkPurchaseBtn');
  if (saveBulk) captureBulkIntent($('#bulkPurchaseForm'));

  if (event.target.closest?.('[data-route]')) {
    setTimeout(listenProject, 60);
    scheduleDecorate(100);
  }
}, true);

document.addEventListener('change', event => {
  if (event.target.matches?.('#globalProjectSelect')) {
    stopMaterials?.();
    stopMaterials = null;
    activeProjectId = '';
    materials = {};
    setTimeout(listenProject, 0);
    scheduleDecorate(80);
  }
}, true);

window.addEventListener('hashchange', () => {
  setTimeout(listenProject, 40);
  scheduleDecorate(80);
});

const view = $('#view');
if (view) new MutationObserver(() => scheduleDecorate(0)).observe(view, { childList: true });
const modalRoot = $('#modalRoot');
if (modalRoot) new MutationObserver(() => scheduleDecorate(0)).observe(modalRoot, { childList: true });

onAuthStateChanged(auth, user => {
  stopMaterials?.();
  stopMaterials = null;
  activeProjectId = '';
  materials = {};
  if (!user) return;
  listenProject();
  scheduleDecorate(0);
});
