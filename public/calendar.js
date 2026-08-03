import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  allocation,
  purchaseCommitted,
  receivedPurchaseQty,
  quantityNumber
} from './material-flow.js?v=20260803-1648';

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

const initialCalendarRoute = location.hash.replace(/^#/, '') === 'calendario';
const today = () => formatISO(new Date());

let projects = {};
let materialsByProject = {};
let stopProjects = null;
let stopMaterials = null;
let calendarActive = false;
let viewMode = 'month';
let anchorDate = startOfDay(new Date());
let selectedDate = today();
let filters = { search: '', project: 'todos', supplier: 'todos', status: 'todos' };
let renderQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseISO(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatISO(value) {
  const date = startOfDay(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value, amount) {
  const date = startOfDay(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function addMonths(value, amount) {
  const date = startOfDay(value);
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  return date;
}

function startOfWeek(value) {
  const date = startOfDay(value);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
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

function formatDate(value, options = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  const date = typeof value === 'string' ? parseISO(value) : startOfDay(value);
  if (!date || Number.isNaN(date.getTime())) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', options).format(date);
}

function formatQty(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(value) || 0);
}

function deliveryStatus(date) {
  if (!date) return 'sem-data';
  const reference = today();
  if (date < reference) return 'atrasado';
  if (date === reference) return 'hoje';
  return 'proximo';
}

function statusLabel(status) {
  return ({
    atrasado: 'Atrasado',
    hoje: 'Entrega hoje',
    proximo: 'Programado',
    'sem-data': 'Sem data'
  })[status] || 'Programado';
}

function ensureStyle() {
  if ($('#calendarPageStyle')) return;
  const style = document.createElement('style');
  style.id = 'calendarPageStyle';
  style.textContent = `
    .cal-shell{display:grid;gap:16px}
    .cal-hero{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:22px 24px;border-radius:20px;background:linear-gradient(135deg,#0f172a 0%,#123b3b 62%,#0f766e 150%);color:#fff;box-shadow:0 15px 34px rgba(15,23,42,.14)}
    .cal-hero h2{margin:5px 0 5px;color:#fff;font-size:24px}.cal-hero p{margin:0;color:rgba(255,255,255,.68);font-size:12px}.cal-eyebrow{font-size:10px;font-weight:800;letter-spacing:.08em;color:#a7f3d0;text-transform:uppercase}
    .cal-view-toggle{display:flex;padding:4px;border-radius:12px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12)}
    .cal-view-toggle button{height:34px;padding:0 14px;border:0;border-radius:9px;background:transparent;color:rgba(255,255,255,.68);font:inherit;font-size:11px;font-weight:800;cursor:pointer}.cal-view-toggle button.active{background:#fff;color:#0f766e;box-shadow:0 4px 12px rgba(0,0,0,.12)}
    .cal-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .cal-kpi{position:relative;overflow:hidden;padding:16px 17px;background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 5px 16px rgba(15,23,42,.035)}
    .cal-kpi::after{content:'';position:absolute;width:52px;height:52px;right:-18px;bottom:-20px;border-radius:50%;background:rgba(15,118,110,.07)}
    .cal-kpi span{display:block;color:#64748b;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.045em}.cal-kpi strong{display:block;margin-top:7px;color:#0f172a;font-size:24px}.cal-kpi small{display:block;margin-top:4px;color:#94a3b8;font-size:10px}.cal-kpi.danger strong{color:#b91c1c}.cal-kpi.today strong{color:#0f766e}
    .cal-controls{display:grid;grid-template-columns:minmax(240px,1fr) repeat(3,minmax(150px,auto));gap:10px;padding:13px;background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 5px 16px rgba(15,23,42,.03)}
    .cal-controls input,.cal-controls select{height:42px;padding:0 12px;border:1px solid #d8e0e8;border-radius:11px;background:#f8fafc;color:#0f172a;font:inherit;font-size:12px;outline:none}.cal-controls input:focus,.cal-controls select:focus{background:#fff;border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.1)}
    .cal-board{background:#fff;border:1px solid var(--border);border-radius:18px;overflow:hidden;box-shadow:0 7px 22px rgba(15,23,42,.04)}
    .cal-board-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 17px;border-bottom:1px solid var(--border)}
    .cal-period{display:flex;align-items:center;gap:9px}.cal-period h3{margin:0;color:#0f172a;font-size:17px}.cal-period small{display:block;margin-top:3px;color:#64748b;font-size:10px}
    .cal-nav{display:flex;align-items:center;gap:7px}.cal-nav button{height:34px;min-width:34px;padding:0 10px;border:1px solid #d8e0e8;border-radius:9px;background:#fff;color:#334155;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.cal-nav button:hover{border-color:#0f766e;color:#0f766e;background:#f0fdfa}
    .cal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--border);background:#f8fafc}.cal-weekdays span{padding:9px 10px;color:#64748b;font-size:9px;font-weight:800;text-align:center;letter-spacing:.05em}
    .cal-month-grid{display:grid;grid-template-columns:repeat(7,1fr)}
    .cal-day{position:relative;min-height:128px;padding:10px;border:0;border-right:1px solid #edf1f4;border-bottom:1px solid #edf1f4;background:#fff;text-align:left;cursor:pointer;transition:background .12s,box-shadow .12s}.cal-day:nth-child(7n){border-right:0}.cal-day:hover{background:#f8fffd;box-shadow:inset 0 0 0 1px rgba(15,118,110,.18)}.cal-day.outside{background:#fafbfc;color:#94a3b8}.cal-day.today{background:#f0fdfa}.cal-day.selected{box-shadow:inset 0 0 0 2px #0f766e}.cal-day.has-overdue{background:#fffafa}
    .cal-day-top{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px}.cal-day-number{display:grid;place-items:center;width:25px;height:25px;border-radius:8px;color:#334155;font-size:11px;font-weight:800}.cal-day.today .cal-day-number{background:#0f766e;color:#fff}.cal-day-count{color:#94a3b8;font-size:9px;font-weight:800}
    .cal-events{display:grid;gap:5px}.cal-chip{display:block;min-width:0;padding:6px 7px;border-radius:8px;background:#ecfdf5;border-left:3px solid #10b981;color:#065f46;font-size:9px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cal-chip.overdue{background:#fef2f2;border-left-color:#ef4444;color:#991b1b}.cal-chip.today{background:#eff6ff;border-left-color:#3b82f6;color:#1d4ed8}.cal-more{display:block;color:#64748b;font-size:9px;font-weight:800;padding:2px 3px}
    .cal-week-grid{display:grid;grid-template-columns:repeat(7,minmax(170px,1fr));gap:10px;padding:12px;overflow:auto;background:#f8fafc}.cal-week-day{min-height:390px;padding:12px;border:1px solid #e1e7ed;border-radius:14px;background:#fff;cursor:pointer;text-align:left}.cal-week-day.today{border-color:#0f766e;box-shadow:0 0 0 2px rgba(15,118,110,.1)}.cal-week-day.selected{box-shadow:0 0 0 2px #0f766e}.cal-week-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid #edf1f4}.cal-week-head strong{color:#0f172a;font-size:13px}.cal-week-head span{color:#64748b;font-size:10px}.cal-week-list{display:grid;gap:8px}.cal-week-event{padding:10px;border-radius:11px;background:#f8fafc;border:1px solid #e9eef3}.cal-week-event.overdue{background:#fff7f7;border-color:#fecaca}.cal-week-event.today{background:#eff6ff;border-color:#bfdbfe}.cal-week-event strong{display:block;color:#0f172a;font-size:10px}.cal-week-event span{display:block;margin-top:4px;color:#64748b;font-size:9px}.cal-week-empty{padding:28px 5px;text-align:center;color:#94a3b8;font-size:10px}
    .cal-undated{padding:15px 17px;border-top:1px solid var(--border);background:#fbfcfd}.cal-undated-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.cal-undated-head strong{color:#0f172a;font-size:12px}.cal-undated-head span{color:#64748b;font-size:10px}.cal-undated-list{display:flex;gap:8px;overflow:auto;padding-bottom:3px}.cal-undated-card{flex:0 0 250px;padding:11px;border:1px dashed #cbd5e1;border-radius:12px;background:#fff}.cal-undated-card strong{display:block;color:#0f172a;font-size:10px}.cal-undated-card span{display:block;margin-top:4px;color:#64748b;font-size:9px}
    .cal-drawer-backdrop{position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.38);backdrop-filter:blur(2px)}.cal-drawer{position:fixed;z-index:81;top:0;right:0;width:min(470px,94vw);height:100vh;background:#f8fafc;box-shadow:-18px 0 50px rgba(15,23,42,.2);display:flex;flex-direction:column}.cal-drawer-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px;background:#0f172a;color:#fff}.cal-drawer-head h3{margin:5px 0 3px;color:#fff;font-size:21px}.cal-drawer-head p{margin:0;color:rgba(255,255,255,.65);font-size:11px}.cal-drawer-close{width:34px;height:34px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(255,255,255,.08);color:#fff;font-size:20px;cursor:pointer}.cal-drawer-body{flex:1;overflow:auto;padding:15px;display:grid;align-content:start;gap:11px}.cal-delivery-group{background:#fff;border:1px solid var(--border);border-radius:15px;overflow:hidden;box-shadow:0 4px 14px rgba(15,23,42,.035)}.cal-delivery-head{padding:13px 14px;border-bottom:1px solid #edf1f4}.cal-delivery-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.cal-delivery-title strong{color:#0f172a;font-size:12px}.cal-status{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:800}.cal-status.atrasado{background:#fee2e2;color:#b91c1c}.cal-status.hoje{background:#dbeafe;color:#1d4ed8}.cal-status.proximo{background:#dcfce7;color:#166534}.cal-status.sem-data{background:#e2e8f0;color:#475569}.cal-delivery-meta{margin-top:6px;color:#64748b;font-size:9px}.cal-items{display:grid}.cal-item{padding:12px 14px;border-bottom:1px solid #edf1f4}.cal-item:last-child{border-bottom:0}.cal-item-main{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.cal-item-main strong{color:#0f172a;font-size:10px}.cal-item-main span{color:#0f766e;font-size:10px;font-weight:800;white-space:nowrap}.cal-item small{display:block;margin-top:4px;color:#64748b;font-size:9px}.cal-drawer-empty{padding:40px 18px;text-align:center;color:#64748b}.cal-drawer-empty strong{display:block;color:#0f172a;font-size:15px;margin-bottom:5px}
    @media(max-width:1150px){.cal-controls{grid-template-columns:1fr 1fr}.cal-kpis{grid-template-columns:repeat(2,1fr)}.cal-day{min-height:112px}}
    @media(max-width:760px){.cal-hero{align-items:flex-start;flex-direction:column}.cal-controls{grid-template-columns:1fr}.cal-month-grid{min-width:760px}.cal-weekdays{min-width:760px}.cal-board{overflow:auto}.cal-kpis{grid-template-columns:1fr 1fr}.cal-day{min-height:105px}.cal-board-head{align-items:flex-start;flex-direction:column}.cal-nav{width:100%;justify-content:space-between}}
  `;
  document.head.appendChild(style);
}

function injectNav() {
  const nav = $('#mainNav');
  if (!nav || $('[data-route="calendario"]', nav)) return;
  const button = document.createElement('button');
  button.className = 'nav-item';
  button.dataset.route = 'calendario';
  button.innerHTML = '<span>▤</span>Calendário';
  const reference = $('[data-route="estoque"]', nav);
  if (reference) reference.insertAdjacentElement('afterend', button);
  else nav.appendChild(button);
}

function buildEvents() {
  const result = [];

  Object.entries(materialsByProject || {}).forEach(([projectId, materials]) => {
    const project = projects[projectId] || {};

    Object.entries(materials || {}).forEach(([materialId, material]) => {
      const alloc = allocation(material);
      if (!(alloc.purchaseQty > 0)) return;

      const received = receivedPurchaseQty(material);
      const pending = Math.max(0, alloc.purchaseQty - received);
      if (!(pending > 0)) return;
      if (!purchaseCommitted(material)) return;

      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(material.deliveryEta || ''))
        ? String(material.deliveryEta)
        : '';
      const supplier = String(material.supplier || '').trim() || 'Fornecedor não informado';
      const orderNumber = String(material.orderNumber || '').trim();
      const description = String(material.description || '').trim() || 'Material sem descrição';
      const projectName = project.name || project.code || 'Obra sem nome';
      const projectCode = project.code || '';

      result.push({
        id: `${projectId}:${materialId}`,
        projectId,
        materialId,
        projectName,
        projectCode,
        supplier,
        orderNumber,
        date,
        status: deliveryStatus(date),
        description,
        code: material.code || '',
        category: material.category || 'Sem categoria',
        unit: material.unit || 'un',
        purchaseQty: alloc.purchaseQty,
        receivedQty: received,
        pendingQty: pending
      });
    });
  });

  return result.sort((a, b) => {
    const dateA = a.date || '9999-99-99';
    const dateB = b.date || '9999-99-99';
    return dateA.localeCompare(dateB)
      || a.supplier.localeCompare(b.supplier, 'pt-BR')
      || a.projectName.localeCompare(b.projectName, 'pt-BR')
      || a.description.localeCompare(b.description, 'pt-BR');
  });
}

function filteredEvents() {
  const search = normalize(filters.search);

  return buildEvents().filter(event => {
    const haystack = normalize([
      event.supplier,
      event.projectName,
      event.projectCode,
      event.orderNumber,
      event.description,
      event.code,
      event.category
    ].join(' '));

    return (!search || haystack.includes(search))
      && (filters.project === 'todos' || event.projectId === filters.project)
      && (filters.supplier === 'todos' || event.supplier === filters.supplier)
      && (filters.status === 'todos' || event.status === filters.status);
  });
}

function groupEvents(events) {
  const groups = new Map();

  events.forEach(event => {
    const key = [event.date || 'sem-data', event.projectId, event.supplier, event.orderNumber || 'sem-pedido'].join('|');
    const current = groups.get(key) || {
      key,
      date: event.date,
      projectId: event.projectId,
      projectName: event.projectName,
      projectCode: event.projectCode,
      supplier: event.supplier,
      orderNumber: event.orderNumber,
      status: event.status,
      items: []
    };
    current.items.push(event);
    groups.set(key, current);
  });

  return [...groups.values()];
}

function periodTitle() {
  if (viewMode === 'week') {
    const start = startOfWeek(anchorDate);
    const end = addDays(start, 6);
    return `${formatDate(start, { day: '2-digit', month: 'short' })} — ${formatDate(end, { day: '2-digit', month: 'short', year: 'numeric' })}`;
  }
  return formatDate(anchorDate, { month: 'long', year: 'numeric' });
}

function monthDays() {
  const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function projectOptions(events) {
  const ids = [...new Set(events.map(event => event.projectId))];
  return ids
    .map(id => ({ id, label: projects[id]?.code ? `${projects[id].code} - ${projects[id].name}` : projects[id]?.name || 'Obra sem nome' }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

function supplierOptions(events) {
  return [...new Set(events.map(event => event.supplier))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function stats(events) {
  const reference = today();
  const weekEnd = formatISO(addDays(parseISO(reference), 7));
  return {
    today: events.filter(event => event.date === reference).length,
    upcoming: events.filter(event => event.date > reference && event.date <= weekEnd).length,
    overdue: events.filter(event => event.status === 'atrasado').length,
    undated: events.filter(event => event.status === 'sem-data').length
  };
}

function calendarChip(group) {
  const label = `${group.supplier} · ${group.projectCode || group.projectName}`;
  const tone = group.status === 'atrasado' ? ' overdue' : group.status === 'hoje' ? ' today' : '';
  return `<span class="cal-chip${tone}" title="${escapeHtml(label)}">${escapeHtml(label)}${group.items.length > 1 ? ` · ${group.items.length} itens` : ''}</span>`;
}

function monthHtml(events) {
  const grouped = groupEvents(events.filter(event => event.date));
  const byDate = new Map();
  grouped.forEach(group => {
    const list = byDate.get(group.date) || [];
    list.push(group);
    byDate.set(group.date, list);
  });

  return `
    <div class="cal-weekdays">${['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map(day => `<span>${day}</span>`).join('')}</div>
    <div class="cal-month-grid">${monthDays().map(date => {
      const iso = formatISO(date);
      const groups = byDate.get(iso) || [];
      const outside = date.getMonth() !== anchorDate.getMonth();
      const hasOverdue = groups.some(group => group.status === 'atrasado');
      const classes = [
        'cal-day',
        outside ? 'outside' : '',
        iso === today() ? 'today' : '',
        iso === selectedDate ? 'selected' : '',
        hasOverdue ? 'has-overdue' : ''
      ].filter(Boolean).join(' ');
      return `<button type="button" class="${classes}" data-calendar-date="${iso}">
        <span class="cal-day-top"><span class="cal-day-number">${date.getDate()}</span><span class="cal-day-count">${groups.length ? `${groups.length} entrega${groups.length === 1 ? '' : 's'}` : ''}</span></span>
        <span class="cal-events">${groups.slice(0, 3).map(calendarChip).join('')}${groups.length > 3 ? `<span class="cal-more">+ ${groups.length - 3} entregas</span>` : ''}</span>
      </button>`;
    }).join('')}</div>`;
}

function weekHtml(events) {
  const start = startOfWeek(anchorDate);
  const grouped = groupEvents(events.filter(event => event.date));
  const byDate = new Map();
  grouped.forEach(group => {
    const list = byDate.get(group.date) || [];
    list.push(group);
    byDate.set(group.date, list);
  });

  return `<div class="cal-week-grid">${Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const iso = formatISO(date);
    const groups = byDate.get(iso) || [];
    const classes = ['cal-week-day', iso === today() ? 'today' : '', iso === selectedDate ? 'selected' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-calendar-date="${iso}">
      <span class="cal-week-head"><strong>${formatDate(date, { weekday: 'short' })}</strong><span>${formatDate(date, { day: '2-digit', month: '2-digit' })}</span></span>
      <span class="cal-week-list">${groups.length ? groups.map(group => {
        const tone = group.status === 'atrasado' ? ' overdue' : group.status === 'hoje' ? ' today' : '';
        return `<span class="cal-week-event${tone}"><strong>${escapeHtml(group.supplier)}</strong><span>${escapeHtml(group.projectCode || group.projectName)} · ${group.items.length} item${group.items.length === 1 ? '' : 's'}</span></span>`;
      }).join('') : '<span class="cal-week-empty">Nenhuma entrega programada</span>'}</span>
    </button>`;
  }).join('')}</div>`;
}

function undatedHtml(events) {
  const groups = groupEvents(events.filter(event => !event.date));
  if (!groups.length) return '';

  return `<section class="cal-undated">
    <div class="cal-undated-head"><strong>Compras sem data de entrega</strong><span>${groups.length} grupo${groups.length === 1 ? '' : 's'} precisam de previsão</span></div>
    <div class="cal-undated-list">${groups.map(group => `
      <article class="cal-undated-card">
        <strong>${escapeHtml(group.supplier)}</strong>
        <span>${escapeHtml(group.projectCode || group.projectName)} · ${group.items.length} item${group.items.length === 1 ? '' : 's'}${group.orderNumber ? ` · Pedido ${escapeHtml(group.orderNumber)}` : ''}</span>
      </article>`).join('')}</div>
  </section>`;
}

function render() {
  renderQueued = false;
  if (!calendarActive || currentRoute() !== 'calendario') return;
  ensureStyle();
  injectNav();

  const view = $('#view');
  if (!view) return;

  const allEvents = buildEvents();
  const events = filteredEvents();
  const indicators = stats(allEvents);
  const projectsList = projectOptions(allEvents);
  const suppliersList = supplierOptions(allEvents);

  $('#pageTitle').textContent = 'Calendário';
  $('#pageSubtitle').textContent = 'Agenda de recebimentos, fornecedores, atrasos e entregas por obra';
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === 'calendario'));

  view.innerHTML = `
    <div class="cal-shell">
      <section class="cal-hero">
        <div><span class="cal-eyebrow">ORGANIZAÇÃO DE RECEBIMENTOS</span><h2>Agenda de entregas</h2><p>Visualize o que chega, de qual fornecedor, para qual obra e o que já está atrasado.</p></div>
        <div class="cal-view-toggle"><button type="button" data-calendar-view="month" class="${viewMode === 'month' ? 'active' : ''}">Mensal</button><button type="button" data-calendar-view="week" class="${viewMode === 'week' ? 'active' : ''}">Semanal</button></div>
      </section>

      <section class="cal-kpis">
        <article class="cal-kpi today"><span>Recebimentos hoje</span><strong>${indicators.today}</strong><small>itens com entrega marcada para hoje</small></article>
        <article class="cal-kpi"><span>Próximos 7 dias</span><strong>${indicators.upcoming}</strong><small>itens programados para a semana</small></article>
        <article class="cal-kpi danger"><span>Atrasados</span><strong>${indicators.overdue}</strong><small>itens ainda não recebidos após o prazo</small></article>
        <article class="cal-kpi"><span>Sem data</span><strong>${indicators.undated}</strong><small>compras registradas sem previsão</small></article>
      </section>

      <section class="cal-controls">
        <input id="calendarSearch" type="search" placeholder="Buscar fornecedor, obra, pedido ou material" value="${escapeHtml(filters.search)}" />
        <select id="calendarProject"><option value="todos">Todas as obras</option>${projectsList.map(option => `<option value="${escapeHtml(option.id)}" ${filters.project === option.id ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>
        <select id="calendarSupplier"><option value="todos">Todos os fornecedores</option>${suppliersList.map(supplier => `<option value="${escapeHtml(supplier)}" ${filters.supplier === supplier ? 'selected' : ''}>${escapeHtml(supplier)}</option>`).join('')}</select>
        <select id="calendarStatus"><option value="todos">Todas as situações</option><option value="atrasado" ${filters.status === 'atrasado' ? 'selected' : ''}>Atrasados</option><option value="hoje" ${filters.status === 'hoje' ? 'selected' : ''}>Entrega hoje</option><option value="proximo" ${filters.status === 'proximo' ? 'selected' : ''}>Programados</option><option value="sem-data" ${filters.status === 'sem-data' ? 'selected' : ''}>Sem data</option></select>
      </section>

      <section class="cal-board">
        <header class="cal-board-head">
          <div class="cal-period"><div><h3>${escapeHtml(periodTitle())}</h3><small>${events.length} item${events.length === 1 ? '' : 's'} aguardando recebimento nos filtros atuais</small></div></div>
          <div class="cal-nav"><button type="button" data-calendar-nav="prev" aria-label="Período anterior">←</button><button type="button" data-calendar-nav="today">Hoje</button><button type="button" data-calendar-nav="next" aria-label="Próximo período">→</button></div>
        </header>
        ${viewMode === 'month' ? monthHtml(events) : weekHtml(events)}
        ${undatedHtml(events)}
      </section>
    </div>`;

  bindControls(view);
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => setTimeout(render, 0));
}

function bindControls(root) {
  $('#calendarSearch', root)?.addEventListener('input', event => {
    filters.search = event.target.value;
    queueRender();
  });

  $('#calendarProject', root)?.addEventListener('change', event => {
    filters.project = event.target.value;
    queueRender();
  });

  $('#calendarSupplier', root)?.addEventListener('change', event => {
    filters.supplier = event.target.value;
    queueRender();
  });

  $('#calendarStatus', root)?.addEventListener('change', event => {
    filters.status = event.target.value;
    queueRender();
  });

  $$('[data-calendar-view]', root).forEach(button => button.addEventListener('click', () => {
    viewMode = button.dataset.calendarView;
    queueRender();
  }));

  $$('[data-calendar-nav]', root).forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.calendarNav;
    if (action === 'today') {
      anchorDate = startOfDay(new Date());
      selectedDate = today();
    } else if (viewMode === 'month') {
      anchorDate = addMonths(anchorDate, action === 'prev' ? -1 : 1);
    } else {
      anchorDate = addDays(anchorDate, action === 'prev' ? -7 : 7);
    }
    queueRender();
  }));

  $$('[data-calendar-date]', root).forEach(button => button.addEventListener('click', () => {
    selectedDate = button.dataset.calendarDate;
    openDrawer(selectedDate);
    queueRender();
  }));
}

function openDrawer(date) {
  closeDrawer();
  const events = filteredEvents().filter(event => event.date === date);
  const groups = groupEvents(events);
  const overlay = document.createElement('div');
  overlay.id = 'calendarDrawerRoot';
  overlay.innerHTML = `
    <div class="cal-drawer-backdrop" data-calendar-close></div>
    <aside class="cal-drawer" aria-label="Entregas do dia ${escapeHtml(formatDate(date))}">
      <header class="cal-drawer-head">
        <div><span class="cal-eyebrow">ENTREGAS DO DIA</span><h3>${escapeHtml(formatDate(date, { weekday: 'long', day: '2-digit', month: 'long' }))}</h3><p>${groups.length} entrega${groups.length === 1 ? '' : 's'} agrupada${groups.length === 1 ? '' : 's'} por fornecedor e obra</p></div>
        <button class="cal-drawer-close" type="button" data-calendar-close aria-label="Fechar">×</button>
      </header>
      <div class="cal-drawer-body">${groups.length ? groups.map(group => deliveryGroupHtml(group)).join('') : '<div class="cal-drawer-empty"><strong>Nenhuma entrega neste dia</strong>Escolha outro dia no calendário ou ajuste os filtros.</div>'}</div>
    </aside>`;
  document.body.appendChild(overlay);
  $$('[data-calendar-close]', overlay).forEach(element => element.addEventListener('click', closeDrawer));
}

function deliveryGroupHtml(group) {
  const projectLabel = group.projectCode ? `${group.projectCode} - ${group.projectName}` : group.projectName;
  return `<article class="cal-delivery-group">
    <header class="cal-delivery-head">
      <div class="cal-delivery-title"><strong>${escapeHtml(group.supplier)}</strong><span class="cal-status ${group.status}">${statusLabel(group.status)}</span></div>
      <div class="cal-delivery-meta">${escapeHtml(projectLabel)}${group.orderNumber ? ` · Pedido ${escapeHtml(group.orderNumber)}` : ' · Pedido não informado'}</div>
    </header>
    <div class="cal-items">${group.items.map(item => `
      <div class="cal-item">
        <div class="cal-item-main"><strong>${escapeHtml(item.description)}</strong><span>${formatQty(item.pendingQty)} ${escapeHtml(item.unit)}</span></div>
        <small>${escapeHtml([item.code, item.category].filter(Boolean).join(' · ') || 'Sem código')} · comprado ${formatQty(item.purchaseQty)} ${escapeHtml(item.unit)} · recebido ${formatQty(item.receivedQty)} ${escapeHtml(item.unit)}</small>
      </div>`).join('')}</div>
  </article>`;
}

function closeDrawer() {
  $('#calendarDrawerRoot')?.remove();
}

function navigateCalendar() {
  injectNav();
  calendarActive = true;
  history.replaceState(null, '', '#calendario');
  closeDrawer();
  render();
  $('#view')?.focus();
}

function subscribe() {
  stopProjects?.();
  stopMaterials?.();
  stopProjects = onValue(ref(db, 'projects'), snapshot => {
    projects = snapshot.val() || {};
    queueRender();
  }, error => console.error('Falha ao carregar obras do calendário:', error));
  stopMaterials = onValue(ref(db, 'materials'), snapshot => {
    materialsByProject = snapshot.val() || {};
    queueRender();
  }, error => console.error('Falha ao carregar recebimentos do calendário:', error));
}

injectNav();

onAuthStateChanged(auth, user => {
  stopProjects?.();
  stopMaterials?.();
  stopProjects = null;
  stopMaterials = null;
  projects = {};
  materialsByProject = {};

  if (!user) {
    calendarActive = false;
    closeDrawer();
    return;
  }

  subscribe();
  if (initialCalendarRoute) setTimeout(navigateCalendar, 180);
});

document.addEventListener('click', event => {
  const calendarButton = event.target.closest?.('[data-route="calendario"]');
  if (calendarButton) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    navigateCalendar();
    return;
  }

  if (calendarActive && event.target.closest?.('[data-route]:not([data-route="calendario"])')) {
    calendarActive = false;
    closeDrawer();
  }
}, true);

window.addEventListener('hashchange', () => {
  if (currentRoute() === 'calendario') {
    calendarActive = true;
    render();
  } else {
    calendarActive = false;
    closeDrawer();
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeDrawer();
});

new MutationObserver(injectNav).observe(document.documentElement, { childList: true, subtree: true });
