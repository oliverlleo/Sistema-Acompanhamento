let selectedCategory = '';
let selectedStage = '';
let applyQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function activeStage() {
  return document.querySelector('[data-tracking-stage].active')?.dataset.trackingStage || '';
}

function categoryCards() {
  return [...document.querySelectorAll('.trk-panel .trk-category')];
}

function categoryName(card) {
  return card.querySelector('div > span')?.textContent?.trim()
    || card.querySelector('span')?.textContent?.trim()
    || '';
}

function ensureStyle() {
  if (document.querySelector('#trackingCategoryFilterStyle')) return;

  const style = document.createElement('style');
  style.id = 'trackingCategoryFilterStyle';
  style.textContent = `
    .trk-category[data-category-filter]{
      cursor:pointer;
      user-select:none;
      transition:border-color .15s ease,background .15s ease,box-shadow .15s ease,transform .15s ease;
    }
    .trk-category[data-category-filter]:hover{
      transform:translateY(-1px);
      border-color:rgba(15,118,110,.45);
      box-shadow:0 7px 18px rgba(15,23,42,.08);
    }
    .trk-category[data-category-filter]:focus-visible{
      outline:3px solid rgba(15,118,110,.2);
      outline-offset:2px;
    }
    .trk-category[data-category-filter].category-filter-active{
      border-color:#0f766e;
      background:#f0fdfa;
      box-shadow:0 0 0 2px rgba(15,118,110,.12),0 8px 20px rgba(15,23,42,.08);
    }
  `;
  document.head.appendChild(style);
}

function decorateCards() {
  ensureStyle();

  categoryCards().forEach(card => {
    const label = categoryName(card);
    const normalized = normalize(label);
    if (!normalized) return;

    card.dataset.categoryFilter = normalized;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Filtrar tabela pela categoria ${label}`);

    const active = Boolean(selectedCategory) && normalized === selectedCategory;
    card.classList.toggle('category-filter-active', active);
    card.setAttribute('aria-pressed', String(active));
  });
}

function applyFilter() {
  applyQueued = false;
  if (currentRoute() !== 'estoque') return;

  const stage = activeStage();
  if (selectedStage && stage && selectedStage !== stage) {
    selectedCategory = '';
    selectedStage = stage;
  }

  decorateCards();

  const input = document.querySelector('#trackingSearch');
  const query = normalize(input?.value || '');
  const rows = [...document.querySelectorAll('[data-tracking-row]')];
  const count = document.querySelector('#trackingCount');
  const empty = document.querySelector('#trackingEmpty');
  let visible = 0;

  rows.forEach(row => {
    const rowSearch = normalize(row.dataset.search || row.textContent || '');
    const rowCategory = normalize(row.cells?.[1]?.textContent || '');
    const matchesSearch = !query || rowSearch.includes(query);
    const matchesCategory = !selectedCategory || rowCategory === selectedCategory;
    const matches = matchesSearch && matchesCategory;

    row.hidden = !matches;
    if (matches) visible += 1;
  });

  if (count) count.textContent = `${visible} item${visible === 1 ? '' : 's'}`;
  if (empty) empty.hidden = visible !== 0;
}

function queueApply() {
  if (applyQueued) return;
  applyQueued = true;
  requestAnimationFrame(() => setTimeout(applyFilter, 0));
}

function toggleCategory(card) {
  const category = card.dataset.categoryFilter || normalize(categoryName(card));
  if (!category) return;

  const stage = activeStage();
  if (selectedStage === stage && selectedCategory === category) {
    selectedCategory = '';
  } else {
    selectedStage = stage;
    selectedCategory = category;
  }

  applyFilter();
}

function clearCategoryFilter() {
  selectedCategory = '';
  selectedStage = activeStage();
  queueApply();
}

document.addEventListener('click', event => {
  const categoryCard = event.target.closest?.('.trk-panel .trk-category');
  if (categoryCard) {
    toggleCategory(categoryCard);
    return;
  }

  if (event.target.closest?.('[data-tracking-stage], #trackingBack, [data-separated-project]')) {
    clearCategoryFilter();
  }
});

document.addEventListener('keydown', event => {
  const categoryCard = event.target.closest?.('.trk-panel .trk-category');
  if (!categoryCard || !['Enter', ' '].includes(event.key)) return;

  event.preventDefault();
  toggleCategory(categoryCard);
});

document.addEventListener('input', event => {
  if (event.target.matches?.('#trackingSearch')) applyFilter();
});

window.addEventListener('hashchange', () => {
  selectedCategory = '';
  selectedStage = '';
  queueApply();
});

const view = document.querySelector('#view');
if (view) new MutationObserver(queueApply).observe(view, { childList: true, subtree: true });

queueApply();
