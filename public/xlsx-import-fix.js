import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase, ref, get, update, push, set
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';

const firebaseConfig = {
  apiKey: 'AIzaSyDtfxhvronefOV9MoDj-GvUUiJ3TLfb8qc',
  authDomain: 'sistemsquared.firebaseapp.com',
  databaseURL: 'https://sistemsquared-default-rtdb.firebaseio.com',
  projectId: 'sistemsquared',
  storageBucket: 'sistemsquared.firebasestorage.app',
  messagingSenderId: '43452051582',
  appId: '1:43452051582:web:08a19296448eb66d0b282f'
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);

const importState = {
  fileName: '',
  rows: [],
  sheetNames: [],
  processing: false
};

const IMPORT_SYNONYMS = {
  code: ['codigo', 'cod', 'perfil', 'item', 'referencia', 'produto referencia'],
  description: ['descricao', 'produto', 'modelo', 'linha extraida do pdf', 'descricao do vidro'],
  type: ['tipo', 'tipologia'],
  quantity: ['quantidade', 'qtde', 'qtd', 'qtde prev', 'qtde barras', 'qtde total'],
  unit: ['unidade', 'un'],
  color: ['cor', 'tratamento cor', 'acabamento'],
  width: ['largura', 'l'],
  height: ['altura', 'h', 'a'],
  length: ['comprimento', 'comp barra mm', 'medida'],
  area: ['area m2', 'area', 'm2 compra', 'm2 corte'],
  notes: ['observacoes', 'obs']
};

const STATUS_STAGE = {
  comprar: 0,
  reservar_estoque: 5,
  aguardando_entrega: 25,
  compra_atrasada: 25,
  recebido_parcial: 38,
  aguarda_pintura: 48,
  em_pintura: 60,
  pintura_atrasada: 60,
  pronto_separar: 74,
  separado_parcial: 80,
  separado: 90,
  enviado_parcial: 94,
  enviado_obra: 100
};

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;
  let text = String(value).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatQty(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(num(value));
}

function isPast(date) {
  return Boolean(date) && new Date(`${date}T23:59:59`).getTime() < Date.now();
}

