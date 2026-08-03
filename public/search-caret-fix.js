const forwardedEvents = new WeakSet();
const pendingTimers = new WeakMap();
const composingInputs = new WeakSet();

function isSearchInput(element) {
  return element instanceof HTMLInputElement && element.type === 'search';
}

function findCurrentInput(input) {
  if (input.id) return document.getElementById(input.id);
  if (input.name) {
    const escapedName = typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(input.name)
      : input.name.replace(/["\\]/g, '\\$&');
    return document.querySelector(`input[type="search"][name="${escapedName}"]`);
  }
  return input.isConnected ? input : null;
}

function restoreSelection(input, snapshot) {
  const replacement = findCurrentInput(input);
  if (!isSearchInput(replacement) || replacement.value !== snapshot.value) return;

  const limit = replacement.value.length;
  const start = Math.min(snapshot.start, limit);
  const end = Math.min(snapshot.end, limit);

  replacement.focus({ preventScroll: true });
  replacement.setSelectionRange(start, end, snapshot.direction);
}

function dispatchFilteredInput(input) {
  if (!isSearchInput(input) || !input.isConnected) return;

  const snapshot = {
    value: input.value,
    start: input.selectionStart ?? input.value.length,
    end: input.selectionEnd ?? input.selectionStart ?? input.value.length,
    direction: input.selectionDirection || 'none'
  };

  const forwarded = new Event('input', { bubbles: true, composed: true });
  forwardedEvents.add(forwarded);
  input.dispatchEvent(forwarded);

  queueMicrotask(() => restoreSelection(input, snapshot));
  requestAnimationFrame(() => restoreSelection(input, snapshot));
  setTimeout(() => restoreSelection(input, snapshot), 0);
  setTimeout(() => restoreSelection(input, snapshot), 40);
}

function scheduleFilter(input, delay = 140) {
  const previous = pendingTimers.get(input);
  if (previous) clearTimeout(previous);

  const timer = setTimeout(() => {
    pendingTimers.delete(input);
    dispatchFilteredInput(input);
  }, delay);

  pendingTimers.set(input, timer);
}

document.addEventListener('compositionstart', event => {
  if (isSearchInput(event.target)) composingInputs.add(event.target);
}, true);

document.addEventListener('compositionend', event => {
  const input = event.target;
  if (!isSearchInput(input)) return;
  composingInputs.delete(input);
  scheduleFilter(input, 0);
}, true);

document.addEventListener('input', event => {
  if (forwardedEvents.has(event)) return;

  const input = event.target;
  if (!isSearchInput(input)) return;

  // O app recria a tela em cada input. Bloqueamos apenas o evento original,
  // deixamos a digitação acontecer normalmente e enviamos um único input
  // após uma pequena pausa, já restaurando o cursor no campo recriado.
  event.stopImmediatePropagation();
  event.stopPropagation();

  if (event.isComposing || composingInputs.has(input)) return;
  scheduleFilter(input);
}, true);
