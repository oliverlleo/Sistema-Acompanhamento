import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase, ref, onValue, get, update, push, set
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

const state = {
  projectId: '',
  materials: {},
  unsubscribe: null,
  decorating: false
};

const STATUS_STAGE = {
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

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;
  let text = String(value).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPast(date) {
  return Boolean(date) && new Date(`${date}T23:59:59`).getTime() < Date.now();
}

function deriveStatus(material) {
  if (material.source === 'pendente' || !material.source) return 'comprar';

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

function addPendingOption(select, label = 'Definir depois') {
  if (!select || select.querySelector('option[value="pendente"]')) return false;
  const option = document.createElement('option');
  option.value = 'pendente';
  option.textContent = label;
  select.insertBefore(option, select.firstChild);
  return true;
}

function prepareGlobalImportSource() {
  const select = $('#importSource');
  if (!select || select.dataset.sourceChoiceReady) return;

  addPendingOption(select);
  select.dataset.sourceChoiceReady = '1';
  select.value = 'pendente';

  queueMicrotask(() => {
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function preparePreviewSources() {
  const globalSource = $('#importSource')?.value || 'pendente';
  const selects = $$('[data-xlsx-source], [data-import-source]');

  selects.forEach(select => {
    const explicitSelection = [...select.options].some(option => option.hasAttribute('selected'));
    const added = addPendingOption(select);
    if (!added) return;

    if (globalSource === 'pendente' && !explicitSelection) {
      select.value = 'pendente';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

function currentProjectId() {
  return $('#globalProjectSelect')?.value || localStorage.getItem('obraflow.currentProject') || '';
}

function listenCurrentProject() {
  const projectId = currentProjectId();
  if (!projectId || projectId === state.projectId) return;

  state.unsubscribe?.();
  state.projectId = projectId;
  state.materials = {};
  state.unsubscribe = onValue(ref(db, `materials/${projectId}`), snapshot => {
    state.materials = snapshot.val() || {};
    queueDecorate();
  });
}

function findSourceBadge(row) {
  return $$('.status-pill', row).find(badge => {
    const text = badge.textContent.trim();
    return ['Compra', 'Estoque', 'Definir depois'].includes(text);
  });
}

function findStageBadge(row) {
  return $$('.status-pill', row).find(badge => {
    const text = badge.textContent.trim();
    return ['Precisa comprar', 'Aguardando definição'].includes(text);
  });
}

function decoratePendingRows() {
  $$('[data-material-id]').forEach(button => {
    const materialId = button.dataset.materialId;
    const material = state.materials[materialId];
    if (!material || material.source !== 'pendente') return;

    const row = button.closest('tr');
    if (!row) return;

    row.dataset.pendingSource = materialId;
    button.dataset.sourceChoiceId = materialId;
    button.textContent = 'Definir origem';
    button.classList.remove('btn-ghost');
    button.classList.add('btn-secondary');

    const sourceBadge = findSourceBadge(row);
    if (sourceBadge) {
      sourceBadge.textContent = 'Definir depois';
      sourceBadge.className = 'status-pill status-warning';
    }

    const stageBadge = findStageBadge(row);
    if (stageBadge) {
      stageBadge.textContent = 'Aguardando definição';
      stageBadge.className = 'status-pill status-warning';
    }
  });
}

function queueDecorate() {
  if (state.decorating) return;
  state.decorating = true;
  queueMicrotask(() => {
    state.decorating = false;
    prepareGlobalImportSource();
    preparePreviewSources();
    listenCurrentProject();
    decoratePendingRows();
  });
}

function closeModal() {
  const root = $('#modalRoot');
  if (root) root.innerHTML = '';
}

function openSourceChoice(materialId) {
  const material = state.materials[materialId];
  if (!material) {
    toast('O material não foi encontrado.', 'error');
    return;
  }

  const root = $('#modalRoot');
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop" data-source-choice-backdrop>
      <section class="modal modal-sm" role="dialog" aria-modal="true" aria-label="Definir origem do material">
        <header class="modal-head">
          <div>
            <h2>Definir origem</h2>
            <p>${escapeHtml(material.description || material.code || 'Material')}</p>
          </div>
          <button class="icon-btn modal-close" type="button" data-source-choice-close aria-label="Fechar">×</button>
        </header>
        <div class="modal-body">
          <p class="muted" style="margin:0 0 16px">Escolha somente agora se este item será comprado ou separado do estoque.</p>
          <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
            <button class="btn btn-primary" type="button" data-source-choice="compra" style="min-height:72px">Comprar</button>
            <button class="btn btn-secondary" type="button" data-source-choice="estoque" style="min-height:72px">Usar estoque</button>
          </div>
        </div>
        <footer class="modal-foot">
          <button class="btn btn-ghost" type="button" data-source-choice-close>Cancelar</button>
        </footer>
      </section>
    </div>`;

  $('[data-source-choice-backdrop]', root)?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeModal();
  });
  $$('[data-source-choice-close]', root).forEach(button => button.addEventListener('click', closeModal));
  $$('[data-source-choice]', root).forEach(button => button.addEventListener('click', () => {
    saveSourceChoice(materialId, button.dataset.sourceChoice, button);
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

  let progressTotal = 0;
  materials.forEach(material => {
    const status = deriveStatus(material);
    progressTotal += STATUS_STAGE[status] || 0;
    if (status === 'enviado_obra') {
      summary.completed += 1;
      summary.enviados += 1;
    } else summary.pending += 1;
    if (status === 'comprar' || status === 'reservar_estoque') summary.comprar += 1;
    if (['aguardando_entrega', 'recebido_parcial'].includes(status)) summary.aguardandoEntrega += 1;
    if (status === 'compra_atrasada') summary.comprasAtrasadas += 1;
    if (['aguarda_pintura', 'em_pintura'].includes(status)) summary.pintura += 1;
    if (status === 'pintura_atrasada') summary.pinturaAtrasada += 1;
    if (['pronto_separar', 'separado_parcial'].includes(status)) summary.separar += 1;
    if (status === 'separado') summary.separados += 1;
  });

  summary.progress = materials.length ? Math.round(progressTotal / materials.length) : 0;
  await set(ref(db, `projectSummaries/${projectId}`), summary);
}

async function saveSourceChoice(materialId, source, button) {
  const material = state.materials[materialId];
  const user = auth.currentUser;
  const projectId = state.projectId || currentProjectId();
  if (!material || !projectId || !user) {
    toast('Não foi possível definir a origem. Atualize a página e tente novamente.', 'error');
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Salvando...';

  try {
    const merged = {
      ...material,
      source,
      updatedAt: Date.now(),
      updatedBy: user.uid
    };
    const status = deriveStatus(merged);

    await update(ref(db, `materials/${projectId}/${materialId}`), {
      source,
      status,
      updatedAt: merged.updatedAt,
      updatedBy: user.uid
    });

    const activity = push(ref(db, `activities/${projectId}`));
    await set(activity, {
      type: 'origem_definida',
      message: `Origem definida como ${source === 'estoque' ? 'estoque' : 'compra'}: ${material.description || material.code || 'Material'}`,
      materialId,
      userId: user.uid,
      userName: user.email || 'Usuário',
      createdAt: Date.now()
    });

    await recalculateSummary(projectId);
    closeModal();
    toast(source === 'estoque' ? 'Item marcado para usar o estoque.' : 'Item marcado para compra.');
  } catch (error) {
    console.error(error);
    toast(error?.message || 'Não foi possível definir a origem.', 'error');
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-source-choice-id]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  openSourceChoice(button.dataset.sourceChoiceId);
}, true);

document.addEventListener('change', event => {
  if (event.target.matches('#globalProjectSelect')) {
    state.projectId = '';
    listenCurrentProject();
  }
});

const observer = new MutationObserver(queueDecorate);
observer.observe(document.body, { childList: true, subtree: true });
queueDecorate();
