import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, get, onValue, push, ref, set, update } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  allocation,
  deriveStatus,
  quantityNumber,
  separableQty,
  summaryForMaterials
} from './material-flow.js?v=20260821-1434';

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

let activeProjectId = '';
let materials = {};
let stopMaterials = null;
let patchQueued = false;
let mixedActionIds = new Set();

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function projectId() {
  return localStorage.getItem('obraflow.currentProject') || '';
}

function formatQty(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(value) || 0);
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function readPath(path, reason) {
  if (window.ObraFlowBackendGuard?.read) {
    return window.ObraFlowBackendGuard.read(path, reason);
  }
  const snapshot = await get(ref(db, path));
  return snapshot.val() || {};
}

function matchesVisibleFilters(material) {
  const search = normalize(document.querySelector('#materialSearch')?.value || '');
  const category = document.querySelector('#categoryFilter')?.value || 'todas';
  const statusFilter = document.querySelector('#statusFilter')?.value || 'todos';
  const status = deriveStatus(material);
  const haystack = normalize([
    material.code,
    material.description,
    material.type,
    material.color,
    material.category,
    material.supplier,
    material.orderNumber,
    material.notes,
    material.dimensions,
    ...Object.values(material.sourceDetails || {})
  ].filter(Boolean).join(' '));

  return (!search || haystack.includes(search))
    && (category === 'todas' || (material.category || 'Sem categoria') === category)
    && (statusFilter === 'todos' || status === statusFilter);
}

function isMixedPartiallySeparable(material) {
  if (material?.source !== 'misto') return false;
  const separated = Math.max(0, quantityNumber(material, material.separatedQty));
  return separableQty(material) > separated + 0.000001;
}

function rowForMaterial(material) {
  const alloc = allocation(material);
  const separated = Math.max(0, quantityNumber(material, material.separatedQty));
  const separable = separableQty(material);
  const required = alloc.required;
  const pct = required > 0 ? Math.min(100, Math.max(0, Math.round((separated / required) * 100))) : 0;
  const status = deriveStatus(material);
  const statusLabel = status === 'separado_parcial' ? 'Separado parcialmente' : 'Pronto para separar';
  const actionLabel = separated > 0 ? 'Continuar separação' : 'Marcar separado';
  const unit = material.unit || 'un';

  return `<tr data-mixed-separation-row="${escapeHtml(material.id || '')}">
    <td><span class="cell-main">${escapeHtml(material.description || 'Sem descrição')}</span><span class="cell-sub">${escapeHtml([material.code, material.type, material.color].filter(Boolean).join(' · ') || 'Sem código')}</span></td>
    <td>${escapeHtml(material.category || 'Sem categoria')}</td>
    <td><span class="status-pill status-warning">Compra + estoque</span><span class="cell-sub">${formatQty(alloc.stockQty)} estoque + ${formatQty(alloc.purchaseQty)} compra</span>${material.paintingRequired ? '<span class="cell-sub">parcela de compra com pintura</span>' : ''}</td>
    <td class="qty-cell"><strong>${formatQty(separated)} / ${formatQty(required)} ${escapeHtml(unit)}</strong><div class="qty-track"><span style="width:${pct}%"></span></div><span class="cell-sub">Disponível agora: ${formatQty(separable)} ${escapeHtml(unit)}</span></td>
    <td><span class="status-pill status-${status === 'separado_parcial' ? 'warning' : 'success'}">${statusLabel}</span></td>
    <td class="nowrap">—</td>
    <td><button class="btn btn-secondary btn-sm" data-mixed-separate="${escapeHtml(material.id || '')}" data-material-id="${escapeHtml(material.id || '')}">${actionLabel}</button></td>
    <td>—</td>
  </tr>`;
}

function updateExistingRow(material, button) {
  const row = button.closest('tr');
  if (!row) return;
  const separated = Math.max(0, quantityNumber(material, material.separatedQty));
  const separable = separableQty(material);
  button.textContent = separated > 0 ? 'Continuar separação' : 'Marcar separado';
  button.classList.remove('btn-ghost');
  button.classList.add('btn-secondary');

  const note = row.querySelector('.qty-cell .cell-sub');
  if (note) note.textContent = `Disponível agora: ${formatQty(separable)} ${material.unit || 'un'}`;
}

