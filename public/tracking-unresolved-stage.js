import { getApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { allocation } from './material-flow.js?v=20260803-1648';

function database() {
  return getDatabase(getApp());
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let projectId = '';
let materials = [];
let requestVersion = 0;
let patchQueued = false;
let unresolvedOpen = false;
let lastRenderSignature = '';

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

function firstUseful(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function measureText(material = {}) {
  const explicit = firstUseful(material.dimensions, material.medidas, material.measurements);
  if (explicit) return String(explicit).trim();
  const details = material.sourceDetails || {};
  const values = [
    firstUseful(material.width, material.largura, details.LARGURA, details.L),
    firstUseful(material.height, material.altura, details.ALTURA, details.A, details.H),
    firstUseful(material.length, material.comprimento, material.medida, details.COMPRIMENTO, details.MEDIDA)
  ].filter(value => value !== undefined && value !== null && String(value).trim() !== '');
  if (values.length) return values.join(' × ');
  const area = firstUseful(material.area, material.areaM2, material.m2, details.AREA, details.M2_COMPRA, details.M2_CORTE);
  return area !== undefined && area !== null && String(area).trim() !== '' ? `${area} m²` : '—';
}

function unresolvedRows() {
  return materials
    .map(material => ({ material, alloc: allocation(material) }))
    .filter(({ alloc }) => alloc.unallocatedQty > 0)
    .sort((a, b) => {
      const category = String(a.material.category || '').localeCompare(String(b.material.category || ''), 'pt-BR');
      return category || String(a.material.description || '').localeCompare(String(b.material.description || ''), 'pt-BR');
    });
}

function percentage(current, total) {
  if (!(total > 0)) return { visual: 0, label: '0%' };
  const exact = Math.min(100, Math.max(0, (current / total) * 100));
  return {
    visual: exact > 0 ? Math.max(1.2, exact) : 0,
    label: exact > 0 && exact < 1 ? '<1%' : `${Math.round(exact)}%`
  };
}

function ensureStyle() {
  if ($('#trackingUnresolvedStyle')) return;
  const style = document.createElement('style');
  style.id = 'trackingUnresolvedStyle';
  style.textContent = `
    .trk-stage-grid{grid-template-columns:repeat(5,minmax(135px,1fr))!important}
    .trk-stage-red .trk-donut{--ring:#fb7185}
    @media(max-width:1280px){.trk-stage-grid{grid-template-columns:repeat(3,minmax(145px,1fr))!important}}
    @media(max-width:900px){.trk-stage-grid{grid-template-columns:repeat(2,minmax(145px,1fr))!important}}
    @media(max-width:680px){.trk-stage-grid{display:flex!important;overflow:auto}.trk-stage{flex:0 0 210px}}
  `;
  document.head.appendChild(style);
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function injectButton() {
  ensureStyle();
  const grid = $('.trk-stage-grid');
  if (!grid || !projectId) return;

  const unresolved = unresolvedRows().length;
  const total = materials.length;
  const pct = percentage(unresolved, total);
  let button = $('[data-tracking-stage="nao-resolvido"]', grid);

  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'trk-stage trk-stage-red';
    button.dataset.trackingStage = 'nao-resolvido';
    button.innerHTML = '<span class="trk-donut"><strong>0%</strong></span><span class="trk-stage-copy"><strong>Não resolvido</strong><span>0 de 0 itens</span></span>';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      unresolvedOpen = true;
      lastRenderSignature = '';
      renderUnresolved();
    });
    grid.appendChild(button);
  }

  button.classList.toggle('active', unresolvedOpen);
  const donut = $('.trk-donut', button);
  if (donut && donut.style.getPropertyValue('--value') !== String(pct.visual)) {
    donut.style.setProperty('--value', String(pct.visual));
  }
  setText($('.trk-donut strong', button), pct.label);
  setText($('.trk-stage-copy span', button), `${unresolved} de ${total} itens`);
}

function metric(label, value, note = '') {
  return `<article class="trk-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</article>`;
}

function searchIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>';
}

function tableRows(rows) {
  return rows.map(({ material, alloc }) => {
    const measure = measureText(material);
    const color = material.color || '';
    const description = material.description || 'Sem descrição';
    const sub = [material.code, material.type].filter(Boolean).join(' · ') || 'Sem código';
    const search = normalize([
      material.code, material.description, material.category, material.type,
      measure, color, 'definir compra estoque', 'nao resolvido'
    ].filter(Boolean).join(' '));

    return `<tr data-unresolved-row data-search="${escapeHtml(search)}">
      <td><span class="trk-main" title="${escapeHtml(description)}">${escapeHtml(description)}</span><span class="trk-sub">${escapeHtml(sub)}</span></td>
      <td>${escapeHtml(material.category || 'Sem categoria')}</td>
      <td><span class="trk-main">${escapeHtml(measure)}</span>${color ? `<span class="trk-sub">${escapeHtml(color)}</span>` : ''}</td>
      <td class="trk-qty">${formatQty(alloc.required)} ${escapeHtml(material.unit || 'un')}</td>
      <td class="trk-qty">${formatQty(alloc.unallocatedQty)} ${escapeHtml(material.unit || 'un')}</td>
      <td><span class="trk-pill trk-danger">Definir compra/estoque</span></td>
    </tr>`;
  }).join('');
}

