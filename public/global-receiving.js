import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue, get, update, push, set } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  allocation,
  purchaseCommitted,
  receivedPurchaseQty,
  quantityNumber,
  clamp,
  deriveStatus,
  summaryForMaterials
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

let projects = {};
let materialsByProject = {};
let stopProjects = null;
let stopMaterials = null;
let active = false;
let renderQueued = false;
let filters = { search: '', supplier: 'todos', project: 'todos', status: 'todos' };

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
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return 'Sem data';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Sem data' : new Intl.DateTimeFormat('pt-BR').format(date);
}

function todayISO() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function deliveryStatus(date) {
  if (!date) return 'sem-data';
  const today = todayISO();
  if (date < today) return 'atrasado';
  if (date === today) return 'hoje';
  return 'programado';
}

function statusLabel(status) {
  return ({
    atrasado: 'Atrasado',
    hoje: 'Entrega hoje',
    programado: 'Programado',
    'sem-data': 'Sem previsão'
  })[status] || 'Programado';
}

function firstUseful(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
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
    .map(value => String(value).trim());

  return parts.length ? parts.join(' × ') : '';
}

function directToPainting(material = {}) {
  return Boolean(
    material.paintingRequired
    && allocation(material).purchaseQty > 0
    && material.purchaseDeliveryDestination === 'pintura'
  );
}

function pendingRows() {
  const rows = [];

  Object.entries(materialsByProject || {}).forEach(([projectId, collection]) => {
    const project = projects[projectId] || {};
    Object.entries(collection || {}).forEach(([materialId, material]) => {
      const alloc = allocation(material);
      if (!(alloc.purchaseQty > 0) || !purchaseCommitted(material)) return;

      const received = receivedPurchaseQty(material);
      if (received >= alloc.purchaseQty - 0.000001) return;

      const supplier = String(material.supplier || '').trim() || 'Fornecedor não informado';
      const projectName = project.name || project.code || 'Obra sem nome';
      const projectCode = project.code || '';
      const status = deliveryStatus(material.deliveryEta || '');

      rows.push({
        projectId,
        materialId,
        project,
        material: { ...material, id: material.id || materialId, projectId },
        supplier,
        projectName,
        projectCode,
        purchaseQty: alloc.purchaseQty,
        receivedQty: received,
        pendingQty: Math.max(0, alloc.purchaseQty - received),
        status,
        direct: directToPainting(material)
      });
    });
  });

  const weight = { atrasado: 0, hoje: 1, programado: 2, 'sem-data': 3 };
  return rows.sort((a, b) => {
    return weight[a.status] - weight[b.status]
      || String(a.material.deliveryEta || '9999-99-99').localeCompare(String(b.material.deliveryEta || '9999-99-99'))
      || a.supplier.localeCompare(b.supplier, 'pt-BR')
      || a.projectName.localeCompare(b.projectName, 'pt-BR')
      || String(a.material.description || '').localeCompare(String(b.material.description || ''), 'pt-BR');
  });
}

function filteredRows(allRows) {
  const search = normalize(filters.search);
  return allRows.filter(row => {
    const material = row.material;
    const haystack = normalize([
      row.supplier,
      row.projectName,
      row.projectCode,
      row.project.client,
      material.orderNumber,
      material.code,
      material.description,
      material.category,
      material.color,
      measureText(material)
    ].filter(Boolean).join(' '));

    return (!search || haystack.includes(search))
      && (filters.supplier === 'todos' || row.supplier === filters.supplier)
      && (filters.project === 'todos' || row.projectId === filters.project)
      && (filters.status === 'todos' || row.status === filters.status);
  });
}

