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
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let projects = {};
let materialsByProject = {};
let selectedProjectId = '';
let stopProjects = null;
let stopMaterials = null;
let started = false;

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

function separationSummary(items = []) {
  const categories = new Map();
  let requiredQty = 0;
  let separatedQty = 0;
  let separatedItems = 0;
  let completedItems = 0;

  items.forEach(material => {
    const required = Math.max(0, number(material.qtyRequired));
    const separated = clamp(number(material.separatedQty), 0, required || Number.MAX_SAFE_INTEGER);
    const category = String(material.category || 'Sem categoria').trim() || 'Sem categoria';
    const current = categories.get(category) || { name: category, required: 0, separated: 0, items: 0, separatedItems: 0 };

    requiredQty += required;
    separatedQty += Math.min(separated, required || separated);
    if (separated > 0) separatedItems += 1;
    if (required > 0 && separated >= required) completedItems += 1;

    current.required += required;
    current.separated += Math.min(separated, required || separated);
    current.items += 1;
    if (separated > 0) current.separatedItems += 1;
    categories.set(category, current);
  });

  const categoryList = [...categories.values()]
    .map(category => ({
      ...category,
      percent: category.required ? clamp(Math.round((category.separated / category.required) * 100), 0, 100) : 0
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return {
    requiredQty,
    separatedQty,
    separatedItems,
    completedItems,
    totalItems: items.length,
    percent: requiredQty ? clamp(Math.round((separatedQty / requiredQty) * 100), 0, 100) : 0,
    categories: categoryList
  };
}

function statusForMaterial(material) {
  const required = Math.max(0, number(material.qtyRequired));
  const separated = number(material.separatedQty);
  const delivered = number(material.siteDeliveredQty);

  if (required > 0 && delivered >= required) return ['Enviado para obra', 'ok'];
  if (delivered > 0) return ['Envio parcial', 'warning'];
  if (required > 0 && separated >= required) return ['Separação concluída', 'success'];
  return ['Separação parcial', 'warning'];
}

function ensureStyle() {
  if ($('#separatedProjectsStyle')) return;
  const style = document.createElement('style');
  style.id = 'separatedProjectsStyle';
  style.textContent = `
    .separated-project-grid{grid-template-columns:repeat(auto-fit,minmax(340px,1fr));align-items:start}
    .separated-project-card{cursor:pointer;transition:transform .16s ease,box-shadow .16s ease}
    .separated-project-card:hover{transform:translateY(-2px);box-shadow:0 14px 32px rgba(15,23,42,.10)}
    .separated-project-card .progress{margin-top:16px}
    .separated-category-list{display:grid;gap:10px;margin-top:16px}
    .separated-category-row{display:grid;grid-template-columns:minmax(110px,1fr) minmax(110px,1.4fr) 48px;gap:10px;align-items:center;font-size:12px}
    .separated-category-name{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .separated-mini-progress{height:7px;border-radius:999px;background:var(--surface-3,#e8edf2);overflow:hidden}
    .separated-mini-progress>span{display:block;height:100%;border-radius:inherit;background:var(--primary,#0f766e)}
    .separated-category-percent{text-align:right;font-weight:800;color:var(--muted)}
    .separated-card-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:18px;padding-top:14px;border-top:1px solid var(--border)}
    .separated-detail-categories{grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:16px}
    .separated-category-card{padding:16px}
    .separated-category-card strong{display:block;font-size:22px;margin-top:6px}
    .separated-table .qty-track{min-width:120px}
    @media(max-width:720px){.separated-category-row{grid-template-columns:1fr 70px}.separated-mini-progress{grid-column:1/-1;grid-row:2}.separated-project-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function emptyState(icon, title, text) {
  return `<div class="card"><div class="empty"><div><div class="empty-icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div></div></div>`;
}

function projectCard(projectId, project) {
  const summary = separationSummary(projectMaterials(projectId));
  const categories = summary.categories.length
    ? summary.categories.map(category => `
        <div class="separated-category-row">
          <span class="separated-category-name" title="${escapeHtml(category.name)}">${escapeHtml(category.name)}</span>
          <div class="separated-mini-progress"><span style="width:${category.percent}%"></span></div>
          <span class="separated-category-percent">${category.percent}%</span>
        </div>`).join('')
    : '<p class="muted">Nenhuma categoria cadastrada.</p>';

  return `
    <article class="card separated-project-card" data-separated-project="${escapeHtml(projectId)}" tabindex="0" role="button" aria-label="Abrir materiais separados da obra ${escapeHtml(project.name || project.code || '')}">
      <div class="project-card-head">
        <div>
          <span class="project-code">${escapeHtml(project.code || 'SEM CÓDIGO')}</span>
          <h3>${escapeHtml(project.name || 'Obra sem nome')}</h3>
          <p>${escapeHtml(project.client || project.address || 'Cliente não informado')}</p>
        </div>
        <span class="status-pill status-${summary.percent >= 100 ? 'ok' : summary.separatedItems ? 'warning' : 'neutral'}">${summary.percent}% separado</span>
      </div>
      <div class="progress"><span style="width:${summary.percent}%"></span></div>
      <div class="progress-meta"><span>${formatQty(summary.separatedQty)} / ${formatQty(summary.requiredQty)}</span><span>${summary.separatedItems} de ${summary.totalItems} item(ns) iniciados</span></div>
      <div class="separated-category-list">${categories}</div>
      <div class="separated-card-footer">
        <span class="muted">${summary.completedItems} item(ns) totalmente separados</span>
        <span class="btn btn-ghost btn-sm">Abrir →</span>
      </div>
    </article>`;
}

function renderProjectList(view) {
  const projectEntries = Object.entries(projects)
    .sort(([, a], [, b]) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));

  view.innerHTML = `
    <div class="page-head">
      <div><h2>Separação por obra</h2><p>Cada card mostra o avanço total e o percentual separado em cada categoria.</p></div>
    </div>
    ${projectEntries.length
      ? `<section class="grid separated-project-grid">${projectEntries.map(([id, project]) => projectCard(id, project)).join('')}</section>`
      : emptyState('▣', 'Nenhuma obra cadastrada', 'Cadastre uma obra e seus materiais para acompanhar a separação.')}`;

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
}

function materialRow(material) {
  const required = Math.max(0, number(material.qtyRequired));
  const separated = clamp(number(material.separatedQty), 0, required || Number.MAX_SAFE_INTEGER);
  const delivered = clamp(number(material.siteDeliveredQty), 0, separated || Number.MAX_SAFE_INTEGER);
  const percent = required ? clamp(Math.round((separated / required) * 100), 0, 100) : 0;
  const [statusLabel, statusTone] = statusForMaterial(material);

  return `<tr>
    <td><span class="cell-main">${escapeHtml(material.description || 'Sem descrição')}</span><span class="cell-sub">${escapeHtml([material.code, material.type].filter(Boolean).join(' · ') || 'Sem código')}</span></td>
    <td>${escapeHtml(material.category || 'Sem categoria')}</td>
    <td><span class="cell-main">${escapeHtml(measureText(material))}</span>${material.color ? `<span class="cell-sub">${escapeHtml(material.color)}</span>` : ''}</td>
    <td class="qty-cell"><strong>${formatQty(separated)} / ${formatQty(required)} ${escapeHtml(material.unit || 'un')}</strong><div class="qty-track"><span style="width:${percent}%"></span></div>${delivered > 0 ? `<span class="cell-sub">${formatQty(delivered)} enviado(s) à obra</span>` : ''}</td>
    <td><span class="status-pill status-${statusTone}">${escapeHtml(statusLabel)}</span></td>
    <td class="nowrap">${formatDate(material.separatedDate)}</td>
  </tr>`;
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
    .filter(material => number(material.separatedQty) > 0)
    .sort((a, b) => {
      const category = String(a.category || '').localeCompare(String(b.category || ''), 'pt-BR');
      return category || String(a.description || '').localeCompare(String(b.description || ''), 'pt-BR');
    });
  const summary = separationSummary(allItems);
  const categoryCards = summary.categories.map(category => `
    <article class="card separated-category-card">
      <span class="muted">${escapeHtml(category.name)}</span>
      <strong>${category.percent}%</strong>
      <div class="progress"><span style="width:${category.percent}%"></span></div>
      <span class="cell-sub">${formatQty(category.separated)} / ${formatQty(category.required)} separados</span>
    </article>`).join('');

  view.innerHTML = `
    <div class="page-head">
      <div><button id="backSeparatedProjects" class="btn btn-ghost btn-sm" type="button">← Voltar para as obras</button><h2 style="margin-top:12px">${escapeHtml(project.name || 'Obra sem nome')}</h2><p>${escapeHtml(project.code || 'Sem código')} · ${summary.percent}% do material separado</p></div>
    </div>
    <section class="detail-hero">
      <div><span class="project-code">OBRA ${escapeHtml(project.code || '')}</span><h2>${escapeHtml(project.name || '')}</h2><p>${summary.separatedItems} item(ns) com separação registrada · ${summary.completedItems} concluído(s)</p></div>
      <div class="detail-score" style="--pct:${summary.percent}%"><span>${summary.percent}%</span></div>
    </section>
    ${categoryCards ? `<section class="grid separated-detail-categories">${categoryCards}</section>` : ''}
    ${separatedItems.length
      ? `<div class="table-wrap"><table class="data-table separated-table"><thead><tr><th>Material</th><th>Categoria</th><th>Medida / cor</th><th>Quantidade separada</th><th>Situação</th><th>Data</th></tr></thead><tbody>${separatedItems.map(materialRow).join('')}</tbody></table></div>`
      : emptyState('✓', 'Nenhum item separado nesta obra', 'Assim que uma separação parcial ou total for registrada, o item aparecerá aqui.')}`;

  $('#backSeparatedProjects', view)?.addEventListener('click', () => {
    selectedProjectId = '';
    render();
  });
}

function render() {
  if (currentRoute() !== 'estoque') return;
  ensureStyle();
  const view = $('#view');
  if (!view) return;

  const title = $('#pageTitle');
  const subtitle = $('#pageSubtitle');
  if (title) title.textContent = 'Materiais separados';
  if (subtitle) subtitle.textContent = 'Acompanhamento da separação por obra e categoria';

  if (selectedProjectId) renderProjectDetail(view, selectedProjectId);
  else renderProjectList(view);
}

function start() {
  if (started) return;
  started = true;
  stopProjects = onValue(ref(db, 'projects'), snapshot => {
    projects = snapshot.val() || {};
    if (selectedProjectId && !projects[selectedProjectId]) selectedProjectId = '';
    render();
  }, error => console.error('Falha ao carregar obras para a separação:', error));

  stopMaterials = onValue(ref(db, 'materials'), snapshot => {
    materialsByProject = snapshot.val() || {};
    render();
  }, error => console.error('Falha ao carregar materiais separados:', error));
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
    setTimeout(render, 80);
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
    projects = {};
    materialsByProject = {};
    selectedProjectId = '';
  }
});

render();
