import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue, get, update, push, set } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

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
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { projectId: '', materials: {}, selected: new Set(), unsubscribe: null, decorating: false };
const STAGE = { comprar: 0, reservar_estoque: 5, aguardando_entrega: 25, compra_atrasada: 25, recebido_parcial: 38, aguarda_pintura: 48, em_pintura: 60, pintura_atrasada: 60, pronto_separar: 74, separado_parcial: 80, separado: 90, enviado_parcial: 94, enviado_obra: 100 };

function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value ?? '').trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
function esc(value = '') { return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]); }
function isPast(date) { return Boolean(date) && new Date(`${date}T23:59:59`).getTime() < Date.now(); }
function routeName() { return location.hash.replace(/^#/, '') || 'dashboard'; }
function projectId() { return $('#globalProjectSelect')?.value || localStorage.getItem('obraflow.currentProject') || ''; }
function closeModal() { if ($('#modalRoot')) $('#modalRoot').innerHTML = ''; }
function toast(message, type = 'success') {
  const host = $('#toastHost');
  if (!host) return alert(message);
  const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = message; host.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function deriveStatus(material) {
  const required = Math.max(0, num(material.qtyRequired));
  const delivered = num(material.siteDeliveredQty), separated = num(material.separatedQty);
  const received = num(material.qtyReceived), reserved = num(material.stockReservedQty);
  const available = material.source === 'estoque' ? reserved : received;
  const paintSent = num(material.paintingSentQty), paintReturned = num(material.paintingReturnedQty);
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

function listenProject() {
  const id = projectId();
  if (!id || id === state.projectId) return;
  state.unsubscribe?.(); state.projectId = id; state.selected.clear(); state.materials = {};
  state.unsubscribe = onValue(ref(db, `materials/${id}`), snap => {
    state.materials = snap.val() || {};
    for (const id of [...state.selected]) if (state.materials[id]?.source !== 'pendente') state.selected.delete(id);
    queueDecorate();
  });
}

function pendingVisibleIds() {
  return $$('[data-origin-bulk-id]').filter(input => input.offsetParent !== null).map(input => input.dataset.originBulkId)
    .filter(id => state.materials[id]?.source === 'pendente');
}
function selectedIds() { return [...state.selected].filter(id => state.materials[id]?.source === 'pendente'); }

function addCheckbox(row, id) {
  const cell = $('td', row); if (!cell) return;
  let input = $(`[data-origin-bulk-id="${CSS.escape(id)}"]`, row);
  if (!input) {
    const label = document.createElement('label');
    label.style.cssText = 'display:inline-flex;align-items:center;margin-right:10px;vertical-align:middle;cursor:pointer';
    label.title = 'Selecionar para definir a origem em lote';
    label.innerHTML = `<input type="checkbox" data-origin-bulk-id="${esc(id)}" aria-label="Selecionar para definir origem em lote">`;
    cell.insertBefore(label, cell.firstChild); input = $('input', label);
  }
  input.checked = state.selected.has(id);
}

function decorateRows() {
  if (routeName() !== 'materiais') return;
  $$('[data-material-id]').forEach(button => {
    const id = button.dataset.materialId, material = state.materials[id];
    if (!material || material.source !== 'pendente') return;
    const row = button.closest('tr'); if (row) addCheckbox(row, id);
  });
}

function updateButtons() {
  const selected = selectedIds(), visible = pendingVisibleIds();
  const bulk = $('#bulkOriginBtn'), select = $('#selectVisibleOriginBtn');
  if (bulk) { bulk.disabled = !selected.length; bulk.textContent = `Definir origem em lote (${selected.length})`; }
  if (select) {
    const all = visible.length > 0 && visible.every(id => state.selected.has(id));
    select.disabled = !visible.length;
    select.textContent = all ? 'Desmarcar pendentes visíveis' : `Selecionar pendentes visíveis (${visible.length})`;
  }
}

function ensureActions() {
  const old = $('#bulkOriginActions');
  if (routeName() !== 'materiais' || !Object.values(state.materials).some(m => m?.source === 'pendente')) { old?.remove(); return; }
  const actions = $('.page-head .page-actions'); if (!actions) return;
  if (!old) {
    const group = document.createElement('div'); group.id = 'bulkOriginActions';
    group.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
    group.innerHTML = '<button id="selectVisibleOriginBtn" class="btn btn-ghost" type="button">Selecionar pendentes visíveis</button><button id="bulkOriginBtn" class="btn btn-secondary" type="button" disabled>Definir origem em lote (0)</button>';
    actions.insertBefore(group, actions.firstChild);
    $('#selectVisibleOriginBtn', group).addEventListener('click', () => {
      const visible = pendingVisibleIds(), all = visible.length > 0 && visible.every(id => state.selected.has(id));
      visible.forEach(id => all ? state.selected.delete(id) : state.selected.add(id));
      $$('[data-origin-bulk-id]').forEach(input => input.checked = state.selected.has(input.dataset.originBulkId));
      updateButtons();
    });
    $('#bulkOriginBtn', group).addEventListener('click', openBulkModal);
  }
  updateButtons();
}

function queueDecorate() {
  if (state.decorating) return; state.decorating = true;
  queueMicrotask(() => { state.decorating = false; listenProject(); decorateRows(); ensureActions(); updateButtons(); });
}

function categoryList(ids) {
  const count = new Map();
  ids.forEach(id => { const cat = state.materials[id]?.category || 'Sem categoria'; count.set(cat, (count.get(cat) || 0) + 1); });
  return [...count.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cat, total]) => `<li><strong>${esc(cat)}</strong>: ${total}</li>`).join('');
}

function openBulkModal() {
  const ids = selectedIds(); if (!ids.length) return toast('Selecione pelo menos um item pendente.', 'error');
  const root = $('#modalRoot'); if (!root) return;
  root.innerHTML = `<div class="modal-backdrop" data-origin-backdrop><section class="modal modal-sm" role="dialog" aria-modal="true"><header class="modal-head"><div><h2>Definir origem em lote</h2><p>${ids.length} item(ns) selecionado(s)</p></div><button class="icon-btn modal-close" data-origin-close>×</button></header><div class="modal-body"><p class="muted" style="margin:0 0 12px">A mesma origem será aplicada a todos os selecionados.</p><ul style="margin:0 0 18px;padding-left:20px;max-height:180px;overflow:auto">${categoryList(ids)}</ul><div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:12px"><button class="btn btn-primary" data-origin-value="compra" style="min-height:72px">Marcar todos para comprar</button><button class="btn btn-secondary" data-origin-value="estoque" style="min-height:72px">Marcar todos para estoque</button></div></div><footer class="modal-foot"><button class="btn btn-ghost" data-origin-close>Cancelar</button></footer></section></div>`;
  $('[data-origin-backdrop]', root).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  $$('[data-origin-close]', root).forEach(btn => btn.addEventListener('click', closeModal));
  $$('[data-origin-value]', root).forEach(btn => btn.addEventListener('click', () => saveBulk(ids, btn.dataset.originValue, btn)));
}

async function recalc(id) {
  const snap = await get(ref(db, `materials/${id}`)), materials = Object.values(snap.val() || {});
  const s = { total: materials.length, completed: 0, pending: 0, comprar: 0, aguardandoEntrega: 0, comprasAtrasadas: 0, pintura: 0, pinturaAtrasada: 0, separar: 0, separados: 0, enviados: 0, progress: 0, updatedAt: Date.now() };
  let progress = 0;
  materials.forEach(m => {
    if (m.source === 'pendente' || !m.source) { s.pending += 1; return; }
    const st = deriveStatus(m); progress += STAGE[st] || 0;
    if (st === 'enviado_obra') { s.completed += 1; s.enviados += 1; } else s.pending += 1;
    if (['comprar', 'reservar_estoque'].includes(st)) s.comprar += 1;
    if (['aguardando_entrega', 'recebido_parcial'].includes(st)) s.aguardandoEntrega += 1;
    if (st === 'compra_atrasada') s.comprasAtrasadas += 1;
    if (['aguarda_pintura', 'em_pintura'].includes(st)) s.pintura += 1;
    if (st === 'pintura_atrasada') s.pinturaAtrasada += 1;
    if (['pronto_separar', 'separado_parcial'].includes(st)) s.separar += 1;
    if (st === 'separado') s.separados += 1;
  });
  s.progress = materials.length ? Math.round(progress / materials.length) : 0;
  await set(ref(db, `projectSummaries/${id}`), s);
}

async function saveBulk(ids, source, button) {
  const user = auth.currentUser, pid = state.projectId || projectId();
  const valid = ids.filter(id => state.materials[id]?.source === 'pendente');
  if (!user || !pid || !valid.length) return toast('Não há itens pendentes válidos selecionados.', 'error');
  const label = button.textContent; button.disabled = true; button.textContent = 'Salvando...';
  try {
    const timestamp = Date.now(), changes = {};
    valid.forEach(id => {
      const status = deriveStatus({ ...state.materials[id], source }), base = `materials/${pid}/${id}`;
      changes[`${base}/source`] = source; changes[`${base}/status`] = status;
      changes[`${base}/updatedAt`] = timestamp; changes[`${base}/updatedBy`] = user.uid;
    });
    await update(ref(db), changes);
    const activity = push(ref(db, `activities/${pid}`));
    await set(activity, { type: 'origem_definida_em_lote', message: `${valid.length} item(ns) definido(s) como ${source === 'estoque' ? 'estoque' : 'compra'}`, materialId: '', userId: user.uid, userName: user.email || 'Usuário', createdAt: timestamp });
    valid.forEach(id => state.selected.delete(id)); await recalc(pid); closeModal();
    toast(`${valid.length} item(ns) marcado(s) para ${source === 'estoque' ? 'estoque' : 'compra'}.`);
  } catch (error) { console.error(error); toast(error?.message || 'Não foi possível definir a origem em lote.', 'error'); button.disabled = false; button.textContent = label; }
}

document.addEventListener('change', event => {
  if (event.target.matches('#globalProjectSelect')) { state.projectId = ''; state.selected.clear(); listenProject(); return; }
  const input = event.target.closest('[data-origin-bulk-id]'); if (!input) return;
  input.checked ? state.selected.add(input.dataset.originBulkId) : state.selected.delete(input.dataset.originBulkId); updateButtons();
});
window.addEventListener('hashchange', () => { state.selected.clear(); queueDecorate(); });
const observer = new MutationObserver(queueDecorate); observer.observe(document.body, { childList: true, subtree: true }); queueDecorate();
