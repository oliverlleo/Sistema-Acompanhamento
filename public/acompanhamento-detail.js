import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  allocation, purchaseCommitted, receivedPurchaseQty, availableQty,
  number, clamp, isPast, quantityNumber} from './material-flow.js?v=20260803-1648';

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
const db = getDatabase(app);
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STAGES = ['comprado', 'pintura', 'disponivel', 'separado'];
let projectId = '';
let project = null;
let materials = [];
let activeStage = 'separado';
let loadVersion = 0;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
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

function formatQty(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(number(value));
}

function formatDate(value) {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR').format(date);
}

function firstUseful(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function formatMeasurePart(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const parsed = Number(raw.replace(/\s/g, '').replace(',', '.'));
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
  return area !== undefined && area !== null && String(area).trim() !== '' ? `${formatMeasurePart(area)} m²` : '—';
}

function percent(value, total) {
  const exact = total > 0 ? clamp((value / total) * 100, 0, 100) : 0;
  const rounded = Math.round(exact);
  return {
    exact,
    visual: exact > 0 ? Math.max(1.2, exact) : 0,
    label: exact > 0 && exact < 1 ? '<1%' : `${rounded}%`
  };
}

function materialIdentity(material) {
  return {
    description: material.description || 'Sem descrição',
    sub: [material.code, material.type].filter(Boolean).join(' · ') || 'Sem código',
    category: material.category || 'Sem categoria',
    measure: measureText(material),
    color: material.color || ''
  };
}

function receivedDate(material) {
  return material.receivedDate
    || material.directPaintingDeliveredDate
    || material.paintingReturnDate
    || '';
}

function stageData(items) {
  const data = {
    totalRequired: 0,
    purchaseRequired: 0,
    purchasedQty: 0,
    purchaseItems: 0,
    purchasedItems: 0,
    missingPurchaseItems: 0,
    paintingRequiredQty: 0,
    inPaintingQty: 0,
    paintingReturnedQty: 0,
    paintingItems: 0,
    readyQty: 0,
    readyItems: 0,
    readyStockQty: 0,
    readyReceivedQty: 0,
    separatedQty: 0,
    separatedItems: 0,
    completedSeparatedItems: 0,
    categories: new Map(),
    latestSeparatedDate: '',
    nearestDeliveryEta: '',
    nearestPaintingEta: ''
  };

  items.forEach(material => {
    const alloc = allocation(material);
    const required = alloc.required;
    const received = receivedPurchaseQty(material);
    const separated = clamp(quantityNumber(material, material.separatedQty), 0, required || Number.MAX_SAFE_INTEGER);
    const paintSent = clamp(quantityNumber(material, material.paintingSentQty), 0, required || Number.MAX_SAFE_INTEGER);
    const paintReturned = clamp(quantityNumber(material, material.paintingReturnedQty), 0, paintSent || Number.MAX_SAFE_INTEGER);
    const inPaint = Math.max(0, paintSent - paintReturned);
    const checkedAvailable = availableQty(material);
    const readyPending = Math.max(0, checkedAvailable - inPaint);

    data.totalRequired += required;
    data.separatedQty += Math.min(separated, required || separated);
    if (separated > 0) data.separatedItems += 1;
    if (required > 0 && separated >= required) data.completedSeparatedItems += 1;
    if (material.separatedDate && material.separatedDate > data.latestSeparatedDate) data.latestSeparatedDate = material.separatedDate;

    const categoryName = String(material.category || 'Sem categoria').trim() || 'Sem categoria';
    const category = data.categories.get(categoryName) || { name: categoryName, required: 0, separated: 0 };
    category.required += required;
    category.separated += Math.min(separated, required || separated);
    data.categories.set(categoryName, category);

    if (alloc.purchaseQty > 0) {
      data.purchaseItems += 1;
      data.purchaseRequired += alloc.purchaseQty;
      if (purchaseCommitted(material)) {
        data.purchasedItems += 1;
        data.purchasedQty += alloc.purchaseQty;
      } else {
        data.missingPurchaseItems += 1;
      }
      if (material.deliveryEta && (!data.nearestDeliveryEta || material.deliveryEta < data.nearestDeliveryEta)) {
        data.nearestDeliveryEta = material.deliveryEta;
      }
    }

    if (material.paintingRequired) {
      data.paintingRequiredQty += required;
      data.inPaintingQty += inPaint;
      data.paintingReturnedQty += paintReturned;
      if (inPaint > 0) data.paintingItems += 1;
      if (inPaint > 0 && material.paintingEta && (!data.nearestPaintingEta || material.paintingEta < data.nearestPaintingEta)) {
        data.nearestPaintingEta = material.paintingEta;
      }
    }

    if (readyPending > 0) {
      data.readyQty += readyPending;
      data.readyItems += 1;
      data.readyStockQty += alloc.stockQty;
      data.readyReceivedQty += received;
    }
  });

  data.categoryList = [...data.categories.values()]
    .map(category => ({ ...category, pct: percent(category.separated, category.required) }))
    .sort((a, b) => b.pct.exact - a.pct.exact || a.name.localeCompare(b.name, 'pt-BR'));

  data.stage = {
    comprado: {
      title: 'Comprado', tone: 'blue', value: data.purchasedQty, total: data.purchaseRequired,
      ...percent(data.purchasedQty, data.purchaseRequired)
    },
    pintura: {
      title: 'Em pintura', tone: 'violet', value: data.inPaintingQty, total: data.paintingRequiredQty,
      ...percent(data.inPaintingQty, data.paintingRequiredQty)
    },
    disponivel: {
      title: 'Conferido', tone: 'amber', value: data.readyQty, total: data.totalRequired,
      ...percent(data.readyQty, data.totalRequired)
    },
    separado: {
      title: 'Separado', tone: 'green', value: data.separatedQty, total: data.totalRequired,
      ...percent(data.separatedQty, data.totalRequired)
    }
  };

  return data;
}

function ensureStyle() {
  if ($('#trackingDetailStyle')) return;
  const style = document.createElement('style');
  style.id = 'trackingDetailStyle';
  style.textContent = `
    .trk-shell{display:grid;gap:18px}
    .trk-back{display:inline-flex;align-items:center;gap:7px}
    .trk-hero{position:relative;overflow:hidden;padding:24px;border-radius:22px;background:linear-gradient(135deg,#0f172a 0%,#123b3b 58%,#0f766e 150%);box-shadow:0 16px 36px rgba(15,23,42,.16);color:#fff}
    .trk-hero::after{content:'';position:absolute;width:280px;height:280px;right:-120px;top:-140px;border-radius:50%;background:rgba(255,255,255,.055)}
    .trk-project{position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}
    .trk-code{display:inline-flex;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.12);color:#d1fae5;font-size:11px;font-weight:800;letter-spacing:.04em}
    .trk-project h2{margin:9px 0 4px;color:#fff;font-size:27px;line-height:1.1}
    .trk-project p{margin:0;color:rgba(255,255,255,.68);font-size:13px}
    .trk-stage-grid{position:relative;z-index:1;display:grid;grid-template-columns:repeat(4,minmax(145px,1fr));gap:11px}
    .trk-stage{display:flex;align-items:center;gap:12px;min-width:0;padding:13px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.07);color:#fff;text-align:left;cursor:pointer;transition:transform .15s,border-color .15s,background .15s}
    .trk-stage:hover{transform:translateY(-2px);background:rgba(255,255,255,.11)}
    .trk-stage.active{border-color:rgba(255,255,255,.48);background:rgba(255,255,255,.16);box-shadow:0 8px 20px rgba(0,0,0,.13)}
    .trk-donut{--value:0;--ring:#14b8a6;position:relative;display:grid;place-items:center;flex:0 0 66px;width:66px;height:66px;border-radius:50%;background:conic-gradient(var(--ring) calc(var(--value)*1%),rgba(255,255,255,.14) 0)}
    .trk-donut::after{content:'';position:absolute;inset:7px;border-radius:50%;background:#153536}
    .trk-donut strong{position:relative;z-index:1;color:#fff;font-size:15px}
    .trk-stage-blue .trk-donut{--ring:#60a5fa}.trk-stage-violet .trk-donut{--ring:#c084fc}.trk-stage-amber .trk-donut{--ring:#fbbf24}.trk-stage-green .trk-donut{--ring:#34d399}
    .trk-stage-copy{min-width:0}.trk-stage-copy strong{display:block;color:#fff;font-size:13px}.trk-stage-copy span{display:block;margin-top:5px;color:rgba(255,255,255,.64);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .trk-panel{display:grid;gap:14px}
    .trk-panel-head{display:flex;align-items:end;justify-content:space-between;gap:16px}
    .trk-panel-head h3{margin:0;color:#0f172a;font-size:21px}.trk-panel-head p{margin:5px 0 0;color:#64748b;font-size:12px}
    .trk-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .trk-metric{padding:16px;background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 5px 16px rgba(15,23,42,.035)}
    .trk-metric span{display:block;color:#64748b;font-size:11px;font-weight:700}.trk-metric strong{display:block;margin-top:7px;color:#0f172a;font-size:21px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.trk-metric small{display:block;margin-top:5px;color:#94a3b8;font-size:10px}
    .trk-progress-card{padding:15px 16px;background:#fff;border:1px solid var(--border);border-radius:16px}
    .trk-progress-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px;color:#475569;font-size:11px;font-weight:700}.trk-progress-head strong{color:#0f172a;font-size:14px}
    .trk-progress{height:9px;border-radius:999px;background:#e8eef3;overflow:hidden}.trk-progress i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#0f766e,#14b8a6)}
    .trk-categories{display:flex;gap:10px;overflow:auto;padding:1px 1px 5px;scrollbar-width:thin}.trk-category{flex:0 0 190px;padding:13px 14px;background:#fff;border:1px solid var(--border);border-radius:14px}.trk-category div{display:flex;justify-content:space-between;gap:8px}.trk-category span{min-width:0;color:#334155;font-size:11px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.trk-category strong{color:#0f766e;font-size:11px}.trk-category small{display:block;margin-top:7px;color:#64748b;font-size:10px}
    .trk-table-card{background:#fff;border:1px solid var(--border);border-radius:18px;overflow:hidden;box-shadow:0 5px 16px rgba(15,23,42,.035)}
    .trk-toolbar{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border)}
    .trk-search{position:relative;flex:1;max-width:560px}.trk-search svg{position:absolute;left:14px;top:50%;width:17px;height:17px;transform:translateY(-50%);stroke:#64748b;pointer-events:none}.trk-search input{width:100%;height:42px;padding:0 14px 0 41px;border:1px solid #d8e0e8;border-radius:12px;background:#f8fafc;font:inherit;color:#0f172a;outline:none}.trk-search input:focus{background:#fff;border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.11)}
    .trk-count{margin-left:auto;color:#64748b;font-size:12px;font-weight:700;white-space:nowrap}.trk-table-wrap{overflow:auto}.trk-table{width:100%;border-collapse:collapse}.trk-table th{padding:12px 14px;background:#f8fafc;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.045em;text-align:left;white-space:nowrap;border-bottom:1px solid var(--border)}.trk-table td{padding:13px 14px;border-bottom:1px solid #edf1f4;vertical-align:middle;color:#334155;font-size:12px}.trk-table tr:last-child td{border-bottom:0}.trk-table tr:hover td{background:#fbfdfd}
    .trk-main{display:block;max-width:360px;color:#0f172a;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.trk-sub{display:block;margin-top:4px;color:#64748b;font-size:10px}.trk-qty{white-space:nowrap;font-weight:800;color:#0f172a}
    .trk-pill{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}.trk-ok{background:#dcfce7;color:#166534}.trk-warn{background:#fff7ed;color:#c2410c}.trk-info{background:#e0f2fe;color:#075985}.trk-violet{background:#f3e8ff;color:#7e22ce}.trk-danger{background:#fee2e2;color:#b91c1c}
    .trk-empty{padding:34px;text-align:center;color:#64748b}.trk-empty strong{display:block;color:#0f172a;font-size:16px;margin-bottom:5px}
    @media(max-width:1100px){.trk-stage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.trk-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:680px){.trk-hero{padding:18px}.trk-project h2{font-size:22px}.trk-stage-grid{display:flex;overflow:auto;padding-bottom:3px}.trk-stage{flex:0 0 210px}.trk-summary{grid-template-columns:1fr 1fr}.trk-panel-head{align-items:flex-start;flex-direction:column}.trk-toolbar{align-items:stretch;flex-direction:column}.trk-count{margin-left:0}}
  `;
  document.head.appendChild(style);
}

function searchIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>';
}