function patchSeparationQueue() {
  patchQueued = false;
  mixedActionIds = new Set();
  document.querySelectorAll('[data-mixed-separation-row]').forEach(row => row.remove());

  if (currentRoute() !== 'separacao' || !activeProjectId) return;

  const candidates = Object.values(materials)
    .filter(isMixedPartiallySeparable)
    .filter(matchesVisibleFilters);

  if (!candidates.length) return;

  let tbody = document.querySelector('.data-table tbody');
  const existingIds = new Set(
    [...document.querySelectorAll('[data-material-id]')]
      .map(element => element.dataset.materialId)
      .filter(Boolean)
  );

  candidates.forEach(material => {
    mixedActionIds.add(material.id);
    const existingButton = document.querySelector(`[data-material-id="${CSS.escape(material.id)}"]`);
    if (existingButton) {
      updateExistingRow(material, existingButton);
      return;
    }

    if (!tbody) {
      const toolbar = document.querySelector('.toolbar');
      if (!toolbar) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrap';
      wrapper.dataset.mixedSeparationTable = 'true';
      wrapper.innerHTML = `<table class="data-table"><thead><tr>
        <th>Material</th><th>Categoria</th><th>Origem</th><th>Quantidade</th><th>Etapa atual</th><th>Previsão</th><th>Próxima ação</th><th class="right">Ações</th>
      </tr></thead><tbody></tbody></table>`;
      toolbar.insertAdjacentElement('afterend', wrapper);
      const oldEmpty = wrapper.nextElementSibling;
      if (oldEmpty?.classList.contains('card')) oldEmpty.hidden = true;
      tbody = wrapper.querySelector('tbody');
    }

    if (!existingIds.has(material.id)) {
      tbody.insertAdjacentHTML('beforeend', rowForMaterial(material));
      existingIds.add(material.id);
    }
  });

  const countBadge = document.querySelector('.toolbar .status-pill.status-neutral');
  if (countBadge && tbody) {
    countBadge.textContent = `${tbody.querySelectorAll('tr').length} item(ns)`;
  }
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(() => setTimeout(patchSeparationQueue, 0));
}

function syncProjectListener() {
  const nextProjectId = currentRoute() === 'separacao' ? projectId() : '';
  if (nextProjectId === activeProjectId && stopMaterials) {
    queuePatch();
    return;
  }

  stopMaterials?.();
  stopMaterials = null;
  activeProjectId = nextProjectId;
  materials = {};
  mixedActionIds = new Set();

  if (!activeProjectId) {
    queuePatch();
    return;
  }

  stopMaterials = onValue(ref(db, `materials/${activeProjectId}`), snapshot => {
    materials = snapshot.val() || {};
    queuePatch();
  }, error => {
    console.error('Falha ao acompanhar separação parcial de material misto:', error);
    window.ObraFlowBackendGuard?.verify?.('mixed-separation-listener-error');
  });
}

function modalRoot() {
  return document.querySelector('#modalRoot');
}

function closeModal() {
  const root = modalRoot();
  if (root) root.innerHTML = '';
}

function showToast(message, type = 'success') {
  const host = document.querySelector('#toastHost');
  if (!host) return;
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  host.appendChild(element);
  setTimeout(() => element.remove(), 3600);
}

async function recalculateSummary(id) {
  const value = await readPath(`materials/${id}`, 'mixed-separation-summary');
  const summary = summaryForMaterials(value || {});
  await set(ref(db, `projectSummaries/${id}`), summary);
}

async function logSeparation(id, material, separatedQty) {
  const user = auth.currentUser;
  if (!user) return;
  const activityRef = push(ref(db, `activities/${id}`));
  await set(activityRef, {
    type: 'separate',
    message: `Separação atualizada: ${material.description} — ${formatQty(separatedQty)} ${material.unit || 'un'} separados`,
    materialId: material.id,
    userId: user.uid,
    userName: user.displayName || user.email || 'Usuário',
    createdAt: Date.now()
  });
}

