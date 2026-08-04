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
const EPSILON = 0.000001;
const MAX_LOCAL_NOTICES = 100;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let currentUser = null;
let projects = {};
let previousMaterials = null;
let localNotices = {};
let stopProjects = null;
let stopMaterials = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function normalizeUnit(material = {}) {
  return String(material.unit || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function decimalUnit(material = {}) {
  return ['m', 'm2', 'm²', 'metro', 'metros', 'kg'].includes(normalizeUnit(material));
}

function quantityNumber(material = {}, value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    if (decimalUnit(material) && Number.isInteger(value) && Math.abs(value) >= 1000) return value / 1000;
    return value;
  }
  let text = String(value).trim().replace(/\s/g, '');
  if (!text) return 0;
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) text = text.replace(',', '.');
  else if (text.includes('.') && !decimalUnit(material) && /^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function allocation(material = {}) {
  const required = Math.max(0, quantityNumber(material, material.qtyRequired));
  const source = material.source || 'pendente';
  if (source === 'compra') return { required, purchaseQty: required };
  if (source === 'misto') {
    const stockQty = clamp(quantityNumber(material, material.stockRequiredQty), 0, required);
    const hasPurchase = material.purchaseRequiredQty !== undefined
      && material.purchaseRequiredQty !== null
      && material.purchaseRequiredQty !== '';
    return {
      required,
      purchaseQty: clamp(
        hasPurchase ? quantityNumber(material, material.purchaseRequiredQty) : required - stockQty,
        0,
        required - stockQty
      )
    };
  }
  return { required, purchaseQty: 0 };
}

function receivedQuantity(material = {}) {
  const purchaseQty = allocation(material).purchaseQty;
  return clamp(quantityNumber(material, material.qtyReceived), 0, purchaseQty || Number.MAX_SAFE_INTEGER);
}

function formatQuantity(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);
}

function categoryName(material = {}) {
  return String(material.category || 'Sem categoria').trim() || 'Sem categoria';
}

function purchaseItems(materials = {}) {
  return Object.entries(materials || {})
    .map(([id, material]) => ({ id, material, purchaseQty: allocation(material).purchaseQty }))
    .filter(item => item.purchaseQty > EPSILON);
}

function categoryState(materials = {}, category = '') {
  const items = purchaseItems(materials).filter(item => categoryName(item.material) === category);
  return {
    items,
    complete: items.length > 0 && items.every(item => receivedQuantity(item.material) + EPSILON >= item.purchaseQty)
  };
}

function projectState(materials = {}) {
  const items = purchaseItems(materials);
  return {
    items,
    complete: items.length > 0 && items.every(item => receivedQuantity(item.material) + EPSILON >= item.purchaseQty)
  };
}

function storageKey() {
  return currentUser ? `obraflow.localReceiptNotices.${currentUser.uid}` : '';
}

function loadLocalNotices() {
  localNotices = {};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()) || '{}');
    if (saved && typeof saved === 'object') localNotices = saved;
  } catch {
    localNotices = {};
  }
}

function saveLocalNotices() {
  if (!currentUser) return;
  const sorted = Object.entries(localNotices)
    .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0))
    .slice(0, MAX_LOCAL_NOTICES);
  localNotices = Object.fromEntries(sorted);
  try {
    localStorage.setItem(storageKey(), JSON.stringify(localNotices));
  } catch {
    // Mantém os avisos na sessão quando o armazenamento estiver bloqueado.
  }
}

function safeId(value = '') {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '').slice(0, 100);
}

function tone(type = '') {
  return ({ receipt_partial: 'warning', receipt_complete: 'success', category_complete: 'category', project_receipts_complete: 'project' })[type] || 'info';
}

function icon(type = '') {
  return ({ receipt_partial: '½', receipt_complete: '✓', category_complete: '▦', project_receipts_complete: '★' })[type] || '↓';
}