function stageButton(key, meta) {
  return `<button type="button" class="trk-stage trk-stage-${meta.tone} ${activeStage === key ? 'active' : ''}" data-tracking-stage="${key}">
    <span class="trk-donut" style="--value:${meta.visual}"><strong>${meta.label === '0%' ? '0%' : meta.label}</strong></span>
    <span class="trk-stage-copy"><strong>${escapeHtml(meta.title)}</strong><span>${formatQty(meta.value)} de ${formatQty(meta.total)}</span></span>
  </button>`;
}

function stageTitle(key) {
  return ({
    comprado: ['Compras da obra', 'O que já teve compra registrada e o que ainda falta comprar.'],
    pintura: ['Materiais em pintura', 'O que está no pintor agora, o que já retornou e os prazos.'],
    disponivel: ['Conferidos e disponíveis', 'Estoque e compras recebidas que já podem ser separados.'],
    separado: ['Materiais separados', 'Quantidades separadas, datas e andamento por categoria.']
  })[key];
}

function metric(label, value, note = '') {
  return `<article class="trk-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</article>`;
}

function materialCell(material) {
  const identity = materialIdentity(material);
  return `<span class="trk-main" title="${escapeHtml(identity.description)}">${escapeHtml(identity.description)}</span><span class="trk-sub">${escapeHtml(identity.sub)}</span>`;
}