async function openMixedSeparation(materialId) {
  const id = activeProjectId || projectId();
  if (!id || !materialId) return;

  let material;
  try {
    material = await readPath(`materials/${id}/${materialId}`, 'mixed-separation-open');
  } catch (error) {
    showToast('Não foi possível confirmar os dados do material. Tente novamente.', 'error');
    return;
  }

  if (!material || material.source !== 'misto') return;

  const alloc = allocation(material);
  const currentSeparated = Math.max(0, quantityNumber(material, material.separatedQty));
  const availableToSeparate = separableQty(material);
  if (availableToSeparate <= currentSeparated + 0.000001) {
    showToast('Ainda não há uma nova quantidade liberada para separação.', 'error');
    return;
  }

  const root = modalRoot();
  if (!root) return;
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal modal-sm" role="dialog" aria-modal="true" aria-label="Registrar separação">
        <header class="modal-head">
          <div><h2>Registrar separação</h2><p>${escapeHtml(material.description || '')} · necessário ${formatQty(alloc.required)} ${escapeHtml(material.unit || 'un')}</p></div>
          <button class="icon-btn modal-close" data-mixed-close aria-label="Fechar">×</button>
        </header>
        <div class="modal-body">
          <div class="import-note" style="margin-bottom:14px">Disponível para separar agora: <strong>${formatQty(availableToSeparate)} de ${formatQty(alloc.required)} ${escapeHtml(material.unit || 'un')}</strong>. A parcela que ainda está em compra/pintura continua pendente e poderá ser separada depois.</div>
          <form id="mixedSeparationForm" class="form-grid">
            <label class="field"><span>Quantidade total separada</span><input name="separatedQty" type="number" step="0.001" min="${currentSeparated}" max="${availableToSeparate}" value="${availableToSeparate}" required /></label>
            <label class="field"><span>Data da separação</span><input name="separatedDate" type="date" value="${escapeHtml(material.separatedDate || todayISO())}" required /></label>
            <label class="field full"><span>Local / identificação do lote</span><input name="separationLocation" value="${escapeHtml(material.separationLocation || '')}" /></label>
          </form>
        </div>
        <footer class="modal-foot"><button class="btn btn-ghost" data-mixed-close>Cancelar</button><button id="saveMixedSeparation" class="btn btn-primary">Confirmar</button></footer>
      </section>
    </div>`;

  root.querySelectorAll('[data-mixed-close]').forEach(button => button.addEventListener('click', closeModal));
  root.querySelector('.modal-backdrop')?.addEventListener('click', event => {
    if (event.target.classList.contains('modal-backdrop')) closeModal();
  });

  root.querySelector('#saveMixedSeparation')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const form = root.querySelector('#mixedSeparationForm');
    if (!form?.reportValidity()) return;
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Salvando...';

    try {
      const latest = await readPath(`materials/${id}/${materialId}`, 'mixed-separation-save');
      const latestSeparated = Math.max(0, quantityNumber(latest, latest.separatedQty));
      const latestLimit = separableQty(latest);
      const data = Object.fromEntries(new FormData(form).entries());
      const requested = Number(data.separatedQty);

      if (!Number.isFinite(requested) || requested < latestSeparated - 0.000001) {
        throw new Error(`A quantidade total não pode diminuir. O valor atual é ${formatQty(latestSeparated)}.`);
      }
      if (requested > latestLimit + 0.000001) {
        throw new Error(`Só existem ${formatQty(latestLimit)} ${latest.unit || 'un'} liberados para separação agora.`);
      }

      const next = {
        ...latest,
        separatedQty: requested,
        separatedDate: data.separatedDate,
        separationLocation: data.separationLocation || '',
        updatedAt: Date.now(),
        updatedBy: auth.currentUser?.uid || latest.updatedBy || ''
      };
      const status = deriveStatus(next);

      await update(ref(db, `materials/${id}/${materialId}`), {
        separatedQty: requested,
        separatedDate: data.separatedDate,
        separationLocation: data.separationLocation || '',
        status,
        updatedAt: next.updatedAt,
        updatedBy: next.updatedBy
      });
      await logSeparation(id, { ...latest, id: materialId }, requested);
      await recalculateSummary(id);
      closeModal();
      showToast('Separação atualizada. A quantidade restante continuará pendente até ficar disponível.');
    } catch (error) {
      showToast(error?.message || 'Não foi possível registrar a separação.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
}

document.addEventListener('click', event => {
  const customButton = event.target.closest?.('[data-mixed-separate]');
  if (customButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openMixedSeparation(customButton.dataset.mixedSeparate);
    return;
  }

  const regularSeparateButton = event.target.closest?.('[data-quick-action="separate"][data-material-id]');
  if (regularSeparateButton && currentRoute() === 'separacao' && mixedActionIds.has(regularSeparateButton.dataset.materialId)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openMixedSeparation(regularSeparateButton.dataset.materialId);
  }
}, true);

document.addEventListener('input', event => {
  if (event.target.matches?.('#materialSearch')) queuePatch();
}, true);

document.addEventListener('change', event => {
  if (event.target.matches?.('#categoryFilter, #statusFilter, #globalProjectSelect')) {
    if (event.target.matches('#globalProjectSelect')) setTimeout(syncProjectListener, 0);
    else queuePatch();
  }
}, true);

window.addEventListener('hashchange', () => setTimeout(syncProjectListener, 0));
window.addEventListener('obraflow:backend-path-synced', event => {
  if (!activeProjectId || event.detail?.path !== `materials/${activeProjectId}`) return;
  materials = event.detail.value || {};
  queuePatch();
});

const view = document.querySelector('#view');
if (view) new MutationObserver(queuePatch).observe(view, { childList: true, subtree: true });

syncProjectListener();
