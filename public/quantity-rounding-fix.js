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
const NativeFormData = window.FormData;

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

function normalizeOperationalValue(typed, exactInitialValue) {
  if (!Number.isFinite(typed)) return typed;
  if (!Number.isFinite(exactInitialValue)) return typed;

  const displayedValue = roundLikeScreen(exactInitialValue);
  const typedMatchesDisplayedValue = Math.abs(typed - displayedValue) <= QUANTITY_EPSILON;
  const hiddenDifferenceIsOnlyDisplayRounding = Math.abs(exactInitialValue - displayedValue)
    <= DISPLAY_HALF_STEP + QUANTITY_EPSILON;

  // A tela continua exibindo duas casas. Se o valor real for 17,572 e o usuário
  // confirmar 17,57, consideramos que ele está confirmando todo o saldo exibido.
  // O mesmo vale quando o arredondamento sobe, como 27,026 exibido como 27,03.
  if (typedMatchesDisplayedValue && hiddenDifferenceIsOnlyDisplayRounding) {
    return exactInitialValue;
  }

  return typed;
}

function legacySafeQuantity(value) {
  if (!Number.isFinite(value)) return '';
  // O parser principal antigo entende vírgula como decimal, mas pode entender
  // 17.572 como 17 mil. Entregamos 17,572 ao FormData para preservar o decimal.
  return String(value).replace('.', ',');
}

function normalizeQuickActionFormData(formData, form) {
  if (!(form instanceof HTMLFormElement) || form.id !== 'quickActionForm') return;

  OPERATIONAL_QUANTITY_FIELDS.forEach(name => {
    const input = form.elements.namedItem(name);
    if (!(input instanceof HTMLInputElement) || !formData.has(name)) return;

    const typed = parseQuantity(input.value);
    const exactInitialValue = parseQuantity(input.defaultValue);
    const normalized = normalizeOperationalValue(typed, exactInitialValue);
    if (Number.isFinite(normalized)) formData.set(name, legacySafeQuantity(normalized));
  });
}

// Corrige na origem o objeto que o app usa para validar e salvar. A aparência
// permanece com duas casas decimais, mas o valor interno conserva todas as casas.
window.FormData = class ObraFlowFormData extends NativeFormData {
  constructor(form, submitter) {
    super(form, submitter);
    normalizeQuickActionFormData(this, form);
  }
};