function bindSearch(panel) {
  const input = $('#unresolvedSearch', panel);
  const count = $('#unresolvedCount', panel);
  const rows = $$('[data-unresolved-row]', panel);
  const empty = $('#unresolvedEmpty', panel);
  const apply = () => {
    const query = normalize(input?.value || '');
    let visible = 0;
    rows.forEach(row => {
      const matches = !query || row.dataset.search.includes(query);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    setText(count, `${visible} item${visible === 1 ? '' : 's'}`);
    if (empty) empty.hidden = visible !== 0;
  };
  input?.addEventListener('input', apply);
  apply();
}

function renderUnresolved() {
  if (currentRoute() !== 'estoque' || !projectId) return;
  const panel = $('.trk-panel');
  if (!panel) return;

  const rows = unresolvedRows();
  const total = materials.length;
  const resolved = Math.max(0, total - rows.length);
  const pct = percentage(rows.length, total);
  const signature = `${projectId}|${total}|${rows.length}|${rows.map(row => row.material.id || row.material.code || row.material.description).join(',')}`;

  $$('[data-tracking-stage]').forEach(button => {
    button.classList.toggle('active', button.dataset.trackingStage === 'nao-resolvido');
  });

  if (lastRenderSignature === signature && panel.dataset.unresolvedStage === signature) {
    injectButton();
    return;
  }

  lastRenderSignature = signature;
  panel.dataset.unresolvedStage = signature;
  panel.innerHTML = `
    <div class="trk-panel-head"><div><h3>Itens não resolvidos</h3><p>Materiais que ainda estão em Definir compra/estoque e precisam ter o destino informado.</p></div></div>
    <section class="trk-summary">
      ${metric('Total de itens', `${total} itens`)}
      ${metric('Não resolvidos', `${rows.length} itens`, 'sem destino de compra ou estoque')}
      ${metric('Resolvidos', `${resolved} itens`)}
      ${metric('Percentual não resolvido', pct.label)}
    </section>
    <section class="trk-progress-card">
      <div class="trk-progress-head"><span>Não resolvido</span><strong>${pct.label} · ${rows.length} de ${total} itens</strong></div>
      <div class="trk-progress"><i style="width:${pct.visual}%;background:linear-gradient(90deg,#e11d48,#fb7185)"></i></div>
    </section>
    <section class="trk-table-card">
      <div class="trk-toolbar">
        <label class="trk-search">${searchIcon()}<input id="unresolvedSearch" type="search" autocomplete="off" placeholder="Buscar código, descrição, categoria, medida ou cor" /></label>
        <span id="unresolvedCount" class="trk-count">${rows.length} itens</span>
      </div>
      <div class="trk-table-wrap"><table class="trk-table">
        <thead><tr><th>Material</th><th>Categoria</th><th>Medida / cor</th><th>Necessário</th><th>Sem destino</th><th>Situação</th></tr></thead>
        <tbody>${tableRows(rows)}<tr id="unresolvedEmpty" hidden><td colspan="6"><div class="trk-empty"><strong>Nenhum item encontrado</strong>Ajuste a busca ou todos os materiais já foram resolvidos.</div></td></tr></tbody>
      </table></div>
    </section>`;

  bindSearch(panel);
  injectButton();
}

function patch() {
  patchQueued = false;
  if (currentRoute() !== 'estoque' || !projectId) return;
  injectButton();
  if (unresolvedOpen) renderUnresolved();
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(patch);
}

async function loadProject(id) {
  if (!id) return;
  const version = ++requestVersion;
  projectId = id;
  unresolvedOpen = false;
  lastRenderSignature = '';
  try {
    const snapshot = await get(ref(database(), `materials/${id}`));
    if (version !== requestVersion || currentRoute() !== 'estoque') return;
    materials = Object.values(snapshot.val() || {});
    queuePatch();
  } catch (error) {
    console.error('Falha ao carregar itens não resolvidos:', error);
  }
}

document.addEventListener('click', event => {
  const card = event.target.closest?.('[data-separated-project]');
  if (card && currentRoute() === 'estoque') {
    loadProject(card.dataset.separatedProject);
    return;
  }
  const stage = event.target.closest?.('[data-tracking-stage]');
  if (stage && stage.dataset.trackingStage !== 'nao-resolvido') {
    unresolvedOpen = false;
    lastRenderSignature = '';
    setTimeout(queuePatch, 0);
  }
}, true);

document.addEventListener('keydown', event => {
  const card = event.target.closest?.('[data-separated-project]');
  if (card && currentRoute() === 'estoque' && (event.key === 'Enter' || event.key === ' ')) {
    loadProject(card.dataset.separatedProject);
  }
}, true);

const view = $('#view');
if (view) {
  new MutationObserver(() => {
    if (currentRoute() === 'estoque' && projectId) queuePatch();
  }).observe(view, { childList: true, subtree: true });
}

window.addEventListener('hashchange', () => {
  if (currentRoute() !== 'estoque') {
    requestVersion += 1;
    projectId = '';
    materials = [];
    unresolvedOpen = false;
    lastRenderSignature = '';
  }
});