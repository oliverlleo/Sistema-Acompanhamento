import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { allocation, clamp, quantityNumber } from './material-flow.js?v=20260803-1648';

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

function ensureStyle() {
  if (document.querySelector('#trackingCardAvailabilityStyle')) return;

  const style = document.createElement('style');
  style.id = 'trackingCardAvailabilityStyle';
  style.textContent = `
    .sep-donut-quantity .sep-donut-label{
      width:100%;
      padding:0 10px;
      overflow:hidden;
    }
    .sep-donut-quantity .sep-donut-label small{
      display:block;
      max-width:66px;
      margin-top:4px;
      overflow:hidden;
      color:#64748b;
      font-size:7px;
      font-weight:700;
      line-height:1;
      letter-spacing:0;
      text-transform:none;
      white-space:nowrap;
    }
  `;
  document.head.appendChild(style);
}

function percentage(value, total) {
  if (!(total > 0)) return { visual: 0, label: '0%' };
  const exact = Math.min(100, Math.max(0, (value / total) * 100));
  return {
    visual: exact > 0 ? Math.max(1.2, exact) : 0,
    label: exact > 0 && exact < 1 ? '<1%' : `${Math.round(exact)}%`
  };
}

function availableQuantityForMaterial(material = {}) {
  const alloc = allocation(material);
  const required = alloc.required;
  if (!(required > 0)) return 0;

  // A parcela definida como estoque já está disponível e nunca deve ser
  // anulada pelo fato de outra parcela do mesmo material precisar de pintura.
  const stockAvailable = clamp(alloc.stockQty, 0, required);

  const receivedFromPurchase = clamp(
    quantityNumber(material, material.qtyReceived),
    0,
    alloc.purchaseQty
  );

  let purchaseAvailable = receivedFromPurchase;

  // Quando a compra precisa de pintura, a parcela comprada só passa a contar
  // como disponível depois do retorno da pintura. O estoque continua contando.
  if (material.paintingRequired && alloc.purchaseQty > 0) {
    purchaseAvailable = clamp(
      quantityNumber(material, material.paintingReturnedQty),
      0,
      alloc.purchaseQty
    );
  }

  return clamp(stockAvailable + purchaseAvailable, 0, required);
}

function availabilityForProject(projectId) {
  const materials = Object.values(materialsByProject[projectId] || {});
  let requiredQuantity = 0;
  let availableQuantity = 0;

  materials.forEach(material => {
    const alloc = allocation(material);
    requiredQuantity += alloc.required;
    availableQuantity += availableQuantityForMaterial(material);
  });

  return {
    requiredQuantity,
    availableQuantity,
    quantityPercent: percentage(availableQuantity, requiredQuantity)
  };
}

function normalizeIndicator(card) {
  const head = card.querySelector('.sep-card-head');
  if (!head) return null;

  const oldBlock = head.querySelector(':scope > .sep-availability-block');
  if (oldBlock) {
    const quantityDonut = oldBlock.querySelector('.sep-donut-quantity')
      || oldBlock.querySelector('.sep-donut');
    if (!quantityDonut) return null;
    oldBlock.replaceWith(quantityDonut);
  }

  const donut = head.querySelector(':scope > .sep-donut');
  if (!donut) return null;

  donut.classList.add('sep-donut-quantity');
  donut.classList.remove('sep-donut-items');
  donut.style.removeProperty('--size');
  return donut;
}

function updateDonut(donut, meta, ariaLabel) {
  if (donut.style.getPropertyValue('--value') !== String(meta.visual)) {
    donut.style.setProperty('--value', String(meta.visual));
  }

  const strong = donut.querySelector('.sep-donut-label strong');
  const small = donut.querySelector('.sep-donut-label small');
  if (strong && strong.textContent !== meta.label) strong.textContent = meta.label;
  if (small && small.textContent !== 'Disponibilidade') small.textContent = 'Disponibilidade';
  if (donut.getAttribute('aria-label') !== ariaLabel) donut.setAttribute('aria-label', ariaLabel);
}

function patchCards() {
  patchQueued = false;
  if (currentRoute() !== 'estoque') return;

  ensureStyle();

  document.querySelectorAll('[data-separated-project]').forEach(card => {
    const projectId = card.dataset.separatedProject || '';
    if (!projectId) return;

    const donut = normalizeIndicator(card);
    if (!donut) return;

    const data = availabilityForProject(projectId);
    updateDonut(
      donut,
      data.quantityPercent,
      `${data.quantityPercent.label} de disponibilidade por quantidade: estoque, compras recebidas sem pintura e retornos da pintura`
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
