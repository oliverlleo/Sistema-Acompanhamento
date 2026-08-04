const OPERATIONAL_QUANTITY_FIELDS = [
  'stockReservedQty',
  'qtyReceived',
  'paintingSentQty',
  'paintingReturnedQty',
  'separatedQty',
  'siteDeliveredQty'
];

const QUANTITY_EPSILON = 0.000001;
const DISPLAY_DECIMALS = 2;
const DISPLAY_HALF_STEP = (10 ** -DISPLAY_DECIMALS) / 2;
const DECIMAL_UNITS = new Set(['m', 'm2', 'm²', 'metro', 'metros', 'kg']);

function parseQuantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let text = String(value ?? '').trim().replace(/\s/g, '');
  if (!text) return NaN;
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function roundLikeScreen(value) {
  const factor = 10 ** DISPLAY_DECIMALS;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizedModalUnit() {
  const modal = document.querySelector('#quickActionForm')?.closest('.modal');
  const subtitle = modal?.querySelector('.modal-head p')?.textContent?.trim() || '';
  const match = subtitle.match(/\s([^\s]+)\s*$/);
  return String(match?.[1] || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeRoundedValue(typed, exactInitialValue) {
  if (!Number.isFinite(exactInitialValue)) return typed;
  const shownRoundedValue = roundLikeScreen(exactInitialValue);
  const isTheRoundedValueShownOnScreen = Math.abs(typed - shownRoundedValue) <= QUANTITY_EPSILON;
  const onlyExceededBecauseOfTwoDecimalRounding = typed > exactInitialValue + QUANTITY_EPSILON
    && typed - exactInitialValue <= DISPLAY_HALF_STEP + QUANTITY_EPSILON;
  return isTheRoundedValueShownOnScreen && onlyExceededBecauseOfTwoDecimalRounding
    ? exactInitialValue
    : typed;
}

function prepareDecimalInputForLegacyParser(input, decimalContext) {
  const typed = parseQuantity(input.value);
  const exactInitialValue = parseQuantity(input.defaultValue);
  if (!Number.isFinite(typed)) return;

  const normalized = normalizeRoundedValue(typed, exactInitialValue);
  if (!decimalContext && Number.isInteger(normalized)) return;

  // O código principal antigo lê "27.026" como 27026. Como texto com vírgula,
  // ele interpreta corretamente 27,026 sem alterar o valor salvo no Firebase.
  input.type = 'text';
  input.inputMode = 'decimal';
  input.value = String(normalized).replace('.', ',');

  queueMicrotask(() => {
    if (!input.isConnected) return;
    input.type = 'number';
    input.step = '0.001';
    input.value = String(normalized);
  });
}

function normalizeQuickActionQuantities() {
  const form = document.querySelector('#quickActionForm');
  if (!form) return;
  const unit = normalizedModalUnit();
  const modalUsesDecimalUnit = DECIMAL_UNITS.has(unit);

  OPERATIONAL_QUANTITY_FIELDS.forEach(name => {
    const input = form.elements.namedItem(name);
    if (!(input instanceof HTMLInputElement)) return;
    const initialValue = parseQuantity(input.defaultValue);
    const decimalContext = modalUsesDecimalUnit || (Number.isFinite(initialValue) && !Number.isInteger(initialValue));
    prepareDecimalInputForLegacyParser(input, decimalContext);
  });
}

// O botão Confirmar fica fora do formulário. A captura acontece antes da validação do app.
document.addEventListener('click', event => {
  if (!event.target.closest('#saveQuickActionBtn')) return;
  normalizeQuickActionQuantities();
}, true);
