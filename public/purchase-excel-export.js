import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import { allocation, quantityNumber} from './material-flow.js?v=20260803-1648';

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

let injectTimer = null;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function currentProjectId() {
  return $('#globalProjectSelect')?.value || localStorage.getItem('obraflow.currentProject') || '';
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

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;
  let text = String(value).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstUseful(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function formatNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value)
      : '';
  }

  let text = String(value ?? '').trim().replace(/\s/g, '');
  if (!text) return '';
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(parsed)
    : '';
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
    .map(value => formatNumber(value) || String(value).trim());

  if (parts.length) return parts.join(' × ');

  const area = firstUseful(material.area, material.areaM2, material.m2, details.AREA, details.M2_COMPRA, details.M2_CORTE);
  if (area !== undefined && area !== null && String(area).trim() !== '') {
    return `${formatNumber(area) || String(area).trim()} m²`;
  }

  return '';
}

function safeText(value) {
  const text = String(value ?? '').trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function visibleMaterialIds() {
  const ids = [];
  const seen = new Set();

  $$('#view .data-table tbody tr').forEach(row => {
    if (row.hidden || row.classList.contains('obrafow-search-hidden')) return;
    if (getComputedStyle(row).display === 'none') return;

    const action = $('[data-material-id]', row);
    const materialId = action?.dataset.materialId;
    if (!materialId || seen.has(materialId)) return;
    seen.add(materialId);
    ids.push(materialId);
  });

  return ids;
}

function localDateStamp() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function filenamePart(value) {
  return String(value || 'Obra')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'Obra';
}

async function exportPurchaseList(button) {
  const projectId = currentProjectId();
  const materialIds = visibleMaterialIds();

  if (!projectId) {
    toast('Selecione uma obra antes de gerar a lista de compra.', 'error');
    return;
  }
  if (!materialIds.length) {
    toast('Não há itens visíveis na fila de compras para exportar.', 'error');
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Gerando Excel...';

  try {
    const snapshot = await get(ref(db, `materials/${projectId}`));
    const materials = snapshot.val() || {};
    const rows = materialIds
      .map(materialId => materials[materialId])
      .filter(Boolean)
      .map(material => {
        const purchaseQty = allocation(material).purchaseQty;
        return [
          safeText(material.code),
          safeText(material.description),
          safeText(measureText(material)),
          safeText(material.color),
          purchaseQty
        ];
      })
      .filter(row => number(row[4]) > 0);

    if (!rows.length) {
      toast('Nenhum item da fila possui quantidade de compra.', 'error');
      return;
    }

    const headers = ['Código', 'Descrição', 'Medida', 'Cor', 'Quantidade de compra'];
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    worksheet['!cols'] = [
      { wch: 18 },
      { wch: 48 },
      { wch: 28 },
      { wch: 22 },
      { wch: 22 }
    ];
    worksheet['!autofilter'] = { ref: `A1:E${rows.length + 1}` };

    for (let rowNumber = 2; rowNumber <= rows.length + 1; rowNumber += 1) {
      const quantityCell = worksheet[`E${rowNumber}`];
      if (quantityCell) quantityCell.z = '0.###';
    }

    const workbook = XLSX.utils.book_new();
    workbook.Props = {
      Title: 'Lista de Compra',
      Subject: 'Materiais pendentes de compra',
      Author: 'ObraFlow',
      CreatedDate: new Date()
    };
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Lista de Compra');

    const projectLabel = $('#globalProjectSelect option:checked')?.textContent || 'Obra';
    const fileName = `Lista_de_Compra_${filenamePart(projectLabel)}_${localDateStamp()}.xlsx`;
    XLSX.writeFile(workbook, fileName, { compression: true });
    toast(`Lista de compra gerada com ${rows.length} item(ns).`);
  } catch (error) {
    console.error('Falha ao gerar lista de compra:', error);
    toast('Não foi possível gerar a lista de compra em Excel.', 'error');
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function injectButton() {
  if (currentRoute() !== 'compras') return;
  const actions = $('#view .page-head .page-actions');
  if (!actions || $('#purchaseExcelExportBtn', actions)) return;

  const button = document.createElement('button');
  button.id = 'purchaseExcelExportBtn';
  button.type = 'button';
  button.className = 'btn btn-secondary';
  button.textContent = '⇩ Gerar lista de compra';
  button.title = 'Exportar os itens visíveis desta fila para Excel';
  button.addEventListener('click', () => exportPurchaseList(button));
  actions.prepend(button);
}

function scheduleInject(delay = 0) {
  clearTimeout(injectTimer);
  injectTimer = setTimeout(injectButton, delay);
}

const view = $('#view');
if (view) new MutationObserver(() => scheduleInject(0)).observe(view, { childList: true });

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="compras"]')) scheduleInject(100);
});

document.addEventListener('change', event => {
  if (event.target.matches?.('#globalProjectSelect, #statusFilter, #categoryFilter')) scheduleInject(80);
});

window.addEventListener('hashchange', () => scheduleInject(80));
scheduleInject(0);
