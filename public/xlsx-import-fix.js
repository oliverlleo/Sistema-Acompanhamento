import { quantityNumber } from './material-flow.js?v=20260803-1648';
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
  sheetStats: [],
  ignoredRows: 0,
  processing: false
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

const HEADER_TERMS = new Set([
  'codigo', 'codigo do vidro', 'descricao', 'descricao do vidro', 'perfil',
  'produto referencia', 'linha extraida do pdf', 'tipo', 'tipologia',
  'qtde', 'qtde prev', 'quantidade', 'qtd', 'unidade', 'un', 'unit',
  'cor', 'tratamento cor', 'largura', 'altura', 'l', 'a', 'h', 'medida',
  'peso kg', 'area m2', 'm2 corte', 'm2 compra', 'custo', 'observacoes', 'obs'
]);

const STOP_ROW_PATTERNS = [
  /^resumo da conferencia\b/,
  /^observacoes gerais\b/,
  /^pendencias gerais\b/
];

const NOISE_PATTERNS = [
  /checklist de conferencia/,
  /^obra\b/,
  /^doc\b/,
  /^pdf\b/,
  /^orientacao\b/,
  /^total previsto\b/,
  /^total qtd\b/,
  /^total quantidade\b/,
  /^total m2\b/,
  /^linhas identificadas\b/,
  /^itens\b/,
  /^responsavel\b/,
  /^conferente\b/,
  /^responsavel da producao\b/
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

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

function quantityNum(value, unit = '') {
  if (value === null || value === undefined || value === '') return 0;
  const normalizedUnit = String(unit || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const decimalUnit = ['m', 'm2', 'm²', 'metro', 'metros', 'kg'].includes(normalizedUnit);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    if (decimalUnit && Number.isInteger(value) && Math.abs(value) >= 1000) return value / 1000;
    return value;
  }
  let text = String(value).trim().replace(/\s/g, '');
  if (!text) return 0;
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) text = text.replace(',', '.');
  else if (text.includes('.') && !decimalUnit && /^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}


function formatQty(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(num(value));
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
  setTimeout(() => element.remove(), 4500);
}

function rowValues(row) {
  return row.filter(value => value !== '' && value !== null && value !== undefined);
}

function isSeparator(value) {
  const text = String(value || '').trim();
  return Boolean(text) && /^[_\-=.\s]+$/.test(text);
}

function isStopRow(row) {
  const values = rowValues(row);
  if (!values.length) return false;
  const first = normalizeText(values[0]);
  return STOP_ROW_PATTERNS.some(pattern => pattern.test(first));
}

function isNoiseRow(row) {
  const values = rowValues(row);
  if (!values.length) return true;
  if (isSeparator(values[0])) return true;
  const first = normalizeText(values[0]);
  const joined = normalizeText(values.join(' '));
  if (NOISE_PATTERNS.some(pattern => pattern.test(first) || pattern.test(joined))) return true;
  return false;
}

function detectHeaderRow(matrix) {
  let bestIndex = -1;
  let bestScore = -1;

  matrix.slice(0, 30).forEach((row, index) => {
    const normalized = row.map(normalizeText).filter(Boolean);
    let score = normalized.reduce((total, cell) => total + (HEADER_TERMS.has(cell) ? 2 : 0), 0);
    if (normalized.includes('codigo') || normalized.includes('codigo do vidro')) score += 4;
    if (normalized.includes('descricao') || normalized.includes('descricao do vidro')) score += 4;
    if (normalized.includes('qtde') || normalized.includes('qtde prev') || normalized.includes('quantidade')) score += 4;
    if (normalized.includes('linha extraida do pdf')) score += 4;
    if (normalized.includes('perfil')) score += 3;
    if (normalized.includes('produto referencia')) score += 3;
    if (normalized.length >= 3) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore > 0 ? bestIndex : -1;
}

function uniqueHeaders(row) {
  const used = {};
  return row.map((value, index) => {
    const base = String(value || `Coluna ${index + 1}`).trim();
    used[base] = (used[base] || 0) + 1;
    return used[base] > 1 ? `${base} (${used[base]})` : base;
  });
}

function findHeader(headers, aliases, options = {}) {
  const normalized = headers.map(normalizeText);

  for (const alias of aliases) {
    const exactIndex = normalized.findIndex(header => header === alias);
    if (exactIndex >= 0) return exactIndex;
  }

  if (options.startsWith !== false) {
    for (const alias of aliases.filter(value => value.length >= 3)) {
      const startsIndex = normalized.findIndex(header => header.startsWith(alias));
      if (startsIndex >= 0) return startsIndex;
    }
  }

  return undefined;
}

function buildMapping(headers) {
  return {
    code: findHeader(headers, ['codigo do vidro', 'codigo', 'cod']),
    description: findHeader(headers, [
      'descricao do vidro', 'descricao', 'linha extraida do pdf', 'produto referencia', 'produto', 'perfil'
    ]),
    type: findHeader(headers, ['tipo', 'tipologia']),
    quantity: findHeader(headers, ['qtde prev', 'qtde', 'quantidade', 'qtd', 'qtde total', 'qtde barras']),
    unit: findHeader(headers, ['unidade', 'un'], { startsWith: false }),
    unitValue: findHeader(headers, ['unit'], { startsWith: false }),
    color: findHeader(headers, ['tratamento cor', 'cor', 'acabamento']),
    width: findHeader(headers, ['largura', 'l'], { startsWith: false }),
    height: findHeader(headers, ['altura', 'h', 'a'], { startsWith: false }),
    length: findHeader(headers, ['comprimento', 'comp barra mm', 'medida']),
    area: findHeader(headers, ['area m2', 'area', 'm2 compra', 'm2 corte']),
    notes: findHeader(headers, ['observacoes', 'obs']),
    itemNumber: findHeader(headers, ['item'], { startsWith: false }),
    weight: findHeader(headers, ['peso kg', 'kg']),
    cost: findHeader(headers, ['custo'])
  };
}

function mappedIndexes(mapping) {
  return new Set(Object.values(mapping).filter(index => Number.isInteger(index)));
}

function parseExtractedLine(sheetName, rawDescription, quantity) {
  const normalizedSheet = normalizeText(sheetName);
  const source = String(rawDescription || '').trim();

  if (normalizedSheet.includes('persiana')) {
    const match = source.match(/^([^\s]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+(RAL\s*[A-Z0-9.-]+)$/i);
    if (match) {
      return {
        code: match[1],
        description: `Persiana ${match[1]}`,
        type: match[1],
        quantity: quantity || num(match[4]),
        color: match[5].replace(/\s+/g, ' ').trim(),
        dimensions: `L ${match[2]} · A ${match[3]}`
      };
    }
  }

  const leadingCode = source.match(/^([A-Z0-9_./,-]{3,})\s+(.+)$/i);
  if (leadingCode) {
    return {
      code: leadingCode[1],
      description: leadingCode[2].trim(),
      type: '',
      quantity,
      color: '',
      dimensions: ''
    };
  }

  return {
    code: '',
    description: source,
    type: '',
    quantity,
    color: '',
    dimensions: ''
  };
}

function normalizeSheetRows(workbook, sheetName, defaultSource, defaultPainting) {
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!matrix.length) return { rows: [], ignored: 0, headerRow: -1 };

  const headerRow = detectHeaderRow(matrix);
  if (headerRow < 0) return { rows: [], ignored: matrix.length, headerRow: -1 };

  const headers = uniqueHeaders(matrix[headerRow] || []);
  const mapping = buildMapping(headers);
  const usedIndexes = mappedIndexes(mapping);
  const rows = [];
  let ignored = 0;

  for (let matrixIndex = headerRow + 1; matrixIndex < matrix.length; matrixIndex += 1) {
    const row = matrix[matrixIndex];
    if (isStopRow(row)) break;
    if (isNoiseRow(row)) {
      ignored += 1;
      continue;
    }

    const getField = field => {
      const index = mapping[field];
      return Number.isInteger(index) ? row[index] : '';
    };

    const rawQuantity = getField('quantity');
    const importedUnit = String(getField('unit') || '').trim();
    let quantity = quantityNum(rawQuantity, importedUnit || 'un');
    let quantityFromUnitValue = false;
    const unitValue = quantityNum(getField('unitValue'), 'm');

    if (quantity <= 0 && (rawQuantity === '' || rawQuantity === null || rawQuantity === undefined) && unitValue > 0) {
      quantity = unitValue;
      quantityFromUnitValue = true;
    }

    if (quantity <= 0) {
      ignored += 1;
      continue;
    }

    const descriptionHeader = Number.isInteger(mapping.description) ? normalizeText(headers[mapping.description]) : '';
    let code = String(getField('code') || '').trim();
    let description = String(getField('description') || '').trim();
    let type = String(getField('type') || '').trim();
    let color = String(getField('color') || '').trim();
    let dimensions = '';

    if (descriptionHeader === 'linha extraida do pdf') {
      const parsed = parseExtractedLine(sheetName, description, quantity);
      code = code || parsed.code;
      description = parsed.description || description;
      type = type || parsed.type;
      color = color || parsed.color;
      quantity = parsed.quantity || quantity;
      dimensions = parsed.dimensions;
    } else {
      if (!description && code) description = code;
      if (!code && description) {
        const leadingCode = description.match(/^([A-Z0-9_./,-]{3,})(?:\s+|$)/i);
        if (leadingCode) code = leadingCode[1];
      }
    }

    if (!code && !description) {
      ignored += 1;
      continue;
    }
    if (isSeparator(code || description)) {
      ignored += 1;
      continue;
    }

    const normalizedIdentity = normalizeText(`${code} ${description}`);
    if (!normalizedIdentity || NOISE_PATTERNS.some(pattern => pattern.test(normalizedIdentity))) {
      ignored += 1;
      continue;
    }

    let unit = importedUnit;
    if (!unit) unit = quantityFromUnitValue ? 'm' : 'un';

    const width = getField('width');
    const height = getField('height');
    let length = getField('length');
    const area = getField('area');
    if (!length && !quantityFromUnitValue && Number.isInteger(mapping.unitValue)) length = getField('unitValue');

    if (!dimensions) {
      dimensions = [
        width !== '' && width !== null ? `L ${width}` : '',
        height !== '' && height !== null ? `A ${height}` : '',
        length !== '' && length !== null ? `C ${length}` : '',
        area !== '' && area !== null ? `${area} m²` : ''
      ].filter(Boolean).join(' · ');
    }

    const sourceDetails = {};
    row.forEach((value, index) => {
      if (usedIndexes.has(index) || value === '' || value === null || value === undefined || !headers[index]) return;
      const base = safeFirebaseKey(headers[index], `Coluna_${index + 1}`);
      let key = base;
      let suffix = 2;
      while (Object.prototype.hasOwnProperty.call(sourceDetails, key)) key = `${base}_${suffix++}`;
      sourceDetails[key] = value;
    });

    if (Number.isInteger(mapping.itemNumber)) sourceDetails.itemOriginal = getField('itemNumber');
    if (Number.isInteger(mapping.weight)) sourceDetails.pesoKg = getField('weight');
    if (Number.isInteger(mapping.cost)) sourceDetails.custo = getField('cost');
    if (quantityFromUnitValue) sourceDetails.quantidadeOriginalEmUnit = getField('unitValue');

    rows.push({
      code,
      description,
      type,
      category: sheetName,
      qtyRequired: quantity,
      unit,
      color,
      dimensions,
      notes: String(getField('notes') || '').trim(),
      sourceDetails: safeFirebaseObject(sourceDetails),
      source: defaultSource,
      paintingRequired: defaultPainting,
      importSheet: sheetName,
      importRow: matrixIndex + 1
    });
  }

  return { rows, ignored, headerRow };
}

function deriveStatus(material) {
  const required = Math.max(0, quantityNumber(material, material.qtyRequired));
  const delivered = quantityNumber(material, material.siteDeliveredQty);
  const separated = quantityNumber(material, material.separatedQty);
  const received = quantityNumber(material, material.qtyReceived);
  const reserved = quantityNumber(material, material.stockReservedQty);
  const available = material.source === 'estoque' ? reserved : received;
  const paintSent = quantityNumber(material, material.paintingSentQty);
  const paintReturned = quantityNumber(material, material.paintingReturnedQty);

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
  if (material.source === 'estoque') return 'pronto_separar';
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

function clearImportState() {
  importState.fileName = '';
  importState.rows = [];
  importState.sheetNames = [];
  importState.sheetStats = [];
  importState.ignoredRows = 0;
  importState.processing = false;
}

function setProcessing(processing) {
  importState.processing = processing;
  const button = $('#xlsxFixedImportBtn');
  if (!button) return;
  button.disabled = processing;
  button.textContent = processing ? 'Importando...' : `Importar ${importState.rows.length} item(ns)`;
}

function renderSheetStats() {
  return importState.sheetStats.map(stat => (
    `<span class="status-pill status-neutral" style="margin:3px 6px 3px 0">${escapeHtml(stat.name)}: <strong>${stat.count}</strong></span>`
  )).join('');
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
      <strong>${importState.rows.length} itens válidos em ${importState.sheetNames.length} abas.</strong>
      Títulos, resumos, totais, assinaturas e linhas sem quantidade foram descartados.
      ${importState.ignoredRows ? `<span style="display:block;margin-top:5px">Linhas descartadas durante a leitura: ${importState.ignoredRows}.</span>` : ''}
      <div style="margin-top:9px">${renderSheetStats()}</div>
    </div>
    <div class="table-wrap preview-table" style="margin-top:16px">
      <table class="data-table" style="min-width:1260px">
        <thead><tr><th>Categoria / aba</th><th>Linha</th><th>Código</th><th>Descrição</th><th>Tipo</th><th>Qtde</th><th>Un.</th><th>Cor</th><th>Medidas</th><th>Origem</th><th>Pintura</th></tr></thead>
        <tbody>${importState.rows.map((row, index) => `
          <tr>
            <td><strong>${escapeHtml(row.category)}</strong></td>
            <td>${row.importRow}</td>
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
    clearImportState();
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
      message: `${importState.rows.length} item(ns) importado(s) de ${importState.fileName}, separados e validados por aba`,
      materialId: '',
      userId: user.uid,
      userName: user.email || 'Usuário',
      createdAt: Date.now()
    });
    await recalculateSummary(projectId);

    toast(`${importState.rows.length} item(ns) importado(s), sem linhas de resumo ou assinatura.`);
    clearImportState();
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
  if (preview) preview.innerHTML = '<p class="muted">Analisando cabeçalho e itens de cada aba...</p>';

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const source = $('#importSource')?.value || 'compra';
    const painting = Boolean($('#importPainting')?.checked);

    importState.fileName = file.name;
    importState.sheetNames = [...workbook.SheetNames];
    importState.rows = [];
    importState.sheetStats = [];
    importState.ignoredRows = 0;

    workbook.SheetNames.forEach(sheetName => {
      const result = normalizeSheetRows(workbook, sheetName, source, painting);
      importState.rows.push(...result.rows);
      importState.sheetStats.push({ name: sheetName, count: result.rows.length });
      importState.ignoredRows += result.ignored;
    });

    if (!importState.rows.length) throw new Error('Nenhuma linha válida foi encontrada nas abas da planilha.');
    renderPreview();
  } catch (error) {
    console.error(error);
    clearImportState();
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

  const reset = $('#resetImportBtn');
  if (reset && !reset.dataset.xlsxFixBound) {
    reset.dataset.xlsxFixBound = '1';
    reset.addEventListener('click', () => clearImportState(), true);
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