function statusPill(label, tone = 'info') {
  return `<span class="trk-pill trk-${tone}">${escapeHtml(label)}</span>`;
}

function dateWithAlert(value, overdue) {
  if (!value) return '—';
  return `${formatDate(value)}${overdue ? '<span class="trk-sub" style="color:#b91c1c">prazo vencido</span>' : ''}`;
}

function purchaseRows(items) {
  return items
    .filter(material => allocation(material).purchaseQty > 0)
    .sort((a, b) => Number(purchaseCommitted(a)) - Number(purchaseCommitted(b)) || String(a.deliveryEta || '9999').localeCompare(String(b.deliveryEta || '9999')))
    .map(material => {
      const alloc = allocation(material);
      const committed = purchaseCommitted(material);
      const overdue = committed && quantityNumber(material, material.qtyReceived) < alloc.purchaseQty && isPast(material.deliveryEta);
      const search = normalize([material.code, material.description, material.category, material.supplier, material.orderNumber, material.deliveryEta].filter(Boolean).join(' '));
      return `<tr data-tracking-row data-search="${escapeHtml(search)}">
        <td>${materialCell(material)}</td><td>${escapeHtml(material.category || 'Sem categoria')}</td>
        <td class="trk-qty">${formatQty(quantityNumber(alloc, alloc.purchaseQty))} ${escapeHtml(material.unit || 'un')}</td>
        <td>${committed ? statusPill('Compra registrada', overdue ? 'danger' : 'ok') : statusPill('Falta comprar', 'warn')}</td>
        <td>${escapeHtml(material.supplier || '—')}<span class="trk-sub">${escapeHtml(material.orderNumber || '')}</span></td>
        <td>${formatDate(material.purchaseDate)}</td><td>${dateWithAlert(material.deliveryEta, overdue)}</td>
      </tr>`;
    }).join('');
}