function safeFirebaseKey(value, fallback = 'campo') {
  return String(value || fallback).replace(/[.#$\/\[\]]/g, '_').trim() || fallback;
}

function safeFirebaseObject(value) {
  if (Array.isArray(value)) return value.map(safeFirebaseObject);
  if (!value || typeof value !== 'object') return value;

  const output = {};
  Object.entries(value).forEach(([rawKey, child]) => {
    const base = safeFirebaseKey(rawKey);
    let key = base;
    let suffix = 2;
    while (Object.prototype.hasOwnProperty.call(output, key)) key = `${base}_${suffix++}`;
    output[key] = safeFirebaseObject(child);
  });
  return output;
}

function toast(message, type = 'success') {
  const host = $('#toastHost');
  if (!host) {
    alert(message);
    return;
  }
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  host.appendChild(element);
  setTimeout(() => element.remove(), 4200);
}

function detectHeaderRow(matrix) {
  let bestIndex = 0;
  let bestScore = -1;
  const knownTerms = Object.values(IMPORT_SYNONYMS).flat();

  matrix.slice(0, 25).forEach((row, index) => {
    const normalized = row.map(normalizeText);
    let score = normalized.reduce((total, cell) => (
      total + (knownTerms.some(term => cell === term || cell.includes(term)) ? 1 : 0)
    ), 0);
    if (normalized.some(cell => cell.includes('codigo'))) score += 2;
    if (normalized.some(cell => cell.includes('descricao'))) score += 2;
    if (normalized.some(cell => cell.includes('qtde') || cell.includes('quantidade'))) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function uniqueHeaders(row) {
  const used = {};
  return row.map((value, index) => {
    const base = String(value || `Coluna ${index + 1}`).trim();
    used[base] = (used[base] || 0) + 1;
    return used[base] > 1 ? `${base} (${used[base]})` : base;
  });
}

function suggestMapping(headers) {
  const mapping = {};
  headers.forEach((header, index) => {
    const normalized = normalizeText(header);
    Object.entries(IMPORT_SYNONYMS).some(([field, synonyms]) => {
      if (mapping[field] !== undefined) return false;
      if (synonyms.some(synonym => normalized === synonym || normalized.includes(synonym))) {
        mapping[field] = index;
        return true;
      }
      return false;
    });
  });
  if (mapping.description === undefined && mapping.code !== undefined) mapping.description = mapping.code;
  return mapping;
}

function normalizeSheetRows(workbook, sheetName, defaultSource, defaultPainting) {
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!matrix.length) return [];

  const headerRow = detectHeaderRow(matrix);
  const headers = uniqueHeaders(matrix[headerRow] || []);
  const mapping = suggestMapping(headers);
  const mappedIndexes = new Set(Object.values(mapping).map(Number));

  return matrix.slice(headerRow + 1).map((row, rowIndex) => {
    const getField = field => mapping[field] === undefined ? '' : row[mapping[field]];
    const code = String(getField('code') || '').trim();
    const description = String(getField('description') || code || '').trim();
    const quantity = num(getField('quantity')) || 1;
    const width = getField('width');
    const height = getField('height');
    const length = getField('length');
    const area = getField('area');
    const sourceDetails = {};

    row.forEach((value, index) => {
      if (mappedIndexes.has(index) || value === '' || value === null || !headers[index]) return;
      const base = safeFirebaseKey(headers[index], `Coluna_${index + 1}`);
      let key = base;
      let suffix = 2;
      while (Object.prototype.hasOwnProperty.call(sourceDetails, key)) key = `${base}_${suffix++}`;
      sourceDetails[key] = value;
    });

    return {
      code,
      description,
      type: String(getField('type') || '').trim(),
      category: sheetName,
      qtyRequired: quantity,
      unit: String(getField('unit') || 'un').trim() || 'un',
      color: String(getField('color') || '').trim(),
      dimensions: [
        width ? `L ${width}` : '',
        height ? `A ${height}` : '',
        length ? `C ${length}` : '',
        area ? `${area} m²` : ''
      ].filter(Boolean).join(' · '),
      notes: String(getField('notes') || '').trim(),
      sourceDetails,
      source: defaultSource,
      paintingRequired: defaultPainting,
      importSheet: sheetName,
      importRow: headerRow + rowIndex + 2
    };
  }).filter(row => {
    const text = normalizeText(`${row.code} ${row.description}`);
    if (!row.code && !row.description) return false;
    if (/resumo|observacoes gerais|total previsto|total quantidade|responsavel|orientacao|checklist de conferencia/.test(text)) return false;
    return row.qtyRequired > 0;
  });
}

function deriveStatus(material) {
  const required = Math.max(0, num(material.qtyRequired));
  const delivered = num(material.siteDeliveredQty);
  const separated = num(material.separatedQty);
  const received = num(material.qtyReceived);
  const reserved = num(material.stockReservedQty);
  const available = material.source === 'estoque' ? reserved : received;
  const paintSent = num(material.paintingSentQty);
  const paintReturned = num(material.paintingReturnedQty);

  if (required > 0 && delivered >= required) return 'enviado_obra';
  if (delivered > 0) return 'enviado_parcial';
  if (required > 0 && separated >= required) return 'separado';
  if (separated > 0) return 'separado_parcial';

  if (material.paintingRequired) {
    if (required > 0 && paintReturned >= required) return 'pronto_separar';
    if (paintReturned > 0 && paintReturned >= Math.min(required || paintSent, paintSent || required)) return 'pronto_separar';
    if (paintSent > 0) return isPast(material.paintingEta) ? 'pintura_atrasada' : 'em_pintura';
  }

  if (required > 0 && available >= required) return material.paintingRequired ? 'aguarda_pintura' : 'pronto_separar';
  if (available > 0) return 'recebido_parcial';
  if (material.source === 'estoque') return 'reservar_estoque';
  if (!material.purchaseDate && !material.orderNumber) return 'comprar';
  return isPast(material.deliveryEta) ? 'compra_atrasada' : 'aguardando_entrega';
}

async function recalculateSummary(projectId) {
  const snapshot = await get(ref(db, `materials/${projectId}`));
  const materials = Object.values(snapshot.val() || {});
  const summary = {
    total: materials.length,
    completed: 0,
    pending: 0,
    comprar: 0,
    aguardandoEntrega: 0,
    comprasAtrasadas: 0,
    pintura: 0,
    pinturaAtrasada: 0,
    separar: 0,
    separados: 0,
    enviados: 0,
    progress: 0,
    updatedAt: Date.now()
  };

  let progressTotal = 0;
  materials.forEach(material => {
    const status = deriveStatus(material);
    progressTotal += STATUS_STAGE[status] || 0;
    if (status === 'enviado_obra') {
      summary.completed += 1;
      summary.enviados += 1;
    } else summary.pending += 1;
    if (status === 'comprar' || status === 'reservar_estoque') summary.comprar += 1;
    if (['aguardando_entrega', 'recebido_parcial'].includes(status)) summary.aguardandoEntrega += 1;
    if (status === 'compra_atrasada') summary.comprasAtrasadas += 1;
    if (['aguarda_pintura', 'em_pintura'].includes(status)) summary.pintura += 1;
    if (status === 'pintura_atrasada') summary.pinturaAtrasada += 1;
    if (['pronto_separar', 'separado_parcial'].includes(status)) summary.separar += 1;
    if (status === 'separado') summary.separados += 1;
  });

  summary.progress = materials.length ? Math.round(progressTotal / materials.length) : 0;
  await set(ref(db, `projectSummaries/${projectId}`), summary);
}

function setProcessing(processing) {
  importState.processing = processing;
  const button = $('#xlsxFixedImportBtn');
  if (!button) return;
  button.disabled = processing;
  button.textContent = processing ? 'Importando...' : `Importar ${importState.rows.length} item(ns)`;
}

function renderPreview() {
  const preview = $('#importPreviewArea');
  if (!preview || !importState.rows.length) return;

  const categoryInput = $('#importCategory');
  if (categoryInput) {
    categoryInput.value = '';
    categoryInput.placeholder = 'Deixe vazio para usar o nome de cada aba';
    const label = categoryInput.closest('label')?.querySelector('span');
    if (label) label.textContent = 'Substituir categoria de todos (opcional)';
  }

  preview.innerHTML = `
    <div class="import-note" style="margin-bottom:14px">
      <strong>${importState.sheetNames.length} aba(s) encontrada(s).</strong>
      Cada aba está sendo usada como uma categoria separada.
    </div>
    <div class="table-wrap preview-table" style="margin-top:16px">
      <table class="data-table" style="min-width:1240px">
        <thead><tr><th>Categoria / aba</th><th>Código</th><th>Descrição</th><th>Tipo</th><th>Qtde</th><th>Un.</th><th>Cor</th><th>Medidas</th><th>Origem</th><th>Pintura</th></tr></thead>
        <tbody>${importState.rows.map((row, index) => `
          <tr>
            <td><strong>${escapeHtml(row.category)}</strong></td>
            <td>${escapeHtml(row.code)}</td>
            <td><span class="cell-main">${escapeHtml(row.description)}</span></td>
            <td>${escapeHtml(row.type)}</td>
            <td>${formatQty(row.qtyRequired)}</td>
            <td>${escapeHtml(row.unit)}</td>
            <td>${escapeHtml(row.color)}</td>
            <td>${escapeHtml(row.dimensions)}</td>
            <td><select data-xlsx-source="${index}" style="min-width:150px"><option value="compra" ${row.source === 'compra' ? 'selected' : ''}>Comprar</option><option value="estoque" ${row.source === 'estoque' ? 'selected' : ''}>Estoque</option></select></td>
            <td style="text-align:center"><input data-xlsx-painting="${index}" type="checkbox" ${row.paintingRequired ? 'checked' : ''} /></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:space-between;gap:12px;margin-top:16px">
      <button id="xlsxClearBtn" class="btn btn-ghost" type="button">Limpar arquivo</button>
      <button id="xlsxFixedImportBtn" class="btn btn-primary" type="button">Importar ${importState.rows.length} item(ns)</button>
    </div>`;

  $$('[data-xlsx-source]', preview).forEach(select => select.addEventListener('change', event => {
    const row = importState.rows[Number(event.target.dataset.xlsxSource)];
    if (row) row.source = event.target.value;
  }));

  $$('[data-xlsx-painting]', preview).forEach(input => input.addEventListener('change', event => {
    const row = importState.rows[Number(event.target.dataset.xlsxPainting)];
    if (row) row.paintingRequired = event.target.checked;
  }));

  $('#xlsxClearBtn')?.addEventListener('click', () => {
    importState.fileName = '';
    importState.rows = [];
    importState.sheetNames = [];
    location.reload();
  });

  $('#xlsxFixedImportBtn')?.addEventListener('click', importRows);
}

async function importRows() {
  if (importState.processing) return;
  const user = auth.currentUser;
  const projectId = $('#importProject')?.value;
  const categoryOverride = ($('#importCategory')?.value || '').trim();

  if (!user) {
    toast('Faça login novamente antes de importar.', 'error');
    return;
  }
  if (!projectId) {
    toast('Selecione a obra de destino.', 'error');
    return;
  }
  if (!importState.rows.length) {
    toast('Nenhum item válido foi encontrado na planilha.', 'error');
    return;
  }

  setProcessing(true);
  try {
    const updates = {};
    importState.rows.forEach(row => {
      const id = push(ref(db, `materials/${projectId}`)).key;
      const payload = {
        ...row,
        id,
        projectId,
        category: categoryOverride || row.category || 'Importado',
        sourceDetails: safeFirebaseObject(row.sourceDetails || {}),
        qtyReceived: 0,
        stockReservedQty: 0,
        paintingSentQty: 0,
        paintingReturnedQty: 0,
        separatedQty: 0,
        siteDeliveredQty: 0,
        importSource: importState.fileName,
        importType: 'xlsx',
        createdAt: Date.now(),
        createdBy: user.uid,
        updatedAt: Date.now(),
        updatedBy: user.uid
      };
      payload.status = deriveStatus(payload);
      updates[`materials/${projectId}/${id}`] = payload;
    });

    await update(ref(db), updates);
    const activity = push(ref(db, `activities/${projectId}`));
    await set(activity, {
      type: 'importacao',
      message: `${importState.rows.length} item(ns) importado(s) de ${importState.fileName}, separados por aba`,
      materialId: '',
      userId: user.uid,
      userName: user.email || 'Usuário',
      createdAt: Date.now()
    });
    await recalculateSummary(projectId);

    toast(`${importState.rows.length} item(ns) importado(s), com cada aba em sua categoria.`);
    importState.fileName = '';
    importState.rows = [];
    importState.sheetNames = [];
    location.hash = '#materiais';
    setTimeout(() => location.reload(), 600);
  } catch (error) {
    console.error(error);
    toast(error?.message || 'Não foi possível importar a planilha.', 'error');
    setProcessing(false);
  }
}

async function handleXlsxFile(file) {
  if (importState.processing) return;
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls'].includes(extension)) return;

  const preview = $('#importPreviewArea');
  if (preview) preview.innerHTML = '<p class="muted">Lendo todas as abas da planilha...</p>';

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const source = $('#importSource')?.value || 'compra';
    const painting = Boolean($('#importPainting')?.checked);

    importState.fileName = file.name;
    importState.sheetNames = [...workbook.SheetNames];
    importState.rows = workbook.SheetNames.flatMap(sheetName => (
      normalizeSheetRows(workbook, sheetName, source, painting)
    ));

    if (!importState.rows.length) throw new Error('Nenhuma linha válida foi encontrada nas abas da planilha.');
    renderPreview();
  } catch (error) {
    console.error(error);
    importState.fileName = '';
    importState.rows = [];
    importState.sheetNames = [];
    toast(`Não foi possível ler a planilha: ${error.message}`, 'error');
    if (preview) preview.innerHTML = '<div class="import-note">Não foi possível montar a prévia da planilha.</div>';
  }
}

function bindGeneralControls() {
  const source = $('#importSource');
  if (source && !source.dataset.xlsxFixBound) {
    source.dataset.xlsxFixBound = '1';
    source.addEventListener('change', event => {
      if (!importState.rows.length) return;
      event.stopImmediatePropagation();
      importState.rows.forEach(row => { row.source = event.target.value; });
      renderPreview();
    }, true);
  }

  const painting = $('#importPainting');
  if (painting && !painting.dataset.xlsxFixBound) {
    painting.dataset.xlsxFixBound = '1';
    painting.addEventListener('change', event => {
      if (!importState.rows.length) return;
      event.stopImmediatePropagation();
      importState.rows.forEach(row => { row.paintingRequired = event.target.checked; });
      renderPreview();
    }, true);
  }
}

function bindImporter() {
  const input = $('#importFile');
  if (input && !input.dataset.xlsxCategoryFixBound) {
    input.dataset.xlsxCategoryFixBound = '1';
    input.addEventListener('change', event => {
      const file = event.target.files?.[0];
      const extension = file?.name.split('.').pop().toLowerCase();
      if (!file || !['xlsx', 'xls'].includes(extension)) return;
      event.stopImmediatePropagation();
      handleXlsxFile(file);
    }, true);
  }

  bindGeneralControls();
  if (importState.rows.length && $('#importPreviewArea') && !$('#xlsxFixedImportBtn')) renderPreview();
}

const observer = new MutationObserver(() => queueMicrotask(bindImporter));
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(bindImporter, 0);
