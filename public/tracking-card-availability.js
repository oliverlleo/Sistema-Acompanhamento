import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { allocation, availableQty } from './material-flow.js?v=20260803-1648';

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
const auth = getAuth(app);
const db = getDatabase(app);

let materialsByProject = {};
let stopMaterials = null;
let patchQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function percentage(value, total) {
  if (!(total > 0)) return { visual: 0, label: '0%' };
  const exact = Math.min(100, Math.max(0, (value / total) * 100));
  return {
    visual: exact > 0 ? Math.max(1.2, exact) : 0,
    label: exact > 0 && exact < 1 ? '<1%' : `${Math.round(exact)}%`
  };
}

function availabilityForProject(projectId) {
  const materials = Object.values(materialsByProject[projectId] || {});
  let requiredQuantity = 0;
  let availableQuantity = 0;
  let availableItems = 0;

  materials.forEach(material => {
    const alloc = allocation(material);
    const available = availableQty(material);

    requiredQuantity += alloc.required;
    availableQuantity += available;
    if (alloc.required > 0 && available > 0) availableItems += 1;
  });

  return {
    requiredQuantity,
    availableQuantity,
    totalItems: materials.length,
    availableItems,
    quantityPercent: percentage(availableQuantity, requiredQuantity),
    itemPercent: percentage(availableItems, materials.length)
  };
}

function ensureStyle() {
  if (document.querySelector('#trackingCardAvailabilityStyle')) return;

  const style = document.createElement('style');
  style.id = 'trackingCardAvailabilityStyle';
  style.textContent = `
    .sep-availability-block{display:grid;justify-items:center;gap:6px;flex:0 0 auto}
    .sep-availability-title{color:#64748b;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.07em}
    .sep-card-availability-pair{display:flex;align-items:center;gap:7px}
    .sep-card-availability-pair .sep-donut{--size:72px!important;flex-basis:var(--size)}
    .sep-card-availability-pair .sep-donut::after{inset:7px}
    .sep-card-availability-pair .sep-donut-label strong{font-size:16px}
    .sep-card-availability-pair .sep-donut-label small{margin-top:4px;font-size:7px;letter-spacing:.045em}
    .sep-card-availability-pair .sep-donut-items{background:conic-gradient(#0ea5e9 calc(var(--value)*1%),#e8eef3 0)}
    @media(max-width:720px){
      .sep-card-availability-pair{gap:5px}
      .sep-card-availability-pair .sep-donut{--size:64px!important}
      .sep-card-availability-pair .sep-donut-label strong{font-size:14px}
    }
  `;
  document.head.appendChild(style);
}

function ensureIndicators(card) {
  let block = card.querySelector('.sep-availability-block');

  if (!block) {
    const head = card.querySelector('.sep-card-head');
    const originalDonut = head?.querySelector(':scope > .sep-donut');
    if (!head || !originalDonut) return null;

    block = document.createElement('div');
    block.className = 'sep-availability-block';
    block.innerHTML = '<span class="sep-availability-title">Disponível</span><div class="sep-card-availability-pair"></div>';

    const pair = block.querySelector('.sep-card-availability-pair');
    originalDonut.replaceWith(block);
    originalDonut.classList.add('sep-donut-quantity');
    originalDonut.style.setProperty('--size', '72px');
    pair.appendChild(originalDonut);

    const itemDonut = document.createElement('div');
    itemDonut.className = 'sep-donut sep-donut-items';
    itemDonut.style.setProperty('--value', '0');
    itemDonut.style.setProperty('--size', '72px');
    itemDonut.innerHTML = '<div class="sep-donut-label"><strong>0%</strong><small>itens</small></div>';
    pair.appendChild(itemDonut);
  }

  const quantityDonut = block.querySelector('.sep-donut-quantity');
  const itemDonut = block.querySelector('.sep-donut-items');
  if (!quantityDonut || !itemDonut) return null;

  return { quantityDonut, itemDonut };
}

function updateDonut(donut, meta, smallLabel, ariaLabel) {
  if (donut.style.getPropertyValue('--value') !== String(meta.visual)) {
    donut.style.setProperty('--value', String(meta.visual));
  }

  const strong = donut.querySelector('.sep-donut-label strong');
  const small = donut.querySelector('.sep-donut-label small');
  if (strong && strong.textContent !== meta.label) strong.textContent = meta.label;
  if (small && small.textContent !== smallLabel) small.textContent = smallLabel;
  if (donut.getAttribute('aria-label') !== ariaLabel) donut.setAttribute('aria-label', ariaLabel);
}

function patchCards() {
  patchQueued = false;
  if (currentRoute() !== 'estoque') return;

  ensureStyle();

  document.querySelectorAll('[data-separated-project]').forEach(card => {
    const projectId = card.dataset.separatedProject || '';
    if (!projectId) return;

    const indicators = ensureIndicators(card);
    if (!indicators) return;

    const data = availabilityForProject(projectId);

    updateDonut(
      indicators.quantityDonut,
      data.quantityPercent,
      'quantidade',
      `${data.quantityPercent.label} disponível por quantidade: estoque e compras recebidas`
    );

    updateDonut(
      indicators.itemDonut,
      data.itemPercent,
      'itens',
      `${data.itemPercent.label} disponível por itens: ${data.availableItems} de ${data.totalItems} materiais`
    );
  });
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(patchCards);
}

onAuthStateChanged(auth, user => {
  stopMaterials?.();
  stopMaterials = null;
  materialsByProject = {};

  if (!user) return;
  stopMaterials = onValue(ref(db, 'materials'), snapshot => {
    materialsByProject = snapshot.val() || {};
    queuePatch();
  }, error => console.error('Falha ao calcular disponibilidade por obra:', error));
});

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="estoque"]')) {
    setTimeout(queuePatch, 80);
    setTimeout(queuePatch, 320);
  }
});

window.addEventListener('hashchange', queuePatch);

const view = document.querySelector('#view');
if (view) new MutationObserver(queuePatch).observe(view, { childList: true, subtree: true });
