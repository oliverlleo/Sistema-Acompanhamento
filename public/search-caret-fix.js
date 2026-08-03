function isSearchInput(element) {
  return element instanceof HTMLInputElement && element.type === 'search';
}

function findReplacement(input) {
  if (input.id) return document.getElementById(input.id);
  if (input.name) return document.querySelector(`input[type="search"][name="${CSS.escape(input.name)}"]`);
  return null;
}

function restoreCaret(input, value, start, end, direction) {
  const replacement = findReplacement(input);
  if (!isSearchInput(replacement) || replacement.value !== value) return;

  const limit = replacement.value.length;
  const safeStart = Math.min(start, limit);
  const safeEnd = Math.min(end, limit);

  replacement.focus({ preventScroll: true });
  replacement.setSelectionRange(safeStart, safeEnd, direction);
}

document.addEventListener('input', event => {
  const input = event.target;
  if (!isSearchInput(input)) return;

  const value = input.value;
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? start;
  const direction = input.selectionDirection || 'none';

  queueMicrotask(() => restoreCaret(input, value, start, end, direction));
}, true);
