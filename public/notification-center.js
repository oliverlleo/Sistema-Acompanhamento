import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase, ref, onValue, set, update
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  getMessaging, getToken, onMessage, isSupported
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging.js';

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
const VAPID_KEY = document.querySelector('meta[name="obraflow-vapid-key"]')?.content?.trim() || '';
const DEVICE_ID_KEY = 'obraflow.notificationDeviceId';
const MAX_VISIBLE = 100;

let currentUser = null;
let notifications = {};
let reads = {};
let notificationStop = null;
let readsStop = null;
let foregroundStop = null;
let activeFilter = 'unread';
let messagingReady = false;
let messaging = null;
let serviceWorkerRegistration = null;
let routeObserver = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deviceId() {
  try {
    const saved = localStorage.getItem(DEVICE_ID_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function sortedNotifications() {
  return Object.entries(notifications)
    .map(([id, item]) => ({ id, ...item, readAt: number(reads[id]) }))
    .sort((a, b) => number(b.createdAt) - number(a.createdAt))
    .slice(0, MAX_VISIBLE);
}

function unreadNotifications() {
  return sortedNotifications().filter(item => !item.readAt);
}

function iconFor(type = '') {
  if (type === 'receipt_partial') return '½';
  if (type === 'receipt_complete') return '✓';
  if (type === 'category_complete') return '▦';
  if (type === 'project_receipts_complete') return '★';
  return '↓';
}

function toneFor(type = '') {
  if (type === 'receipt_partial') return 'warning';
  if (type === 'receipt_complete') return 'success';
  if (type === 'category_complete') return 'category';
  if (type === 'project_receipts_complete') return 'project';
  return 'info';
}

function relativeTime(timestamp) {
  const value = number(timestamp);
  if (!value) return '';
  const difference = Date.now() - value;
  const minutes = Math.max(0, Math.floor(difference / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} dia${days === 1 ? '' : 's'}`;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(value));
}

function dayLabel(timestamp) {
  const date = new Date(number(timestamp));
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
  if (sameDay(date, today)) return 'Hoje';
  if (sameDay(date, yesterday)) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' }).format(date);
}

function ensureStyle() {
  if ($('#obraflowNotificationStyle')) return;
  const style = document.createElement('style');
  style.id = 'obraflowNotificationStyle';
  style.textContent = `
    .of-notification-bell{position:relative;display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;padding:0;border:1px solid #d8e0e8;border-radius:12px;background:#fff;color:#334155;cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .15s}
    .of-notification-bell:hover{border-color:rgba(15,118,110,.5);box-shadow:0 5px 16px rgba(15,23,42,.08);transform:translateY(-1px)}
    .of-notification-bell svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .of-notification-count{position:absolute;top:-6px;right:-6px;display:grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border:2px solid #fff;border-radius:999px;background:#dc2626;color:#fff;font-size:10px;font-weight:800;box-shadow:0 3px 9px rgba(220,38,38,.3)}
    .of-notification-count[hidden]{display:none}
    .of-notification-backdrop{position:fixed;z-index:12000;inset:0;background:rgba(15,23,42,.34);backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:opacity .2s}
    .of-notification-panel{position:fixed;z-index:12001;inset:0 0 0 auto;display:flex;flex-direction:column;width:min(430px,100%);background:#f8fafc;border-left:1px solid #dfe6ed;box-shadow:-24px 0 60px rgba(15,23,42,.18);transform:translateX(105%);transition:transform .24s ease}
    body.of-notifications-open{overflow:hidden}.of-notifications-open .of-notification-backdrop{opacity:1;pointer-events:auto}.of-notifications-open .of-notification-panel{transform:translateX(0)}
    .of-notification-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:20px 20px 16px;background:#fff;border-bottom:1px solid #e5eaf0}
    .of-notification-head h2{margin:0;color:#0f172a;font-size:20px}.of-notification-head p{margin:4px 0 0;color:#64748b;font-size:12px}
    .of-notification-close{display:grid;place-items:center;width:38px;height:38px;border:1px solid #d8e0e8;border-radius:11px;background:#fff;color:#475569;font-size:22px;cursor:pointer}
    .of-notification-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 16px;background:#fff;border-bottom:1px solid #e5eaf0}
    .of-notification-tabs{display:flex;gap:6px}.of-notification-tab{min-height:34px;padding:0 11px;border:1px solid #d8e0e8;border-radius:10px;background:#fff;color:#64748b;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.of-notification-tab.active{border-color:#0f766e;background:#ecfdf5;color:#047857}
    .of-notification-read-all{border:0;background:transparent;color:#0f766e;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.of-notification-read-all:disabled{color:#94a3b8;cursor:default}
    .of-push-card{margin:14px 14px 0;padding:14px;border:1px solid rgba(15,118,110,.2);border-radius:15px;background:linear-gradient(135deg,#ecfdf5,#f0fdfa)}
    .of-push-card strong{display:block;color:#065f46;font-size:12px}.of-push-card p{margin:5px 0 11px;color:#475569;font-size:11px;line-height:1.45}.of-push-card button{min-height:36px;padding:0 12px;border:0;border-radius:10px;background:#0f766e;color:#fff;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.of-push-card button:disabled{opacity:.6;cursor:wait}
    .of-push-card.denied{border-color:#fed7aa;background:#fff7ed}.of-push-card.denied strong{color:#9a3412}.of-push-card.enabled{border-color:#bbf7d0;background:#f0fdf4}.of-push-card.enabled strong{color:#166534}
    .of-notification-list{flex:1;overflow:auto;padding:12px 14px 24px}
    .of-notification-day{margin:10px 4px 7px;color:#64748b;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
    .of-notification-item{position:relative;display:grid;grid-template-columns:42px minmax(0,1fr);gap:11px;width:100%;margin-bottom:9px;padding:13px;border:1px solid #e1e7ed;border-radius:15px;background:#fff;text-align:left;cursor:pointer;box-shadow:0 4px 13px rgba(15,23,42,.035);transition:transform .15s,border-color .15s,box-shadow .15s}
    .of-notification-item:hover{transform:translateY(-1px);border-color:rgba(15,118,110,.35);box-shadow:0 9px 20px rgba(15,23,42,.08)}
    .of-notification-item.unread::after{content:'';position:absolute;top:14px;right:13px;width:8px;height:8px;border-radius:50%;background:#0f766e;box-shadow:0 0 0 4px rgba(15,118,110,.1)}
    .of-notification-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:#eff6ff;color:#2563eb;font-size:17px;font-weight:900}
    .of-notification-item.warning .of-notification-icon{background:#fff7ed;color:#ea580c}.of-notification-item.success .of-notification-icon{background:#ecfdf5;color:#059669}.of-notification-item.category .of-notification-icon{background:#f0fdfa;color:#0f766e}.of-notification-item.project .of-notification-icon{background:#eef2ff;color:#4f46e5}
    .of-notification-copy{min-width:0;padding-right:10px}.of-notification-project{display:block;margin-bottom:4px;color:#0f766e;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.of-notification-copy strong{display:block;color:#0f172a;font-size:12px;line-height:1.35}.of-notification-copy p{margin:4px 0 0;color:#64748b;font-size:11px;line-height:1.45}.of-notification-meta{display:flex;flex-wrap:wrap;gap:5px 9px;margin-top:7px;color:#94a3b8;font-size:9px}.of-notification-meta span:not(:last-child)::after{content:'·';margin-left:9px}
    .of-notification-empty{display:grid;place-items:center;min-height:330px;padding:30px;text-align:center}.of-notification-empty span{display:grid;place-items:center;width:58px;height:58px;margin:0 auto 13px;border-radius:18px;background:#ecfdf5;color:#0f766e;font-size:25px}.of-notification-empty strong{display:block;color:#0f172a;font-size:14px}.of-notification-empty p{max-width:260px;margin:6px auto 0;color:#64748b;font-size:11px;line-height:1.5}
    .of-route-news{display:flex;align-items:center;gap:14px;padding:13px 15px;border:1px solid rgba(15,118,110,.22);border-radius:16px;background:linear-gradient(135deg,#fff,#f0fdfa);box-shadow:0 5px 18px rgba(15,23,42,.035);cursor:pointer}
    .of-route-news-icon{position:relative;display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;border-radius:13px;background:#0f766e;color:#fff;font-size:18px}.of-route-news-icon b{position:absolute;top:-5px;right:-5px;display:grid;place-items:center;min-width:19px;height:19px;padding:0 4px;border:2px solid #fff;border-radius:999px;background:#dc2626;color:#fff;font-size:9px}
    .of-route-news-copy{min-width:0;flex:1}.of-route-news-copy strong{display:block;color:#0f172a;font-size:12px}.of-route-news-copy p{margin:3px 0 0;color:#64748b;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.of-route-news-open{color:#0f766e;font-size:11px;font-weight:900;white-space:nowrap}
    .of-project-notification-badge{position:absolute;z-index:2;top:12px;right:12px;display:inline-flex;align-items:center;gap:5px;min-height:25px;padding:0 8px;border:2px solid #fff;border-radius:999px;background:#dc2626;color:#fff;font-size:9px;font-weight:900;box-shadow:0 4px 12px rgba(220,38,38,.25)}
    .of-notification-flash{animation:ofNotificationFlash 1.5s ease}@keyframes ofNotificationFlash{0%,100%{box-shadow:initial}35%{box-shadow:0 0 0 5px rgba(15,118,110,.2),0 12px 30px rgba(15,23,42,.14)}}
    .of-foreground-toast{position:fixed;z-index:13000;right:18px;bottom:18px;width:min(380px,calc(100% - 36px));padding:14px 15px;border:1px solid rgba(15,118,110,.25);border-radius:15px;background:#fff;box-shadow:0 18px 46px rgba(15,23,42,.22);cursor:pointer;animation:ofToastIn .22s ease}.of-foreground-toast strong{display:block;color:#0f172a;font-size:12px}.of-foreground-toast p{margin:5px 0 0;color:#64748b;font-size:11px;line-height:1.45}@keyframes ofToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
    @media(max-width:760px){.topbar-actions .of-notification-bell{order:-1}.of-notification-panel{inset:auto 0 0;width:100%;height:min(84vh,760px);border-left:0;border-top:1px solid #dfe6ed;border-radius:22px 22px 0 0;transform:translateY(105%)}.of-notifications-open .of-notification-panel{transform:translateY(0)}.of-route-news{align-items:flex-start}.of-route-news-open{display:none}}
  `;
  document.head.appendChild(style);
}

function ensureUi() {
  ensureStyle();
  const actions = $('.topbar-actions');
  if (actions && !$('#obraflowNotificationBell')) {
    const button = document.createElement('button');
    button.id = 'obraflowNotificationBell';
    button.className = 'of-notification-bell';
    button.type = 'button';
    button.setAttribute('aria-label', 'Abrir notificações');
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>
      <span id="obraflowNotificationCount" class="of-notification-count" hidden>0</span>`;
    button.addEventListener('click', openPanel);
    actions.insertBefore(button, actions.firstChild);
  }

  if (!$('#obraflowNotificationPanel')) {
    const backdrop = document.createElement('div');
    backdrop.id = 'obraflowNotificationBackdrop';
    backdrop.className = 'of-notification-backdrop';
    backdrop.addEventListener('click', closePanel);

    const panel = document.createElement('aside');
    panel.id = 'obraflowNotificationPanel';
    panel.className = 'of-notification-panel';
    panel.setAttribute('aria-label', 'Notificações do ObraFlow');
    panel.innerHTML = `
      <header class="of-notification-head">
        <div><h2>Notificações</h2><p id="obraflowNotificationSubtitle">Acompanhe recebimentos importantes</p></div>
        <button class="of-notification-close" type="button" data-notification-close aria-label="Fechar">×</button>
      </header>
      <div class="of-notification-toolbar">
        <div class="of-notification-tabs">
          <button class="of-notification-tab active" type="button" data-notification-filter="unread">Não lidas</button>
          <button class="of-notification-tab" type="button" data-notification-filter="all">Todas</button>
        </div>
        <button class="of-notification-read-all" type="button" data-notification-read-all>Marcar todas como lidas</button>
      </div>
      <div id="obraflowPushCard"></div>
      <div id="obraflowNotificationList" class="of-notification-list"></div>`;

    panel.addEventListener('click', event => {
      if (event.target.closest('[data-notification-close]')) closePanel();
      const filter = event.target.closest('[data-notification-filter]');
      if (filter) {
        activeFilter = filter.dataset.notificationFilter;
        renderPanel();
      }
      if (event.target.closest('[data-notification-read-all]')) markAllRead();
      if (event.target.closest('[data-enable-push]')) enablePushNotifications();
      const item = event.target.closest('[data-notification-id]');
      if (item) openNotification(item.dataset.notificationId);
    });

    document.body.append(backdrop, panel);
  }

  if (!routeObserver) {
    routeObserver = new MutationObserver(() => renderRouteEnhancements());
    const view = $('#view');
    if (view) routeObserver.observe(view, { childList: true, subtree: true });
    window.addEventListener('hashchange', () => setTimeout(renderRouteEnhancements, 80));
  }
}

function openPanel() {
  document.body.classList.add('of-notifications-open');
  renderPanel();
}

function closePanel() {
  document.body.classList.remove('of-notifications-open');
}

function renderPushCard() {
  const host = $('#obraflowPushCard');
  if (!host) return;
  if (!('Notification' in window)) {
    host.innerHTML = '<div class="of-push-card denied"><strong>Notificações não disponíveis</strong><p>Este navegador não oferece notificações do sistema.</p></div>';
    return;
  }
  if (Notification.permission === 'granted' && messagingReady) {
    host.innerHTML = '<div class="of-push-card enabled"><strong>Notificações do aparelho ativadas</strong><p>Os avisos podem aparecer no Windows e na barra de notificações do celular.</p></div>';
    return;
  }
  if (Notification.permission === 'denied') {
    host.innerHTML = '<div class="of-push-card denied"><strong>Permissão bloqueada pelo navegador</strong><p>Abra as permissões deste site e altere Notificações para Permitir.</p></div>';
    return;
  }
  host.innerHTML = `<div class="of-push-card"><strong>Receba avisos mesmo com o ObraFlow fechado</strong><p>Ative para receber chegadas parciais, itens concluídos e categorias completas.</p><button type="button" data-enable-push>Ativar notificações</button></div>`;
}

function notificationItem(item) {
  const metadata = [
    item.category ? item.category : '',
    item.actorName ? `por ${item.actorName}` : '',
    relativeTime(item.createdAt)
  ].filter(Boolean);
  return `<button type="button" class="of-notification-item ${toneFor(item.type)} ${item.readAt ? '' : 'unread'}" data-notification-id="${escapeHtml(item.id)}">
    <span class="of-notification-icon">${escapeHtml(iconFor(item.type))}</span>
    <span class="of-notification-copy">
      <span class="of-notification-project">${escapeHtml(item.projectName || 'ObraFlow')}</span>
      <strong>${escapeHtml(item.title || 'Atualização de recebimento')}</strong>
      <p>${escapeHtml(item.body || '')}</p>
      <span class="of-notification-meta">${metadata.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</span>
    </span>
  </button>`;
}

function renderPanel() {
  ensureUi();
  const all = sortedNotifications();
  const unread = all.filter(item => !item.readAt);
  const visible = activeFilter === 'unread' ? unread : all;
  const count = $('#obraflowNotificationCount');
  if (count) {
    count.textContent = unread.length > 99 ? '99+' : String(unread.length);
    count.hidden = unread.length === 0;
  }
  const subtitle = $('#obraflowNotificationSubtitle');
  if (subtitle) subtitle.textContent = unread.length
    ? `${unread.length} aviso${unread.length === 1 ? '' : 's'} não lido${unread.length === 1 ? '' : 's'}`
    : 'Tudo conferido por enquanto';
  $$('[data-notification-filter]').forEach(button => button.classList.toggle('active', button.dataset.notificationFilter === activeFilter));
  const readAll = $('[data-notification-read-all]');
  if (readAll) readAll.disabled = unread.length === 0;
  renderPushCard();

  const list = $('#obraflowNotificationList');
  if (!list) return;
  if (!visible.length) {
    list.innerHTML = `<div class="of-notification-empty"><div><span>✓</span><strong>${activeFilter === 'unread' ? 'Nenhuma notificação pendente' : 'Nenhuma notificação ainda'}</strong><p>${activeFilter === 'unread' ? 'Os novos recebimentos aparecerão aqui.' : 'Quando um material for recebido, o histórico será exibido aqui.'}</p></div></div>`;
    return;
  }

  let lastDay = '';
  list.innerHTML = visible.map(item => {
    const day = dayLabel(item.createdAt);
    const heading = day !== lastDay ? `<div class="of-notification-day">${escapeHtml(day)}</div>` : '';
    lastDay = day;
    return heading + notificationItem(item);
  }).join('');
}

async function markRead(id) {
  if (!currentUser || reads[id]) return;
  try {
    await set(ref(db, `notificationReads/${currentUser.uid}/${id}`), Date.now());
  } catch (error) {
    console.warn('Não foi possível marcar a notificação como lida:', error);
  }
}

async function markAllRead() {
  if (!currentUser) return;
  const unread = unreadNotifications();
  if (!unread.length) return;
  const changes = {};
  const timestamp = Date.now();
  unread.forEach(item => {
    changes[`notificationReads/${currentUser.uid}/${item.id}`] = timestamp;
  });
  try {
    await update(ref(db), changes);
  } catch (error) {
    console.warn('Não foi possível marcar as notificações como lidas:', error);
  }
}

function navigateToNotification(item) {
  if (!item) return;
  const projectId = item.projectId || '';
  const projectSelect = $('#globalProjectSelect');
  if (projectId && projectSelect && [...projectSelect.options].some(option => option.value === projectId)) {
    projectSelect.value = projectId;
    projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const routeButton = $('[data-route="estoque"]');
  if (routeButton) routeButton.click();
  else location.hash = '#estoque';

  setTimeout(() => {
    const card = projectId ? $(`[data-separated-project="${CSS.escape(projectId)}"]`) : null;
    if (card) card.click();
    setTimeout(() => {
      const material = item.materialId
        ? $(`[data-material-id="${CSS.escape(item.materialId)}"], [data-tracking-material="${CSS.escape(item.materialId)}"]`)
        : null;
      if (material) {
        material.scrollIntoView({ behavior: 'smooth', block: 'center' });
        material.classList.add('of-notification-flash');
        setTimeout(() => material.classList.remove('of-notification-flash'), 1800);
      }
    }, 420);
  }, 260);
}

async function openNotification(id) {
  const item = notifications[id] ? { id, ...notifications[id] } : null;
  await markRead(id);
  closePanel();
  navigateToNotification(item);
}

function renderRouteEnhancements() {
  if (location.hash.replace('#', '') !== 'estoque') return;
  const view = $('#view');
  if (!view) return;
  const unread = unreadNotifications();
  const existing = $('.of-route-news', view);
  if (!unread.length) {
    existing?.remove();
  } else if (!existing) {
    const latest = unread[0];
    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'of-route-news';
    summary.innerHTML = `
      <span class="of-route-news-icon">↓<b>${unread.length > 99 ? '99+' : unread.length}</b></span>
      <span class="of-route-news-copy"><strong>Novidades de recebimento</strong><p>${escapeHtml(latest.projectName || 'Obra')}: ${escapeHtml(latest.title || '')} — ${escapeHtml(latest.body || '')}</p></span>
      <span class="of-route-news-open">Ver notificações →</span>`;
    summary.addEventListener('click', openPanel);
    view.prepend(summary);
  } else {
    const badge = $('b', existing);
    if (badge) badge.textContent = unread.length > 99 ? '99+' : String(unread.length);
    const latest = unread[0];
    const paragraph = $('p', existing);
    if (paragraph) paragraph.textContent = `${latest.projectName || 'Obra'}: ${latest.title || ''} — ${latest.body || ''}`;
  }

  const byProject = unread.reduce((map, item) => {
    if (item.projectId) map[item.projectId] = (map[item.projectId] || 0) + 1;
    return map;
  }, {});
  $$('[data-separated-project]', view).forEach(card => {
    const projectId = card.dataset.separatedProject;
    card.querySelector('.of-project-notification-badge')?.remove();
    const count = byProject[projectId] || 0;
    if (!count) return;
    const badge = document.createElement('span');
    badge.className = 'of-project-notification-badge';
    badge.textContent = `🔔 ${count}`;
    card.appendChild(badge);
  });
}

function showForegroundToast(payload = {}) {
  const data = payload.data || payload.notification || payload;
  if (!data?.title && !data?.body) return;
  $('.of-foreground-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'of-foreground-toast';
  toast.innerHTML = `<strong>${escapeHtml(data.title || 'Nova notificação')}</strong><p>${escapeHtml(data.body || '')}</p>`;
  toast.addEventListener('click', () => {
    toast.remove();
    openPanel();
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6500);
}

async function registerMessaging() {
  if (messagingReady || !currentUser || !('serviceWorker' in navigator)) return false;
  if (!(await isSupported().catch(() => false))) return false;
  serviceWorkerRegistration = await navigator.serviceWorker.register('./sw.js', {
    scope: './',
    updateViaCache: 'none'
  });
  await navigator.serviceWorker.ready;
  messaging = getMessaging(app);
  const tokenOptions = { serviceWorkerRegistration };
  if (VAPID_KEY) tokenOptions.vapidKey = VAPID_KEY;
  const token = await getToken(messaging, tokenOptions);
  if (!token) throw new Error('O navegador não devolveu um token de notificação.');

  await set(ref(db, `pushTokens/${currentUser.uid}/${deviceId()}`), {
    token,
    enabled: true,
    platform: navigator.userAgentData?.platform || navigator.platform || '',
    mobile: navigator.userAgentData?.mobile === true || /android|iphone|ipad|ipod/i.test(navigator.userAgent || ''),
    userAgent: String(navigator.userAgent || '').slice(0, 350),
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  foregroundStop?.();
  foregroundStop = onMessage(messaging, payload => showForegroundToast(payload));
  messagingReady = true;
  return true;
}

async function enablePushNotifications() {
  const button = $('[data-enable-push]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Ativando...';
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      renderPushCard();
      return;
    }
    await registerMessaging();
    renderPushCard();
    showForegroundToast({
      title: 'Notificações ativadas',
      body: 'O ObraFlow poderá avisar sobre recebimentos mesmo em segundo plano.'
    });
  } catch (error) {
    console.error('Falha ao ativar notificações:', error);
    if ($('#obraflowPushCard')) {
      $('#obraflowPushCard').innerHTML = `<div class="of-push-card denied"><strong>Não foi possível ativar agora</strong><p>${escapeHtml(error?.message || 'Verifique as permissões e tente novamente.')}</p><button type="button" data-enable-push>Tentar novamente</button></div>`;
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function stopListeners() {
  notificationStop?.();
  readsStop?.();
  foregroundStop?.();
  notificationStop = null;
  readsStop = null;
  foregroundStop = null;
  notifications = {};
  reads = {};
  messagingReady = false;
  messaging = null;
  currentUser = null;
  closePanel();
  renderPanel();
}

function startListeners(user) {
  currentUser = user;
  notificationStop?.();
  readsStop?.();
  notificationStop = onValue(ref(db, `notifications/${user.uid}`), snapshot => {
    notifications = snapshot.val() || {};
    renderPanel();
    renderRouteEnhancements();
  });
  readsStop = onValue(ref(db, `notificationReads/${user.uid}`), snapshot => {
    reads = snapshot.val() || {};
    renderPanel();
    renderRouteEnhancements();
  });

  if ('Notification' in window && Notification.permission === 'granted') {
    registerMessaging().then(() => renderPushCard()).catch(error => {
      console.warn('Falha ao restaurar as notificações do aparelho:', error);
      renderPushCard();
    });
  }
}

ensureUi();
onAuthStateChanged(auth, user => {
  if (!user) {
    stopListeners();
    return;
  }
  startListeners(user);
});

window.ObraFlowNotifications = {
  open: openPanel,
  close: closePanel,
  enablePush: enablePushNotifications
};
