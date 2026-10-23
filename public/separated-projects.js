import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, get, onValue, update } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { allocation, purchaseCommitted, receivedPurchaseQty, quantityNumber } from './material-flow.js?v=20260803-1648';

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
let stopProfile = null;
let managerRole = false;
let phaseFilter = 'todos';
let kindFilter = 'todos';
let projectQuery = '';
let classificationSaving = false;
let classificationEscapeHandler = null;
const PROJECT_PHASES = [
  ['lista_inicial', 'Lista inicial'],
  ['producao', 'Produção / Andamento'],
  ['manutencao', 'Manutenção'],
  ['finalizados', 'Finalizados']
];
const PROJECT_PHASE_LABELS = Object.fromEntries(PROJECT_PHASES);
function trackingPhase(project = {}) {
  return Object.prototype.hasOwnProperty.call(PROJECT_PHASE_LABELS, project.trackingPhase) ? project.trackingPhase : 'lista_inicial';
}

const PROJECT_KINDS = [
  ['obra', 'Obras'],
  ['manutencao', 'Manutenções']
];
function trackingKind(project = {}) {
  if (project.trackingKind === 'obra' || project.trackingKind === 'manutencao') return project.trackingKind;
  // Cadastros antigos em manutenção são considerados manutenções; os demais, obras.
  return trackingPhase(project) === 'manutencao' ? 'manutencao' : 'obra';
}
function phaseSupportsKind(phase) {
  return phase === 'manutencao' || phase === 'finalizados';
}

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

// Progresso dos cards: contabiliza cada material individualmente para não
// misturar unidades (peças, metros, m²). A origem indefinida nunca é resolvida.
function honestStagePercent(value, total) {
  if (!(total > 0)) return { ...percentMeta(0, 0), label: '—' };
  const meta = percentMeta(value, total);
  // Não exibir 100% por arredondamento quando ainda houver saldo.
  return { ...meta, label: meta.exact >= 100 - 0.000001 ? '100%' : `${Math.min(99, Math.round(meta.exact))}%` };
}