function relativeTime(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days === 1 ? '' : 's'}`;
}

function ensureStyle() {
  if ($('#obraflowReceiptFallbackStyle')) return;
  const style = document.createElement('style');
  style.id = 'obraflowReceiptFallbackStyle';
  style.textContent = `
    .of-local-heading{margin:10px 4px 7px;color:#0f766e;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.of-local-note{border-color:#b9ddd9}.of-local-note .of-meta::after{content:' · salvo neste aparelho';color:#0f766e}.of-local-toast{position:fixed;z-index:13002;right:18px;bottom:18px;width:min(390px,calc(100% - 36px));padding:14px 15px;border:1px solid #b9ddd9;border-radius:15px;background:#fff;box-shadow:0 18px 46px rgba(15,23,42,.22);cursor:pointer}.of-local-toast strong{display:block;color:#0f172a;font-size:12px}.of-local-toast p{margin:5px 0 0;color:#64748b;font-size:11px;line-height:1.45}@media(max-width:760px){.of-local-toast{right:14px;bottom:max(14px,env(safe-area-inset-bottom));width:calc(100% - 28px)}}
  `;
  document.head.appendChild(style);
}

function sortedNotices() {
  return Object.entries(localNotices)
    .map(([id, notice]) => ({ id, ...notice }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function noticeHtml(notice) {
  const meta = [notice.category, notice.actorName ? `por ${notice.actorName}` : '', relativeTime(notice.createdAt)].filter(Boolean).join(' · ');
  return `<button type="button" class="of-item of-local-note ${tone(notice.type)} ${notice.readAt ? '' : 'unread'}" data-local-notice-id="${escapeHtml(notice.id)}"><span class="of-icon">${escapeHtml(icon(notice.type))}</span><span class="of-copy"><span class="of-project">${escapeHtml(notice.projectName || 'ObraFlow')}</span><strong>${escapeHtml(notice.title || 'Atualização de recebimento')}</strong><p>${escapeHtml(notice.body || '')}</p><span class="of-meta">${escapeHtml(meta)}</span></span></button>`;
}

function renderLocalNotices() {
  ensureStyle();
  const list = $('#obraflowNotificationList');
  if (!list) return;
  const all = sortedNotices();
  const unread = all.filter(item => !item.readAt);
  const filter = $('.of-tab.active')?.dataset.filter || 'unread';
  const visible = filter === 'unread' ? unread : all;
  let block = $('[data-local-fallback-block]', list);

  if (!visible.length) {
    block?.remove();
  } else {
    list.querySelector('.of-empty')?.remove();
    const signature = `${filter}|${visible.map(item => `${item.id}:${item.readAt || 0}`).join('|')}`;
    if (!block) {
      block = document.createElement('div');
      block.dataset.localFallbackBlock = 'true';
      list.prepend(block);
    }
    if (block.dataset.signature !== signature) {
      block.dataset.signature = signature;
      block.innerHTML = `<div class="of-local-heading">Recebimentos detectados neste aparelho</div>${visible.map(noticeHtml).join('')}`;
    }
  }

  const remoteUnread = $$('.of-item.unread:not(.of-local-note)', list).length;
  const totalUnread = remoteUnread + unread.length;
  const count = $('#obraflowNotificationCount');
  if (count) {
    const text = totalUnread > 99 ? '99+' : String(totalUnread);
    if (count.textContent !== text) count.textContent = text;
    if (count.hidden !== (totalUnread === 0)) count.hidden = totalUnread === 0;
  }
  const subtitle = $('#obraflowNotificationSubtitle');
  if (subtitle && totalUnread) {
    const text = `${totalUnread} aviso${totalUnread === 1 ? '' : 's'} não lido${totalUnread === 1 ? '' : 's'}`;
    if (subtitle.textContent !== text) subtitle.textContent = text;
  }
}

function showToast(notice) {
  $('.of-local-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'of-local-toast';
  toast.innerHTML = `<strong>${escapeHtml(notice.title)}</strong><p>${escapeHtml(notice.body)}</p>`;
  toast.addEventListener('click', () => {
    toast.remove();
    $('#obraflowNotificationBell')?.click();
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6500);
}

function addNotice(notice) {
  if (!notice?.id || localNotices[notice.id]) return false;
  localNotices[notice.id] = { ...notice, readAt: 0, localFallback: true };
  saveLocalNotices();
  return true;
}

function priority(type = '') {
  return ({ project_receipts_complete: 4, category_complete: 3, receipt_complete: 2, receipt_partial: 1 })[type] || 0;
}

function detectChanges(beforeTree = {}, afterTree = {}) {
  const generated = [];
  const categoryMilestones = new Set();
  const projectMilestones = new Set();

  Object.entries(afterTree || {}).forEach(([projectId, projectMaterials]) => {
    const beforeProject = beforeTree?.[projectId] || {};
    Object.entries(projectMaterials || {}).forEach(([materialId, material]) => {
      const before = beforeProject?.[materialId];
      if (!before) return;
      const oldReceived = receivedQuantity(before);
      const newReceived = receivedQuantity(material);
      if (newReceived <= oldReceived + EPSILON) return;

      const purchaseQty = allocation(material).purchaseQty;
      if (purchaseQty <= EPSILON) return;
      const project = projects[projectId] || {};
      const projectName = project.name || project.code || 'Obra';
      const description = material.description || material.code || 'Material';
      const unit = material.unit || 'un';
      const category = categoryName(material);
      const remaining = Math.max(0, purchaseQty - newReceived);
      const completed = newReceived + EPSILON >= purchaseQty;
      const changedAt = Number(material.updatedAt || Date.now());
      const actorName = currentUser?.displayName || currentUser?.email || '';

      generated.push({
        id: safeId(`receipt-${projectId}-${materialId}-${changedAt}-${newReceived}`),
        type: completed ? 'receipt_complete' : 'receipt_partial',
        title: completed ? 'Item completamente recebido' : 'Recebimento parcial',
        body: completed
          ? `${description}: ${formatQuantity(newReceived)} de ${formatQuantity(purchaseQty)} ${unit} recebidos.`
          : `${description}: ${formatQuantity(newReceived)} de ${formatQuantity(purchaseQty)} ${unit} recebidos. Faltam ${formatQuantity(remaining)} ${unit}.`,
        projectId, projectName, materialId, materialDescription: description, category, actorName,
        receivedQty: newReceived, purchaseQty, remainingQty: remaining, unit,
        createdAt: changedAt, url: './#estoque'
      });

      const categoryKey = `${projectId}\u0000${category}`;
      if (!categoryMilestones.has(categoryKey)) {
        const beforeCategory = categoryState(beforeProject, category);
        const afterCategory = categoryState(projectMaterials, category);
        if (!beforeCategory.complete && afterCategory.complete) {
          categoryMilestones.add(categoryKey);
          generated.push({
            id: safeId(`category-${projectId}-${category}-${changedAt}`),
            type: 'category_complete',
            title: 'Categoria completamente recebida',
            body: `Todos os ${afterCategory.items.length} itens de ${category} foram recebidos.`,
            projectId, projectName, materialId, category, actorName,
            itemCount: afterCategory.items.length, createdAt: changedAt + 1, url: './#estoque'
          });
        }
      }

      if (!projectMilestones.has(projectId)) {
        const beforeState = projectState(beforeProject);
        const afterState = projectState(projectMaterials);
        if (!beforeState.complete && afterState.complete) {
          projectMilestones.add(projectId);
          generated.push({
            id: safeId(`project-${projectId}-${changedAt}`),
            type: 'project_receipts_complete',
            title: 'Todos os materiais comprados foram recebidos',
            body: `${projectName}: os ${afterState.items.length} itens de compra estão completamente recebidos.`,
            projectId, projectName, materialId, category, actorName,
            itemCount: afterState.items.length, createdAt: changedAt + 2, url: './#estoque'
          });
        }
      }
    });
  });

  const added = generated.filter(addNotice);
  if (added.length) {
    const mostImportant = [...added].sort((a, b) => priority(b.type) - priority(a.type))[0];
    showToast(mostImportant);
    renderLocalNotices();
  }
}

function markRead(id) {
  if (!localNotices[id] || localNotices[id].readAt) return;
  localNotices[id].readAt = Date.now();
  saveLocalNotices();
  renderLocalNotices();
}

function markAllRead() {
  let changed = false;
  Object.values(localNotices).forEach(notice => {
    if (!notice.readAt) {
      notice.readAt = Date.now();
      changed = true;
    }
  });
  if (changed) {
    saveLocalNotices();
    renderLocalNotices();
  }
}

function openNotice(id) {
  const notice = localNotices[id];
  if (!notice) return;
  markRead(id);
  document.body.classList.remove('of-open');
  const select = $('#globalProjectSelect');
  if (notice.projectId && select && [...select.options].some(option => option.value === notice.projectId)) {
    select.value = notice.projectId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  $('[data-route="estoque"]')?.click();
}

document.addEventListener('click', event => {
  const localNotice = event.target.closest('[data-local-notice-id]');
  if (localNotice) {
    event.preventDefault();
    event.stopPropagation();
    openNotice(localNotice.dataset.localNoticeId);
    return;
  }
  if (event.target.closest('[data-read-all]')) markAllRead();
  if (event.target.closest('[data-filter], #obraflowNotificationBell')) setTimeout(renderLocalNotices, 0);
}, true);

function stop() {
  stopProjects?.();
  stopMaterials?.();
  stopProjects = stopMaterials = null;
  currentUser = null;
  projects = {};
  previousMaterials = null;
  localNotices = {};
  renderLocalNotices();
}

function start(user) {
  currentUser = user;
  loadLocalNotices();
  stopProjects?.();
  stopMaterials?.();
  stopProjects = onValue(ref(db, 'projects'), snapshot => {
    projects = snapshot.val() || {};
  });
  stopMaterials = onValue(ref(db, 'materials'), snapshot => {
    const next = snapshot.val() || {};
    if (previousMaterials !== null) detectChanges(previousMaterials, next);
    previousMaterials = next;
  }, error => console.warn('Falha no detector local de recebimentos:', error));
  renderLocalNotices();
}

ensureStyle();
setInterval(renderLocalNotices, 700);
onAuthStateChanged(auth, user => user ? start(user) : stop());
