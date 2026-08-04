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
let activeProjectId = '';
let stopMaterials = null;
let patchQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function companyAvailableQty(material) {
  const baseAvailable = availableQty(material);
  const sentToPainting = Math.max(0, quantityNumber(material, material.paintingSentQty));
  const returnedFromPainting = Math.max(0, quantityNumber(material, material.paintingReturnedQty));
  const awayAtPainting = Math.max(0, sentToPainting - returnedFromPainting);
  const deliveredToSite = Math.max(0, quantityNumber(material, material.siteDeliveredQty));

  // Separado em produção permanece disponível.
  return Math.max(0, baseAvailable - awayAtPainting - deliveredToSite);
}

function percentage(value, total) {
  const exact = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return {
    visual: exact > 0 ? Math.max(1.2, exact) : 0,
    label: exact > 0 && exact < 1 ? '<1%' : `${Math.round(exact)}%`
  };
}

function ensureStyle() {
  if (document.querySelector('#availabilityItemPercentStyle')) return;
  const style = document.createElement('style');
  style.id = 'availabilityItemPercentStyle';
  style.textContent = `
    [data-tracking-stage="disponivel"] .trk-donut[data-item-percent]{
      background:conic-gradient(var(--ring) calc(var(--item-percent-value)*1%),rgba(255,255,255,.14) 0)!important;
    }
    [data-tracking-stage="disponivel"] .trk-donut strong[data-item-percent-label]{font-size:0!important}
    [data-tracking-stage="disponivel"] .trk-donut strong[data-item-percent-label]::after{
      content:attr(data-item-percent-label);font-size:15px;
    }
    .trk-progress-card[data-item-percent] .trk-progress i{
      width:var(--item-percent-width)!important;
    }
    .trk-progress-card[data-item-percent] .trk-progress-head strong[data-item-progress-label]{font-size:0!important}
    .trk-progress-card[data-item-percent] .trk-progress-head strong[data-item-progress-label]::after{
      content:attr(data-item-progress-label);font-size:14px;
    }
  `;
  document.head.appendChild(style);
}

function patch() {
  patchQueued = false;
  if (currentRoute() !== 'estoque' || !activeProjectId) return;

  const stage = document.querySelector('[data-tracking-stage="disponivel"]');
  if (!stage) return;

  const materials = Object.values(materialsByProject[activeProjectId] || {});
  const totalItems = materials.length;
  const availableItems = materials.filter(material => companyAvailableQty(material) > 0).length;
  const meta = percentage(availableItems, totalItems);

  ensureStyle();

  const donut = stage.querySelector('.trk-donut');
  const donutLabel = donut?.querySelector('strong');
  if (donut) {
    donut.dataset.itemPercent = 'true';
    donut.style.setProperty('--item-percent-value', String(meta.visual));
  }
  if (donutLabel) donutLabel.dataset.itemPercentLabel = meta.label;

  if (!stage.classList.contains('active')) return;

  const progress = document.querySelector('.trk-progress-card');
  const progressStrong = progress?.querySelector('.trk-progress-head strong');
  const quantityText = stage.querySelector('.trk-stage-copy span')?.textContent?.trim() || '';
  const progressText = quantityText
    ? `${meta.label} dos itens · ${quantityText}`
    : `${meta.label} dos itens · ${availableItems} de ${totalItems} itens`;

  if (progress) {
    progress.dataset.itemPercent = 'true';
    progress.style.setProperty('--item-percent-width', `${meta.visual}%`);
  }
  if (progressStrong) progressStrong.dataset.itemProgressLabel = progressText;
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(() => setTimeout(patch, 0));
}

onAuthStateChanged(auth, user => {
  stopMaterials?.();
  stopMaterials = null;
  materialsByProject = {};

  if (!user) return;
  stopMaterials = onValue(ref(db, 'materials'), snapshot => {
    materialsByProject = snapshot.val() || {};
    queuePatch();
  }, error => console.error('Falha ao restaurar percentual disponível por itens:', error));
});

document.addEventListener('click', event => {
  const card = event.target.closest?.('[data-separated-project]');
  if (card && currentRoute() === 'estoque') {
    activeProjectId = card.dataset.separatedProject || '';
    setTimeout(queuePatch, 0);
    setTimeout(queuePatch, 100);
    setTimeout(queuePatch, 350);
    return;
  }

  if (event.target.closest?.('[data-tracking-stage]')) {
    setTimeout(queuePatch, 0);
    setTimeout(queuePatch, 120);
  }

  if (event.target.closest?.('#trackingBack')) {
    activeProjectId = '';
  }
}, true);

document.addEventListener('keydown', event => {
  const card = event.target.closest?.('[data-separated-project]');
  if (card && currentRoute() === 'estoque' && (event.key === 'Enter' || event.key === ' ')) {
    activeProjectId = card.dataset.separatedProject || '';
    setTimeout(queuePatch, 100);
  }
}, true);

window.addEventListener('hashchange', () => {
  if (currentRoute() !== 'estoque') activeProjectId = '';
  queuePatch();
});

const view = document.querySelector('#view');
if (view) new MutationObserver(queuePatch).observe(view, { childList: true, subtree: true });