function workProgress(items = []) {
  const epsilon = 0.000001;
  let purchaseItems = 0;
  let purchasedItems = 0;
  let receivedProgress = 0;
  let receivedCompleteItems = 0;
  let separatedProgress = 0;
  let separatedCompleteItems = 0;
  let resolvedItems = 0;
  let undefinedItems = 0;
  let missingQuantityItems = 0;
  let unregisteredPurchaseItems = 0;

  items.forEach(material => {
    const alloc = allocation(material);
    const required = alloc.required;
    if (!(required > epsilon)) {
      missingQuantityItems += 1;
      return;
    }

    if (alloc.unallocatedQty > epsilon) undefinedItems += 1;

    if (alloc.purchaseQty > epsilon) {
      purchaseItems += 1;
      if (purchaseCommitted(material)) purchasedItems += 1;
      else unregisteredPurchaseItems += 1;

      // Cada compra contribui de 0 a 1. Recebimentos parciais contam
      // proporcionalmente, independentemente da unidade do material.
      const receivedFraction = clamp(receivedPurchaseQty(material) / alloc.purchaseQty, 0, 1);
      receivedProgress += receivedFraction;
      if (receivedFraction >= 1 - epsilon) receivedCompleteItems += 1;
    }

    const separatedFraction = clamp(quantityNumber(material, material.separatedQty) / required, 0, 1);
    separatedProgress += separatedFraction;
    if (separatedFraction >= 1 - epsilon) separatedCompleteItems += 1;

    // Resolvido = toda a necessidade classificada entre compra/estoque
    // e, quando houver compra, pedido efetivamente registrado.
    if (alloc.unallocatedQty <= epsilon && (alloc.purchaseQty <= epsilon || purchaseCommitted(material))) {
      resolvedItems += 1;
    }
  });

  return {
    totalItems: items.length,
    undefinedItems,
    missingQuantityItems,
    unregisteredPurchaseItems,
    purchased: { ...honestStagePercent(purchasedItems, purchaseItems), current: purchasedItems, total: purchaseItems },
    received: { ...honestStagePercent(receivedProgress, purchaseItems), current: receivedCompleteItems, total: purchaseItems },
    separated: { ...honestStagePercent(separatedProgress, items.length), current: separatedCompleteItems, total: items.length },
    resolved: { ...honestStagePercent(resolvedItems, items.length), current: resolvedItems, total: items.length }
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
    .sep-kind-filter{display:flex;align-items:center;gap:8px;min-width:0;color:#475569;font-size:11px;font-weight:750;white-space:nowrap}
    .sep-kind-filter select{height:44px;min-width:156px;max-width:100%;padding:0 12px;border:1px solid #d8e0e8;border-radius:12px;background:#f8fafc;color:#0f172a;font:inherit;font-size:12px;cursor:pointer}
    .sep-kind-filter select:focus-visible{outline:2px solid #0f766e;outline-offset:2px}
    .sep-kind-filter[hidden],.sep-phase-dialog label[hidden]{display:none}

    .sep-phase-cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;min-width:0}
    .sep-phase-card{position:relative;display:flex;flex-direction:column;justify-content:space-between;align-items:stretch;gap:10px;min-width:0;min-height:82px;padding:13px 14px;border:1px solid #e0e7ee;border-radius:14px;background:#fff;color:#334155;text-align:left;cursor:pointer;font:inherit;box-shadow:0 3px 12px rgba(15,23,42,.035);transition:border-color .16s,background .16s,box-shadow .16s}
    .sep-phase-card:hover{border-color:#71b6a9;background:#f7fcfa}
    .sep-phase-card:focus-visible{outline:3px solid rgba(15,118,110,.25);outline-offset:2px}
    .sep-phase-card[aria-pressed="true"]{border-color:#0f766e;background:#edfaf6;box-shadow:inset 0 0 0 1px #0f766e,0 5px 16px rgba(15,118,110,.10)}
    .sep-phase-card[aria-pressed="true"]::before{content:'';position:absolute;top:0;left:13px;right:13px;height:3px;background:#0f766e;border-radius:0 0 4px 4px}
    .sep-phase-name{display:block;font-size:11px;line-height:1.25;font-weight:750;overflow-wrap:break-word}
    .sep-phase-card[aria-pressed="true"] .sep-phase-name{color:#0f766e}
    .sep-phase-number{display:block;color:#0f172a;font-size:24px;line-height:1;font-weight:800;font-variant-numeric:tabular-nums}
    .sep-phase-card[aria-pressed="true"] .sep-phase-number{color:#0f766e}
    @media(max-width:1180px){.sep-phase-cards{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(158px,1fr);grid-template-columns:none;overflow-x:auto;padding:2px 2px 8px;scroll-snap-type:x proximity;scrollbar-width:thin}.sep-phase-card{scroll-snap-align:start}}
    @media(max-width:720px){.sep-phase-cards{grid-auto-columns:minmax(148px,60%);gap:8px}.sep-phase-card{min-height:77px;padding:12px}}
    .sep-classification{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}
    .sep-phase-tag{display:inline-flex;align-items:center;min-height:25px;padding:5px 9px;border-radius:8px;background:#e7f2ef;color:#0f766e;font-size:10px;font-weight:800}
    .sep-phase-edit{padding:6px 10px;border:1px solid #bbddd6;border-radius:9px;background:#fff;color:#0f766e;font:inherit;font-size:11px;font-weight:800;cursor:pointer}
    .sep-phase-edit:hover{background:#effaf7}.sep-phase-edit:focus-visible{outline:2px solid #0f766e;outline-offset:2px}
    .sep-phase-overlay{position:fixed;z-index:110;inset:0;display:grid;place-items:center;padding:16px;background:rgba(15,23,42,.48)}
    .sep-phase-dialog{width:min(420px,100%);padding:22px;background:#fff;border-radius:18px;box-shadow:0 22px 65px rgba(15,23,42,.26)}
    .sep-phase-dialog h3{margin:0 0 6px;color:#0f172a;font-size:20px}.sep-phase-dialog p{margin:0 0 18px;color:#64748b;font-size:12px;line-height:1.5}
    .sep-phase-dialog label{display:grid;gap:8px;color:#334155;font-size:12px;font-weight:700}.sep-phase-dialog select{width:100%;min-height:44px;padding:10px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#0f172a;font:inherit;font-weight:500}
    .sep-phase-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}.sep-phase-actions button{padding:10px 15px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#0f172a;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.sep-phase-actions button[type="submit"]{border-color:#0f766e;background:#0f766e;color:#fff}.sep-phase-actions button:disabled{opacity:.65;cursor:wait}
    .sep-phase-error{margin-top:10px!important;color:#b91c1c!important;font-weight:700}
    .sep-toolbar-count strong{font-size:20px;color:#0f172a}
    .sep-toolbar-count span{font-size:12px;color:#64748b}
    .sep-project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px;align-items:start}
    .sep-project-card{position:relative;display:flex;flex-direction:column;min-height:300px;padding:20px;background:#fff;border:1px solid #dfe6ed;border-radius:18px;box-shadow:0 6px 18px rgba(15,23,42,.045);cursor:pointer;overflow:hidden;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
    .sep-project-card[hidden],#separatedNoResults[hidden]{display:none}
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
    .sep-stage-progress{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:18px 0 12px}
    .sep-stage-meter{min-width:0;padding:10px 9px;background:#f8fafc;border:1px solid #edf1f5;border-radius:12px}
    .sep-stage-top{display:flex;flex-direction:column;gap:5px}
    .sep-stage-top span{color:#475569;font-size:10px;font-weight:700}
    .sep-stage-top strong{color:#0f172a;font-size:18px;line-height:1;font-weight:800}
    .sep-stage-track{height:5px;margin:9px 0 6px;background:#e2e8f0;border-radius:999px;overflow:hidden}
    .sep-stage-track i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#0f766e,#14b8a6)}
    .sep-stage-meter small{display:block;min-width:0;color:#64748b;font-size:9px;line-height:1.35}
    .sep-progress-alert{margin:0 0 14px;padding:9px 10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;color:#9a3412;font-size:10px;font-weight:750;line-height:1.4}

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
      .sep-toolbar{align-items:stretch;flex-direction:column}.sep-toolbar-count{justify-content:flex-end}.sep-kind-filter{justify-content:space-between}.sep-kind-filter select{flex:1;min-width:0}
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

function donut(summary, size = 92, label = 'separado') {
  return `
    <div class="sep-donut" style="--value:${summary.visual};--size:${size}px" aria-label="${summary.label} ${escapeHtml(label)}">
      <div class="sep-donut-label"><strong>${summary.label}</strong><small>${escapeHtml(label)}</small></div>
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
    PROJECT_PHASE_LABELS[trackingPhase(project)],
    phaseSupportsKind(trackingPhase(project)) ? (trackingKind(project) === 'manutencao' ? 'manutencoes' : 'obras') : '',
    ...separationSummary(projectMaterials(projectId)).categories.map(category => category.name)
  ].filter(Boolean).join(' '));
}

function stageMeter(label, meta, explanation) {
  return `<div class="sep-stage-meter" title="${escapeHtml(explanation)}">
    <div class="sep-stage-top"><span>${escapeHtml(label)}</span><strong>${meta.label}</strong></div>
    <div class="sep-stage-track"><i style="width:${meta.visual}%"></i></div>
    <small>${meta.total ? `${meta.current} de ${meta.total} itens completos` : 'Sem itens nesta etapa'}</small>
  </div>`;
}

function projectCard(projectId, project) {
  const items = projectMaterials(projectId);
  const summary = separationSummary(items);
  const progress = workProgress(items);
  const preview = summary.categories.slice(0, 4);
  const remaining = Math.max(0, summary.categories.length - preview.length);
  const categories = preview.length
    ? preview.map(category => `
        <div class="sep-category-line" title="${escapeHtml(category.name)} · ${formatQty(category.separated)} de ${formatQty(category.required)}">
          <span>${escapeHtml(category.name)}</span><strong>${category.label}</strong>
        </div>`).join('')
    : '<div class="sep-category-line"><span>Nenhuma categoria cadastrada</span><strong>—</strong></div>';

  return `
    <article class="sep-project-card" data-phase="${trackingPhase(project)}" data-kind="${trackingKind(project)}" data-separated-project="${escapeHtml(projectId)}" data-search="${escapeHtml(projectSearchText(projectId, project))}" tabindex="0" role="button" aria-label="Abrir materiais separados da obra ${escapeHtml(project.name || project.code || '')}">
      <div class="sep-card-head">
        <div class="sep-card-copy">
          <span class="sep-project-code">${escapeHtml(project.code || 'SEM CÓDIGO')}</span>
          <h3 title="${escapeHtml(project.name || 'Obra sem nome')}">${escapeHtml(project.name || 'Obra sem nome')}</h3>
          <p title="${escapeHtml(project.client || project.address || 'Cliente não informado')}">${escapeHtml(project.client || project.address || 'Cliente não informado')}</p>
        </div>
        ${donut(progress.resolved, 92, 'resolvido')}
      </div>
      <div class="sep-classification"><span class="sep-phase-tag">${escapeHtml(PROJECT_PHASE_LABELS[trackingPhase(project)])}</span>${managerRole ? `<button type="button" class="sep-phase-edit" data-classify-project="${escapeHtml(projectId)}" aria-label="Classificar obra ${escapeHtml(project.name || project.code || '')}">Classificar</button>` : ''}</div>
      <div class="sep-stage-progress" aria-label="Andamento da obra por etapa">
        ${stageMeter('Comprado', progress.purchased, 'Itens com compra registrada entre os destinados à compra. Pendências sem origem aparecem no aviso.')}
        ${stageMeter('Recebido', progress.received, 'Média dos percentuais recebidos de cada item destinado à compra. Recebimentos parciais são proporcionais.')}
        ${stageMeter('Separado', progress.separated, 'Média da fração separada de cada material da obra, incluindo os que ainda não têm origem definida.')}
      </div>
      ${progress.undefinedItems || progress.missingQuantityItems || progress.unregisteredPurchaseItems ? `<div class="sep-progress-alert" role="note">${[
        progress.undefinedItems ? `${progress.undefinedItems} sem origem definida` : '',
        progress.missingQuantityItems ? `${progress.missingQuantityItems} sem quantidade válida` : '',
        progress.unregisteredPurchaseItems ? `${progress.unregisteredPurchaseItems} compras sem registro` : ''
      ].filter(Boolean).join(' · ')}</div>` : ''}
      <div class="sep-category-preview">${categories}</div>
      ${remaining ? `<span class="sep-more">+ ${remaining} categoria${remaining === 1 ? '' : 's'}</span>` : ''}
      <div class="sep-card-foot">
        <span class="sep-qty-summary">${summary.completedItems} de ${summary.totalItems} itens totalmente separados</span>
        <span class="sep-open">Ver detalhes ${arrowIcon()}</span>
      </div>
    </article>`;
}

function bindProjectSearch(view) {
  const input = $('#separatedProjectSearch', view);
  const phaseButtons = $$('[data-phase-filter]', view);
  const kindHolder = $('#separatedProjectKindHolder', view);
  const kindSelect = $('#separatedProjectKindFilter', view);
  const count = $('#separatedProjectCount', view);
  const cards = $$('[data-separated-project]', view);
  const noResults = $('#separatedNoResults', view);

  const apply = () => {
    projectQuery = input?.value || '';
    const withKind = phaseSupportsKind(phaseFilter);
    if (!withKind) kindFilter = 'todos';
    if (kindHolder) kindHolder.hidden = !withKind;
    if (kindSelect) kindSelect.value = kindFilter;
    const query = normalize(projectQuery);
    let visible = 0;
    cards.forEach(card => {
      const matches = (!query || card.dataset.search.includes(query))
        && (phaseFilter === 'todos' || card.dataset.phase === phaseFilter)
        && (!withKind || kindFilter === 'todos' || card.dataset.kind === kindFilter);
      card.hidden = !matches;
      if (matches) visible += 1;
    });
    phaseButtons.forEach(button => {
      const selected = button.dataset.phaseFilter === phaseFilter;
      button.setAttribute('aria-pressed', String(selected));
    });
    if (count) count.textContent = String(visible);
    if (noResults) noResults.hidden = visible !== 0;
  };

  input?.addEventListener('input', apply);
  kindSelect?.addEventListener('change', () => { kindFilter = kindSelect.value; apply(); });
  phaseButtons.forEach(button => button.addEventListener('click', () => {
    if (phaseFilter !== button.dataset.phaseFilter) kindFilter = 'todos';
    phaseFilter = button.dataset.phaseFilter;
    apply();
  }));
  apply();
}

function closeClassificationDialog() {
  $('#trackingPhaseOverlay')?.remove();
  if (classificationEscapeHandler) document.removeEventListener('keydown', classificationEscapeHandler);
  classificationEscapeHandler = null;
}

function openClassificationDialog(projectId) {
  if (!managerRole || !auth.currentUser || !projects[projectId]) return;
  closeClassificationDialog();
  const project = projects[projectId];
  const overlay = document.createElement('div');
  overlay.id = 'trackingPhaseOverlay';
  overlay.className = 'sep-phase-overlay';
  const currentPhase = trackingPhase(project);
  overlay.innerHTML = `<form class="sep-phase-dialog" id="trackingPhaseForm" role="dialog" aria-modal="true" aria-label="Classificar obra">
    <h3>Classificar obra</h3>
    <p>${escapeHtml(project.code || '')} · ${escapeHtml(project.name || 'Obra')} — escolha em qual grupo esta obra será exibida.</p>
    <label for="trackingPhaseSelect">Grupo da obra
      <select id="trackingPhaseSelect" name="phase">${PROJECT_PHASES.map(([value, label]) => `<option value="${value}" ${currentPhase === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>
    </label>
    <label for="trackingKindSelect" id="trackingKindRow" ${phaseSupportsKind(currentPhase) ? '' : 'hidden'}>Tipo
      <select id="trackingKindSelect" name="kind">${PROJECT_KINDS.map(([value, label]) => `<option value="${value}" ${trackingKind(project) === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>
    </label>
    <p class="sep-phase-error" id="trackingPhaseError" hidden></p>
    <div class="sep-phase-actions"><button type="button" data-phase-cancel>Cancelar</button><button type="submit" data-phase-save>Salvar classificação</button></div>
  </form>`;
  document.body.appendChild(overlay);
  const phaseSelect = $('#trackingPhaseSelect', overlay);
  const kindRow = $('#trackingKindRow', overlay);
  const kindSelect = $('#trackingKindSelect', overlay);
  phaseSelect.addEventListener('change', () => {
    const nextPhase = phaseSelect.value;
    kindRow.hidden = !phaseSupportsKind(nextPhase);
    if (nextPhase === 'manutencao' && currentPhase !== 'manutencao' && !project.trackingKind) {
      kindSelect.value = 'manutencao';
    }
  });
  const close = () => closeClassificationDialog();
  classificationEscapeHandler = event => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', classificationEscapeHandler);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  $('[data-phase-cancel]', overlay).addEventListener('click', close);
  $('#trackingPhaseForm', overlay).addEventListener('submit', async event => {
    event.preventDefault();
    if (classificationSaving) return;
    const phase = $('#trackingPhaseSelect', overlay)?.value;
    const kind = $('#trackingKindSelect', overlay)?.value;
    if (!Object.prototype.hasOwnProperty.call(PROJECT_PHASE_LABELS, phase)) return;
    if (phaseSupportsKind(phase) && !PROJECT_KINDS.some(([value]) => value === kind)) return;
    const currentUser = auth.currentUser;
    if (!currentUser || !managerRole || !projects[projectId]) { close(); return; }
    const button = $('[data-phase-save]', overlay);
    classificationSaving = true;
    button.disabled = true;
    try {
      const profileSnapshot = await get(ref(db, `users/${currentUser.uid}`));
      if (!auth.currentUser || auth.currentUser.uid !== currentUser.uid
        || profileSnapshot.val()?.role !== 'gerente' || profileSnapshot.val()?.active !== true) {
        throw new Error('Somente usuários com cargo de gerente podem classificar obras.');
      }
      const values = { trackingPhase: phase };
      if (phaseSupportsKind(phase)) values.trackingKind = kind;
      await update(ref(db, `projects/${projectId}`), values);
      close();
    } catch (error) {
      console.error('Falha ao classificar obra:', error);
      const message = $('#trackingPhaseError', overlay);
      if (message) { message.textContent = error.message || 'Não foi possível salvar a classificação.'; message.hidden = false; }
    } finally {
      classificationSaving = false;
      if (button.isConnected) button.disabled = false;
    }
  });
}

function renderProjectList(view) {
  const projectEntries = Object.entries(projects)
    .sort(([, a], [, b]) => String(a.name || a.code || '').localeCompare(String(b.name || b.code || ''), 'pt-BR'));
  const phaseCounts = Object.fromEntries(PROJECT_PHASES.map(([key]) => [key, 0]));
  projectEntries.forEach(([, project]) => { phaseCounts[trackingPhase(project)] += 1; });
  const filterCards = [['todos', 'Todas as obras', projectEntries.length],
    ...PROJECT_PHASES.map(([key, label]) => [key, label, phaseCounts[key]])]
    .map(([key, label, total]) => `<button type="button" class="sep-phase-card" data-phase-filter="${key}" aria-pressed="${phaseFilter === key}" aria-label="${escapeHtml(label)}: ${total} obra${total === 1 ? '' : 's'}">
      <span class="sep-phase-name">${escapeHtml(label)}</span><strong class="sep-phase-number">${total}</strong>
    </button>`).join('');

  view.innerHTML = `
    <div class="sep-shell">
      <div class="page-head">
        <div><h2>Acompanhamento por obra</h2><p>Localize uma obra para acompanhar compras, pintura, materiais conferidos e separação.</p></div>
      </div>
      <nav class="sep-phase-cards" aria-label="Filtrar obras por etapa">
        ${filterCards}
      </nav>
      <div class="sep-toolbar">
        <label class="sep-search" aria-label="Buscar obra">
          ${searchIcon()}
          <input id="separatedProjectSearch" type="search" autocomplete="off" placeholder="Buscar por código, obra, cliente ou categoria" value="${escapeHtml(projectQuery)}" />
        </label>
        <label id="separatedProjectKindHolder" class="sep-kind-filter" for="separatedProjectKindFilter" ${phaseSupportsKind(phaseFilter) ? '' : 'hidden'}><span>Tipo</span><select id="separatedProjectKindFilter" aria-label="Filtrar entre obras e manutenções"><option value="todos">Todos os tipos</option>${PROJECT_KINDS.map(([value, label]) => `<option value="${value}" ${kindFilter === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>
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
    card.addEventListener('click', event => { if (event.target.closest('[data-classify-project]')) return; open(); });
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        if (event.target.closest('button, input, select, a')) return;
        event.preventDefault();
        open();
      }
    });
  });
  if (managerRole) $$('[data-classify-project]', view).forEach(button => button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openClassificationDialog(button.dataset.classifyProject);
  }));

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
  stopProfile?.();
  stopProfile = null;
  managerRole = false;
  closeClassificationDialog();
  if (user) {
    stopProfile = onValue(ref(db, `users/${user.uid}`), snapshot => {
      managerRole = snapshot.val()?.role === 'gerente' && snapshot.val()?.active === true;
      if (!managerRole) closeClassificationDialog();
      if (currentRoute() === 'estoque' && !selectedProjectId) render();
    }, error => console.error('Falha ao consultar cargo para classificação de obras:', error));
    start();
  } else {
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
    projectQuery = '';
    phaseFilter = 'todos';
    kindFilter = 'todos';
  }
});

render();
