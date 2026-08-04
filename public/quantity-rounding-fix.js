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

function normalizeRoundedOperationalQuantity(input) {
  const typed = parseQuantity(input.value);
  const exactInitialValue = parseQuantity(input.defaultValue);
  if (!Number.isFinite(typed) || !Number.isFinite(exactInitialValue)) return;

  const shownRoundedValue = roundLikeScreen(exactInitialValue);
  const isTheRoundedValueShownOnScreen = Math.abs(typed - shownRoundedValue) <= QUANTITY_EPSILON;
  const onlyExceededBecauseOfTwoDecimalRounding = typed > exactInitialValue + QUANTITY_EPSILON
    && typed - exactInitialValue <= DISPLAY_HALF_STEP + QUANTITY_EPSILON;

  if (isTheRoundedValueShownOnScreen && onlyExceededBecauseOfTwoDecimalRounding) {
    input.value = String(exactInitialValue);
  }
}

function normalizeQuickActionQuantities() {
  const form = document.querySelector('#quickActionForm');
  if (!form) return;
  OPERATIONAL_QUANTITY_FIELDS.forEach(name => {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) normalizeRoundedOperationalQuantity(input);
  });
}

// O botão Confirmar fica fora do formulário. A captura ocorre antes da validação do app.
document.addEventListener('click', event => {
  if (!event.target.closest('#saveQuickActionBtn')) return;
  normalizeQuickActionQuantities();
}, true);