function paintingRows(items) {
  return items
    .filter(material => material.paintingRequired)
    .sort((a, b) => {
      const aCurrent = Math.max(0, quantityNumber(a, a.paintingSentQty) - quantityNumber(a, a.paintingReturnedQty));
      const bCurrent = Math.max(0, quantityNumber(b, b.paintingSentQty) - quantityNumber(b, b.paintingReturnedQty));
      return Number(bCurrent > 0) - Number(aCurrent > 0) || String(a.paintingEta || '9999').localeCompare(String(b.paintingEta || '9999'));
    })
    .map(material => {
      const sent = quantityNumber(material, material.paintingSentQty);
      const returned = quantityNumber(material, material.paintingReturnedQty);
      const current = Math.max(0, sent - returned);
      const overdue = current > 0 && isPast(material.paintingEta);
      const status = current > 0 ? (overdue ? statusPill('Pintura atrasada', 'danger') : statusPill('Em pintura', 'violet'))
        : returned > 0 ? statusPill('Retornado', 'ok') : statusPill('Aguardando envio', 'warn');
      const search = normalize([material.code, material.description, material.category, material.paintingSupplier, material.paintingEta].filter(Boolean).join(' '));
      return `<tr data-tracking-row data-search="${escapeHtml(search)}">
        <td>${materialCell(material)}</td><td>${escapeHtml(material.category || 'Sem categoria')}</td>
        <td class="trk-qty">${formatQty(sent)} ${escapeHtml(material.unit || 'un')}</td>
        <td class="trk-qty">${formatQty(current)} ${escapeHtml(material.unit || 'un')}</td>
        <td class="trk-qty">${formatQty(returned)} ${escapeHtml(material.unit || 'un')}</td>
        <td>${escapeHtml(material.paintingSupplier || '—')}</td><td>${dateWithAlert(material.paintingEta, overdue)}</td><td>${status}</td>
      </tr>`;
    }).join('');
}

