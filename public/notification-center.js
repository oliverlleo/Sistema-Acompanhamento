import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue, set, update } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { getMessaging, getToken, onMessage, isSupported } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging.js';

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
const VAPID_KEY = document.querySelector('meta[name="obraflow-vapid-key"]')?.content?.trim() || '';
const DEVICE_KEY = 'obraflow.notificationDeviceId';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let user = null;
let notices = {};
let reads = {};
let filter = 'unread';
let stopNotices = null;
let stopReads = null;
let stopForeground = null;
let messagingReady = false;
let observer = null;

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function allNotices() {
  return Object.entries(notices)
    .map(([id, item]) => ({ id, ...item, readAt: num(reads[id]) }))
    .sort((a, b) => num(b.createdAt) - num(a.createdAt))
    .slice(0, 100);
}

function unreadNotices() {
  return allNotices().filter(item => !item.readAt);
}

function relativeTime(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - num(timestamp)) / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} dia${days === 1 ? '' : 's'}`;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(num(timestamp)));
}

function dayLabel(timestamp) {
  const date = new Date(num(timestamp));
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(date, today)) return 'Hoje';
  if (same(date, yesterday)) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' }).format(date);
}

function tone(type = '') {
  return ({
    receipt_partial: 'warning',
    receipt_complete: 'success',
    category_complete: 'category',
    project_receipts_complete: 'project'
  })[type] || 'info';
}

function icon(type = '') {
  return ({
    receipt_partial: '½',
    receipt_complete: '✓',
    category_complete: '▦',
    project_receipts_complete: '★'
  })[type] || '↓';
}

function ensureStyle() {
  if ($('#obraflowNotificationStyle')) return;
  const style = document.createElement('style');
  style.id = 'obraflowNotificationStyle';
  style.textContent = `
    .of-bell{position:relative;display:grid;place-items:center;width:42px;height:42px;flex:0 0 42px;padding:0;border:1px solid #d8e0e8;border-radius:12px;background:#fff;color:#334155;cursor:pointer}.of-bell:hover{border-color:#5fb3ab;box-shadow:0 6px 18px rgba(15,23,42,.09)}.of-bell svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.of-count{position:absolute;top:-6px;right:-6px;display:grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border:2px solid #fff;border-radius:999px;background:#dc2626;color:#fff;font-size:10px;font-weight:900}.of-count[hidden]{display:none}
    .of-backdrop{position:fixed;z-index:12000;inset:0;background:rgba(15,23,42,.34);opacity:0;pointer-events:none;transition:.2s}.of-panel{position:fixed;z-index:12001;inset:0 0 0 auto;display:flex;flex-direction:column;width:min(430px,100%);background:#f8fafc;border-left:1px solid #dfe6ed;box-shadow:-24px 0 60px rgba(15,23,42,.18);transform:translateX(105%);transition:.24s}.of-open{overflow:hidden}.of-open .of-backdrop{opacity:1;pointer-events:auto}.of-open .of-panel{transform:none}
    .of-head{display:flex;justify-content:space-between;gap:12px;padding:20px;background:#fff;border-bottom:1px solid #e5eaf0}.of-head h2{margin:0;font-size:20px}.of-head p{margin:4px 0 0;color:#64748b;font-size:12px}.of-close{width:38px;height:38px;border:1px solid #d8e0e8;border-radius:11px;background:#fff;color:#475569;font-size:22px;cursor:pointer}.of-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 16px;background:#fff;border-bottom:1px solid #e5eaf0}.of-tabs{display:flex;gap:6px}.of-tab{height:34px;padding:0 11px;border:1px solid #d8e0e8;border-radius:10px;background:#fff;color:#64748b;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.of-tab.active{border-color:#0f766e;background:#ecfdf5;color:#047857}.of-read-all{border:0;background:none;color:#0f766e;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.of-read-all:disabled{color:#94a3b8}
    .of-push{margin:14px 14px 0;padding:14px;border:1px solid #b9ddd9;border-radius:15px;background:linear-gradient(135deg,#ecfdf5,#f0fdfa)}.of-push strong{display:block;color:#065f46;font-size:12px}.of-push p{margin:5px 0 11px;color:#475569;font-size:11px;line-height:1.45}.of-push button{height:36px;padding:0 12px;border:0;border-radius:10px;background:#0f766e;color:#fff;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.of-push.denied{border-color:#fed7aa;background:#fff7ed}.of-push.denied strong{color:#9a3412}.of-push.enabled{border-color:#bbf7d0;background:#f0fdf4}.of-push.enabled strong{color:#166534}
    .of-list{flex:1;overflow:auto;padding:12px 14px 24px}.of-day{margin:10px 4px 7px;color:#64748b;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.of-item{position:relative;display:grid;grid-template-columns:42px minmax(0,1fr);gap:11px;width:100%;margin-bottom:9px;padding:13px;border:1px solid #e1e7ed;border-radius:15px;background:#fff;text-align:left;cursor:pointer;box-shadow:0 4px 13px rgba(15,23,42,.035)}.of-item:hover{border-color:#8bc9c3;box-shadow:0 9px 20px rgba(15,23,42,.08)}.of-item.unread::after{content:'';position:absolute;top:14px;right:13px;width:8px;height:8px;border-radius:50%;background:#0f766e;box-shadow:0 0 0 4px rgba(15,118,110,.1)}.of-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:#eff6ff;color:#2563eb;font-size:17px;font-weight:900}.of-item.warning .of-icon{background:#fff7ed;color:#ea580c}.of-item.success .of-icon{background:#ecfdf5;color:#059669}.of-item.category .of-icon{background:#f0fdfa;color:#0f766e}.of-item.project .of-icon{background:#eef2ff;color:#4f46e5}.of-copy{min-width:0;padding-right:10px}.of-project{display:block;margin-bottom:4px;color:#0f766e;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.of-copy strong{display:block;color:#0f172a;font-size:12px;line-height:1.35}.of-copy p{margin:4px 0 0;color:#64748b;font-size:11px;line-height:1.45}.of-meta{display:block;margin-top:7px;color:#94a3b8;font-size:9px}.of-empty{display:grid;place-items:center;min-height:330px;padding:30px;text-align:center}.of-empty span{display:grid;place-items:center;width:58px;height:58px;margin:0 auto 13px;border-radius:18px;background:#ecfdf5;color:#0f766e;font-size:25px}.of-empty strong{display:block;font-size:14px}.of-empty p{max-width:260px;margin:6px auto 0;color:#64748b;font-size:11px;line-height:1.5}
    .of-route-news{display:flex;align-items:center;gap:14px;padding:13px 15px;border:1px solid #b9ddd9;border-radius:16px;background:linear-gradient(135deg,#fff,#f0fdfa);box-shadow:0 5px 18px rgba(15,23,42,.035);cursor:pointer}.of-route-icon{position:relative;display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;border-radius:13px;background:#0f766e;color:#fff;font-size:18px}.of-route-icon b{position:absolute;top:-5px;right:-5px;display:grid;place-items:center;min-width:19px;height:19px;padding:0 4px;border:2px solid #fff;border-radius:999px;background:#dc2626;color:#fff;font-size:9px}.of-route-copy{min-width:0;flex:1}.of-route-copy strong{display:block;font-size:12px}.of-route-copy p{margin:3px 0 0;color:#64748b;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.of-route-open{color:#0f766e;font-size:11px;font-weight:900}.of-project-badge{position:absolute;z-index:2;top:12px;right:12px;display:inline-flex;align-items:center;min-height:25px;padding:0 8px;border:2px solid #fff;border-radius:999px;background:#dc2626;color:#fff;font-size:9px;font-weight:900;box-shadow:0 4px 12px rgba(220,38,38,.25)}
    .of-toast{position:fixed;z-index:13000;right:18px;bottom:18px;width:min(380px,calc(100% - 36px));padding:14px 15px;border:1px solid #b9ddd9;border-radius:15px;background:#fff;box-shadow:0 18px 46px rgba(15,23,42,.22);cursor:pointer}.of-toast strong{display:block;font-size:12px}.of-toast p{margin:5px 0 0;color:#64748b;font-size:11px;line-height:1.45}.of-flash{animation:ofFlash 1.5s ease}@keyframes ofFlash{35%{box-shadow:0 0 0 5px rgba(15,118,110,.2),0 12px 30px rgba(15,23,42,.14)}}
    @media(max-width:760px){.topbar-actions .of-bell{order:-1}.of-panel{inset:auto 0 0;width:100%;height:min(84vh,760px);border:0;border-top:1px solid #dfe6ed;border-radius:22px 22px 0 0;transform:translateY(105%)}.of-open .of-panel{transform:none}.of-route-open{display:none}}
  `;
  document.head.appendChild(style);
}

function ensureUi() {
  ensureStyle();
  const actions = $('.topbar-actions');
  if (actions && !$('#obraflowNotificationBell')) {
    const button = document.createElement('button');
    button.id = 'obraflowNotificationBell';
    button.className = 'of-bell';
    button.type = 'button';
    button.setAttribute('aria-label', 'Abrir notificações');
    button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg><span id="obraflowNotificationCount" class="of-count" hidden>0</span>';
    button.addEventListener('click', openPanel);
    actions.prepend(button);
  }

  if (!$('#obraflowNotificationPanel')) {
    const backdrop = document.createElement('div');
    backdrop.className = 'of-backdrop';
    backdrop.addEventListener('click', closePanel);
    const panel = document.createElement('aside');
    panel.id = 'obraflowNotificationPanel';
    panel.className = 'of-panel';
    panel.innerHTML = `
      <header class="of-head"><div><h2>Notificações</h2><p id="obraflowNotificationSubtitle">Acompanhe recebimentos importantes</p></div><button class="of-close" type="button" data-close>×</button></header>
      <div class="of-tools"><div class="of-tabs"><button class="of-tab active" type="button" data-filter="unread">Não lidas</button><button class="of-tab" type="button" data-filter="all">Todas</button></div><button class="of-read-all" type="button" data-read-all>Marcar todas como lidas</button></div>
      <div id="obraflowPushCard"></div><div id="obraflowNotificationList" class="of-list"></div>`;
    panel.addEventListener('click', event => {
      if (event.target.closest('[data-close]')) closePanel();
      const filterButton = event.target.closest('[data-filter]');
      if (filterButton) {
        filter = filterButton.dataset.filter;
        renderPanel();
      }
      if (event.target.closest('[data-read-all]')) markAllRead();
      if (event.target.closest('[data-enable-push]')) enablePush();
      const notice = event.target.closest('[data-notice-id]');
      if (notice) openNotice(notice.dataset.noticeId);
    });
    document.body.append(backdrop, panel);
  }

  if (!observer && $('#view')) {
    observer = new MutationObserver(renderRouteNews);
    observer.observe($('#view'), { childList: true, subtree: true });
    window.addEventListener('hashchange', () => setTimeout(renderRouteNews, 80));
  }
}

function openPanel() {
  document.body.classList.add('of-open');
  renderPanel();
}

function closePanel() {
  document.body.classList.remove('of-open');
}

function pushCard() {
  const host = $('#obraflowPushCard');
  if (!host) return;
  if (!('Notification' in window)) {
    host.innerHTML = '<div class="of-push denied"><strong>Notificações indisponíveis</strong><p>Este navegador não oferece notificações do sistema.</p></div>';
  } else if (Notification.permission === 'granted' && messagingReady) {
    host.innerHTML = '<div class="of-push enabled"><strong>Notificações do aparelho ativadas</strong><p>Os avisos podem aparecer no Windows e na barra do celular.</p></div>';
  } else if (Notification.permission === 'denied') {
    host.innerHTML = '<div class="of-push denied"><strong>Permissão bloqueada</strong><p>Abra as permissões deste site e altere Notificações para Permitir.</p></div>';
  } else {
    host.innerHTML = '<div class="of-push"><strong>Receba avisos com o ObraFlow fechado</strong><p>Ative chegadas parciais, itens e categorias concluídas.</p><button type="button" data-enable-push>Ativar notificações</button></div>';
  }
}

function noticeHtml(item) {
  const meta = [item.category, item.actorName ? `por ${item.actorName}` : '', relativeTime(item.createdAt)].filter(Boolean).join(' · ');
  return `<button type="button" class="of-item ${tone(item.type)} ${item.readAt ? '' : 'unread'}" data-notice-id="${esc(item.id)}"><span class="of-icon">${esc(icon(item.type))}</span><span class="of-copy"><span class="of-project">${esc(item.projectName || 'ObraFlow')}</span><strong>${esc(item.title || 'Atualização de recebimento')}</strong><p>${esc(item.body || '')}</p><span class="of-meta">${esc(meta)}</span></span></button>`;
}

function renderPanel() {
  ensureUi();
  const all = allNotices();
  const unread = all.filter(item => !item.readAt);
  const visible = filter === 'unread' ? unread : all;
  const count = $('#obraflowNotificationCount');
  if (count) {
    count.textContent = unread.length > 99 ? '99+' : String(unread.length);
    count.hidden = !unread.length;
  }
  const subtitle = $('#obraflowNotificationSubtitle');
  if (subtitle) subtitle.textContent = unread.length ? `${unread.length} aviso${unread.length === 1 ? '' : 's'} não lido${unread.length === 1 ? '' : 's'}` : 'Tudo conferido por enquanto';
  $$('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
  const readAll = $('[data-read-all]');
  if (readAll) readAll.disabled = !unread.length;
  pushCard();
  const list = $('#obraflowNotificationList');
  if (!list) return;
  if (!visible.length) {
    list.innerHTML = `<div class="of-empty"><div><span>✓</span><strong>${filter === 'unread' ? 'Nenhuma notificação pendente' : 'Nenhuma notificação ainda'}</strong><p>Os novos recebimentos aparecerão aqui.</p></div></div>`;
    return;
  }
  let lastDay = '';
  list.innerHTML = visible.map(item => {
    const day = dayLabel(item.createdAt);
    const heading = day === lastDay ? '' : `<div class="of-day">${esc(day)}</div>`;
    lastDay = day;
    return heading + noticeHtml(item);
  }).join('');
}

async function markRead(id) {
  if (!user || reads[id]) return;
  try {
    await set(ref(db, `notificationReads/${user.uid}/${id}`), Date.now());
  } catch (error) {
    console.warn('Falha ao marcar notificação:', error);
  }
}

async function markAllRead() {
  if (!user) return;
  const changes = {};
  const time = Date.now();
  unreadNotices().forEach(item => {
    changes[`notificationReads/${user.uid}/${item.id}`] = time;
  });
  if (!Object.keys(changes).length) return;
  try {
    await update(ref(db), changes);
  } catch (error) {
    console.warn('Falha ao marcar notificações:', error);
  }
}

function goToNotice(item) {
  if (!item) return;
  const projectId = item.projectId || '';
  const select = $('#globalProjectSelect');
  if (projectId && select && [...select.options].some(option => option.value === projectId)) {
    select.value = projectId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  $('[data-route="estoque"]')?.click();
  setTimeout(() => {
    const safeProject = window.CSS?.escape ? CSS.escape(projectId) : projectId;
    $(`[data-separated-project="${safeProject}"]`)?.click();
    setTimeout(() => {
      if (!item.materialId) return;
      const safeMaterial = window.CSS?.escape ? CSS.escape(item.materialId) : item.materialId;
      const material = $(`[data-material-id="${safeMaterial}"], [data-tracking-material="${safeMaterial}"]`);
      if (material) {
        material.scrollIntoView({ behavior: 'smooth', block: 'center' });
        material.classList.add('of-flash');
        setTimeout(() => material.classList.remove('of-flash'), 1800);
      }
    }, 420);
  }, 260);
}

async function openNotice(id) {
  const item = notices[id] ? { id, ...notices[id] } : null;
  await markRead(id);
  closePanel();
  goToNotice(item);
}

function renderRouteNews() {
  if (location.hash.replace('#', '') !== 'estoque') return;
  const view = $('#view');
  if (!view) return;
  const unread = unreadNotices();
  let summary = $('.of-route-news', view);
  if (!unread.length) {
    summary?.remove();
  } else {
    const latest = unread[0];
    const count = unread.length > 99 ? '99+' : String(unread.length);
    const text = `${latest.projectName || 'Obra'}: ${latest.title || ''} — ${latest.body || ''}`;
    if (!summary) {
      summary = document.createElement('button');
      summary.type = 'button';
      summary.className = 'of-route-news';
      summary.innerHTML = '<span class="of-route-icon">↓<b></b></span><span class="of-route-copy"><strong>Novidades de recebimento</strong><p></p></span><span class="of-route-open">Ver notificações →</span>';
      summary.addEventListener('click', openPanel);
      view.prepend(summary);
    }
    const badge = $('b', summary);
    const paragraph = $('p', summary);
    if (badge?.textContent !== count) badge.textContent = count;
    if (paragraph?.textContent !== text) paragraph.textContent = text;
  }

  const counts = unread.reduce((map, item) => {
    if (item.projectId) map[item.projectId] = (map[item.projectId] || 0) + 1;
    return map;
  }, {});
  $$('[data-separated-project]', view).forEach(card => {
    const count = counts[card.dataset.separatedProject] || 0;
    let badge = $('.of-project-badge', card);
    if (!count) {
      badge?.remove();
      return;
    }
    const text = `🔔 ${count}`;
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'of-project-badge';
      card.appendChild(badge);
    }
    if (badge.textContent !== text) badge.textContent = text;
  });
}

function foregroundToast(payload = {}) {
  const data = payload.data || payload.notification || payload;
  if (!data.title && !data.body) return;
  $('.of-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'of-toast';
  toast.innerHTML = `<strong>${esc(data.title || 'Nova notificação')}</strong><p>${esc(data.body || '')}</p>`;
  toast.addEventListener('click', () => {
    toast.remove();
    openPanel();
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6500);
}

async function registerMessaging() {
  if (messagingReady || !user || !('serviceWorker' in navigator)) return messagingReady;
  if (!(await isSupported().catch(() => false))) throw new Error('Este navegador não suporta notificações push.');
  const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
  await navigator.serviceWorker.ready;
  const messaging = getMessaging(app);
  const options = { serviceWorkerRegistration: registration };
  if (VAPID_KEY) options.vapidKey = VAPID_KEY;
  const token = await getToken(messaging, options);
  if (!token) throw new Error('O navegador não devolveu um token de notificação.');
  await set(ref(db, `pushTokens/${user.uid}/${deviceId()}`), {
    token,
    enabled: true,
    platform: navigator.userAgentData?.platform || navigator.platform || '',
    mobile: navigator.userAgentData?.mobile === true || /android|iphone|ipad|ipod/i.test(navigator.userAgent || ''),
    userAgent: String(navigator.userAgent || '').slice(0, 350),
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  stopForeground?.();
  stopForeground = onMessage(messaging, foregroundToast);
  messagingReady = true;
  return true;
}

async function enablePush() {
  const button = $('[data-enable-push]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Ativando...';
  }
  try {
    if (await Notification.requestPermission() !== 'granted') {
      pushCard();
      return;
    }
    await registerMessaging();
    pushCard();
    foregroundToast({ title: 'Notificações ativadas', body: 'O ObraFlow poderá avisar mesmo em segundo plano.' });
  } catch (error) {
    console.error('Falha ao ativar notificações:', error);
    const host = $('#obraflowPushCard');
    if (host) host.innerHTML = `<div class="of-push denied"><strong>Não foi possível ativar</strong><p>${esc(error?.message || 'Verifique as permissões e tente novamente.')}</p><button type="button" data-enable-push>Tentar novamente</button></div>`;
  } finally {
    if (button) button.disabled = false;
  }
}

function stop() {
  stopNotices?.();
  stopReads?.();
  stopForeground?.();
  stopNotices = stopReads = stopForeground = null;
  user = null;
  notices = {};
  reads = {};
  messagingReady = false;
  closePanel();
  renderPanel();
}

function start(currentUser) {
  user = currentUser;
  stopNotices?.();
  stopReads?.();
  stopNotices = onValue(ref(db, `notifications/${user.uid}`), snapshot => {
    notices = snapshot.val() || {};
    renderPanel();
    renderRouteNews();
  });
  stopReads = onValue(ref(db, `notificationReads/${user.uid}`), snapshot => {
    reads = snapshot.val() || {};
    renderPanel();
    renderRouteNews();
  });
  if ('Notification' in window && Notification.permission === 'granted') {
    registerMessaging().then(pushCard).catch(error => {
      console.warn('Falha ao restaurar notificações:', error);
      pushCard();
    });
  }
}

ensureUi();
onAuthStateChanged(auth, currentUser => currentUser ? start(currentUser) : stop());
window.ObraFlowNotifications = { open: openPanel, close: closePanel, enablePush };
