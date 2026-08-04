import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  allocation,
  purchaseCommitted,
  availableQty
} from './material-flow.js?v=20260803-1648';

const firebaseConfig = {
  apiKey: 'AIzaSyDtfxhvronefOV9MoDj-GvUUiJ3TLfb8qc',
  authDomain: 'sistemsquared.firebaseapp.com',
  databaseURL: 'https://sistemsquared-default-rtdb.firebaseio.com',
  projectId: 'sistemsquared',
  storageBucket: 'sistemsquared.firebasestorage.app',
  messagingSenderId: '43452051582',
  appId: '1:43452051582:web:08a19296448eb66d0b282f'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);

let projectId = '';
let materials = [];
let loadVersion = 0;
let patchQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function formatQty(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(value) || 0);
}

function percent(value, total) {
  const exact = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return {
    exact,
    label: exact > 0 && exact < 1 ? '<1%' : `${Math.round(exact)}%`
  };
}

function categoryData(stage) {
  const categories = new Map();

  materials.forEach(material => {
    const alloc = allocation(material);
    const name = String(material.category || 'Sem categoria').trim() || 'Sem categoria';
    const current = categories.get(name) || { name, value: 0, total: 0 };

    if (stage === 'comprado') {
      if (!(alloc.purchaseQty > 0)) return;
      current.total += alloc.purchaseQty;
      if (purchaseCommitted(material)) current.value += alloc.purchaseQty;
    } else if (stage === 'disponivel') {
      if (!(alloc.required > 0)) return;
      current.total += alloc.required;
      current.value += Math.min(availableQty(material), alloc.required);
    } else {
      return;
    }

    categories.set(name, current);
  });

  return [...categories.values()]
    .map(category => ({ ...category, pct: percent(category.value, category.total) }))
    .sort((a, b) => b.pct.exact - a.pct.exact || a.name.localeCompare(b.name, 'pt-BR'));
}

function removeInjected() {
  document.querySelector('[data-tracking-category-progress]')?.remove();
}

function patchCategories() {
  patchQueued = false;
  if (currentRoute() !== 'estoque' || !projectId || !materials.length) {
    removeInjected();
    return;
  }

  const activeStage = document.querySelector('.trk-stage.active')?.dataset.trackingStage || '';
  if (!['comprado', 'disponivel'].includes(activeStage)) {
    removeInjected();
    return;
  }

  const progress = document.querySelector('.trk-panel .trk-progress-card');
  if (!progress) return;

  const categories = categoryData(activeStage);
  if (!categories.length) {
    removeInjected();
    return;
  }

  const signature = `${projectId}|${activeStage}|${categories.map(category => `${category.name}:${category.value}:${category.total}`).join('|')}`;
  let section = document.querySelector('[data-tracking-category-progress]');
  if (section?.dataset.signature === signature) return;

  if (!section) {
    section = document.createElement('section');
    section.className = 'trk-categories';
    section.dataset.trackingCategoryProgress = 'true';
  }

  const action = activeStage === 'comprado' ? 'comprados' : 'conferidos';
  section.dataset.signature = signature;
  section.innerHTML = categories.map(category => `
    <article class="trk-category" title="${escapeHtml(category.name)}">
      <div><span>${escapeHtml(category.name)}</span><strong>${category.pct.label}</strong></div>
      <small>${formatQty(category.value)} de ${formatQty(category.total)} ${action}</small>
    </article>`).join('');

  progress.insertAdjacentElement('afterend', section);
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(() => setTimeout(patchCategories, 0));
}

async function loadProject(id) {
  if (!id || currentRoute() !== 'estoque') return;
  const version = ++loadVersion;
  projectId = id;
  materials = [];
  removeInjected();

  try {
    const snapshot = await get(ref(db, `materials/${id}`));
    if (version !== loadVersion || projectId !== id || currentRoute() !== 'estoque') return;
    materials = Object.values(snapshot.val() || {});
    queuePatch();
  } catch (error) {
    console.error('Falha ao carregar categorias do acompanhamento:', error);
  }
}

document.addEventListener('click', event => {
  const card = event.target.closest?.('[data-separated-project]');
  if (card && currentRoute() === 'estoque') {
    loadProject(card.dataset.separatedProject || '');
    return;
  }

  if (event.target.closest?.('#trackingBack')) {
    loadVersion += 1;
    projectId = '';
    materials = [];
    removeInjected();
    return;
  }

  if (event.target.closest?.('[data-tracking-stage]')) setTimeout(queuePatch, 0);
}, true);

document.addEventListener('keydown', event => {
  const card = event.target.closest?.('[data-separated-project]');
  if (card && currentRoute() === 'estoque' && (event.key === 'Enter' || event.key === ' ')) {
    loadProject(card.dataset.separatedProject || '');
  }
}, true);

window.addEventListener('hashchange', () => {
  if (currentRoute() !== 'estoque') {
    loadVersion += 1;
    projectId = '';
    materials = [];
    removeInjected();
  }
});

const view = document.querySelector('#view');
if (view) new MutationObserver(queuePatch).observe(view, { childList: true, subtree: true });