function availableRows(items) {
  return items
    .map(material => {
      const alloc = allocation(material);
      const received = receivedPurchaseQty(material);
      const separated = quantityNumber(material, material.separatedQty);
      const paintSent = quantityNumber(material, material.paintingSentQty);
      const paintReturned = quantityNumber(material, material.paintingReturnedQty);
      const currentAwayAtPainting = Math.max(0, paintSent - paintReturned);
      const ready = Math.max(0, availableQty(material) - currentAwayAtPainting);
      return { material, alloc, received, ready };
    })
    .filter(row => row.ready > 0)
    .sort((a, b) => String(a.material.category || '').localeCompare(String(b.material.category || ''), 'pt-BR') || String(a.material.description || '').localeCompare(String(b.material.description || ''), 'pt-BR'))
    .map(({ material, alloc, received, ready }) => {
      const origin = alloc.source === 'misto' ? 'Compra + estoque' : alloc.source === 'estoque' ? 'Estoque' : 'Compra';
      const search = normalize([material.code, material.description, material.category, material.color, measureText(material), origin, material.receivedDate].filter(Boolean).join(' '));
      return `<tr data-tracking-row data-search="${escapeHtml(search)}">
        <td>${materialCell(material)}</td><td>${escapeHtml(material.category || 'Sem categoria')}</td>
        <td>${statusPill(origin, alloc.source === 'estoque' ? 'violet' : alloc.source === 'misto' ? 'warn' : 'info')}</td>
        <td class="trk-qty">${formatQty(quantityNumber(alloc, alloc.stockQty))} ${escapeHtml(material.unit || 'un')}</td>
        <td class="trk-qty">${formatQty(received)} ${escapeHtml(material.unit || 'un')}</td>
        <td class="trk-qty">${formatQty(ready)} ${escapeHtml(material.unit || 'un')}</td>
        <td>${formatDate(receivedDate(material))}</td>
      </tr>`;
    }).join('');
}

function separatedRows(items) {
  return items
    .filter(material => quantityNumber(material, material.separatedQty) > 0)
    .sort((a, b) => String(b.separatedDate || '').localeCompare(String(a.separatedDate || '')) || String(a.description || '').localeCompare(String(b.description || ''), 'pt-BR'))
    .map(material => {
      const required = allocation(material).required;
      const separated = clamp(quantityNumber(material, material.separatedQty), 0, required || Number.MAX_SAFE_INTEGER);
      const complete = required > 0 && separated >= required;
      const identity = materialIdentity(material);
      const search = normalize([material.code, material.description, material.category, identity.measure, material.color, material.separatedDate].filter(Boolean).join(' '));
      return `<tr data-tracking-row data-search="${escapeHtml(search)}">
        <td>${materialCell(material)}</td><td>${escapeHtml(identity.category)}</td>
        <td><span class="trk-main">${escapeHtml(identity.measure)}</span>${identity.color ? `<span class="trk-sub">${escapeHtml(identity.color)}</span>` : ''}</td>
        <td class="trk-qty">${formatQty(separated)} / ${formatQty(required)} ${escapeHtml(material.unit || 'un')}</td>
        <td>${complete ? statusPill('Separação concluída', 'ok') : statusPill('Separação parcial', 'warn')}</td>
        <td>${formatDate(material.separatedDate)}</td>
      </tr>`;
    }).join('');
}

