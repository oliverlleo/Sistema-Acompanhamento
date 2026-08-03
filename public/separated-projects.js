import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { allocation, purchaseCommitted, quantityNumber} from './material-flow.js?v=20260803-1648';

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

let projects = {};
let materialsByProject = {};
let selectedProjectId = '';
let stopProjects = null;
let stopMaterials = null;
let started = false;
let projectsReady = false;
let materialsReady = false;

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;
  let text = String(value).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatQty(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(number(value));
}

function formatDate(value) {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR').format(date);
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

function firstUseful(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function formatMeasurePart(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(parsed)
    : raw;
}

function measureText(material = {}) {
  const explicit = firstUseful(material.dimensions, material.medidas, material.measurements);
  if (explicit) return String(explicit).trim();

  const details = material.sourceDetails || {};
  const width = firstUseful(material.width, material.largura, details.LARGURA, details.L);
  const height = firstUseful(material.height, material.altura, details.ALTURA, details.A, details.H);
  const length = firstUseful(material.length, material.comprimento, material.medida, details.COMPRIMENTO, details.MEDIDA);
  const parts = [width, height, length]
    .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
    .map(formatMeasurePart);

  if (parts.length) return parts.join(' × ');

  const area = firstUseful(material.area, material.areaM2, material.m2, details.AREA, details.M2_COMPRA, details.M2_CORTE);
  return area !== undefined && area !== null && String(area).trim() !== ''
    ? `${formatMeasurePart(area)} m²`
    : '—';
}

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function projectMaterials(projectId) {
  return Object.values(materialsByProject[projectId] || {});
}

function percentMeta(separated, required) {
  const exact = required > 0 ? clamp((separated / required) * 100, 0, 100) : 0;
  const rounded = Math.round(exact);
  return {
    exact,
    rounded,
    visual: exact > 0 ? Math.max(1.2, exact) : 0,
    label: exact > 0 && exact < 1 ? '<1%' : `${rounded}%`
  };
}

function separationSummary(items = []) {
  const categories = new Map();
  let requiredQty = 0;
  let separatedQty = 0;
  let separatedItems = 0;
  let purchasedItems = 0;
  let completedItems = 0;

  items.forEach(material => {
    const required = Math.max(0, quantityNumber(material, material.qtyRequired));
    const separated = clamp(quantityNumber(material, material.separatedQty), 0, required || Number.MAX_SAFE_INTEGER);
    const categoryName = String(material.category || 'Sem categoria').trim() || 'Sem categoria';
    const current = categories.get(categoryName) || {
      name: categoryName,
      required: 0,
      separated: 0,
      items: 0,
      separatedItems: 0,
      completedItems: 0
    };

    requiredQty += required;
    separatedQty += Math.min(separated, required || separated);
    if (separated > 0) separatedItems += 1;
    const purchase = allocation(material);
    if (purchase.purchaseQty > 0 && purchaseCommitted(material)) purchasedItems += 1;
    if (required > 0 && separated >= required) completedItems += 1;

    current.required += required;
    current.separated += Math.min(separated, required || separated);
    current.items += 1;
    if (separated > 0) current.separatedItems += 1;
    if (required > 0 && separated >= required) current.completedItems += 1;
    categories.set(categoryName, current);
  });

  const categoryList = [...categories.values()]
    .map(category => ({ ...category, ...percentMeta(category.separated, category.required) }))
    .sort((a, b) => {
      const active = Number(b.separated > 0) - Number(a.separated > 0);
      if (active) return active;
      if (b.exact !== a.exact) return b.exact - a.exact;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

  return {
    requiredQty,
    separatedQty,
    separatedItems,
    purchasedItems,
    completedItems,
    totalItems: items.length,
    categories: categoryList,
    ...percentMeta(separatedQty, requiredQty)
  };
}

function statusForMaterial(material) {
  const required = Math.max(0, quantityNumber(material, material.qtyRequired));
  const separated = quantityNumber(material, material.separatedQty);
  const delivered = quantityNumber(material, material.siteDeliveredQty);

  if (required > 0 && delivered >= required) return ['Enviado para obra', 'sent'];
  if (delivered > 0) return ['Envio parcial', 'partial'];
  if (required > 0 && separated >= required) return ['Separação concluída', 'done'];
  return ['Separação parcial', 'partial'];
}

function ensureStyle() {
  if ($('#separatedProjectsStyle')) return;
  const style = document.createElement('style');
  style.id = 'separatedProjectsStyle';
  style.textContent = `
    .sep-shell{display:grid;gap:18px}
    .sep-toolbar{display:flex;align-items:center;gap:14px;padding:14px 16px;background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 5px 18px rgba(15,23,42,.035)}
    .sep-search{position:relative;flex:1;min-width:220px}
    .sep-search svg{position:absolute;left:14px;top:50%;width:18px;height:18px;transform:translateY(-50%);stroke:#64748b;pointer-events:none}
    .sep-search input{width:100%;height:44px;padding:0 14px 0 42px;border:1px solid #d8e0e8;border-radius:12px;background:#f8fafc;font:inherit;color:var(--text);outline:none;transition:border-color .15s,box-shadow .15s,background .15s}
    .sep-search input:focus{background:#fff;border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.12)}
    .sep-toolbar-count{display:flex;align-items:baseline;gap:6px;white-space:nowrap;padding:0 4px}
    .sep-toolbar-count strong{font-size:20px;color:#0f172a}
    .sep-toolbar-count span{font-size:12px;color:#64748b}
    .sep-project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px;align-items:start}
    .sep-project-card{position:relative;display:flex;flex-direction:column;min-height:300px;padding:20px;background:#fff;border:1px solid #dfe6ed;border-radius:18px;box-shadow:0 6px 18px rgba(15,23,42,.045);cursor:pointer;overflow:hidden;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
    .sep-project-card:hover{transform:translateY(-3px);border-color:rgba(15,118,110,.36);box-shadow:0 15px 34px rgba(15,23,42,.10)}
    .sep-project-card:focus-visible{outline:3px solid rgba(15,118,110,.22);outline-offset:2px}
    .sep-project-card::before{content:'';position:absolute;inset:0 0 auto;height:4px;background:linear-gradient(90deg,#0f766e,#14b8a6)}
    .sep-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
    .sep-card-copy{min-width:0;padding-top:2px}
    .sep-project-code{display:inline-flex;align-items:center;min-height:23px;padding:3px 9px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:11px;font-weight:800;letter-spacing:.035em}
    .sep-card-copy h3{margin:10px 0 3px;font-size:20px;line-height:1.18;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sep-card-copy p{margin:0;color:#64748b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sep-donut{--value:0;--size:92px;position:relative;display:grid;place-items:center;flex:0 0 var(--size);width:var(--size);height:var(--size);border-radius:50%;background:conic-gradient(#0f766e calc(var(--value)*1%),#e8eef3 0);box-shadow:inset 0 0 0 1px rgba(15,23,42,.03)}
    .sep-donut::after{content:'';position:absolute;inset:9px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(15,23,42,.035)}
    .sep-donut-label{position:relative;z-index:1;display:grid;place-items:center;line-height:1;text-align:center}
    .sep-donut-label strong{font-size:20px;color:#0f172a}
    .sep-donut-label small{margin-top:5px;color:#64748b;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
    .sep-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:18px 0 14px}
    .sep-stat{min-width:0;padding:10px 9px;border-radius:12px;background:#f8fafc;border:1px solid #edf1f5}
    .sep-stat strong{display:block;color:#0f172a;font-size:16px;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sep-stat span{display:block;margin-top:4px;color:#64748b;font-size:10px;font-weight:600}
    .sep-category-preview{display:grid;gap:7px}
    .sep-category-line{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:7px 9px;border-radius:10px;background:#fbfcfd;border:1px solid #edf1f4}
    .sep-category-line span{min-width:0;color:#334155;font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sep-category-line strong{color:#0f766e;font-size:11px}
    .sep-more{display:inline-flex;align-items:center;align-self:flex-start;margin-top:2px;color:#64748b;font-size:11px;font-weight:700}
    .sep-card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:16px}
    .sep-qty-summary{min-width:0;color:#64748b;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sep-open{display:inline-flex;align-items:center;gap:6px;color:#0f766e;font-size:12px;font-weight:800}
    .sep-open svg{width:15px;height:15px;stroke:currentColor}
    .sep-no-results{grid-column:1/-1}
    .sep-detail-top{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:22px;background:linear-gradient(135deg,#0f172a 0%,#123b3b 100%);border-radius:20px;color:#fff;box-shadow:0 14px 30px rgba(15,23,42,.14)}
    .sep-detail-top h2{margin:8px 0 4px;color:#fff;font-size:26px}
    .sep-detail-top p{margin:0;color:rgba(255,255,255,.72)}
    .sep-detail-top .sep-project-code{background:rgba(255,255,255,.12);color:#d1fae5}
    .sep-detail-top .sep-donut::after{background:#123131}
    .sep-detail-top .sep-donut-label strong{color:#fff}
    .sep-detail-top .sep-donut-label small{color:rgba(255,255,255,.65)}
    .sep-detail-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .sep-detail-metric{padding:16px;background:#fff;border:1px solid var(--border);border-radius:15px;box-shadow:0 5px 16px rgba(15,23,42,.035)}
    .sep-detail-metric span{display:block;color:#64748b;font-size:11px;font-weight:700}
    .sep-detail-metric strong{display:block;margin-top:6px;color:#0f172a;font-size:21px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sep-category-strip{display:flex;gap:10px;overflow:auto;padding:2px 1px 6px;scrollbar-width:thin}
    .sep-category-pill{flex:0 0 180px;padding:13px 14px;background:#fff;border:1px solid var(--border);border-radius:14px}
    .sep-category-pill-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .sep-category-pill-head span{min-width:0;color:#334155;font-size:11px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sep-category-pill-head strong{font-size:12px;color:#0f766e}
    .sep-mini-track{height:6px;margin:10px 0 7px;border-radius:999px;background:#e8eef3;overflow:hidden}
    .sep-mini-track i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#0f766e,#14b8a6)}
    .sep-category-pill small{color:#64748b;font-size:10px}
    .sep-table-card{background:#fff;border:1px solid var(--border);border-radius:17px;overflow:hidden;box-shadow:0 5px 16px rgba(15,23,42,.035)}
    .sep-table-toolbar{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border)}
    .sep-table-toolbar .sep-search{max-width:520px}
    .sep-table-count{margin-left:auto;color:#64748b;font-size:12px;font-weight:700;white-space:nowrap}
    .sep-table-wrap{overflow:auto}
    .sep-table{width:100%;border-collapse:collapse}
    .sep-table th{padding:12px 14px;background:#f8fafc;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.045em;text-align:left;white-space:nowrap;border-bottom:1px solid var(--border)}
    .sep-table td{padding:13px 14px;border-bottom:1px solid #edf1f4;vertical-align:middle;font-size:12px;color:#334155}
    .sep-table tr:last-child td{border-bottom:0}
    .sep-table tr:hover td{background:#fbfdfd}
    .sep-material-main{display:block;max-width:360px;color:#0f172a;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sep-material-sub{display:block;margin-top:4px;color:#64748b;font-size:10px}
    .sep-qty{min-width:145px}
    .sep-qty strong{display:block;color:#0f172a;font-size:12px}
    .sep-row-track{height:5px;margin-top:7px;border-radius:999px;background:#e8eef3;overflow:hidden}
    .sep-row-track i{display:block;height:100%;border-radius:inherit;background:#0f766e}
    .sep-status{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}
    .sep-status-done{background:#dcfce7;color:#166534}
    .sep-status-partial{background:#fff7ed;color:#c2410c}
    .sep-status-sent{background:#e0f2fe;color:#075985}
    .sep-back{display:inline-flex;align-items:center;gap:7px;margin-bottom:12px}
    @media(max-width:980px){.sep-detail-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:720px){
      .sep-toolbar{align-items:stretch;flex-direction:column}.sep-toolbar-count{justify-content:flex-end}
      .sep-project-grid{grid-template-columns:1fr}.sep-project-card{min-height:auto}
      .sep-card-head{gap:12px}.sep-donut{--size:78px}.sep-donut-label strong{font-size:17px}
      .sep-detail-top{align-items:flex-start}.sep-detail-top h2{font-size:22px}
      .sep-detail-summary{grid-template-columns:1fr 1fr}.sep-table-toolbar{align-items:stretch;flex-direction:column}.sep-table-count{margin-left:0}
    }
  `;
  document.head.appendChild(style);
}

function searchIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>';
}

function arrowIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>';
}

function donut(summary, size = 92) {
  return `
    <div class="sep-donut" style="--value:${summary.visual};--size:${size}px" aria-label="${summary.label} separado">
      <div class="sep-donut-label"><strong>${summary.label}</strong><small>separado</small></div>
    </div>`;
}

function emptyState(icon, title, text, extraClass = '') {
  return `<div class="card ${extraClass}"><div class="empty"><div><div class="empty-icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div></div></div>`;
}

function projectSearchText(projectId, project) {
  return normalize([
    project.code,
    project.name,
    project.client,
    project.address,
    project.responsible,
    ...separationSummary(projectMaterials(projectId)).categories.map(category => category.name)
  ].filter(Boolean).join(' '));
}

function projectCard(projectId, project) {
  const summary = separationSummary(projectMaterials(projectId));
  const preview = summary.categories.slice(0, 4);
  const remaining = Math.max(0, summary.categories.length - preview.length);
  const categories = preview.length
    ? preview.map(category => `
        <div class="sep-category-line" title="${escapeHtml(category.name)} · ${formatQty(category.separated)} de ${formatQty(category.required)}">
          <span>${escapeHtml(category.name)}</span><strong>${category.label}</strong>
        </div>`).join('')
    : '<div class="sep-category-line"><span>Nenhuma categoria cadastrada</span><strong>—</strong></div>';

  return `
    <article class="sep-project-card" data-separated-project="${escapeHtml(projectId)}" data-search="${escapeHtml(projectSearchText(projectId, project))}" tabindex="0" role="button" aria-label="Abrir materiais separados da obra ${escapeHtml(project.name || project.code || '')}">
      <div class="sep-card-head">
        <div class="sep-card-copy">
          <span class="sep-project-code">${escapeHtml(project.code || 'SEM CÓDIGO')}</span>
          <h3 title="${escapeHtml(project.name || 'Obra sem nome')}">${escapeHtml(project.name || 'Obra sem nome')}</h3>
          <p title="${escapeHtml(project.client || project.address || 'Cliente não informado')}">${escapeHtml(project.client || project.address || 'Cliente não informado')}</p>
        </div>
        ${donut(summary)}
      </div>
      <div class="sep-stats">
        <div class="sep-stat"><strong>${summary.totalItems}</strong><span>itens da obra</span></div>
        <div class="sep-stat"><strong>${summary.purchasedItems}</strong><span>itens comprados</span></div>
        <div class="sep-stat"><strong>${summary.separatedItems}</strong><span>itens separados</span></div>
      </div>
      <div class="sep-category-preview">${categories}</div>
      ${remaining ? `<span class="sep-more">+ ${remaining} categoria${remaining === 1 ? '' : 's'}</span>` : ''}
      <div class="sep-card-foot">
        <span class="sep-qty-summary">${formatQty(quantityNumber(summary, summary.separatedQty))} de ${formatQty(quantityNumber(summary, summary.requiredQty))} separados</span>
        <span class="sep-open">Ver detalhes ${arrowIcon()}</span>
      </div>
    </article>`;
}

function bindProjectSearch(view) {
  const input = $('#separatedProjectSearch', view);
  const count = $('#separatedProjectCount', view);
  const cards = $$('[data-separated-project]', view);
  const noResults = $('#separatedNoResults', view);

  const apply = () => {
    const query = normalize(input?.value || '');
    let visible = 0;
    cards.forEach(card => {
      const matches = !query || card.dataset.search.includes(query);
      card.hidden = !matches;
      if (matches) visible += 1;
    });
    if (count) count.textContent = String(visible);
    if (noResults) noResults.hidden = visible !== 0;
  };

  input?.addEventListener('input', apply);
  apply();
}

function renderProjectList(view) {
  const projectEntries = Object.entries(projects)
    .sort(([, a], [, b]) => String(a.name || a.code || '').localeCompare(String(b.name || b.code || ''), 'pt-BR'));

  view.innerHTML = `
    <div class="sep-shell">
      <div class="page-head">
        <div><h2>Acompanhamento por obra</h2><p>Localize uma obra para acompanhar compras, pintura, materiais conferidos e separação.</p></div>
      </div>
      <div class="sep-toolbar">
        <label class="sep-search" aria-label="Buscar obra">
          ${searchIcon()}
          <input id="separatedProjectSearch" type="search" autocomplete="off" placeholder="Buscar por código, obra, cliente ou categoria" />
        </label>
        <div class="sep-toolbar-count"><strong id="separatedProjectCount">${projectEntries.length}</strong><span>obra${projectEntries.length === 1 ? '' : 's'}</span></div>
      </div>
      ${projectEntries.length
        ? `<section class="sep-project-grid">${projectEntries.map(([id, project]) => projectCard(id, project)).join('')}${emptyState('⌕', 'Nenhuma obra encontrada', 'Tente outro código, nome, cliente ou categoria.', 'sep-no-results')}</section>`
        : emptyState('▣', 'Nenhuma obra cadastrada', 'Cadastre uma obra e seus materiais para acompanhar a separação.')}
    </div>`;

  const noResults = $('.sep-no-results', view);
  if (noResults) {
    noResults.id = 'separatedNoResults';
    noResults.hidden = true;
  }

  $$('[data-separated-project]', view).forEach(card => {
    const open = () => {
      selectedProjectId = card.dataset.separatedProject;
      render();
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });

  bindProjectSearch(view);
}

function materialSearchText(material) {
  return normalize([
    material.code,
    material.description,
    material.type,
    material.category,
    material.color,
    measureText(material),
    material.unit
  ].filter(Boolean).join(' '));
}

function materialRow(material) {
  const required = Math.max(0, quantityNumber(material, material.qtyRequired));
  const separated = clamp(quantityNumber(material, material.separatedQty), 0, required || Number.MAX_SAFE_INTEGER);
  const delivered = clamp(quantityNumber(material, material.siteDeliveredQty), 0, separated || Number.MAX_SAFE_INTEGER);
  const percent = percentMeta(separated, required);
  const [statusLabel, statusTone] = statusForMaterial(material);

  return `<tr data-separated-material-row data-search="${escapeHtml(materialSearchText(material))}">
    <td><span class="sep-material-main" title="${escapeHtml(material.description || 'Sem descrição')}">${escapeHtml(material.description || 'Sem descrição')}</span><span class="sep-material-sub">${escapeHtml([material.code, material.type].filter(Boolean).join(' · ') || 'Sem código')}</span></td>
    <td>${escapeHtml(material.category || 'Sem categoria')}</td>
    <td><span class="sep-material-main">${escapeHtml(measureText(material))}</span>${material.color ? `<span class="sep-material-sub">${escapeHtml(material.color)}</span>` : ''}</td>
    <td class="sep-qty"><strong>${formatQty(separated)} / ${formatQty(required)} ${escapeHtml(material.unit || 'un')}</strong><div class="sep-row-track"><i style="width:${percent.visual}%"></i></div></td>
    <td>${delivered > 0 ? `${formatQty(delivered)} ${escapeHtml(material.unit || 'un')}` : '—'}</td>
    <td><span class="sep-status sep-status-${statusTone}">${escapeHtml(statusLabel)}</span></td>
    <td>${formatDate(material.separatedDate)}</td>
  </tr>`;
}

function bindMaterialSearch(view) {
  const input = $('#separatedMaterialSearch', view);
  const count = $('#separatedMaterialCount', view);
  const rows = $$('[data-separated-material-row]', view);
  const emptyRow = $('#separatedMaterialEmptyRow', view);

  const apply = () => {
    const query = normalize(input?.value || '');
    let visible = 0;
    rows.forEach(row => {
      const matches = !query || row.dataset.search.includes(query);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    if (count) count.textContent = `${visible} item${visible === 1 ? '' : 's'}`;
    if (emptyRow) emptyRow.hidden = visible !== 0;
  };

  input?.addEventListener('input', apply);
  apply();
}

function renderProjectDetail(view, projectId) {
  const project = projects[projectId];
  if (!project) {
    selectedProjectId = '';
    renderProjectList(view);
    return;
  }

  const allItems = projectMaterials(projectId);
  const separatedItems = allItems
    .filter(material => quantityNumber(material, material.separatedQty) > 0)
    .sort((a, b) => {
      const category = String(a.category || '').localeCompare(String(b.category || ''), 'pt-BR');
      return category || String(a.description || '').localeCompare(String(b.description || ''), 'pt-BR');
    });
  const summary = separationSummary(allItems);
  const categoryStrip = summary.categories.map(category => `
    <article class="sep-category-pill" title="${escapeHtml(category.name)}">
      <div class="sep-category-pill-head"><span>${escapeHtml(category.name)}</span><strong>${category.label}</strong></div>
      <div class="sep-mini-track"><i style="width:${category.visual}%"></i></div>
      <small>${formatQty(category.separated)} de ${formatQty(category.required)} separados</small>
    </article>`).join('');

  view.innerHTML = `
    <div class="sep-shell">
      <div class="page-head">
        <div><button id="backSeparatedProjects" class="btn btn-ghost btn-sm sep-back" type="button">← Voltar para as obras</button></div>
      </div>
      <section class="sep-detail-top">
        <div>
          <span class="sep-project-code">${escapeHtml(project.code || 'SEM CÓDIGO')}</span>
          <h2>${escapeHtml(project.name || 'Obra sem nome')}</h2>
          <p>${escapeHtml(project.client || project.address || 'Cliente não informado')}</p>
        </div>
        ${donut(summary, 108)}
      </section>
      <section class="sep-detail-summary">
        <article class="sep-detail-metric"><span>Itens da obra</span><strong>${summary.totalItems}</strong></article>
        <article class="sep-detail-metric"><span>Itens comprados</span><strong>${summary.purchasedItems}</strong></article>
        <article class="sep-detail-metric"><span>Itens separados</span><strong>${summary.separatedItems}</strong></article>
        <article class="sep-detail-metric"><span>Quantidade separada</span><strong>${formatQty(quantityNumber(summary, summary.separatedQty))} / ${formatQty(quantityNumber(summary, summary.requiredQty))}</strong></article>
      </section>
      ${categoryStrip ? `<section class="sep-category-strip" aria-label="Progresso por categoria">${categoryStrip}</section>` : ''}
      ${separatedItems.length ? `
        <section class="sep-table-card">
          <div class="sep-table-toolbar">
            <label class="sep-search" aria-label="Buscar material separado">
              ${searchIcon()}
              <input id="separatedMaterialSearch" type="search" autocomplete="off" placeholder="Buscar código, descrição, categoria, medida ou cor" />
            </label>
            <span id="separatedMaterialCount" class="sep-table-count">${separatedItems.length} item${separatedItems.length === 1 ? '' : 's'}</span>
          </div>
          <div class="sep-table-wrap">
            <table class="sep-table">
              <thead><tr><th>Material</th><th>Categoria</th><th>Medida / cor</th><th>Separado</th><th>Enviado</th><th>Situação</th><th>Data</th></tr></thead>
              <tbody>${separatedItems.map(materialRow).join('')}<tr id="separatedMaterialEmptyRow" hidden><td colspan="7">Nenhum material corresponde à busca.</td></tr></tbody>
            </table>
          </div>
        </section>` : emptyState('✓', 'Nenhum item separado nesta obra', 'Assim que uma separação parcial ou total for registrada, o item aparecerá aqui.')}
    </div>`;

  $('#backSeparatedProjects', view)?.addEventListener('click', () => {
    selectedProjectId = '';
    render();
  });
  if (separatedItems.length) bindMaterialSearch(view);
}

function renderLoading(view) {
  view.innerHTML = '<div class="card"><div class="empty"><div><div class="empty-icon">◌</div><h3>Carregando separados</h3><p>Organizando as obras e materiais...</p></div></div></div>';
}

function render() {
  if (currentRoute() !== 'estoque') return;
  ensureStyle();
  const view = $('#view');
  if (!view) return;

  const title = $('#pageTitle');
  const subtitle = $('#pageSubtitle');
  if (title) title.textContent = 'Acompanhamento';
  if (subtitle) subtitle.textContent = 'Compras, pintura, conferência e separação por obra';

  if (!projectsReady || !materialsReady) {
    renderLoading(view);
    return;
  }

  if (selectedProjectId) renderProjectDetail(view, selectedProjectId);
  else renderProjectList(view);
}

function start() {
  if (started) return;
  started = true;
  projectsReady = false;
  materialsReady = false;

  stopProjects = onValue(ref(db, 'projects'), snapshot => {
    projects = snapshot.val() || {};
    projectsReady = true;
    if (selectedProjectId && !projects[selectedProjectId]) selectedProjectId = '';
    render();
  }, error => {
    projectsReady = true;
    console.error('Falha ao carregar obras para a separação:', error);
    render();
  });

  stopMaterials = onValue(ref(db, 'materials'), snapshot => {
    materialsByProject = snapshot.val() || {};
    materialsReady = true;
    render();
  }, error => {
    materialsReady = true;
    console.error('Falha ao carregar materiais separados:', error);
    render();
  });
}

window.ObraFlowSeparatedProjects = {
  render,
  reset() {
    selectedProjectId = '';
    render();
  }
};

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="estoque"]')) {
    selectedProjectId = '';
    setTimeout(render, 70);
  }
});

window.addEventListener('hashchange', () => {
  if (currentRoute() === 'estoque') render();
});

onAuthStateChanged(auth, user => {
  if (user) start();
  else {
    stopProjects?.();
    stopMaterials?.();
    stopProjects = null;
    stopMaterials = null;
    started = false;
    projectsReady = false;
    materialsReady = false;
    projects = {};
    materialsByProject = {};
    selectedProjectId = '';
  }
});

render();