function supplierOptions(rows) {
  return [...new Set(rows.map(row => row.supplier))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function projectOptions(rows) {
  const map = new Map();
  rows.forEach(row => {
    map.set(row.projectId, row.projectCode ? `${row.projectCode} - ${row.projectName}` : row.projectName);
  });
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
}

function toast(message, type = 'success') {
  const host = $('#toastHost');
  if (!host) return;
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  host.appendChild(element);
  setTimeout(() => element.remove(), 3600);
}

function ensureStyle() {
  if ($('#globalReceivingStyle')) return;
  const style = document.createElement('style');
  style.id = 'globalReceivingStyle';
  style.textContent = `
    .gr-shell{display:grid;gap:17px}
    .gr-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:22px 24px;border-radius:20px;background:linear-gradient(135deg,#0f172a,#164e63);color:#fff;box-shadow:0 14px 30px rgba(15,23,42,.13)}
    .gr-hero h2{margin:6px 0 5px;color:#fff;font-size:25px}.gr-hero p{margin:0;color:rgba(255,255,255,.68);font-size:13px}.gr-eyebrow{font-size:10px;font-weight:800;letter-spacing:.09em;color:#a5f3fc}
    .gr-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.gr-kpi{padding:16px;background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 5px 16px rgba(15,23,42,.035)}.gr-kpi span{display:block;color:#64748b;font-size:11px;font-weight:700}.gr-kpi strong{display:block;margin-top:6px;color:#0f172a;font-size:23px}.gr-kpi small{display:block;margin-top:4px;color:#94a3b8;font-size:10px}.gr-kpi.danger strong{color:#b91c1c}
    .gr-filters{display:grid;grid-template-columns:minmax(250px,1.5fr) repeat(3,minmax(170px,.7fr));gap:10px;padding:13px;background:#fff;border:1px solid var(--border);border-radius:16px}.gr-filters input,.gr-filters select{width:100%;height:42px;border:1px solid #d8e0e8;border-radius:11px;background:#f8fafc;padding:0 12px;font:inherit;color:#0f172a;outline:none}.gr-filters input:focus,.gr-filters select:focus{background:#fff;border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.1)}
    .gr-table-card{background:#fff;border:1px solid var(--border);border-radius:18px;overflow:hidden;box-shadow:0 5px 16px rgba(15,23,42,.035)}.gr-table-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 17px;border-bottom:1px solid var(--border)}.gr-table-head h3{margin:0;color:#0f172a;font-size:16px}.gr-table-head span{color:#64748b;font-size:11px;font-weight:700}.gr-table-wrap{overflow:auto}.gr-table{width:100%;min-width:1160px;border-collapse:collapse}.gr-table th{padding:12px 14px;background:#f8fafc;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.045em;text-align:left;white-space:nowrap;border-bottom:1px solid var(--border)}.gr-table td{padding:13px 14px;border-bottom:1px solid #edf1f4;vertical-align:middle;color:#334155;font-size:12px}.gr-table tr:last-child td{border-bottom:0}.gr-table tr:hover td{background:#fbfdfd}
    .gr-main{display:block;max-width:310px;color:#0f172a;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gr-sub{display:block;margin-top:4px;color:#64748b;font-size:10px}.gr-project{min-width:170px}.gr-qty{min-width:165px}.gr-qty strong{display:block;color:#0f172a;font-size:12px}.gr-track{height:5px;margin-top:7px;border-radius:999px;background:#e8eef3;overflow:hidden}.gr-track i{display:block;height:100%;border-radius:inherit;background:#0f766e}.gr-pill{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}.gr-atrasado{background:#fee2e2;color:#b91c1c}.gr-hoje{background:#cffafe;color:#155e75}.gr-programado{background:#dcfce7;color:#166534}.gr-sem-data{background:#f1f5f9;color:#475569}.gr-direct{display:block;margin-top:5px;color:#7e22ce;font-size:10px;font-weight:700}.gr-empty{padding:38px;text-align:center;color:#64748b}.gr-empty strong{display:block;margin-bottom:5px;color:#0f172a;font-size:16px}
    @media(max-width:1050px){.gr-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.gr-filters{grid-template-columns:1fr 1fr}}
    @media(max-width:650px){.gr-hero{align-items:flex-start;flex-direction:column}.gr-kpis,.gr-filters{grid-template-columns:1fr}.gr-table-head{align-items:flex-start;flex-direction:column}}
  `;
  document.head.appendChild(style);
}

function setTopbarMode(enabled) {
  const projectWrap = $('.project-select-wrap');
  if (!projectWrap) return;
  if (enabled) {
    if (!projectWrap.dataset.globalReceivingHidden) {
      projectWrap.dataset.globalReceivingHidden = '1';
      projectWrap.dataset.previousDisplay = projectWrap.style.display || '';
    }
    projectWrap.style.display = 'none';
  } else if (projectWrap.dataset.globalReceivingHidden) {
    projectWrap.style.display = projectWrap.dataset.previousDisplay || '';
    delete projectWrap.dataset.globalReceivingHidden;
    delete projectWrap.dataset.previousDisplay;
  }
}

function renderRow(row) {
  const material = row.material;
  const receivedPercent = row.purchaseQty > 0 ? clamp((row.receivedQty / row.purchaseQty) * 100, 0, 100) : 0;
  const projectLabel = row.projectCode ? `${row.projectCode} - ${row.projectName}` : row.projectName;
  const measure = measureText(material);

  return `<tr>
    <td class="gr-project"><span class="gr-main" title="${escapeHtml(projectLabel)}">${escapeHtml(projectLabel)}</span><span class="gr-sub">${escapeHtml(row.project.client || row.project.address || 'Cliente/local não informado')}</span></td>
    <td><span class="gr-main" title="${escapeHtml(material.description || 'Sem descrição')}">${escapeHtml(material.description || 'Sem descrição')}</span><span class="gr-sub">${escapeHtml([material.code, material.category, measure].filter(Boolean).join(' · ') || 'Sem código')}</span></td>
    <td><span class="gr-main">${escapeHtml(row.supplier)}</span><span class="gr-sub">${escapeHtml(material.orderNumber ? `Pedido ${material.orderNumber}` : 'Pedido não informado')}</span></td>
    <td class="gr-qty"><strong>${formatQty(row.receivedQty)} / ${formatQty(row.purchaseQty)} ${escapeHtml(material.unit || 'un')}</strong><div class="gr-track"><i style="width:${receivedPercent}%"></i></div><span class="gr-sub">Falta receber: ${formatQty(row.pendingQty)} ${escapeHtml(material.unit || 'un')}</span></td>
    <td>${formatDate(material.deliveryEta)}${row.direct ? '<span class="gr-direct">Entrega direta na pintura</span>' : ''}</td>
    <td><span class="gr-pill gr-${row.status}">${statusLabel(row.status)}</span></td>
    <td><button type="button" class="btn btn-secondary btn-sm" data-global-receive="${escapeHtml(row.projectId)}:${escapeHtml(row.materialId)}">${row.direct ? 'Confirmar na pintura' : 'Confirmar chegada'}</button></td>
  </tr>`;
}

function render() {
  renderQueued = false;
  if (!active || currentRoute() !== 'recebimento') return;

  ensureStyle();
  setTopbarMode(true);

  const view = $('#view');
  if (!view) return;

  const allRows = pendingRows();
  const rows = filteredRows(allRows);
  const suppliers = supplierOptions(allRows);
  const works = projectOptions(allRows);
  const overdue = allRows.filter(row => row.status === 'atrasado').length;
  const today = allRows.filter(row => row.status === 'hoje').length;
  const noDate = allRows.filter(row => row.status === 'sem-data').length;

  $('#pageTitle').textContent = 'Recebimento';
  $('#pageSubtitle').textContent = 'Entregas pendentes de todos os fornecedores e todas as obras';
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === 'recebimento'));

  view.innerHTML = `<div id="globalReceivingRoot" class="gr-shell">
    <section class="gr-hero"><div><span class="gr-eyebrow">VISÃO GLOBAL DE ENTREGAS</span><h2>Recebimentos de todas as obras</h2><p>Filtre por fornecedor e veja, em uma única fila, tudo o que ainda precisa chegar e para qual obra.</p></div></section>
    <section class="gr-kpis">
      <article class="gr-kpi"><span>Itens aguardando</span><strong>${allRows.length}</strong><small>em todas as obras</small></article>
      <article class="gr-kpi"><span>Fornecedores</span><strong>${suppliers.length}</strong><small>com entrega pendente</small></article>
      <article class="gr-kpi danger"><span>Atrasados</span><strong>${overdue}</strong><small>prazo já vencido</small></article>
      <article class="gr-kpi"><span>Hoje / sem data</span><strong>${today} / ${noDate}</strong><small>entregas de hoje e sem previsão</small></article>
    </section>
    <section class="gr-filters">
      <input id="globalReceivingSearch" type="search" autocomplete="off" placeholder="Buscar obra, material, fornecedor ou pedido" value="${escapeHtml(filters.search)}" />
      <select id="globalReceivingSupplier"><option value="todos">Todos os fornecedores</option>${suppliers.map(supplier => `<option value="${escapeHtml(supplier)}" ${filters.supplier === supplier ? 'selected' : ''}>${escapeHtml(supplier)}</option>`).join('')}</select>
      <select id="globalReceivingProject"><option value="todos">Todas as obras</option>${works.map(([id, label]) => `<option value="${escapeHtml(id)}" ${filters.project === id ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>
      <select id="globalReceivingStatus"><option value="todos">Todas as situações</option><option value="atrasado" ${filters.status === 'atrasado' ? 'selected' : ''}>Atrasados</option><option value="hoje" ${filters.status === 'hoje' ? 'selected' : ''}>Entrega hoje</option><option value="programado" ${filters.status === 'programado' ? 'selected' : ''}>Programados</option><option value="sem-data" ${filters.status === 'sem-data' ? 'selected' : ''}>Sem previsão</option></select>
    </section>
    <section class="gr-table-card">
      <header class="gr-table-head"><h3>Fila de recebimentos</h3><span>${rows.length} de ${allRows.length} item${allRows.length === 1 ? '' : 's'}</span></header>
      ${rows.length ? `<div class="gr-table-wrap"><table class="gr-table"><thead><tr><th>Obra</th><th>Material</th><th>Fornecedor / pedido</th><th>Quantidade recebida</th><th>Previsão</th><th>Situação</th><th>Ação</th></tr></thead><tbody>${rows.map(renderRow).join('')}</tbody></table></div>` : '<div class="gr-empty"><strong>Nenhum recebimento encontrado</strong>Ajuste os filtros ou registre novas compras com previsão de entrega.</div>'}
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
  $('#globalReceivingSearch', root)?.addEventListener('input', event => {
    filters.search = event.target.value;
    const position = event.target.selectionStart;
    queueRender();
    setTimeout(() => {
      const input = $('#globalReceivingSearch');
      input?.focus();
      input?.setSelectionRange(position, position);
    }, 0);
  });
  $('#globalReceivingSupplier', root)?.addEventListener('change', event => {
    filters.supplier = event.target.value;
    queueRender();
  });
  $('#globalReceivingProject', root)?.addEventListener('change', event => {
    filters.project = event.target.value;
    queueRender();
  });
  $('#globalReceivingStatus', root)?.addEventListener('change', event => {
    filters.status = event.target.value;
    queueRender();
  });
  $$('[data-global-receive]', root).forEach(button => button.addEventListener('click', () => {
    const separator = button.dataset.globalReceive.indexOf(':');
    const projectId = button.dataset.globalReceive.slice(0, separator);
    const materialId = button.dataset.globalReceive.slice(separator + 1);
    const material = materialsByProject[projectId]?.[materialId];
    if (!material) return;
    if (directToPainting(material)) openDirectModal(projectId, materialId, material);
    else openReceiveModal(projectId, materialId, material);
  }));
}

function closeModal() {
  const root = $('#modalRoot');
  if (root) root.innerHTML = '';
}

async function recalculateProject(projectId) {
  const snapshot = await get(ref(db, `materials/${projectId}`));
  await set(ref(db, `projectSummaries/${projectId}`), summaryForMaterials(snapshot.val() || {}));
}

function bindModalClose(root) {
  $$('[data-global-receive-close]', root).forEach(button => button.addEventListener('click', closeModal));
  $('[data-global-receive-backdrop]', root)?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeModal();
  });
}

