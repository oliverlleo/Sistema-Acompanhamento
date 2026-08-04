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
let panelObserver = null;
let renderScheduled = false;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function normalizeUnit(material = {}) {
  return String(material.unit || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
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
    const purchaseQty = clamp(
      hasPurchase ? quantityNumber(material, material.purchaseRequiredQty) : required - stockQty,
      0,
      required - stockQty
    );
    return { required, purchaseQty };
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
  const key = storageKey();
  if (!key) return;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    if (parsed && typeof parsed === 'object') localNotices = parsed;
  } catch {
    localNotices = {};
  }
}

function saveLocalNotices() {
  const key = storageKey();
  if (!key) return;
  const sorted = Object.entries(localNotices)
    .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0))
    .slice(0, MAX_LOCAL_NOTICES);
  localNotices = Object.fromEntries(sorted);
  try {
    localStorage.setItem(key, JSON.stringify(localNotices));
  } catch {
    // O aviso continua funcionando durante a sessão mesmo se o armazenamento estiver bloqueado.
  }
}

function safeId(value = '') {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '').slice(0, 100);
}

function noticeTone(type = '') {
  return ({
    receipt_partial: 'warning',
    receipt_complete: 'success',
    category_complete: 'category',
    project_receipts_complete: 'project'
  })[type] || 'info';
}

