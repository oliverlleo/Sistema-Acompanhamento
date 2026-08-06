let query = '';
let hadFocus = false;
let selectionStart = 0;
let selectionEnd = 0;
let applyQueued = false;

function isReceivingRoute() {
  return location.hash.replace(/^#/, '') === 'recebimento';
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[×*]/g, 'x')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function compact(value = '') {
  return normalize(value).replace(/\s+/g, '');
}

function digits(value = '') {
  return String(value).replace(/\D+/g, '');
}

function updateCounter(root, visible, rendered) {
  const counter = root.querySelector('.gr-table-head span');
  if (!counter) return;

  const totalMatch = counter.textContent.match(/\bde\s+(\d+)/i);
  const total = totalMatch ? Number(totalMatch[1]) : rendered;
  counter.textContent = `${visible} de ${total} item${total === 1 ? '' : 's'}`;
}

function updateEmptyState(root, visible, rendered) {
  let empty = root.querySelector('.receiving-local-search-empty');
  if (visible > 0 || rendered === 0 || !query.trim()) {
    empty?.remove();
    return;
  }

  if (!empty) {
    empty = document.createElement('div');
    empty.className = 'gr-empty receiving-local-search-empty';
    empty.innerHTML = '<strong>Nenhum recebimento encontrado</strong>Revise a busca ou ajuste os filtros.';
    root.querySelector('.gr-table-card')?.appendChild(empty);
  }
}

function applySearch() {
  applyQueued = false;
  if (!isReceivingRoute()) return;

  const root = document.querySelector('#globalReceivingRoot');
  const input = root?.querySelector('#globalReceivingSearch');
  if (!root || !(input instanceof HTMLInputElement)) return;

  if (input.value !== query) input.value = query;

  const normalizedQuery = normalize(query);
  const compactQuery = compact(query);
  const digitQuery = digits(query);
  const numericOnly = digitQuery.length > 0 && /^\s*[\d\s.,]+\s*$/.test(query);
  const rows = [...root.querySelectorAll('.gr-table tbody tr')];
  let visible = 0;

  rows.forEach(row => {
    const searchable = row.textContent || '';
    const matches = !normalizedQuery
      || normalize(searchable).includes(normalizedQuery)
      || (compactQuery && compact(searchable).includes(compactQuery))
      || (numericOnly && digits(searchable).includes(digitQuery));

    row.hidden = !matches;
    if (matches) visible += 1;
  });

  updateCounter(root, visible, rows.length);
  updateEmptyState(root, visible, rows.length);

  if (hadFocus) {
    input.focus({ preventScroll: true });
    try {
      input.setSelectionRange(
        Math.min(selectionStart, input.value.length),
        Math.min(selectionEnd, input.value.length)
      );
    } catch {
      // O navegador pode recusar seleção durante a troca de tela.
    }
  }
}

function queueApply() {
  if (applyQueued) return;
  applyQueued = true;
  requestAnimationFrame(() => setTimeout(applySearch, 0));
}

function captureSearch(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.id !== 'globalReceivingSearch') return;

  query = input.value;
  hadFocus = true;
  selectionStart = input.selectionStart ?? query.length;
  selectionEnd = input.selectionEnd ?? selectionStart;

  // Substitui somente a busca do Recebimento, que recriava a tela a cada letra.
  event.stopImmediatePropagation();
  event.stopPropagation();
  queueApply();
}

document.addEventListener('input', captureSearch, true);
document.addEventListener('search', captureSearch, true);

document.addEventListener('focusin', event => {
  if (event.target instanceof HTMLInputElement && event.target.id === 'globalReceivingSearch') {
    hadFocus = true;
  }
});

document.addEventListener('focusout', event => {
  if (event.target instanceof HTMLInputElement && event.target.id === 'globalReceivingSearch') {
    hadFocus = false;
  }
});

document.addEventListener('change', event => {
  if (event.target.matches?.('#globalReceivingSupplier, #globalReceivingProject, #globalReceivingStatus')) {
    setTimeout(queueApply, 0);
    setTimeout(queueApply, 80);
  }
}, true);

document.addEventListener('pointerdown', event => {
  if (!event.target.closest?.('#globalReceivingSearch')) hadFocus = false;
}, true);

const view = document.querySelector('#view');
if (view) {
  new MutationObserver(() => {
    if (isReceivingRoute()) queueApply();
  }).observe(view, { childList: true, subtree: true });
}

window.addEventListener('hashchange', () => {
  if (!isReceivingRoute()) {
    query = '';
    hadFocus = false;
  }
  queueApply();
});

queueApply();