function tableConfig(key, items) {
  if (key === 'comprado') return {
    placeholder: 'Buscar código, material, fornecedor ou pedido',
    headers: ['Material', 'Categoria', 'Quantidade a comprar', 'Situação', 'Fornecedor / pedido', 'Data da compra', 'Prazo de recebimento'],
    rows: purchaseRows(items)
  };
  if (key === 'pintura') return {
    placeholder: 'Buscar material, categoria, pintor ou prazo',
    headers: ['Material', 'Categoria', 'Enviado', 'Em pintura', 'Retornado', 'Empresa', 'Previsão', 'Situação'],
    rows: paintingRows(items)
  };
  if (key === 'disponivel') return {
    placeholder: 'Buscar código, descrição, categoria, medida ou origem',
    headers: ['Material', 'Categoria', 'Origem', 'No estoque', 'Recebido da compra', 'Disponível não separado', 'Data de recebimento / retorno'],
    rows: availableRows(items)
  };
  return {
    placeholder: 'Buscar código, descrição, categoria, medida ou cor',
    headers: ['Material', 'Categoria', 'Medida / cor', 'Separado', 'Situação', 'Data da separação'],
    rows: separatedRows(items)
  };
}

function summaryHtml(key, data) {
  if (key === 'comprado') {
    return [
      metric('Itens que precisam de compra', String(data.purchaseItems)),
      metric('Itens comprados', String(data.purchasedItems)),
      metric('Itens que faltam comprar', String(data.missingPurchaseItems)),
      metric('Quantidade comprada', `${formatQty(quantityNumber(data, data.purchasedQty))} / ${formatQty(data.purchaseRequired)}`, data.nearestDeliveryEta ? `Próximo prazo: ${formatDate(data.nearestDeliveryEta)}` : 'Sem prazo registrado')
    ].join('');
  }
  if (key === 'pintura') {
    return [
      metric('Itens em pintura agora', String(data.paintingItems)),
      metric('Quantidade em pintura', formatQty(quantityNumber(data, data.inPaintingQty))),
      metric('Quantidade já retornada', formatQty(quantityNumber(data, data.paintingReturnedQty))),
      metric('Próximo retorno', formatDate(data.nearestPaintingEta), data.nearestPaintingEta && isPast(data.nearestPaintingEta) ? 'Prazo vencido' : '')
    ].join('');
  }
  if (key === 'disponivel') {
    return [
      metric('Itens disponíveis', String(data.readyItems)),
      metric('Quantidade não separada', formatQty(quantityNumber(data, data.readyQty))),
      metric('Quantidade de estoque', formatQty(quantityNumber(data, data.readyStockQty))),
      metric('Quantidade recebida da compra', formatQty(quantityNumber(data, data.readyReceivedQty)))
    ].join('');
  }
  return [
    metric('Itens com separação', String(data.separatedItems)),
    metric('Itens totalmente separados', String(data.completedSeparatedItems)),
    metric('Quantidade separada', `${formatQty(quantityNumber(data, data.separatedQty))} / ${formatQty(data.totalRequired)}`),
    metric('Última separação', formatDate(data.latestSeparatedDate))
  ].join('');
}

function categoryHtml(data) {
  if (activeStage !== 'separado' || !data.categoryList.length) return '';
  return `<section class="trk-categories">${data.categoryList.map(category => `
    <article class="trk-category" title="${escapeHtml(category.name)}">
      <div><span>${escapeHtml(category.name)}</span><strong>${category.pct.label}</strong></div>
      <small>${formatQty(category.separated)} de ${formatQty(category.required)} separados</small>
    </article>`).join('')}</section>`;
}

function progressHtml(meta) {
  return `<section class="trk-progress-card"><div class="trk-progress-head"><span>${escapeHtml(meta.title)}</span><strong>${meta.label === '0%' ? '0%' : meta.label} · ${formatQty(meta.value)} de ${formatQty(meta.total)}</strong></div><div class="trk-progress"><i style="width:${meta.visual}%"></i></div></section>`;
}

function bindSearch(root) {
  const input = $('#trackingSearch', root);
  const count = $('#trackingCount', root);
  const rows = $$('[data-tracking-row]', root);
  const empty = $('#trackingEmpty', root);
  const apply = () => {
    const query = normalize(input?.value || '');
    let visible = 0;
    rows.forEach(row => {
      const match = !query || row.dataset.search.includes(query);
      row.hidden = !match;
      if (match) visible += 1;
    });
    if (count) count.textContent = `${visible} item${visible === 1 ? '' : 's'}`;
    if (empty) empty.hidden = visible !== 0;
  };
  input?.addEventListener('input', apply);
  apply();
}