function openReceiveModal(projectId, materialId, material) {
  const alloc = allocation(material);
  const previous = receivedPurchaseQty(material);
  const project = projects[projectId] || {};
  const root = $('#modalRoot');
  if (!root) return;

  root.innerHTML = `<div class="modal-backdrop" data-global-receive-backdrop><section class="modal modal-sm" role="dialog" aria-modal="true" aria-label="Confirmar recebimento">
    <header class="modal-head"><div><h2>Confirmar chegada</h2><p>${escapeHtml(project.name || project.code || 'Obra')} · ${escapeHtml(material.description || 'Material')}</p></div><button type="button" class="icon-btn modal-close" data-global-receive-close>×</button></header>
    <div class="modal-body"><form id="globalReceiveForm" class="form-grid">
      <label class="field"><span>Quantidade total recebida</span><input name="qtyReceived" type="number" step="0.001" min="${previous}" max="${alloc.purchaseQty}" value="${Math.max(previous, alloc.purchaseQty)}" required /></label>
      <label class="field"><span>Data do recebimento</span><input name="receivedDate" type="date" value="${escapeHtml(material.receivedDate || todayISO())}" required /></label>
      <label class="field full"><span>Observação / divergência</span><textarea name="receiptNotes">${escapeHtml(material.receiptNotes || '')}</textarea></label>
    </form></div>
    <footer class="modal-foot"><button type="button" class="btn btn-ghost" data-global-receive-close>Cancelar</button><button id="saveGlobalReceive" type="button" class="btn btn-primary">Confirmar chegada</button></footer>
  </section></div>`;

  bindModalClose(root);
  $('#saveGlobalReceive', root)?.addEventListener('click', async event => {
    const form = $('#globalReceiveForm', root);
    if (!form?.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const quantity = quantityNumber(material, data.qtyReceived);

    if (quantity < previous - 0.000001) {
      toast(`A quantidade total não pode diminuir. O valor atual é ${formatQty(previous)} ${material.unit || 'un'}.`, 'error');
      return;
    }
    if (quantity > alloc.purchaseQty + 0.000001) {
      toast(`A quantidade recebida não pode ultrapassar ${formatQty(alloc.purchaseQty)} ${material.unit || 'un'}.`, 'error');
      return;
    }

    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Salvando...';

    try {
      const timestamp = Date.now();
      const merged = {
        ...material,
        qtyReceived: quantity,
        receivedDate: data.receivedDate,
        receiptNotes: data.receiptNotes || ''
      };
      const base = `materials/${projectId}/${materialId}`;
      await update(ref(db), {
        [`${base}/qtyReceived`]: quantity,
        [`${base}/receivedDate`]: data.receivedDate,
        [`${base}/receiptNotes`]: data.receiptNotes || '',
        [`${base}/status`]: deriveStatus(merged),
        [`${base}/updatedAt`]: timestamp,
        [`${base}/updatedBy`]: auth.currentUser?.uid || ''
      });

      const activity = push(ref(db, `activities/${projectId}`));
      await set(activity, {
        type: 'receive',
        message: `Recebimento atualizado: ${material.description || 'Material'} · ${formatQty(quantity)} ${material.unit || 'un'}`,
        materialId,
        userId: auth.currentUser?.uid || '',
        userName: auth.currentUser?.email || 'Usuário',
        createdAt: timestamp
      });
      await recalculateProject(projectId);
      closeModal();
      toast('Recebimento atualizado.');
    } catch (error) {
      console.error('Falha ao confirmar recebimento global:', error);
      toast(error?.message || 'Não foi possível confirmar o recebimento.', 'error');
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  });
}

function openDirectModal(projectId, materialId, material) {
  const alloc = allocation(material);
  const previousDirect = clamp(quantityNumber(material, material.directPaintingDeliveredQty), 0, alloc.purchaseQty);
  const project = projects[projectId] || {};
  const root = $('#modalRoot');
  if (!root) return;

  root.innerHTML = `<div class="modal-backdrop" data-global-receive-backdrop><section class="modal modal-sm" role="dialog" aria-modal="true" aria-label="Confirmar entrega direta na pintura">
    <header class="modal-head"><div><h2>Confirmar entrega na pintura</h2><p>${escapeHtml(project.name || project.code || 'Obra')} · ${escapeHtml(material.description || 'Material')}</p></div><button type="button" class="icon-btn modal-close" data-global-receive-close>×</button></header>
    <div class="modal-body"><form id="globalDirectReceiveForm" class="form-grid">
      <label class="field"><span>Quantidade total entregue na pintura</span><input name="directPaintingDeliveredQty" type="number" step="0.001" min="${previousDirect}" max="${alloc.purchaseQty}" value="${Math.max(previousDirect, alloc.purchaseQty)}" required /></label>
      <label class="field"><span>Data da entrega</span><input name="directPaintingDeliveredDate" type="date" value="${escapeHtml(material.directPaintingDeliveredDate || todayISO())}" required /></label>
      <label class="field"><span>Empresa de pintura</span><input name="paintingSupplier" value="${escapeHtml(material.paintingSupplier || '')}" required /></label>
      <label class="field"><span>Previsão de retorno</span><input name="paintingEta" type="date" value="${escapeHtml(material.paintingEta || '')}" required /></label>
      <label class="field full"><span>Observações da entrega</span><textarea name="directPaintingNotes">${escapeHtml(material.directPaintingNotes || '')}</textarea></label>
      <div class="import-note full">A entrega será registrada na obra correta e seguirá diretamente para a etapa de pintura.</div>
    </form></div>
    <footer class="modal-foot"><button type="button" class="btn btn-ghost" data-global-receive-close>Cancelar</button><button id="saveGlobalDirectReceive" type="button" class="btn btn-primary">Confirmar entrega</button></footer>
  </section></div>`;

  bindModalClose(root);
  $('#saveGlobalDirectReceive', root)?.addEventListener('click', async event => {
    const form = $('#globalDirectReceiveForm', root);
    if (!form?.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const quantity = quantityNumber(material, data.directPaintingDeliveredQty);

    if (quantity < previousDirect - 0.000001) {
      toast(`A quantidade total não pode diminuir. O valor atual é ${formatQty(previousDirect)} ${material.unit || 'un'}.`, 'error');
      return;
    }
    if (quantity > alloc.purchaseQty + 0.000001) {
      toast(`A entrega direta não pode ultrapassar ${formatQty(alloc.purchaseQty)} ${material.unit || 'un'}.`, 'error');
      return;
    }

    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Salvando...';

    try {
      const internalPaintingSent = Math.max(0, quantityNumber(material, material.paintingSentQty) - previousDirect);
      const paintingSentQty = clamp(internalPaintingSent + quantity, 0, alloc.required);
      const merged = {
        ...material,
        purchaseDeliveryDestination: 'pintura',
        directPaintingDeliveredQty: quantity,
        directPaintingDeliveredDate: data.directPaintingDeliveredDate,
        directPaintingNotes: data.directPaintingNotes || '',
        paintingSupplier: data.paintingSupplier,
        paintingEta: data.paintingEta,
        qtyReceived: quantity,
        paintingSentQty
      };
      const timestamp = Date.now();
      const base = `materials/${projectId}/${materialId}`;
      await update(ref(db), {
        [`${base}/purchaseDeliveryDestination`]: 'pintura',
        [`${base}/directPaintingDeliveredQty`]: quantity,
        [`${base}/directPaintingDeliveredDate`]: data.directPaintingDeliveredDate,
        [`${base}/directPaintingNotes`]: data.directPaintingNotes || '',
        [`${base}/paintingSupplier`]: data.paintingSupplier,
        [`${base}/paintingEta`]: data.paintingEta,
        [`${base}/qtyReceived`]: quantity,
        [`${base}/paintingSentQty`]: paintingSentQty,
        [`${base}/status`]: deriveStatus(merged),
        [`${base}/updatedAt`]: timestamp,
        [`${base}/updatedBy`]: auth.currentUser?.uid || ''
      });

      const activity = push(ref(db, `activities/${projectId}`));
      await set(activity, {
        type: 'entrega_direta_pintura',
        message: `Entrega direta na pintura registrada: ${material.description || 'Material'} · ${formatQty(quantity)} ${material.unit || 'un'}`,
        materialId,
        userId: auth.currentUser?.uid || '',
        userName: auth.currentUser?.email || 'Usuário',
        createdAt: timestamp
      });
      await recalculateProject(projectId);
      closeModal();
      toast('Entrega direta na pintura registrada.');
    } catch (error) {
      console.error('Falha ao confirmar entrega direta global:', error);
      toast(error?.message || 'Não foi possível registrar a entrega direta.', 'error');
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  });
}

function activate() {
  active = currentRoute() === 'recebimento';
  if (active) queueRender();
  else {
    setTopbarMode(false);
    closeModal();
  }
}

onAuthStateChanged(auth, user => {
  stopProjects?.();
  stopMaterials?.();
  stopProjects = null;
  stopMaterials = null;
  projects = {};
  materialsByProject = {};

  if (!user) {
    active = false;
    setTopbarMode(false);
    closeModal();
    return;
  }

  stopProjects = onValue(ref(db, 'projects'), snapshot => {
    projects = snapshot.val() || {};
    queueRender();
  }, error => console.error('Falha ao carregar obras do recebimento global:', error));

  stopMaterials = onValue(ref(db, 'materials'), snapshot => {
    materialsByProject = snapshot.val() || {};
    queueRender();
  }, error => console.error('Falha ao carregar materiais do recebimento global:', error));

  activate();
});

document.addEventListener('click', event => {
  const routeButton = event.target.closest?.('[data-route]');
  if (!routeButton) return;
  setTimeout(activate, 50);
  setTimeout(activate, 220);
}, true);

window.addEventListener('hashchange', activate);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeModal();
});

const view = $('#view');
if (view) {
  new MutationObserver(() => {
    if (active && currentRoute() === 'recebimento' && !$('#globalReceivingRoot')) queueRender();
  }).observe(view, { childList: true });
}

activate();
