import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { availableQty, quantityNumber } from './material-flow.js?v=20260803-1648';

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

function companyAvailableQty(material) {
  const baseAvailable = availableQty(material);
  const sentToPainting = Math.max(0, quantityNumber(material, material.paintingSentQty));
  const returnedFromPainting = Math.max(0, quantityNumber(material, material.paintingReturnedQty));
  const awayAtPainting = Math.max(0, sentToPainting - returnedFromPainting);
  const deliveredToSite = Math.max(0, quantityNumber(material, material.siteDeliveredQty));

  // Material separado em produção continua disponível. Só descontamos o que
  // está fora em pintura e o que já foi enviado para a obra.
  return Math.max(0, baseAvailable - awayAtPainting - deliveredToSite);
}

function availabilityForProject(projectId) {
  const materials = Object.values(materialsByProject[projectId] || {});
  const totalItems = materials.length;
  const availableItems = materials.filter(material => companyAvailableQty(material) > 0).length;

  return {
    totalItems,
    availableItems,
    itemPercent: percentage(availableItems, totalItems)
  };
}

function normalizeIndicator(card) {
  const head = card.querySelector('.sep-card-head');
  if (!head) return null;

  const oldBlock = head.querySelector(':scope > .sep-availability-block');
  if (oldBlock) {
    const donut = oldBlock.querySelector('.sep-donut') || oldBlock.firstElementChild;
    if (!donut) return null;
    oldBlock.replaceWith(donut);
  }

  const donut = head.querySelector(':scope > .sep-donut');
  if (!donut) return null;

  donut.classList.add('sep-donut-items');
  donut.classList.remove('sep-donut-quantity');
  donut.style.removeProperty('--size');
  return donut;
}

function updateDonut(donut, data) {
  const meta = data.itemPercent;
  if (donut.style.getPropertyValue('--value') !== String(meta.visual)) {
    donut.style.setProperty('--value', String(meta.visual));
  }

  const strong = donut.querySelector('.sep-donut-label strong');
  const small = donut.querySelector('.sep-donut-label small');
  if (strong && strong.textContent !== meta.label) strong.textContent = meta.label;
  if (small && small.textContent !== 'Disponibilidade') small.textContent = 'Disponibilidade';

  const ariaLabel = `${meta.label} de itens disponíveis: ${data.availableItems} de ${data.totalItems}, incluindo os separados em produção`;
  if (donut.getAttribute('aria-label') !== ariaLabel) donut.setAttribute('aria-label', ariaLabel);
}

function patchCards() {
  patchQueued = false;
  if (currentRoute() !== 'estoque') return;

  document.querySelectorAll('[data-separated-project]').forEach(card => {
    const projectId = card.dataset.separatedProject || '';
    if (!projectId) return;

    const donut = normalizeIndicator(card);
    if (!donut) return;

    updateDonut(donut, availabilityForProject(projectId));
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