function renderDetail() {
  if (!projectId || !project || currentRoute() !== 'estoque') return;
  ensureStyle();
  const view = $('#view');
  if (!view) return;
  const data = stageData(materials);
  const title = stageTitle(activeStage);
  const table = tableConfig(activeStage, materials);
  const meta = data.stage[activeStage];

  $('#pageTitle').textContent = 'Acompanhamento';
  $('#pageSubtitle').textContent = 'Compras, pintura, conferência e separação por obra';

  view.innerHTML = `
    <div class="trk-shell">
      <div><button id="trackingBack" class="btn btn-ghost btn-sm trk-back" type="button">← Voltar para as obras</button></div>
      <section class="trk-hero">
        <div class="trk-project"><div><span class="trk-code">${escapeHtml(project.code || 'SEM CÓDIGO')}</span><h2>${escapeHtml(project.name || 'Obra sem nome')}</h2><p>${escapeHtml(project.client || project.address || 'Cliente não informado')}</p></div></div>
        <div class="trk-stage-grid">${STAGES.map(key => stageButton(key, data.stage[key])).join('')}</div>
      </section>
      <section class="trk-panel">
        <div class="trk-panel-head"><div><h3>${escapeHtml(title[0])}</h3><p>${escapeHtml(title[1])}</p></div></div>
        <section class="trk-summary">${summaryHtml(activeStage, data)}</section>
        ${progressHtml(meta)}
        ${categoryHtml(data)}
        <section class="trk-table-card">
          <div class="trk-toolbar"><label class="trk-search">${searchIcon()}<input id="trackingSearch" type="search" autocomplete="off" placeholder="${escapeHtml(table.placeholder)}" /></label><span id="trackingCount" class="trk-count">0 itens</span></div>
          <div class="trk-table-wrap"><table class="trk-table"><thead><tr>${table.headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${table.rows}<tr id="trackingEmpty" hidden><td colspan="${table.headers.length}"><div class="trk-empty"><strong>Nenhum item encontrado</strong>Ajuste a busca ou escolha outra etapa.</div></td></tr></tbody></table></div>
        </section>
      </section>
    </div>`;

  $$('[data-tracking-stage]', view).forEach(button => button.addEventListener('click', () => {
    activeStage = button.dataset.trackingStage;
    renderDetail();
  }));
  $('#trackingBack', view)?.addEventListener('click', () => {
    projectId = '';
    project = null;
    materials = [];
    activeStage = 'separado';
    window.ObraFlowSeparatedProjects?.reset?.();
  });
  bindSearch(view);
}

async function openProject(id) {
  if (!id || currentRoute() !== 'estoque') return;
  const version = ++loadVersion;
  projectId = id;
  activeStage = 'separado';
  try {
    const [projectSnapshot, materialsSnapshot] = await Promise.all([
      get(ref(db, `projects/${id}`)),
      get(ref(db, `materials/${id}`))
    ]);
    if (version !== loadVersion || currentRoute() !== 'estoque') return;
    project = projectSnapshot.val() || { id };
    materials = Object.values(materialsSnapshot.val() || {});
    renderDetail();
  } catch (error) {
    console.error('Falha ao carregar acompanhamento da obra:', error);
  }
}

document.addEventListener('click', event => {
  const card = event.target.closest?.('[data-separated-project]');
  if (card && currentRoute() === 'estoque') {
    const id = card.dataset.separatedProject;
    setTimeout(() => openProject(id), 0);
  }
}, true);

document.addEventListener('keydown', event => {
  const card = event.target.closest?.('[data-separated-project]');
  if (card && currentRoute() === 'estoque' && (event.key === 'Enter' || event.key === ' ')) {
    const id = card.dataset.separatedProject;
    setTimeout(() => openProject(id), 0);
  }
}, true);

window.addEventListener('hashchange', () => {
  if (currentRoute() !== 'estoque') {
    loadVersion += 1;
    projectId = '';
    project = null;
    materials = [];
    activeStage = 'separado';
  }
});
