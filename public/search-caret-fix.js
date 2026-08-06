let restoreTimer = 0;

function isSearchInput(element) {
  return element instanceof HTMLInputElement && element.type === 'search';
}

function selectorFor(input) {
  if (input.id) return `#${CSS.escape(input.id)}`;
  if (input.name) return `input[type="search"][name="${CSS.escape(input.name)}"]`;
  return '#view input[type="search"]';
}

function restoreCaret(input) {
  if (!isSearchInput(input) || document.activeElement !== input) return;

  const selector = selectorFor(input);
  const value = input.value;
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? start;
  const direction = input.selectionDirection || 'none';

  clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => {
    const current = document.querySelector(selector);
    if (!isSearchInput(current)) return;

    // A busca da própria página continua responsável por filtrar e renderizar.
    // Aqui apenas devolvemos o foco e a posição do cursor caso o input tenha sido recriado.
    if (current.value !== value) return;
    current.focus({ preventScroll: true });
    try {
      current.setSelectionRange(start, end, direction);
    } catch {
      // Alguns navegadores podem não aceitar seleção durante uma troca de tela.
    }
  }, 0);
}

// Não bloqueia propagação: cada página recebe normalmente seus eventos de busca.
document.addEventListener('input', event => {
  if (isSearchInput(event.target)) restoreCaret(event.target);
}, true);

document.addEventListener('search', event => {
  if (isSearchInput(event.target)) restoreCaret(event.target);
}, true);