function noticeIcon(type = '') {
  return ({
    receipt_partial: '½',
    receipt_complete: '✓',
    category_complete: '▦',
    project_receipts_complete: '★'
  })[type] || '↓';
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
    .of-local-block{display:contents}.of-local-heading{margin:10px 4px 7px;color:#0f766e;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.of-local-note{border-color:#b9ddd9}.of-local-note .of-meta::after{content:' · salvo neste aparelho';color:#0f766e}.of-local-toast{position:fixed;z-index:13002;right:18px;bottom:18px;width:min(390px,calc(100% - 36px));padding:14px 15px;border:1px solid #b9ddd9;border-radius:15px;background:#fff;box-shadow:0 18px 46px rgba(15,23,42,.22);cursor:pointer}.of-local-toast strong{display:block;color:#0f172a;font-size:12px}.of-local-toast p{margin:5px 0 0;color:#64748b;font-size:11px;line-height:1.45}@media(max-width:760px){.of-local-toast{right:14px;bottom:max(14px,env(safe-area-inset-bottom));width:calc(100% - 28px)}}
  `;
  document.head.appendChild(style);
}

function sortedLocalNotices() {
  return Object.entries(localNotices)
    .map(([id, notice]) => ({ id, ...notice }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function localNoticeHtml(notice) {
  const meta = [notice.category, notice.actorName ? `por ${notice.actorName}` : '', relativeTime(notice.createdAt)].filter(Boolean).join(' · ');
  return `<button type="button" class="of-item of-local-note ${noticeTone(notice.type)} ${notice.readAt ? '' : 'unread'}" data-local-notice-id="${escapeHtml(notice.id)}"><span class="of-icon">${escapeHtml(noticeIcon(notice.type))}</span><span class="of-copy"><span class="of-project">${escapeHtml(notice.projectName || 'ObraFlow')}</span><strong>${escapeHtml(notice.title || 'Atualização de recebimento')}</strong><p>${escapeHtml(notice.body || '')}</p><span class="of-meta">${escapeHtml(meta)}</span></span></button>`;
}

function activeFilter() {
  return $('.of-tab.active')?.dataset.filter || 'unread';
}

function renderLocalNotices() {
  renderScheduled = false;
  ensureStyle();
  const list = $('#obraflowNotificationList');
  if (!list) return;

  const all = sortedLocalNotices();
  const unread = all.filter(item => !item.readAt);
  const visible = activeFilter() === 'unread' ? unread : all;
  let block = $('[data-local-fallback-block]', list);

  if (!visible.length) {
    block?.remove();
  } else {
    list.querySelector('.of-empty')?.remove();
    const signature = visible.map(item => `${item.id}:${item.readAt || 0}`).join('|');
    if (!block) {
      block = document.createElement('div');
      block.dataset.localFallbackBlock = 'true';
      block.className = 'of-local-block';
      list.prepend(block);
    }
    if (block.dataset.signature !== signature) {
      block.dataset.signature = signature;
      block.innerHTML = `<div class="of-local-heading">Recebimentos detectados neste aparelho</div>${visible.map(localNoticeHtml).join('')}`;
    }
  }

  const remoteUnread = $$('.of-item.unread:not(.of-local-note)', list).length;
  const totalUnread = remoteUnread + unread.length;
  const count = $('#obraflowNotificationCount');
  if (count) {
    const text = totalUnread > 99 ? '99+' : String(totalUnread);
    if (count.textContent !== text) count.textContent = text;
    count.hidden = totalUnread === 0;
  }
  const subtitle = $('#obraflowNotificationSubtitle');
  if (subtitle && totalUnread) subtitle.textContent = `${totalUnread} aviso${totalUnread === 1 ? '' : 's'} não lido${totalUnread === 1 ? '' : 's'}`;
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  queueMicrotask(renderLocalNotices);
}

function ensurePanelObserver() {
  const panel = $('#obraflowNotificationPanel');
  if (!panel || panelObserver) return;
  panelObserver = new MutationObserver(scheduleRender);
  panelObserver.observe(panel, { childList: true, subtree: true, characterData: true });
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

function addLocalNotice(notice) {
  if (!notice?.id || localNotices[notice.id]) return false;
  localNotices[notice.id] = { ...notice, readAt: 0, localFallback: true };
  saveLocalNotices();
  scheduleRender();
  return true;
}

function noticePriority(type = '') {
  return ({ project_receipts_complete: 4, category_complete: 3, receipt_complete: 2, receipt_partial: 1 })[type] || 0;
}

function detectChanges(beforeTree = {}, afterTree = {}) {
  const generated = [];
  const completedCategories = new Set();
  const completedProjects = new Set();

  Object.entries(afterTree || {}).forEach(([projectId, projectMaterials]) => {
    const beforeProjectMaterials = beforeTree?.[projectId] || {};
    Object.entries(projectMaterials || {}).forEach(([materialId, material]) => {
      const before = beforeProjectMaterials?.[materialId];
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
        id: safeId(`local-receipt-${projectId}-${materialId}-${changedAt}-${newReceived}`),
        type: completed ? 'receipt_complete' : 'receipt_partial',
        title: completed ? 'Item completamente recebido' : 'Recebimento parcial',
        body: completed
          ? `${description}: ${formatQuantity(newReceived)} de ${formatQuantity(purchaseQty)} ${unit} recebidos.`
          : `${description}: ${formatQuantity(newReceived)} de ${formatQuantity(purchaseQty)} ${unit} recebidos. Faltam ${formatQuantity(remaining)} ${unit}.`,
        projectId,
        projectName,
        materialId,
        materialDescription: description,
        category,
        actorName,
        receivedQty: newReceived,
        purchaseQty,
        remainingQty: remaining,
        unit,
        createdAt: changedAt,
        url: './#estoque'
      });

      const categoryKey = `${projectId}\u0000${category}`;
      if (!completedCategories.has(categoryKey)) {
        const beforeCategory = categoryState(beforeProjectMaterials, category);
        const afterCategory = categoryState(projectMaterials, category);
        if (!beforeCategory.complete && afterCategory.complete) {
          completedCategories.add(categoryKey);
          generated.push({
            id: safeId(`local-category-${projectId}-${category}-${changedAt}`),
            type: 'category_complete',
            title: 'Categoria completamente recebida',
            body: `Todos os ${afterCategory.items.length} itens de ${category} foram recebidos.`,
            projectId,
            projectName,
            materialId,
            category,
            actorName,
            itemCount: afterCategory.items.length,
            createdAt: changedAt + 1,
            url: './#estoque'
          });
        }
      }

      if (!completedProjects.has(projectId)) {
        const beforeState = projectState(beforeProjectMaterials);
        const afterState = projectState(projectMaterials);
        if (!beforeState.complete && afterState.complete) {
          completedProjects.add(projectId);
          generated.push({
            id: safeId(`local-project-${projectId}-${changedAt}`),
            type: 'project_receipts_complete',
            title: 'Todos os materiais comprados foram recebidos',
            body: `${projectName}: os ${afterState.items.length} itens de compra estão completamente recebidos.`,
            projectId,
            projectName,
            materialId,
            category,
            actorName,
            itemCount: afterState.items.length,
            createdAt: changedAt + 2,
            url: './#estoque'
          });
        }
      }
    });
  });

  const added = generated.filter(addLocalNotice);
  if (added.length) {
    const important = [...added].sort((a, b) => noticePriority(b.type) - noticePriority(a.type))[0];
    showToast(important);
  }
}

function markLocalRead(id) {
  const notice = localNotices[id];
  if (!notice || notice.readAt) return;
  notice.readAt = Date.now();
  saveLocalNotices();
  scheduleRender();
}

function markAllLocalRead() {
  let changed = false;
  Object.values(localNotices).forEach(notice => {
    if (!notice.readAt) {
      notice.readAt = Date.now();
      changed = true;
    }
  });
  if (changed) {
    saveLocalNotices();
    scheduleRender();
  }
}

function openLocalNotice(id) {
  const notice = localNotices[id];
  if (!notice) return;
  markLocalRead(id);
  document.body.classList.remove('of-open');
  const select = $('#globalProjectSelect');
  if (notice.projectId && select && [...select.options].some(option => option.value === notice.projectId)) {
    select.value = notice.projectId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  $('[data-route="estoque"]')?.click();
}

function bindUiHooks() {
  document.addEventListener('click', event => {
    const localNotice = event.target.closest('[data-local-notice-id]');
    if (localNotice) {
      event.preventDefault();
      event.stopPropagation();
      openLocalNotice(localNotice.dataset.localNoticeId);
      return;
    }
    if (event.target.closest('[data-read-all]')) markAllLocalRead();
    if (event.target.closest('[data-filter], #obraflowNotificationBell')) setTimeout(scheduleRender, 0);
  }, true);

  const waitForPanel = new MutationObserver(() => {
    ensurePanelObserver();
    scheduleRender();
  });
  waitForPanel.observe(document.documentElement, { childList: true, subtree: true });
  ensurePanelObserver();
}

function stop() {
  stopProjects?.();
  stopMaterials?.();
  stopProjects = stopMaterials = null;
  currentUser = null;
  projects = {};
  previousMaterials = null;
  localNotices = {};
  scheduleRender();
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
  scheduleRender();
}

ensureStyle();
bindUiHooks();
onAuthStateChanged(auth, user => user ? start(user) : stop());
