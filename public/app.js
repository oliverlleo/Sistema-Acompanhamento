import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase, ref, onValue, get, set, update, remove, push
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const firebaseConfig = {
  apiKey: 'AIzaSyDtfxhvronefOV9MoDj-GvUUiJ3TLfb8qc',
  authDomain: 'sistemsquared.firebaseapp.com',
  databaseURL: 'https://sistemsquared-default-rtdb.firebaseio.com',
  projectId: 'sistemsquared',
  storageBucket: 'sistemsquared.firebasestorage.app',
  messagingSenderId: '43452051582',
  appId: '1:43452051582:web:08a19296448eb66d0b282f'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const now = () => Date.now();
const todayISO = () => new Date().toISOString().slice(0, 10);
const num = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;
  let text = String(value).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
};
const normalizedQuantityUnit = (material = {}) => String(material.unit || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const isDecimalQuantity = (material = {}) => ['m', 'm2', 'm²', 'metro', 'metros', 'kg'].includes(normalizedQuantityUnit(material));
const quantityNum = (material = {}, value) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    if (isDecimalQuantity(material) && Number.isInteger(value) && Math.abs(value) >= 1000) return value / 1000;
    return value;
  }
  let text = String(value).trim().replace(/\s/g, '');
  if (!text) return 0;
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) text = text.replace(',', '.');
  else if (text.includes('.') && !isDecimalQuantity(material) && /^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const fmtQty = (n) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(num(n));
const fmtDate = (value) => {
  if (!value) return '—';
  const d = typeof value === 'number' ? new Date(value) : new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR').format(d);
};
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const normalizeText = (value = '') => String(value)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
const isPast = (date) => date && new Date(`${date}T23:59:59`).getTime() < Date.now();
const initials = (name = 'U') => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();

const STATUS = {
  comprar: { label: 'Precisa comprar', tone: 'danger', stage: 0 },
  reservar_estoque: { label: 'Reservar no estoque', tone: 'warning', stage: 5 },
  aguardando_entrega: { label: 'Aguardando entrega', tone: 'info', stage: 25 },
  compra_atrasada: { label: 'Compra atrasada', tone: 'danger', stage: 25 },
  recebido_parcial: { label: 'Recebido parcialmente', tone: 'warning', stage: 38 },
  atendimento_parcial: { label: 'Atendimento parcial', tone: 'warning', stage: 50 },
  aguarda_pintura: { label: 'Aguardando pintura', tone: 'violet', stage: 48 },
  em_pintura: { label: 'Em pintura', tone: 'violet', stage: 60 },
  pintura_atrasada: { label: 'Pintura atrasada', tone: 'danger', stage: 60 },
  pronto_separar: { label: 'Pronto para separar', tone: 'success', stage: 74 },
  separado_parcial: { label: 'Separado parcialmente', tone: 'warning', stage: 80 },
  separado: { label: 'Separado para obra', tone: 'success', stage: 90 },
  enviado_parcial: { label: 'Enviado parcialmente', tone: 'warning', stage: 94 },
  enviado_obra: { label: 'Enviado para obra', tone: 'success', stage: 100 }
};

const ROUTES = {
  dashboard: ['Visão geral', 'Acompanhamento completo das obras'],
  obras: ['Obras', 'Cadastre e acompanhe cada obra separadamente'],
  materiais: ['Materiais', 'Visão completa de cada item e de todas as etapas'],
  compras: ['Compras', 'Parcelas de compra que ainda precisam ser registradas'],
  recebimento: ['Recebimento', 'Confirmação das entregas e quantidades recebidas'],
  pintura: ['Pintura', 'Envio, prazo e retorno dos itens que exigem pintura'],
  separacao: ['Separação', 'Materiais disponíveis que precisam ser separados para a obra'],
  estoque: ['Acompanhamento', 'Compras, pintura, conferência e separação por obra'],
  importar: ['Importar arquivos', 'Suba planilhas e PDFs sem perder o formato de origem'],
  usuarios: ['Usuários', 'Perfis e permissões da equipe']
};

const state = {
  user: null,
  profile: null,
  route: 'dashboard',
  projects: {},
  summaries: {},
  currentProjectId: localStorage.getItem('obraflow.currentProject') || '',
  materials: {},
  activities: {},
  inventory: {},
  users: {},
  filters: { search: '', status: 'todos', category: 'todas' },
  importer: {
    file: null, type: '', fileName: '', workbook: null, sheetNames: [], selectedSheet: '',
    matrix: [], headerRow: 0, headers: [], mapping: {}, rows: [], rawPdfLines: [], parser: '',
    defaultSource: 'compra', defaultPainting: false
  },
  unsubs: { projects: null, summaries: null, materials: null, activities: null, inventory: null, users: null }
};

function roleLabel(role) {
  return ({ gerente: 'Gerente', compras: 'Compras', almoxarifado: 'Almoxarifado', producao: 'Produção', operador: 'Operador' })[role] || 'Operador';
}
function isManager() { return state.profile?.role === 'gerente'; }
function canManageProjects() { return ['gerente', 'compras'].includes(state.profile?.role); }
function activeProject() { return state.projects[state.currentProjectId] || null; }
function currentMaterials() { return Object.values(state.materials || {}); }
function statusMeta(status) { return STATUS[status] || STATUS.comprar; }
function statusPill(status) {
  const meta = statusMeta(status);
  return `<span class="status-pill status-${meta.tone}">${escapeHtml(meta.label)}</span>`;
}

function materialAllocation(material) {
  const required = Math.max(0, quantityNum(material, material.qtyRequired));
  const source = material.source || 'pendente';
  if (source === 'estoque') return { required, source, stockQty: required, purchaseQty: 0, unallocatedQty: 0 };
  if (source === 'compra') return { required, source, stockQty: 0, purchaseQty: required, unallocatedQty: 0 };
  if (source === 'misto') {
    const stockQty = clamp(quantityNum(material, material.stockRequiredQty), 0, required);
    const hasPurchase = material.purchaseRequiredQty !== undefined && material.purchaseRequiredQty !== null && material.purchaseRequiredQty !== '';
    const purchaseQty = clamp(hasPurchase ? quantityNum(material, material.purchaseRequiredQty) : required - stockQty, 0, required - stockQty);
    return { required, source, stockQty, purchaseQty, unallocatedQty: Math.max(0, required - stockQty - purchaseQty) };
  }
  return { required, source, stockQty: 0, purchaseQty: 0, unallocatedQty: required };
}

function materialPurchaseCommitted(material) {
  const { purchaseQty } = materialAllocation(material);
  if (purchaseQty <= 0) return true;
  if (material.purchaseDate || material.orderNumber || quantityNum(material, material.qtyReceived) > 0) return true;
  return ['aguardando_entrega', 'compra_atrasada', 'recebido_parcial'].includes(material.status);
}

function materialReceivedPurchaseQty(material) {
  const { purchaseQty } = materialAllocation(material);
  return clamp(quantityNum(material, material.qtyReceived), 0, purchaseQty);
}

function materialAvailableQty(material) {
  const { required, stockQty } = materialAllocation(material);
  return clamp(stockQty + materialReceivedPurchaseQty(material), 0, required);
}

function materialSeparableQty(material) {
  const { required } = materialAllocation(material);
  const available = materialAvailableQty(material);
  if (!material.paintingRequired) return available;
  return clamp(quantityNum(material, material.paintingReturnedQty), 0, Math.min(required, available));
}

function materialCommittedQty(material) {
  const { required, stockQty, purchaseQty } = materialAllocation(material);
  const purchased = purchaseQty > 0 && materialPurchaseCommitted(material) ? purchaseQty : 0;
  return clamp(stockQty + purchased, 0, required);
}

function materialPurchaseNeedsAction(material) {
  const { purchaseQty } = materialAllocation(material);
  return purchaseQty > 0 && !materialPurchaseCommitted(material);
}

function deriveMaterialStatus(material) {
  const { required, stockQty, purchaseQty, unallocatedQty } = materialAllocation(material);
  const delivered = quantityNum(material, material.siteDeliveredQty);
  const separated = quantityNum(material, material.separatedQty);
  const received = materialReceivedPurchaseQty(material);
  const available = materialAvailableQty(material);
  const paintSent = quantityNum(material, material.paintingSentQty);
  const paintReturned = quantityNum(material, material.paintingReturnedQty);

  if (required > 0 && delivered >= required) return 'enviado_obra';
  if (delivered > 0) return 'enviado_parcial';
  if (required > 0 && separated >= required) return 'separado';
  if (separated > 0) return 'separado_parcial';

  if (material.paintingRequired) {
    if (required > 0 && paintReturned >= required) return 'pronto_separar';
    if (paintReturned > 0) return 'pronto_separar';
    if (paintSent > 0) return isPast(material.paintingEta) ? 'pintura_atrasada' : 'em_pintura';
  }

  if (required > 0 && available >= required) return material.paintingRequired ? 'aguarda_pintura' : 'pronto_separar';
  if (available > 0) {
    if (unallocatedQty > 0 || (purchaseQty > 0 && !materialPurchaseCommitted(material))) return 'atendimento_parcial';
    return material.paintingRequired ? 'aguarda_pintura' : 'recebido_parcial';
  }
  if (unallocatedQty > 0) return 'comprar';
  if (purchaseQty > 0) {
    if (!materialPurchaseCommitted(material)) return 'comprar';
    if (received < purchaseQty) return isPast(material.deliveryEta) ? 'compra_atrasada' : 'aguardando_entrega';
  }
  if (stockQty > 0) return material.paintingRequired ? 'aguarda_pintura' : 'pronto_separar';
  return 'comprar';
}

function progressForMaterial(material) {
  const status = material.status || deriveMaterialStatus(material);
  if (['enviado_obra', 'enviado_parcial', 'separado', 'separado_parcial', 'em_pintura', 'pintura_atrasada', 'pronto_separar'].includes(status)) {
    return statusMeta(status).stage;
  }
  const { required, stockQty, purchaseQty } = materialAllocation(material);
  if (!required) return statusMeta(status).stage;
  const stockStage = stockQty > 0 ? statusMeta(material.paintingRequired ? 'aguarda_pintura' : 'pronto_separar').stage : 0;
  let purchaseStage = 0;
  if (purchaseQty > 0 && materialPurchaseCommitted(material)) {
    const received = materialReceivedPurchaseQty(material);
    if (received >= purchaseQty) purchaseStage = statusMeta(material.paintingRequired ? 'aguarda_pintura' : 'pronto_separar').stage;
    else if (received > 0) purchaseStage = statusMeta('recebido_parcial').stage;
    else purchaseStage = statusMeta('aguardando_entrega').stage;
  }
  return Math.round(((stockQty * stockStage) + (purchaseQty * purchaseStage)) / required);
}

function nextAction(material) {
  const status = material.status || deriveMaterialStatus(material);
  const actions = {
    comprar: ['Registrar compra', 'purchase'],
    reservar_estoque: ['Reservar estoque', 'reserve'],
    aguardando_entrega: ['Confirmar chegada', 'receive'],
    compra_atrasada: ['Confirmar chegada', 'receive'],
    recebido_parcial: [material.paintingRequired ? 'Enviar para pintura' : 'Confirmar chegada', material.paintingRequired ? 'send-paint' : 'receive'],
    atendimento_parcial: ['Registrar compra', 'purchase'],
    aguarda_pintura: ['Enviar para pintura', 'send-paint'],
    em_pintura: ['Registrar retorno', 'return-paint'],
    pintura_atrasada: ['Registrar retorno', 'return-paint'],
    pronto_separar: ['Marcar separado', 'separate'],
    separado_parcial: ['Concluir separação', 'separate'],
    separado: ['Enviar para obra', 'deliver'],
    enviado_parcial: ['Concluir envio', 'deliver'],
    enviado_obra: ['Concluído', 'view']
  };
  return actions[status] || ['Editar', 'edit'];
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toastHost').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}
function authErrorMessage(error) {
  const code = error?.code || '';
  if (code.includes('invalid-credential')) return 'E-mail ou senha inválidos.';
  if (code.includes('email-already-in-use')) return 'Este e-mail já está cadastrado.';
  if (code.includes('weak-password')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (code.includes('network-request-failed')) return 'Falha de conexão. Verifique a internet.';
  if (code.includes('operation-not-allowed')) return 'Ative o provedor E-mail/Senha no Firebase Authentication.';
  if (code.includes('permission-denied')) return 'Sem permissão. Verifique as regras e o perfil do usuário.';
  return error?.message || 'Não foi possível concluir a operação.';
}
function setBusy(button, busy, label = 'Salvando...') {
  if (!button) return;
  if (busy) { button.dataset.original = button.textContent; button.textContent = label; button.disabled = true; }
  else { button.textContent = button.dataset.original || button.textContent; button.disabled = false; }
}

function openModal({ title, subtitle = '', body = '', footer = '', small = false }) {
  $('#modalRoot').innerHTML = `
    <div class="modal-backdrop">
      <section class="modal ${small ? 'modal-sm' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <header class="modal-head">
          <div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>
          <button class="icon-btn modal-close" data-close-modal="true" aria-label="Fechar">×</button>
        </header>
        <div class="modal-body">${body}</div>
        ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
      </section>
    </div>`;
  const backdrop = $('.modal-backdrop');
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
}
function closeModal() { $('#modalRoot').innerHTML = ''; }

function projectOptions(includeEmpty = false) {
  const projects = Object.entries(state.projects).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
  const first = includeEmpty ? '<option value="">Selecione a obra</option>' : '';
  return first + projects.map(([id, p]) => `<option value="${id}" ${id === state.currentProjectId ? 'selected' : ''}>${escapeHtml(p.code ? `${p.code} - ${p.name}` : p.name)}</option>`).join('');
}

function updateProjectSelect() {
  const select = $('#globalProjectSelect');
  if (!select) return;
  const ids = Object.keys(state.projects);
  if (!state.currentProjectId || !state.projects[state.currentProjectId]) {
    state.currentProjectId = ids[0] || '';
    if (state.currentProjectId) localStorage.setItem('obraflow.currentProject', state.currentProjectId);
  }
  select.innerHTML = ids.length ? projectOptions(false) : '<option value="">Nenhuma obra</option>';
  select.disabled = !ids.length;
}

function updateUserUI() {
  if (!state.profile) return;
  $('#sidebarUser').innerHTML = `<span class="avatar">${escapeHtml(initials(state.profile.name))}</span><span class="user-meta"><strong>${escapeHtml(state.profile.name || state.user.email)}</strong><small>${escapeHtml(roleLabel(state.profile.role))}</small></span>`;
  $$('.manager-only').forEach(el => el.hidden = !isManager());
}

function setRoute(route, options = {}) {
  if (!ROUTES[route]) route = 'dashboard';
  if (route === 'usuarios' && !isManager()) route = 'dashboard';
  if (options.projectId && state.projects[options.projectId]) {
    state.currentProjectId = options.projectId;
    localStorage.setItem('obraflow.currentProject', options.projectId);
    updateProjectSelect();
    listenProjectData(options.projectId);
  }
  state.route = route;
  const [title, subtitle] = ROUTES[route];
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = subtitle;
  $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.route === route));
  renderCurrent();
  closeMobileSidebar();
  history.replaceState(null, '', `#${route}`);
}

function renderCurrent() {
  if (!state.profile) return;
  const renderers = {
    dashboard: renderDashboard,
    obras: renderProjects,
    materiais: () => renderMaterialQueue('materiais'),
    compras: () => renderMaterialQueue('compras'),
    recebimento: () => renderMaterialQueue('recebimento'),
    pintura: () => renderMaterialQueue('pintura'),
    separacao: () => renderMaterialQueue('separacao'),
    estoque: () => {
      const renderer = window.ObraFlowSeparatedProjects?.render;
      if (renderer) renderer();
      else $('#view').innerHTML = '<div class="card"><div class="empty"><div><div class="empty-icon">✓</div><h3>Carregando materiais separados</h3><p>Organizando as obras e categorias...</p></div></div></div>';
    },
    importar: renderImporter,
    usuarios: renderUsers
  };
  (renderers[state.route] || renderDashboard)();
}

function openMobileSidebar() {
  $('#sidebar').classList.add('open');
  $('#sidebarBackdrop').hidden = false;
}
function closeMobileSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebarBackdrop').hidden = true;
}

// ---------- Autenticação e sincronização ----------
$('#showSignupBtn').addEventListener('click', () => { $('#loginForm').hidden = true; $('#signupForm').hidden = false; });
$('#showLoginBtn').addEventListener('click', () => { $('#signupForm').hidden = true; $('#loginForm').hidden = false; });

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Entrando...');
  $('#authMessage').textContent = '';
  try {
    await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
  } catch (error) {
    $('#authMessage').textContent = authErrorMessage(error);
  } finally { setBusy(button, false); }
});

$('#signupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Criando...');
  $('#signupMessage').textContent = '';
  try {
    const credential = await createUserWithEmailAndPassword(auth, $('#signupEmail').value.trim(), $('#signupPassword').value);
    await set(ref(db, `users/${credential.user.uid}`), {
      name: $('#signupName').value.trim(),
      email: credential.user.email,
      role: 'operador', active: true, createdAt: now(), updatedAt: now()
    });
    toast('Acesso criado. A gerente pode ajustar o perfil na tela Usuários.');
  } catch (error) {
    $('#signupMessage').textContent = authErrorMessage(error);
  } finally { setBusy(button, false); }
});

$('#logoutBtn').addEventListener('click', () => signOut(auth));
$('#openSidebarBtn').addEventListener('click', openMobileSidebar);
$('#closeSidebarBtn').addEventListener('click', closeMobileSidebar);
$('#sidebarBackdrop').addEventListener('click', closeMobileSidebar);
$('#mainNav').addEventListener('click', (e) => {
  const button = e.target.closest('[data-route]');
  if (button) setRoute(button.dataset.route);
});
$('#globalProjectSelect').addEventListener('change', (e) => {
  state.currentProjectId = e.target.value;
  localStorage.setItem('obraflow.currentProject', state.currentProjectId);
  listenProjectData(state.currentProjectId);
  renderCurrent();
});
$('#quickAddBtn').addEventListener('click', () => openMaterialModal());
window.addEventListener('online', () => { $('#offlineBanner').hidden = true; toast('Conexão restabelecida.'); });
window.addEventListener('offline', () => { $('#offlineBanner').hidden = false; });

onAuthStateChanged(auth, async (user) => {
  stopAllListeners();
  state.user = user;
  state.profile = null;
  if (!user) {
    $('#authScreen').hidden = false;
    $('#appShell').hidden = true;
    return;
  }

  try {
    let profileSnap = await get(ref(db, `users/${user.uid}`));
    if (!profileSnap.exists()) {
      await set(ref(db, `users/${user.uid}`), {
        name: user.displayName || user.email.split('@')[0], email: user.email,
        role: 'operador', active: true, createdAt: now(), updatedAt: now()
      });
      profileSnap = await get(ref(db, `users/${user.uid}`));
    }
    state.profile = profileSnap.val();
    if (state.profile.active === false) {
      await signOut(auth);
      alert('Seu acesso está desativado. Procure a gerente.');
      return;
    }

    $('#authScreen').hidden = true;
    $('#appShell').hidden = false;
    updateUserUI();
    startCoreListeners();
    const hashRoute = location.hash.replace('#', '');
    setRoute(ROUTES[hashRoute] ? hashRoute : 'dashboard');
  } catch (error) {
    $('#authScreen').hidden = false;
    $('#appShell').hidden = true;
    $('#authMessage').textContent = authErrorMessage(error);
  }
});

function stopAllListeners() {
  Object.keys(state.unsubs).forEach(key => {
    if (typeof state.unsubs[key] === 'function') state.unsubs[key]();
    state.unsubs[key] = null;
  });
  state.projects = {}; state.summaries = {}; state.materials = {}; state.activities = {};
  state.inventory = {}; state.users = {};
}

function startCoreListeners() {
  state.unsubs.projects = onValue(ref(db, 'projects'), (snap) => {
    state.projects = snap.val() || {};
    updateProjectSelect();
    if (state.currentProjectId) listenProjectData(state.currentProjectId);
    renderCurrent();
  }, (error) => toast(authErrorMessage(error), 'error'));

  state.unsubs.summaries = onValue(ref(db, 'projectSummaries'), (snap) => {
    state.summaries = snap.val() || {};
    if (state.route === 'dashboard' || state.route === 'obras' || state.route === 'materiais') renderCurrent();
  });
}

function listenProjectData(projectId) {
  if (typeof state.unsubs.materials === 'function') state.unsubs.materials();
  if (typeof state.unsubs.activities === 'function') state.unsubs.activities();
  state.materials = {}; state.activities = {};
  if (!projectId) return;
  state.unsubs.materials = onValue(ref(db, `materials/${projectId}`), (snap) => {
    state.materials = snap.val() || {};
    refreshCurrentStatuses();
    if (['materiais', 'compras', 'recebimento', 'pintura', 'separacao', 'importar'].includes(state.route)) renderCurrent();
  });
  state.unsubs.activities = onValue(ref(db, `activities/${projectId}`), (snap) => {
    state.activities = snap.val() || {};
    if (state.route === 'materiais') renderCurrent();
  });
}

function ensureInventoryListener() {
  if (state.unsubs.inventory) return;
  state.unsubs.inventory = onValue(ref(db, 'inventory'), (snap) => {
    state.inventory = snap.val() || {};
    if (state.route === 'estoque') renderInventory();
  });
}
function ensureUsersListener() {
  if (state.unsubs.users || !isManager()) return;
  state.unsubs.users = onValue(ref(db, 'users'), (snap) => {
    state.users = snap.val() || {};
    if (state.route === 'usuarios') renderUsers();
  });
}

async function logActivity(projectId, type, message, materialId = '') {
  if (!projectId || !state.user) return;
  const activityRef = push(ref(db, `activities/${projectId}`));
  await set(activityRef, {
    type, message, materialId, userId: state.user.uid,
    userName: state.profile?.name || state.user.email, createdAt: now()
  });
}

async function recalculateProjectSummary(projectId) {
  if (!projectId) return;
  const snap = await get(ref(db, `materials/${projectId}`));
  const materials = Object.values(snap.val() || {});
  const summary = {
    total: materials.length, completed: 0, pending: 0, committed: 0, commitmentProgress: 0,
    definirOrigem: 0, comprar: 0, aguardandoEntrega: 0, comprasAtrasadas: 0,
    pintura: 0, pinturaAtrasada: 0, separar: 0, separados: 0,
    enviados: 0, progress: 0, updatedAt: now()
  };
  let progressSum = 0;
  let requiredSum = 0;
  let committedSum = 0;
  materials.forEach(item => {
    const allocation = materialAllocation(item);
    const status = deriveMaterialStatus(item);
    const received = materialReceivedPurchaseQty(item);
    const committed = materialCommittedQty(item);
    const separated = quantityNum(item, item.separatedQty);
    const delivered = quantityNum(item, item.siteDeliveredQty);
    const separable = materialSeparableQty(item);

    progressSum += progressForMaterial(item);
    requiredSum += allocation.required;
    committedSum += committed;
    if (allocation.required > 0 && committed >= allocation.required) summary.committed += 1;
    else summary.pending += 1;

    if (status === 'enviado_obra') { summary.completed += 1; summary.enviados += 1; }
    if (allocation.unallocatedQty > 0) summary.definirOrigem += 1;
    else if (materialPurchaseNeedsAction(item)) summary.comprar += 1;
    if (allocation.purchaseQty > 0 && materialPurchaseCommitted(item) && received < allocation.purchaseQty) {
      if (isPast(item.deliveryEta)) summary.comprasAtrasadas += 1;
      else summary.aguardandoEntrega += 1;
    }
    if (item.paintingRequired && !['separado', 'enviado_parcial', 'enviado_obra'].includes(status)) {
      if (status === 'pintura_atrasada') summary.pinturaAtrasada += 1;
      else if (materialAvailableQty(item) > 0 || quantityNum(item, item.paintingSentQty) > 0) summary.pintura += 1;
    }
    if (separable > separated || (separated > delivered && delivered < allocation.required)) summary.separar += 1;
    if (allocation.required > 0 && separated >= allocation.required && delivered < allocation.required) summary.separados += 1;
  });
  summary.progress = materials.length ? Math.round(progressSum / materials.length) : 0;
  summary.commitmentProgress = requiredSum ? Math.round((committedSum / requiredSum) * 100) : 0;
  await set(ref(db, `projectSummaries/${projectId}`), summary);
}

// ---------- Dashboard e obras ----------
function renderDashboard() {
  const view = $('#view');
  const projects = Object.entries(state.projects).sort((a, b) => (a[1].deadline || '9999').localeCompare(b[1].deadline || '9999'));
  const summaries = Object.values(state.summaries);
  const totalPending = summaries.reduce((sum, s) => sum + num(s.pending), 0);
  const purchaseIssues = summaries.reduce((sum, s) => sum + num(s.definirOrigem) + num(s.comprar) + num(s.comprasAtrasadas), 0);
  const paintingIssues = summaries.reduce((sum, s) => sum + num(s.pintura) + num(s.pinturaAtrasada), 0);
  const activeWorks = projects.filter(([, p]) => p.status !== 'concluida' && p.status !== 'cancelada').length;

  const alerts = [];
  projects.forEach(([id, project]) => {
    const s = state.summaries[id] || {};
    if (num(s.comprasAtrasadas)) alerts.push({ tone: 'danger', title: `${project.name}: ${s.comprasAtrasadas} compra(s) atrasada(s)`, text: 'Verifique o fornecedor e atualize a previsão de chegada.', projectId: id, route: 'compras' });
    if (num(s.pinturaAtrasada)) alerts.push({ tone: 'danger', title: `${project.name}: ${s.pinturaAtrasada} item(ns) com pintura atrasada`, text: 'Confirme o retorno da pintura para liberar a separação.', projectId: id, route: 'pintura' });
    if (num(s.definirOrigem)) alerts.push({ tone: 'warning', title: `${project.name}: ${s.definirOrigem} item(ns) sem origem definida`, text: 'Defina compra, estoque ou uma divisão entre as duas origens.', projectId: id, route: 'materiais' });
    if (num(s.comprar)) alerts.push({ tone: 'warning', title: `${project.name}: ${s.comprar} item(ns) com compra não registrada`, text: 'Registre fornecedor, pedido e previsão de chegada.', projectId: id, route: 'compras' });
  });

  view.innerHTML = `
    <div class="page-head">
      <div><h2>Bom dia, ${escapeHtml((state.profile.name || '').split(' ')[0])}</h2><p>Veja rapidamente o que está resolvido e o que precisa de atenção.</p></div>
      <div class="page-actions">${canManageProjects() ? '<button class="btn btn-ghost" data-action="new-project">+ Nova obra</button>' : ''}<button class="btn btn-primary" data-action="new-material">+ Material</button></div>
    </div>
    <section class="grid kpi-grid">
      ${kpiCard('Obras ativas', activeWorks, `${projects.length} obra(s) cadastrada(s)`, '▣', '')}
      ${kpiCard('Itens a empenhar', totalPending, 'Sem origem definida ou compra registrada', '≡', 'warning')}
      ${kpiCard('Origem/compras para agir', purchaseIssues, 'Sem origem, sem compra ou fora do prazo', '◎', 'danger')}
      ${kpiCard('Fluxo de pintura', paintingIssues, 'Aguardando, em andamento ou atrasado', '◒', 'info')}
    </section>
    <section class="grid dashboard-grid">
      <div class="card">
        <div class="card-head"><h3>Andamento das obras</h3><button class="btn btn-ghost btn-sm" data-route-link="obras">Ver todas</button></div>
        ${projects.length ? `<div class="project-list">${projects.slice(0, 7).map(([id, p]) => projectRow(id, p)).join('')}</div>` : emptyState('▣', 'Nenhuma obra cadastrada', 'Crie a primeira obra para começar a organizar os materiais.', canManageProjects() ? '<button class="btn btn-primary" data-action="new-project">Criar obra</button>' : '')}
      </div>
      <div class="card">
        <div class="card-head"><h3>Pontos de atenção</h3><span class="status-pill status-${alerts.length ? 'danger' : 'ok'}">${alerts.length ? `${alerts.length} alerta(s)` : 'Tudo em ordem'}</span></div>
        <div class="card-body">
          ${alerts.length ? `<div class="alerts">${alerts.slice(0, 8).map(a => `<button class="alert-item ${a.tone}" data-alert-project="${a.projectId}" data-alert-route="${a.route}" style="width:100%;text-align:left"><span class="alert-dot"></span><span class="alert-copy"><strong>${escapeHtml(a.title)}</strong><p>${escapeHtml(a.text)}</p></span></button>`).join('')}</div>` : `<div class="empty" style="min-height:180px"><div><div class="empty-icon">✓</div><h3>Nenhuma urgência agora</h3><p>As obras não têm atrasos registrados.</p></div></div>`}
        </div>
      </div>
    </section>`;

  bindCommonPageActions(view);
  $$('[data-alert-project]', view).forEach(btn => btn.addEventListener('click', () => setRoute(btn.dataset.alertRoute, { projectId: btn.dataset.alertProject })));
}

function kpiCard(label, value, foot, icon, tone) {
  return `<article class="kpi-card ${tone}"><div class="kpi-top"><span>${escapeHtml(label)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${fmtQty(value)}</div><div class="kpi-foot">${escapeHtml(foot)}</div></article>`;
}
function emptyState(icon, title, text, action = '') {
  return `<div class="empty"><div><div class="empty-icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div></div>`;
}
function projectRow(id, project) {
  const s = state.summaries[id] || { progress: 0, pending: 0 };
  const urgency = num(s.comprasAtrasadas) + num(s.pinturaAtrasada);
  return `<div class="project-row" data-project-open="${id}">
    <div class="project-name"><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.code || 'Sem código')} · Prazo ${fmtDate(project.deadline)}</small></div>
    <div><div class="progress"><span style="width:${clamp(num(s.progress), 0, 100)}%"></span></div><div class="progress-meta"><span>${num(s.progress)}%</span><span>${num(s.pending)} a empenhar</span></div></div>
    <div>${urgency ? `<span class="status-pill status-danger">${urgency} atraso(s)</span>` : `<span class="status-pill status-ok">No prazo</span>`}</div>
    <div class="right"><button class="btn btn-ghost btn-sm">Abrir →</button></div>
  </div>`;
}

function renderProjects() {
  const view = $('#view');
  const projects = Object.entries(state.projects).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
  view.innerHTML = `
    <div class="page-head"><div><h2>Obras cadastradas</h2><p>Cada obra possui seus próprios materiais, prazos e pendências.</p></div><div class="page-actions">${canManageProjects() ? '<button class="btn btn-primary" data-action="new-project">+ Nova obra</button>' : ''}</div></div>
    ${projects.length ? `<section class="grid project-cards">${projects.map(([id, project]) => projectCard(id, project)).join('')}</section>` : `<div class="card">${emptyState('▣', 'Nenhuma obra cadastrada', 'Crie a primeira obra e depois adicione ou importe os materiais.', canManageProjects() ? '<button class="btn btn-primary" data-action="new-project">Criar obra</button>' : '')}</div>`}`;
  bindCommonPageActions(view);
  $$('[data-project-open]', view).forEach(el => el.addEventListener('click', () => setRoute('materiais', { projectId: el.dataset.projectOpen })));
  $$('[data-edit-project]', view).forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); openProjectModal(el.dataset.editProject); }));
}

function projectCard(id, project) {
  const s = state.summaries[id] || {};
  const urgency = num(s.comprasAtrasadas) + num(s.pinturaAtrasada);
  return `<article class="card project-card" data-project-open="${id}">
    <div class="project-card-head"><div><span class="project-code">${escapeHtml(project.code || 'SEM CÓDIGO')}</span><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.client || project.address || 'Cliente não informado')}</p></div><button class="icon-btn" data-edit-project="${id}" aria-label="Editar obra">⋯</button></div>
    <div class="progress"><span style="width:${clamp(num(s.progress), 0, 100)}%"></span></div><div class="progress-meta"><span>${num(s.progress)}% concluído</span><span>Prazo ${fmtDate(project.deadline)}</span></div>
    <div class="project-stats"><div class="project-stat"><strong>${num(s.total)}</strong><span>Itens</span></div><div class="project-stat"><strong>${num(s.pending)}</strong><span>A empenhar</span></div><div class="project-stat"><strong>${urgency}</strong><span>Atrasos</span></div></div>
  </article>`;
}

function bindCommonPageActions(root) {
  $$('[data-action="new-project"]', root).forEach(btn => btn.addEventListener('click', () => openProjectModal()));
  $$('[data-action="new-material"]', root).forEach(btn => btn.addEventListener('click', () => openMaterialModal()));
  $$('[data-route-link]', root).forEach(btn => btn.addEventListener('click', () => setRoute(btn.dataset.routeLink)));
  $$('[data-project-open]', root).forEach(el => el.addEventListener('click', () => setRoute('materiais', { projectId: el.dataset.projectOpen })));
}

function openProjectModal(projectId = '') {
  if (!canManageProjects()) { toast('Seu perfil não pode criar ou editar os dados gerais da obra.', 'error'); return; }
  const project = state.projects[projectId] || {};
  openModal({
    title: projectId ? 'Editar obra' : 'Nova obra',
    subtitle: 'Os materiais e etapas ficarão separados por esta obra.',
    body: `<form id="projectForm" class="form-grid">
      <label class="field"><span>Código / número da obra *</span><input name="code" required value="${escapeHtml(project.code || '')}" placeholder="Ex.: 1890" /></label>
      <label class="field"><span>Nome da obra *</span><input name="name" required value="${escapeHtml(project.name || '')}" placeholder="Ex.: Residência DOHO" /></label>
      <label class="field"><span>Cliente</span><input name="client" value="${escapeHtml(project.client || '')}" /></label>
      <label class="field"><span>Prazo da obra</span><input name="deadline" type="date" value="${escapeHtml(project.deadline || '')}" /></label>
      <label class="field full"><span>Endereço / local</span><input name="address" value="${escapeHtml(project.address || '')}" /></label>
      <label class="field"><span>Responsável</span><input name="manager" value="${escapeHtml(project.manager || '')}" /></label>
      <label class="field"><span>Status</span><select name="status"><option value="ativa" ${project.status === 'ativa' ? 'selected' : ''}>Ativa</option><option value="pausada" ${project.status === 'pausada' ? 'selected' : ''}>Pausada</option><option value="concluida" ${project.status === 'concluida' ? 'selected' : ''}>Concluída</option><option value="cancelada" ${project.status === 'cancelada' ? 'selected' : ''}>Cancelada</option></select></label>
      <label class="field full"><span>Observações</span><textarea name="notes">${escapeHtml(project.notes || '')}</textarea></label>
    </form>`,
    footer: `${projectId && isManager() ? '<button id="deleteProjectBtn" class="btn btn-danger" style="margin-right:auto">Excluir obra</button>' : ''}<button class="btn btn-ghost" data-close-modal="true">Cancelar</button><button id="saveProjectBtn" class="btn btn-primary">Salvar obra</button>`
  });
  $$('[data-close-modal="true"]', $('#modalRoot')).forEach(b => b.addEventListener('click', closeModal));
  $('#saveProjectBtn').addEventListener('click', async () => {
    const form = $('#projectForm');
    if (!form.reportValidity()) return;
    const button = $('#saveProjectBtn'); setBusy(button, true);
    const data = Object.fromEntries(new FormData(form).entries());
    const id = projectId || push(ref(db, 'projects')).key;
    try {
      await set(ref(db, `projects/${id}`), { ...project, ...data, id, createdAt: project.createdAt || now(), updatedAt: now(), createdBy: project.createdBy || state.user.uid });
      if (!state.summaries[id]) await set(ref(db, `projectSummaries/${id}`), { total: 0, completed: 0, pending: 0, progress: 0, updatedAt: now() });
      state.currentProjectId = id; localStorage.setItem('obraflow.currentProject', id);
      await logActivity(id, projectId ? 'obra_editada' : 'obra_criada', `${projectId ? 'Obra atualizada' : 'Obra criada'}: ${data.name}`);
      closeModal(); toast('Obra salva com sucesso.'); setRoute('materiais', { projectId: id });
    } catch (error) { toast(authErrorMessage(error), 'error'); }
    finally { setBusy(button, false); }
  });
  if ($('#deleteProjectBtn')) $('#deleteProjectBtn').addEventListener('click', async () => {
    if (!confirm('Excluir a obra e todos os seus materiais? Esta ação não pode ser desfeita.')) return;
    try {
      await update(ref(db), { [`projects/${projectId}`]: null, [`materials/${projectId}`]: null, [`activities/${projectId}`]: null, [`projectSummaries/${projectId}`]: null });
      closeModal(); toast('Obra excluída.'); setRoute('obras');
    } catch (error) { toast(authErrorMessage(error), 'error'); }
  });
}

// ---------- Materiais e fluxo operacional ----------
function materialMatchesRoute(material, route) {
  const status = material.status || deriveMaterialStatus(material);
  const allocation = materialAllocation(material);
  const received = materialReceivedPurchaseQty(material);
  const available = materialAvailableQty(material);
  const separable = materialSeparableQty(material);
  const separated = quantityNum(material, material.separatedQty);
  const delivered = quantityNum(material, material.siteDeliveredQty);

  if (route === 'compras') return allocation.purchaseQty > 0 && materialPurchaseNeedsAction(material);
  if (route === 'recebimento') return allocation.purchaseQty > 0 && materialPurchaseCommitted(material) && received < allocation.purchaseQty;
  if (route === 'pintura') {
    return Boolean(material.paintingRequired)
      && !['separado', 'enviado_parcial', 'enviado_obra'].includes(status)
      && (available > quantityNum(material, material.paintingReturnedQty) || quantityNum(material, material.paintingSentQty) > quantityNum(material, material.paintingReturnedQty));
  }
  if (route === 'separacao') return separable > separated || separated > delivered;
  return true;
}

function filteredMaterials(route) {
  const search = normalizeText(state.filters.search);
  return currentMaterials().filter(item => {
    const status = item.status || deriveMaterialStatus(item);
    const category = item.category || 'Sem categoria';
    const haystack = normalizeText([item.code, item.description, item.type, item.color, item.category, item.supplier, item.orderNumber, item.notes, item.dimensions, item.medidas, item.measurements, item.width, item.largura, item.height, item.altura, item.length, item.comprimento, item.medida, item.area, item.areaM2, item.m2, ...Object.values(item.sourceDetails || {})].filter(value => value !== undefined && value !== null && String(value).trim() !== '').join(' '));
    return materialMatchesRoute(item, route)
      && (!search || haystack.includes(search))
      && (state.filters.status === 'todos' || status === state.filters.status)
      && (state.filters.category === 'todas' || category === state.filters.category);
  }).sort((a, b) => {
    const stageDiff = progressForMaterial(a) - progressForMaterial(b);
    return stageDiff || (a.description || '').localeCompare(b.description || '');
  });
}

function renderMaterialQueue(route) {
  const view = $('#view');
  const project = activeProject();
  if (!project) {
    view.innerHTML = `<div class="card">${emptyState('▣', 'Selecione ou crie uma obra', 'Os materiais sempre ficam vinculados a uma obra.', canManageProjects() ? '<button class="btn btn-primary" data-action="new-project">Criar obra</button>' : '')}</div>`;
    bindCommonPageActions(view); return;
  }

  const all = currentMaterials();
  const materials = filteredMaterials(route);
  const summary = state.summaries[state.currentProjectId] || {};
  const categories = [...new Set(all.map(m => m.category || 'Sem categoria'))].sort();
  const routeCopy = {
    materiais: ['Todos os materiais', 'Acompanhe cada item desde a origem até o envio para a obra.'],
    compras: ['Fila de compras', 'Registre pedido, fornecedor e previsão de chegada.'],
    recebimento: ['Aguardando recebimento', 'Informe a quantidade que chegou e mantenha os atrasos visíveis.'],
    pintura: ['Controle de pintura', 'A etapa só aparece para os itens marcados como “vai para pintura”.'],
    separacao: ['Prontos para separação', 'Itens disponíveis que precisam ser separados ou enviados para a obra.']
  }[route];

  view.innerHTML = `
    <section class="detail-hero">
      <div><span class="project-code">OBRA ${escapeHtml(project.code || '')}</span><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(project.client || project.address || 'Sem cliente/local informado')} · Prazo ${fmtDate(project.deadline)}</p></div>
      <div class="detail-score" style="--pct:${clamp(num(summary.progress), 0, 100)}%"><span>${num(summary.progress)}%</span></div>
    </section>
    <section class="flow-strip">
      ${flowCard('Definir / comprar', num(summary.definirOrigem) + num(summary.comprar), num(summary.definirOrigem) + num(summary.comprar) ? 'danger' : '')}
      ${flowCard('Aguardando entrega', num(summary.aguardandoEntrega), '')}
      ${flowCard('Compras atrasadas', num(summary.comprasAtrasadas), num(summary.comprasAtrasadas) ? 'danger' : '')}
      ${flowCard('Em pintura', num(summary.pintura), '')}
      ${flowCard('Pintura atrasada', num(summary.pinturaAtrasada), num(summary.pinturaAtrasada) ? 'danger' : '')}
      ${flowCard('Pronto para separar', num(summary.separar), num(summary.separar) ? 'warning' : '')}
    </section>
    <div class="page-head">
      <div><h2>${routeCopy[0]}</h2><p>${routeCopy[1]}</p></div>
      <div class="page-actions"><button class="btn btn-ghost" data-action="import">⇧ Importar</button><button class="btn btn-primary" data-action="new-material">+ Material</button></div>
    </div>
    <div class="toolbar">
      <input id="materialSearch" class="grow" type="search" placeholder="Buscar código, descrição, fornecedor..." value="${escapeHtml(state.filters.search)}" />
      <select id="statusFilter"><option value="todos">Todos os status</option>${Object.entries(STATUS).map(([key, meta]) => `<option value="${key}" ${state.filters.status === key ? 'selected' : ''}>${escapeHtml(meta.label)}</option>`).join('')}</select>
      <select id="categoryFilter"><option value="todas">Todas as categorias</option>${categories.map(c => `<option value="${escapeHtml(c)}" ${state.filters.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>
      <span class="status-pill status-neutral">${materials.length} item(ns)</span>
    </div>
    ${materials.length ? renderMaterialsTable(materials) : `<div class="card">${emptyState('≡', 'Nenhum item nesta visão', all.length ? 'Ajuste os filtros ou escolha outra etapa do fluxo.' : 'Adicione manualmente ou importe uma planilha/PDF.', all.length ? '' : '<button class="btn btn-primary" data-action="new-material">Adicionar material</button>')}</div>`}
    ${route === 'materiais' ? renderActivityCard() : ''}`;

  bindCommonPageActions(view);
  $$('[data-action="import"]', view).forEach(btn => btn.addEventListener('click', () => setRoute('importar')));
  $('#materialSearch')?.addEventListener('input', (e) => { state.filters.search = e.target.value; renderMaterialQueue(route); $('#materialSearch')?.focus(); });
  $('#statusFilter')?.addEventListener('change', (e) => { state.filters.status = e.target.value; renderMaterialQueue(route); });
  $('#categoryFilter')?.addEventListener('change', (e) => { state.filters.category = e.target.value; renderMaterialQueue(route); });
  bindMaterialTableActions(view);
}

function flowCard(label, value, tone) {
  return `<div class="flow-card ${tone}"><span>${escapeHtml(label)}</span><strong>${fmtQty(value)}</strong></div>`;
}

function renderMaterialsTable(materials) {
  return `<div class="table-wrap"><table class="data-table"><thead><tr>
    <th>Material</th><th>Categoria</th><th>Origem</th><th>Quantidade</th><th>Etapa atual</th><th>Previsão</th><th>Próxima ação</th><th class="right">Ações</th>
  </tr></thead><tbody>${materials.map(materialRow).join('')}</tbody></table></div>`;
}

function materialRow(material) {
  const status = material.status || deriveMaterialStatus(material);
  const allocation = materialAllocation(material);
  const available = materialAvailableQty(material);
  const separable = materialSeparableQty(material);
  const received = materialReceivedPurchaseQty(material);
  const separated = quantityNum(material, material.separatedQty);
  const delivered = quantityNum(material, material.siteDeliveredQty);
  const paintSent = quantityNum(material, material.paintingSentQty);
  const paintReturned = quantityNum(material, material.paintingReturnedQty);
  let [actionLabel, action] = nextAction({ ...material, status });

  if (state.route === 'compras') [actionLabel, action] = ['Registrar compra', 'purchase'];
  else if (state.route === 'recebimento') [actionLabel, action] = ['Confirmar chegada', 'receive'];
  else if (state.route === 'pintura') {
    if (paintSent > paintReturned) [actionLabel, action] = ['Registrar retorno', 'return-paint'];
    else if (available > paintSent) [actionLabel, action] = ['Enviar para pintura', 'send-paint'];
    else [actionLabel, action] = ['Ver material', 'view'];
  } else if (state.route === 'separacao') {
    if (separated < separable) [actionLabel, action] = [separated > 0 ? 'Continuar separação' : 'Marcar separado', 'separate'];
    else if (separated > delivered) [actionLabel, action] = [delivered > 0 ? 'Continuar envio' : 'Enviar para obra', 'deliver'];
    else [actionLabel, action] = ['Ver material', 'view'];
  } else if (state.route === 'materiais' && allocation.unallocatedQty > 0) {
    [actionLabel, action] = ['Definir compra/estoque', 'edit'];
  } else if (state.route === 'materiais' && materialPurchaseNeedsAction(material)) {
    [actionLabel, action] = ['Registrar compra', 'purchase'];
  }

  let currentQty = 0;
  let requiredQty = allocation.required;
  let quantityNote = '';
  if (state.route === 'compras') {
    requiredQty = allocation.purchaseQty;
    quantityNote = 'Parcela de compra';
  } else if (state.route === 'recebimento') {
    currentQty = received;
    requiredQty = allocation.purchaseQty;
    quantityNote = 'Parcela de compra';
  } else if (state.route === 'pintura') {
    currentQty = Math.max(paintSent, paintReturned);
    quantityNote = `Disponível: ${fmtQty(available)} ${material.unit || 'un'}`;
  } else if (state.route === 'separacao') {
    currentQty = separated;
    quantityNote = `Disponível agora: ${fmtQty(separable)} ${material.unit || 'un'}`;
  } else {
    currentQty = delivered || separated || paintReturned || paintSent || available;
  }

  const pct = requiredQty ? clamp(Math.round((currentQty / requiredQty) * 100), 0, 100) : 0;
  const eta = ['em_pintura', 'pintura_atrasada'].includes(status) ? material.paintingEta : material.deliveryEta;
  const sourceLabel = allocation.source === 'misto' ? 'Compra + estoque'
    : allocation.source === 'estoque' ? 'Estoque'
    : allocation.source === 'compra' ? 'Compra'
    : 'Definir depois';
  const sourceTone = allocation.source === 'misto' ? 'warning'
    : allocation.source === 'estoque' ? 'violet'
    : allocation.source === 'compra' ? 'info'
    : 'neutral';
  const allocationNote = allocation.source === 'misto'
    ? `${fmtQty(quantityNum(allocation, allocation.stockQty))} estoque + ${fmtQty(quantityNum(allocation, allocation.purchaseQty))} compra`
    : '';

  return `<tr>
    <td><span class="cell-main">${escapeHtml(material.description || 'Sem descrição')}</span><span class="cell-sub">${escapeHtml([material.code, material.type, material.color].filter(Boolean).join(' · ') || 'Sem código')}</span></td>
    <td>${escapeHtml(material.category || 'Sem categoria')}</td>
    <td><span class="status-pill status-${sourceTone}">${sourceLabel}</span>${allocationNote ? `<span class="cell-sub">${escapeHtml(allocationNote)}</span>` : ''}${material.paintingRequired ? '<span class="cell-sub">com pintura</span>' : ''}</td>
    <td class="qty-cell"><strong>${fmtQty(currentQty)} / ${fmtQty(requiredQty)} ${escapeHtml(material.unit || 'un')}</strong><div class="qty-track"><span style="width:${pct}%"></span></div>${quantityNote ? `<span class="cell-sub">${escapeHtml(quantityNote)}</span>` : ''}</td>
    <td>${statusPill(status)}</td>
    <td class="nowrap">${fmtDate(eta)}${eta && isPast(eta) && !['enviado_obra', 'separado'].includes(status) ? '<span class="cell-sub" style="color:var(--danger)">prazo vencido</span>' : ''}</td>
    <td><button class="btn ${action === 'view' ? 'btn-ghost' : 'btn-secondary'} btn-sm" data-quick-action="${action}" data-material-id="${material.id}">${escapeHtml(actionLabel)}</button></td>
    <td><div class="cell-actions"><button class="btn btn-ghost btn-sm" data-edit-material="${material.id}">Editar</button>${isManager() ? `<button class="btn btn-danger btn-sm" data-delete-material="${material.id}">×</button>` : ''}</div></td>
  </tr>`;
}

function renderActivityCard() {
  const activities = Object.values(state.activities || {}).sort((a, b) => num(b.createdAt) - num(a.createdAt)).slice(0, 10);
  return `<div class="card" style="margin-top:16px"><div class="card-head"><h3>Últimas movimentações</h3><span class="muted" style="font-size:11px">Rastreabilidade da equipe</span></div><div class="card-body">${activities.length ? `<div class="timeline">${activities.map((a, idx) => `<div class="timeline-item"><div class="timeline-line"><span class="timeline-dot"></span>${idx < activities.length - 1 ? '<span class="timeline-stem"></span>' : ''}</div><div class="timeline-copy"><strong>${escapeHtml(a.message)}</strong><p>${escapeHtml(a.userName || 'Usuário')} · ${fmtDate(a.createdAt)}</p></div></div>`).join('')}</div>` : '<p class="muted">Nenhuma movimentação registrada ainda.</p>'}</div></div>`;
}

function bindMaterialTableActions(root) {
  $$('[data-edit-material]', root).forEach(btn => btn.addEventListener('click', () => openMaterialModal(btn.dataset.editMaterial)));
  $$('[data-delete-material]', root).forEach(btn => btn.addEventListener('click', async () => {
    const material = state.materials[btn.dataset.deleteMaterial];
    if (!material || !confirm(`Excluir “${material.description}”?`)) return;
    try {
      await remove(ref(db, `materials/${state.currentProjectId}/${material.id}`));
      await logActivity(state.currentProjectId, 'material_excluido', `Material excluído: ${material.description}`, material.id);
      await recalculateProjectSummary(state.currentProjectId); toast('Material excluído.');
    } catch (error) { toast(authErrorMessage(error), 'error'); }
  }));
  $$('[data-quick-action]', root).forEach(btn => btn.addEventListener('click', () => {
    const material = state.materials[btn.dataset.materialId];
    if (!material) return;
    if (btn.dataset.quickAction === 'view') openMaterialModal(material.id);
    else openQuickActionModal(material, btn.dataset.quickAction);
  }));
}

function openMaterialModal(materialId = '') {
  const project = activeProject();
  if (!project) { toast('Crie ou selecione uma obra antes de adicionar materiais.', 'error'); setRoute('obras'); return; }
  const material = state.materials[materialId] || { source: 'compra', unit: 'un', priority: 'normal', paintingRequired: false };
  const paintingRequired = Boolean(material.paintingRequired);
  openModal({
    title: materialId ? 'Editar material' : 'Adicionar material',
    subtitle: `${project.code ? `${project.code} · ` : ''}${project.name}`,
    body: `<form id="materialForm" class="form-grid cols-3">
      <div class="section-title">Identificação</div>
      <label class="field"><span>Código</span><input name="code" value="${escapeHtml(material.code || '')}" placeholder="Código interno ou fornecedor" /></label>
      <label class="field"><span>Categoria *</span><input name="category" required value="${escapeHtml(material.category || '')}" placeholder="Perfis, Ferragens, Vidros..." /></label>
      <label class="field"><span>Tipo / tipologia</span><input name="type" value="${escapeHtml(material.type || '')}" placeholder="Ex.: FDP1" /></label>
      <label class="field full"><span>Descrição *</span><input name="description" required value="${escapeHtml(material.description || '')}" /></label>
      <label class="field"><span>Quantidade necessária *</span><input name="qtyRequired" type="number" step="0.001" min="0" required value="${escapeHtml(material.qtyRequired ?? 1)}" /></label>
      <label class="field"><span>Unidade</span><input name="unit" value="${escapeHtml(material.unit || 'un')}" placeholder="un, barra, m², kg..." /></label>
      <label class="field"><span>Cor / tratamento</span><input name="color" value="${escapeHtml(material.color || '')}" /></label>
      <label class="field"><span>Medidas</span><input name="dimensions" value="${escapeHtml(material.dimensions || '')}" placeholder="L x A x C" /></label>
      <label class="field"><span>Prioridade</span><select name="priority"><option value="baixa" ${material.priority === 'baixa' ? 'selected' : ''}>Baixa</option><option value="normal" ${!material.priority || material.priority === 'normal' ? 'selected' : ''}>Normal</option><option value="alta" ${material.priority === 'alta' ? 'selected' : ''}>Alta</option><option value="urgente" ${material.priority === 'urgente' ? 'selected' : ''}>Urgente</option></select></label>
      <label class="field"><span>Responsável</span><input name="responsible" value="${escapeHtml(material.responsible || '')}" /></label>

      <div class="section-title">Origem do material</div>
      <label class="field"><span>Origem *</span><select id="materialSource" name="source"><option value="pendente" ${!material.source || material.source === 'pendente' ? 'selected' : ''}>Definir depois</option><option value="compra" ${material.source === 'compra' ? 'selected' : ''}>Precisa comprar</option><option value="estoque" ${material.source === 'estoque' ? 'selected' : ''}>Já existe no estoque</option><option value="misto" ${material.source === 'misto' ? 'selected' : ''}>Compra + estoque</option></select></label>
      <label class="field source-mixed"><span>Quantidade do estoque</span><input name="stockRequiredQty" type="number" step="0.001" min="0" value="${escapeHtml(materialAllocation(material).stockQty)}" /></label>
      <label class="field source-mixed"><span>Quantidade a comprar</span><input name="purchaseRequiredQty" type="number" step="0.001" min="0" value="${escapeHtml(materialAllocation(material).purchaseQty)}" readonly /></label>
      <label class="field source-purchase"><span>Fornecedor</span><input name="supplier" value="${escapeHtml(material.supplier || '')}" /></label>
      <label class="field source-purchase"><span>Pedido / OC</span><input name="orderNumber" value="${escapeHtml(material.orderNumber || '')}" /></label>
      <label class="field source-purchase"><span>Data da compra</span><input name="purchaseDate" type="date" value="${escapeHtml(material.purchaseDate || '')}" /></label>
      <label class="field source-purchase"><span>Previsão de chegada</span><input name="deliveryEta" type="date" value="${escapeHtml(material.deliveryEta || '')}" /></label>
      <label class="field source-purchase"><span>Quantidade recebida da compra</span><input name="qtyReceived" type="number" step="0.001" min="0" value="${escapeHtml(material.qtyReceived ?? 0)}" /></label>
      <input name="stockReservedQty" type="hidden" value="${escapeHtml(materialAllocation(material).stockQty)}" />
      <label class="field source-stock"><span>Código no estoque</span><input name="stockItemCode" value="${escapeHtml(material.stockItemCode || '')}" /></label>
      <label class="field source-stock"><span>Localização no estoque</span><input name="stockLocation" value="${escapeHtml(material.stockLocation || '')}" /></label>

      <div class="section-title">Pintura opcional</div>
      <label class="check-row full"><input id="paintingRequired" name="paintingRequired" type="checkbox" ${paintingRequired ? 'checked' : ''} /><span><strong>Este material vai para pintura</strong><small style="display:block;color:var(--muted);margin-top:3px">Quando desmarcado, a etapa de pintura não aparece no fluxo.</small></span></label>
      <div id="paintingFields" class="form-grid cols-3 full" ${paintingRequired ? '' : 'hidden'}>
        <label class="field"><span>Empresa de pintura</span><input name="paintingSupplier" value="${escapeHtml(material.paintingSupplier || '')}" /></label>
        <label class="field"><span>Data de envio</span><input name="paintingSentDate" type="date" value="${escapeHtml(material.paintingSentDate || '')}" /></label>
        <label class="field"><span>Previsão de retorno</span><input name="paintingEta" type="date" value="${escapeHtml(material.paintingEta || '')}" /></label>
        <label class="field"><span>Quantidade enviada</span><input name="paintingSentQty" type="number" step="0.001" min="0" value="${escapeHtml(material.paintingSentQty ?? 0)}" /></label>
        <label class="field"><span>Quantidade retornada</span><input name="paintingReturnedQty" type="number" step="0.001" min="0" value="${escapeHtml(material.paintingReturnedQty ?? 0)}" /></label>
        <label class="field"><span>Data de retorno</span><input name="paintingReturnDate" type="date" value="${escapeHtml(material.paintingReturnDate || '')}" /></label>
      </div>

      <div class="section-title">Separação e envio</div>
      <label class="field"><span>Quantidade separada</span><input name="separatedQty" type="number" step="0.001" min="0" value="${escapeHtml(material.separatedQty ?? 0)}" /></label>
      <label class="field"><span>Data da separação</span><input name="separatedDate" type="date" value="${escapeHtml(material.separatedDate || '')}" /></label>
      <label class="field"><span>Quantidade enviada à obra</span><input name="siteDeliveredQty" type="number" step="0.001" min="0" value="${escapeHtml(material.siteDeliveredQty ?? 0)}" /></label>
      <label class="field"><span>Data do envio à obra</span><input name="siteDeliveredDate" type="date" value="${escapeHtml(material.siteDeliveredDate || '')}" /></label>
      <label class="field full"><span>Observações / pendências</span><textarea name="notes">${escapeHtml(material.notes || '')}</textarea></label>
    </form>`,
    footer: '<button class="btn btn-ghost" data-close-modal="true">Cancelar</button><button id="saveMaterialBtn" class="btn btn-primary">Salvar material</button>'
  });
  $$('[data-close-modal="true"]', $('#modalRoot')).forEach(b => b.addEventListener('click', closeModal));
  const sourceSelect = $('#materialSource');
  const syncSourceFields = () => {
    const mode = sourceSelect.value;
    const isMixed = mode === 'misto';
    const usesStock = mode === 'estoque' || isMixed;
    const usesPurchase = mode === 'compra' || isMixed;
    $$('.source-stock', $('#materialForm')).forEach(el => el.hidden = !usesStock);
    $$('.source-purchase', $('#materialForm')).forEach(el => el.hidden = !usesPurchase);
    $$('.source-mixed', $('#materialForm')).forEach(el => el.hidden = !isMixed);

    const requiredInput = $('[name="qtyRequired"]', $('#materialForm'));
    const stockInput = $('[name="stockRequiredQty"]', $('#materialForm'));
    const purchaseInput = $('[name="purchaseRequiredQty"]', $('#materialForm'));
    const reservedInput = $('[name="stockReservedQty"]', $('#materialForm'));
    const required = Math.max(0, num(requiredInput?.value));
    const stock = mode === 'estoque' ? required : isMixed ? clamp(num(stockInput?.value), 0, required) : 0;
    const purchase = mode === 'compra' ? required : isMixed ? Math.max(0, required - stock) : 0;
    if (stockInput && !isMixed) stockInput.value = stock;
    if (purchaseInput) purchaseInput.value = purchase;
    if (reservedInput) reservedInput.value = stock;
  };
  sourceSelect.addEventListener('change', syncSourceFields);
  $('[name="qtyRequired"]', $('#materialForm'))?.addEventListener('input', syncSourceFields);
  $('[name="stockRequiredQty"]', $('#materialForm'))?.addEventListener('input', syncSourceFields);
  syncSourceFields();
  $('#paintingRequired').addEventListener('change', (e) => { $('#paintingFields').hidden = !e.target.checked; });
  $('#saveMaterialBtn').addEventListener('click', async () => {
    const form = $('#materialForm'); if (!form.reportValidity()) return;
    const button = $('#saveMaterialBtn'); setBusy(button, true);
    const entries = Object.fromEntries(new FormData(form).entries());
    const numericFields = ['qtyRequired', 'qtyReceived', 'stockReservedQty', 'stockRequiredQty', 'purchaseRequiredQty', 'paintingSentQty', 'paintingReturnedQty', 'separatedQty', 'siteDeliveredQty'];
    numericFields.forEach(key => entries[key] = num(entries[key]));
    entries.paintingRequired = $('#paintingRequired').checked;
    const requiredQty = Math.max(0, entries.qtyRequired);
    if (entries.source === 'misto') {
      entries.stockRequiredQty = clamp(entries.stockRequiredQty, 0, requiredQty);
      entries.purchaseRequiredQty = Math.max(0, requiredQty - entries.stockRequiredQty);
      if (!(entries.stockRequiredQty > 0 && entries.purchaseRequiredQty > 0)) {
        setBusy(button, false);
        toast('Na origem Compra + estoque, informe uma quantidade de estoque maior que zero e menor que a quantidade necessária.', 'error');
        return;
      }
      entries.stockReservedQty = entries.stockRequiredQty;
      entries.qtyReceived = clamp(entries.qtyReceived, 0, entries.purchaseRequiredQty);
    } else if (entries.source === 'estoque') {
      entries.stockRequiredQty = requiredQty;
      entries.purchaseRequiredQty = 0;
      entries.stockReservedQty = requiredQty;
      entries.qtyReceived = 0;
    } else if (entries.source === 'compra') {
      entries.stockRequiredQty = 0;
      entries.purchaseRequiredQty = requiredQty;
      entries.stockReservedQty = 0;
      entries.qtyReceived = clamp(entries.qtyReceived, 0, requiredQty);
    } else {
      entries.stockRequiredQty = 0;
      entries.purchaseRequiredQty = 0;
      entries.stockReservedQty = 0;
      entries.qtyReceived = 0;
    }
    const previousAllocation = materialAllocation(material);
    const nextAllocation = materialAllocation({ ...material, ...entries });
    const allocationChanged = previousAllocation.source !== nextAllocation.source
      || Math.abs(previousAllocation.stockQty - nextAllocation.stockQty) > 0.000001
      || Math.abs(previousAllocation.purchaseQty - nextAllocation.purchaseQty) > 0.000001;
    const hasOperationalMovement = Boolean(
      material.purchaseDate || material.orderNumber || quantityNum(material, material.qtyReceived) > 0
      || quantityNum(material, material.paintingSentQty) > 0 || quantityNum(material, material.paintingReturnedQty) > 0
      || quantityNum(material, material.separatedQty) > 0 || quantityNum(material, material.siteDeliveredQty) > 0
    );
    if (materialId && allocationChanged && hasOperationalMovement) {
      setBusy(button, false);
      toast('A divisão entre compra e estoque não pode ser alterada depois que o material já teve movimentação.', 'error');
      return;
    }
    const id = materialId || push(ref(db, `materials/${state.currentProjectId}`)).key;
    const payload = {
      ...material, ...entries, id, projectId: state.currentProjectId,
      createdAt: material.createdAt || now(), createdBy: material.createdBy || state.user.uid,
      updatedAt: now(), updatedBy: state.user.uid
    };
    payload.status = deriveMaterialStatus(payload);
    try {
      await set(ref(db, `materials/${state.currentProjectId}/${id}`), payload);
      await logActivity(state.currentProjectId, materialId ? 'material_editado' : 'material_adicionado', `${materialId ? 'Material atualizado' : 'Material adicionado'}: ${payload.description}`, id);
      await recalculateProjectSummary(state.currentProjectId);
      closeModal(); toast('Material salvo com sucesso.');
    } catch (error) { toast(authErrorMessage(error), 'error'); }
    finally { setBusy(button, false); }
  });
}

function openQuickActionModal(material, action) {
  const allocation = materialAllocation(material);
  const totalRequired = allocation.required;
  const availableNow = materialAvailableQty(material);
  const separableNow = materialSeparableQty(material);
  const required = ['purchase', 'receive'].includes(action) ? allocation.purchaseQty : action === 'reserve' ? allocation.stockQty : totalRequired;
  const configs = {
    purchase: {
      title: 'Registrar compra', subtitle: material.description,
      fields: `
        <label class="field full"><span>Fornecedor</span><input name="supplier" value="${escapeHtml(material.supplier || '')}" required /></label>
        <label class="field"><span>Pedido / OC</span><input name="orderNumber" value="${escapeHtml(material.orderNumber || '')}" /></label>
        <label class="field"><span>Data da compra</span><input name="purchaseDate" type="date" value="${escapeHtml(material.purchaseDate || todayISO())}" required /></label>
        <label class="field"><span>Previsão de chegada</span><input name="deliveryEta" type="date" value="${escapeHtml(material.deliveryEta || '')}" required /></label>`,
      message: 'Compra registrada'
    },
    reserve: {
      title: 'Reservar no estoque', subtitle: `${material.description} · necessário ${fmtQty(required)} ${material.unit || 'un'}`,
      fields: `
        <label class="field"><span>Quantidade reservada</span><input name="stockReservedQty" type="number" step="0.001" min="0" value="${escapeHtml(material.stockReservedQty || required)}" required /></label>
        <label class="field"><span>Localização</span><input name="stockLocation" value="${escapeHtml(material.stockLocation || '')}" placeholder="Corredor, prateleira..." /></label>
        <label class="field full"><span>Código no estoque</span><input name="stockItemCode" value="${escapeHtml(material.stockItemCode || material.code || '')}" /></label>`,
      message: 'Reserva de estoque atualizada'
    },
    receive: {
      title: 'Confirmar chegada', subtitle: `${material.description} · necessário ${fmtQty(required)} ${material.unit || 'un'}`,
      fields: `
        <label class="field"><span>Quantidade total recebida</span><input name="qtyReceived" type="number" step="0.001" min="0" value="${escapeHtml(Math.max(quantityNum(material, material.qtyReceived), required))}" required /></label>
        <label class="field"><span>Data do recebimento</span><input name="receivedDate" type="date" value="${escapeHtml(material.receivedDate || todayISO())}" required /></label>
        <label class="field full"><span>Observação / divergência</span><textarea name="receiptNotes">${escapeHtml(material.receiptNotes || '')}</textarea></label>`,
      message: 'Recebimento atualizado'
    },
    'send-paint': {
      title: 'Enviar para pintura', subtitle: material.description,
      fields: `
        <label class="field"><span>Quantidade enviada</span><input name="paintingSentQty" type="number" step="0.001" min="0" value="${escapeHtml(Math.max(quantityNum(material, material.paintingSentQty), availableNow))}" required /></label>
        <label class="field"><span>Data de envio</span><input name="paintingSentDate" type="date" value="${escapeHtml(material.paintingSentDate || todayISO())}" required /></label>
        <label class="field"><span>Empresa de pintura</span><input name="paintingSupplier" value="${escapeHtml(material.paintingSupplier || '')}" /></label>
        <label class="field"><span>Previsão de retorno</span><input name="paintingEta" type="date" value="${escapeHtml(material.paintingEta || '')}" required /></label>`,
      message: 'Envio para pintura registrado'
    },
    'return-paint': {
      title: 'Registrar retorno da pintura', subtitle: material.description,
      fields: `
        <label class="field"><span>Quantidade total retornada</span><input name="paintingReturnedQty" type="number" step="0.001" min="0" value="${escapeHtml(Math.max(quantityNum(material, material.paintingReturnedQty), quantityNum(material, material.paintingSentQty)))}" required /></label>
        <label class="field"><span>Data de retorno</span><input name="paintingReturnDate" type="date" value="${escapeHtml(material.paintingReturnDate || todayISO())}" required /></label>
        <label class="field full"><span>Observações</span><textarea name="paintingNotes">${escapeHtml(material.paintingNotes || '')}</textarea></label>`,
      message: 'Retorno da pintura atualizado'
    },
    separate: {
      title: 'Registrar separação', subtitle: `${material.description} · necessário ${fmtQty(required)} ${material.unit || 'un'}`,
      fields: `
        <label class="field"><span>Quantidade total separada</span><input name="separatedQty" type="number" step="0.001" min="0" value="${escapeHtml(Math.max(quantityNum(material, material.separatedQty), separableNow))}" required /></label>
        <label class="field"><span>Data da separação</span><input name="separatedDate" type="date" value="${escapeHtml(material.separatedDate || todayISO())}" required /></label>
        <label class="field full"><span>Local / identificação do lote</span><input name="separationLocation" value="${escapeHtml(material.separationLocation || '')}" /></label>`,
      message: 'Separação atualizada'
    },
    deliver: {
      title: 'Enviar material para a obra', subtitle: material.description,
      fields: `
        <label class="field"><span>Quantidade total enviada</span><input name="siteDeliveredQty" type="number" step="0.001" min="0" value="${escapeHtml(Math.max(quantityNum(material, material.siteDeliveredQty), quantityNum(material, material.separatedQty)))}" required /></label>
        <label class="field"><span>Data do envio</span><input name="siteDeliveredDate" type="date" value="${escapeHtml(material.siteDeliveredDate || todayISO())}" required /></label>
        <label class="field full"><span>Recebido por / observações</span><input name="siteDeliveryNotes" value="${escapeHtml(material.siteDeliveryNotes || '')}" /></label>`,
      message: 'Envio para a obra atualizado'
    }
  };
  const config = configs[action];
  if (!config) return openMaterialModal(material.id);
  openModal({
    title: config.title, subtitle: config.subtitle, small: true,
    body: `<form id="quickActionForm" class="form-grid">${config.fields}</form>`,
    footer: '<button class="btn btn-ghost" data-close-modal="true">Cancelar</button><button id="saveQuickActionBtn" class="btn btn-primary">Confirmar</button>'
  });
  $$('[data-close-modal="true"]', $('#modalRoot')).forEach(b => b.addEventListener('click', closeModal));
  $('#saveQuickActionBtn').addEventListener('click', async () => {
    const form = $('#quickActionForm'); if (!form.reportValidity()) return;
    const button = $('#saveQuickActionBtn'); setBusy(button, true);
    const data = Object.fromEntries(new FormData(form).entries());
    ['stockReservedQty', 'qtyReceived', 'paintingSentQty', 'paintingReturnedQty', 'separatedQty', 'siteDeliveredQty'].forEach(key => { if (key in data) data[key] = num(data[key]); });
    const limits = {
      stockReservedQty: allocation.stockQty,
      qtyReceived: allocation.purchaseQty,
      paintingSentQty: availableNow,
      paintingReturnedQty: quantityNum(material, material.paintingSentQty),
      separatedQty: separableNow,
      siteDeliveredQty: quantityNum(material, material.separatedQty)
    };
    const labels = {
      stockReservedQty: 'quantidade de estoque',
      qtyReceived: 'quantidade da parcela comprada',
      paintingSentQty: 'quantidade disponível',
      paintingReturnedQty: 'quantidade enviada para pintura',
      separatedQty: 'quantidade disponível para separação',
      siteDeliveredQty: 'quantidade separada'
    };
    const minimums = {
      qtyReceived: quantityNum(material, material.qtyReceived),
      paintingSentQty: quantityNum(material, material.paintingSentQty),
      paintingReturnedQty: quantityNum(material, material.paintingReturnedQty),
      separatedQty: quantityNum(material, material.separatedQty),
      siteDeliveredQty: quantityNum(material, material.siteDeliveredQty)
    };
    for (const [field, minimum] of Object.entries(minimums)) {
      if (field in data && data[field] < minimum - 0.000001) {
        setBusy(button, false);
        toast(`A quantidade total não pode diminuir. O valor atual é ${fmtQty(minimum)} ${material.unit || 'un'}.`, 'error');
        return;
      }
    }
    for (const [field, limit] of Object.entries(limits)) {
      if (field in data && data[field] > limit + 0.000001) {
        setBusy(button, false);
        toast(`A quantidade informada não pode ser maior que a ${labels[field]} (${fmtQty(limit)} ${material.unit || 'un'}).`, 'error');
        return;
      }
    }
    const payload = { ...material, ...data, updatedAt: now(), updatedBy: state.user.uid };
    payload.status = deriveMaterialStatus(payload);
    try {
      await update(ref(db, `materials/${state.currentProjectId}/${material.id}`), { ...data, status: payload.status, updatedAt: payload.updatedAt, updatedBy: payload.updatedBy });
      await logActivity(state.currentProjectId, action, `${config.message}: ${material.description}`, material.id);
      await recalculateProjectSummary(state.currentProjectId);
      closeModal(); toast(config.message + '.');
    } catch (error) { toast(authErrorMessage(error), 'error'); }
    finally { setBusy(button, false); }
  });
}

// ---------- Estoque ----------
function renderInventory() {
  ensureInventoryListener();
  const view = $('#view');
  const items = Object.entries(state.inventory).sort((a, b) => (a[1].description || '').localeCompare(b[1].description || ''));
  const lowStock = items.filter(([, item]) => quantityNum(item, item.qtyAvailable) <= quantityNum(item, item.minQty));
  view.innerHTML = `
    <div class="page-head"><div><h2>Estoque geral</h2><p>Cadastre saldos e localizações para facilitar a reserva dos itens que já existem.</p></div><div class="page-actions"><button class="btn btn-primary" data-new-stock>+ Item de estoque</button></div></div>
    <section class="grid kpi-grid">
      ${kpiCard('Itens cadastrados', items.length, 'Catálogo geral do estoque', '▤', '')}
      ${kpiCard('Estoque baixo', lowStock.length, 'Saldo igual ou abaixo do mínimo', '!', lowStock.length ? 'danger' : '')}
      ${kpiCard('Unidades disponíveis', items.reduce((s, [, i]) => s + quantityNum(i, i.qtyAvailable), 0), 'Soma dos saldos cadastrados', 'Σ', 'info')}
      ${kpiCard('Locais usados', new Set(items.map(([, i]) => i.location).filter(Boolean)).size, 'Endereços do almoxarifado', '⌖', 'warning')}
    </section>
    ${items.length ? `<section class="grid stock-grid">${items.map(([id, item]) => stockCard(id, item)).join('')}</section>` : `<div class="card">${emptyState('▤', 'Estoque ainda não cadastrado', 'Adicione os materiais recorrentes e informe o saldo e a localização.', '<button class="btn btn-primary" data-new-stock>Adicionar item</button>')}</div>`}`;
  $$('[data-new-stock]', view).forEach(btn => btn.addEventListener('click', () => openStockModal()));
  $$('[data-edit-stock]', view).forEach(btn => btn.addEventListener('click', () => openStockModal(btn.dataset.editStock)));
}
function stockCard(id, item) {
  const low = quantityNum(item, item.qtyAvailable) <= quantityNum(item, item.minQty);
  return `<article class="card stock-card"><div class="project-card-head"><div><span class="project-code">${escapeHtml(item.code || 'SEM CÓDIGO')}</span><h3>${escapeHtml(item.description || 'Item')}</h3><p>${escapeHtml(item.category || 'Sem categoria')}</p></div><button class="icon-btn" data-edit-stock="${id}">⋯</button></div><div class="stock-qty">${fmtQty(quantityNum(item, item.qtyAvailable))} <small style="font-size:12px;color:var(--muted)">${escapeHtml(item.unit || 'un')}</small></div><div>${low ? '<span class="status-pill status-danger">Estoque baixo</span>' : '<span class="status-pill status-ok">Saldo disponível</span>'}</div><div class="stock-location" style="margin-top:13px">Local: ${escapeHtml(item.location || 'não informado')} · Mínimo: ${fmtQty(quantityNum(item, item.minQty))}</div></article>`;
}
function openStockModal(itemId = '') {
  const item = state.inventory[itemId] || { unit: 'un', qtyAvailable: 0, minQty: 0 };
  openModal({ title: itemId ? 'Editar item de estoque' : 'Novo item de estoque', small: true,
    body: `<form id="stockForm" class="form-grid">
      <label class="field"><span>Código</span><input name="code" value="${escapeHtml(item.code || '')}" /></label>
      <label class="field"><span>Categoria</span><input name="category" value="${escapeHtml(item.category || '')}" /></label>
      <label class="field full"><span>Descrição *</span><input name="description" required value="${escapeHtml(item.description || '')}" /></label>
      <label class="field"><span>Saldo disponível</span><input name="qtyAvailable" type="number" step="0.001" value="${escapeHtml(item.qtyAvailable ?? 0)}" /></label>
      <label class="field"><span>Estoque mínimo</span><input name="minQty" type="number" step="0.001" value="${escapeHtml(item.minQty ?? 0)}" /></label>
      <label class="field"><span>Unidade</span><input name="unit" value="${escapeHtml(item.unit || 'un')}" /></label>
      <label class="field"><span>Localização</span><input name="location" value="${escapeHtml(item.location || '')}" /></label>
      <label class="field full"><span>Observações</span><textarea name="notes">${escapeHtml(item.notes || '')}</textarea></label>
    </form>`,
    footer: `${itemId && isManager() ? '<button id="deleteStockBtn" class="btn btn-danger" style="margin-right:auto">Excluir</button>' : ''}<button class="btn btn-ghost" data-close-modal="true">Cancelar</button><button id="saveStockBtn" class="btn btn-primary">Salvar</button>`
  });
  $$('[data-close-modal="true"]', $('#modalRoot')).forEach(b => b.addEventListener('click', closeModal));
  $('#saveStockBtn').addEventListener('click', async () => {
    const form = $('#stockForm'); if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    data.qtyAvailable = quantityNum(data, data.qtyAvailable); data.minQty = quantityNum(data, data.minQty);
    const id = itemId || push(ref(db, 'inventory')).key;
    try { await set(ref(db, `inventory/${id}`), { ...item, ...data, id, createdAt: item.createdAt || now(), updatedAt: now() }); closeModal(); toast('Item de estoque salvo.'); }
    catch (error) { toast(authErrorMessage(error), 'error'); }
  });
  if ($('#deleteStockBtn')) $('#deleteStockBtn').addEventListener('click', async () => {
    if (!confirm('Excluir este item do estoque?')) return;
    try { await remove(ref(db, `inventory/${itemId}`)); closeModal(); toast('Item excluído.'); }
    catch (error) { toast(authErrorMessage(error), 'error'); }
  });
}

// ---------- Usuários ----------
function renderUsers() {
  if (!isManager()) { setRoute('dashboard'); return; }
  ensureUsersListener();
  const view = $('#view');
  const users = Object.entries(state.users).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
  view.innerHTML = `
    <div class="page-head"><div><h2>Equipe e permissões</h2><p>O usuário cria o próprio primeiro acesso; depois a gerente define o perfil adequado.</p></div></div>
    <div class="import-note" style="margin-bottom:16px">Para adicionar alguém: peça que a pessoa use “Criar primeiro acesso” na tela de login. O cadastro aparecerá aqui como Operador.</div>
    ${users.length ? `<section class="grid user-grid">${users.map(([id, user]) => `<article class="card user-card"><div class="user-card-head"><span class="avatar">${escapeHtml(initials(user.name))}</span><div><h3>${escapeHtml(user.name || 'Usuário')}</h3><p>${escapeHtml(user.email || '')}</p></div></div><span class="role-badge">${escapeHtml(roleLabel(user.role))}</span><div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px"><span class="status-pill status-${user.active === false ? 'danger' : 'ok'}">${user.active === false ? 'Desativado' : 'Ativo'}</span><button class="btn btn-ghost btn-sm" data-edit-user="${id}">Editar</button></div></article>`).join('')}</section>` : `<div class="card">${emptyState('♙', 'Nenhum usuário encontrado', 'Os cadastros aparecerão aqui após o primeiro acesso.')}</div>`}`;
  $$('[data-edit-user]', view).forEach(btn => btn.addEventListener('click', () => openUserModal(btn.dataset.editUser)));
}
function openUserModal(uid) {
  const user = state.users[uid]; if (!user) return;
  openModal({ title: 'Editar usuário', subtitle: user.email || '', small: true,
    body: `<form id="userForm" class="form-grid">
      <label class="field full"><span>Nome</span><input name="name" value="${escapeHtml(user.name || '')}" required /></label>
      <label class="field full"><span>Perfil</span><select name="role"><option value="gerente" ${user.role === 'gerente' ? 'selected' : ''}>Gerente</option><option value="compras" ${user.role === 'compras' ? 'selected' : ''}>Compras</option><option value="almoxarifado" ${user.role === 'almoxarifado' ? 'selected' : ''}>Almoxarifado</option><option value="producao" ${user.role === 'producao' ? 'selected' : ''}>Produção</option><option value="operador" ${!user.role || user.role === 'operador' ? 'selected' : ''}>Operador</option></select></label>
      <label class="check-row full"><input id="userActive" type="checkbox" ${user.active !== false ? 'checked' : ''} /><span><strong>Usuário ativo</strong><small style="display:block;color:var(--muted);margin-top:3px">Desmarque para bloquear o acesso.</small></span></label>
    </form>`,
    footer: '<button class="btn btn-ghost" data-close-modal="true">Cancelar</button><button id="saveUserBtn" class="btn btn-primary">Salvar</button>'
  });
  $$('[data-close-modal="true"]', $('#modalRoot')).forEach(b => b.addEventListener('click', closeModal));
  $('#saveUserBtn').addEventListener('click', async () => {
    const form = $('#userForm'); if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    try { await update(ref(db, `users/${uid}`), { name: data.name, role: data.role, active: $('#userActive').checked, updatedAt: now() }); closeModal(); toast('Perfil atualizado.'); }
    catch (error) { toast(authErrorMessage(error), 'error'); }
  });
}

// ---------- Importação XLSX / PDF ----------
const IMPORT_FIELDS = [
  ['code', 'Código'], ['description', 'Descrição'], ['type', 'Tipo / tipologia'],
  ['quantity', 'Quantidade'], ['unit', 'Unidade'], ['color', 'Cor / tratamento'],
  ['width', 'Largura'], ['height', 'Altura'], ['length', 'Comprimento / medida'],
  ['area', 'Área / m²'], ['notes', 'Observações']
];
const IMPORT_SYNONYMS = {
  code: ['codigo', 'cod', 'perfil', 'item', 'referencia', 'produto referencia'],
  description: ['descricao', 'produto', 'modelo', 'linha extraida do pdf', 'descricao do vidro'],
  type: ['tipo', 'tipologia'],
  quantity: ['quantidade', 'qtde', 'qtd', 'qtde prev', 'qtde barras', 'qtde total'],
  unit: ['unidade', 'un'],
  color: ['cor', 'tratamento cor', 'acabamento'],
  width: ['largura', 'l'],
  height: ['altura', 'h', 'a'],
  length: ['comprimento', 'comp barra mm', 'medida'],
  area: ['area m2', 'area', 'm2 compra', 'm2 corte'],
  notes: ['observacoes', 'obs']
};

function resetImporter() {
  state.importer = {
    file: null, type: '', fileName: '', workbook: null, sheetNames: [], selectedSheet: '',
    matrix: [], headerRow: 0, headers: [], mapping: {}, rows: [], rawPdfLines: [], parser: '',
    defaultSource: 'compra', defaultPainting: false
  };
}

function renderImporter() {
  const view = $('#view');
  const project = activeProject();
  const imp = state.importer;
  view.innerHTML = `
    <div class="page-head"><div><h2>Importar materiais</h2><p>Planilhas e PDFs entram em uma prévia antes de serem gravados na obra.</p></div>${imp.fileName ? '<div class="page-actions"><button class="btn btn-ghost" id="resetImportBtn">Limpar arquivo</button></div>' : ''}</div>
    <section class="import-layout">
      <div class="card"><div class="card-head"><h3>1. Arquivo e destino</h3></div><div class="card-body import-config">
        <label id="dropzone" class="dropzone"><input id="importFile" type="file" accept=".xlsx,.xls,.pdf" /><div><div class="empty-icon">⇧</div><strong>Arraste ou escolha o arquivo</strong><p>Formatos aceitos: XLSX, XLS e PDF.<br>Os dados só serão salvos após a confirmação.</p><button type="button" class="btn btn-secondary btn-sm" style="margin-top:12px">Escolher arquivo</button></div></label>
        ${imp.fileName ? `<div class="file-badge"><span>${escapeHtml(imp.fileName)}</span><span>${escapeHtml(imp.type.toUpperCase())}</span></div>` : ''}
        <label class="field"><span>Obra de destino *</span><select id="importProject">${projectOptions(true)}</select></label>
        <label class="field"><span>Categoria padrão</span><input id="importCategory" value="${escapeHtml(imp.selectedSheet || '')}" placeholder="Ex.: Perfis, Ferragens, Vidros" /></label>
        <label class="field"><span>Aplicar origem a todos</span><select id="importSource"><option value="compra" ${imp.defaultSource === 'compra' ? 'selected' : ''}>Precisa comprar</option><option value="estoque" ${imp.defaultSource === 'estoque' ? 'selected' : ''}>Já existe no estoque</option></select></label>
        <label class="check-row"><input id="importPainting" type="checkbox" ${imp.defaultPainting ? 'checked' : ''} /><span><strong>Aplicar pintura a todos</strong><small style="display:block;color:var(--muted);margin-top:3px">Depois você pode alterar cada item individualmente na tabela.</small></span></label>
        <div class="import-note">O importador preserva colunas não mapeadas no campo “detalhes de origem”. Linhas vazias, títulos e resumos são ignorados.</div>
      </div></div>
      <div class="card"><div class="card-head"><h3>2. Conferência e mapeamento</h3>${imp.rows.length ? `<span class="status-pill status-info">${imp.rows.length} linha(s)</span>` : ''}</div><div class="card-body" id="importPreviewArea">${renderImportPreview()}</div></div>
    </section>`;

  const fileInput = $('#importFile');
  const dropzone = $('#dropzone');
  fileInput.addEventListener('change', (e) => e.target.files[0] && handleImportFile(e.target.files[0]));
  ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', e => e.dataTransfer.files[0] && handleImportFile(e.dataTransfer.files[0]));
  $('#importProject').value = state.currentProjectId || '';
  $('#importProject').addEventListener('change', e => {
    if (e.target.value) { state.currentProjectId = e.target.value; localStorage.setItem('obraflow.currentProject', e.target.value); updateProjectSelect(); listenProjectData(e.target.value); }
  });
  $('#importSource').addEventListener('change', e => {
    state.importer.defaultSource = e.target.value;
    state.importer.rows.forEach(row => { row.source = e.target.value; });
    $('#importPreviewArea').innerHTML = renderImportPreview();
    bindImportPreviewEvents();
  });
  $('#importPainting').addEventListener('change', e => {
    state.importer.defaultPainting = e.target.checked;
    state.importer.rows.forEach(row => { row.paintingRequired = e.target.checked; });
    $('#importPreviewArea').innerHTML = renderImportPreview();
    bindImportPreviewEvents();
  });
  $('#resetImportBtn')?.addEventListener('click', () => { resetImporter(); renderImporter(); });
  bindImportPreviewEvents();
}

function renderImportPreview() {
  const imp = state.importer;
  if (!imp.fileName) return `<div class="empty" style="min-height:440px"><div><div class="empty-icon">⇧</div><h3>Envie uma planilha ou PDF</h3><p>Você poderá conferir os campos antes da importação.</p></div></div>`;
  if (imp.type === 'xlsx' && imp.workbook) {
    return `${imp.sheetNames.length > 1 ? `<label class="field" style="max-width:340px;margin-bottom:14px"><span>Aba da planilha</span><select id="sheetSelect">${imp.sheetNames.map(name => `<option value="${escapeHtml(name)}" ${name === imp.selectedSheet ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label>` : ''}
      <div class="section-title" style="margin:0 0 10px">Mapeamento das colunas</div>
      <div class="mapping-grid">${IMPORT_FIELDS.map(([key, label]) => `<label class="field"><span>${escapeHtml(label)}</span><select data-map-field="${key}"><option value="">Não importar</option>${imp.headers.map((h, idx) => `<option value="${idx}" ${String(imp.mapping[key]) === String(idx) ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}</select></label>`).join('')}</div>
      ${normalizedPreviewTable(imp.rows)}
      <div style="display:flex;justify-content:flex-end;margin-top:16px"><button id="confirmImportBtn" class="btn btn-primary" ${imp.rows.length ? '' : 'disabled'}>Importar ${imp.rows.length} item(ns)</button></div>`;
  }
  if (imp.type === 'pdf') {
    return `${imp.parser ? `<div class="import-note" style="margin-bottom:14px">Formato reconhecido: <strong>${escapeHtml(imp.parser)}</strong>. Confira a prévia antes de importar.</div>` : `<div class="import-note" style="margin-bottom:14px;background:var(--warning-soft);color:#7a2e0e">O PDF não correspondeu aos modelos de Vidros ou Vedaportas. O texto extraído aparece abaixo para conferência; este arquivo não será importado automaticamente.</div>`}
      ${imp.rows.length ? normalizedPreviewTable(imp.rows) : `<div class="pdf-lines">${escapeHtml(imp.rawPdfLines.join('\n'))}</div>`}
      <div style="display:flex;justify-content:flex-end;margin-top:16px"><button id="confirmImportBtn" class="btn btn-primary" ${imp.rows.length ? '' : 'disabled'}>Importar ${imp.rows.length} item(ns)</button></div>`;
  }
  return `<p class="muted">Processando arquivo...</p>`;
}

function normalizedPreviewTable(rows) {
  return `<div class="table-wrap preview-table" style="margin-top:16px"><table class="data-table" style="min-width:1080px"><thead><tr><th>Código</th><th>Descrição</th><th>Tipo</th><th>Qtde</th><th>Un.</th><th>Cor</th><th>Medidas</th><th>Origem</th><th>Pintura</th></tr></thead><tbody>${rows.map((r, index) => `<tr><td>${escapeHtml(r.code || '')}</td><td><span class="cell-main">${escapeHtml(r.description || '')}</span></td><td>${escapeHtml(r.type || '')}</td><td>${fmtQty(quantityNum(r, r.qtyRequired))}</td><td>${escapeHtml(r.unit || 'un')}</td><td>${escapeHtml(r.color || '')}</td><td>${escapeHtml(r.dimensions || '')}</td><td><select data-import-source="${index}" aria-label="Origem do item" style="min-width:150px"><option value="compra" ${(r.source || state.importer.defaultSource) === 'compra' ? 'selected' : ''}>Comprar</option><option value="estoque" ${(r.source || state.importer.defaultSource) === 'estoque' ? 'selected' : ''}>Estoque</option></select></td><td style="text-align:center"><input data-import-painting="${index}" type="checkbox" ${Boolean(r.paintingRequired ?? state.importer.defaultPainting) ? 'checked' : ''} aria-label="Vai para pintura" /></td></tr>`).join('')}</tbody></table></div>`;
}

function bindImportPreviewEvents() {
  $('#sheetSelect')?.addEventListener('change', (e) => selectWorkbookSheet(e.target.value));
  $$('[data-map-field]').forEach(select => select.addEventListener('change', () => {
    const mapping = {};
    $$('[data-map-field]').forEach(s => { if (s.value !== '') mapping[s.dataset.mapField] = Number(s.value); });
    state.importer.mapping = mapping;
    state.importer.rows = normalizeMatrixRows();
    $('#importPreviewArea').innerHTML = renderImportPreview();
    bindImportPreviewEvents();
  }));
  $$('[data-import-source]').forEach(select => select.addEventListener('change', e => {
    const row = state.importer.rows[Number(e.target.dataset.importSource)];
    if (row) row.source = e.target.value;
  }));
  $$('[data-import-painting]').forEach(input => input.addEventListener('change', e => {
    const row = state.importer.rows[Number(e.target.dataset.importPainting)];
    if (row) row.paintingRequired = e.target.checked;
  }));
  $('#confirmImportBtn')?.addEventListener('click', confirmImport);
}

async function handleImportFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  resetImporter();
  state.importer.file = file; state.importer.fileName = file.name;
  try {
    if (['xlsx', 'xls'].includes(extension)) {
      state.importer.type = 'xlsx';
      const buffer = await file.arrayBuffer();
      state.importer.workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      state.importer.sheetNames = state.importer.workbook.SheetNames;
      selectWorkbookSheet(state.importer.sheetNames[0]);
    } else if (extension === 'pdf') {
      state.importer.type = 'pdf'; renderImporter();
      const lines = await extractPdfLines(file);
      state.importer.rawPdfLines = lines;
      const recognized = parseKnownPdf(lines);
      state.importer.rows = recognized.rows.map(row => ({
        ...row,
        source: state.importer.defaultSource || 'compra',
        paintingRequired: Boolean(state.importer.defaultPainting)
      }));
      state.importer.parser = recognized.parser;
      renderImporter();
    } else throw new Error('Formato não suportado.');
  } catch (error) {
    toast(`Não foi possível ler o arquivo: ${error.message}`, 'error');
    renderImporter();
  }
}

function selectWorkbookSheet(sheetName) {
  const imp = state.importer;
  imp.selectedSheet = sheetName;
  const sheet = imp.workbook.Sheets[sheetName];
  imp.matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  imp.headerRow = detectHeaderRow(imp.matrix);
  imp.headers = makeUniqueHeaders(imp.matrix[imp.headerRow] || []);
  imp.mapping = suggestColumnMapping(imp.headers);
  imp.rows = normalizeMatrixRows();
  renderImporter();
}

function detectHeaderRow(matrix) {
  let bestIndex = 0, bestScore = -1;
  const knownTerms = Object.values(IMPORT_SYNONYMS).flat();
  matrix.slice(0, 20).forEach((row, index) => {
    const normalized = row.map(normalizeText);
    let score = normalized.reduce((sum, cell) => sum + (knownTerms.some(term => cell === term || cell.includes(term)) ? 1 : 0), 0);
    if (normalized.some(c => c.includes('codigo'))) score += 2;
    if (normalized.some(c => c.includes('descricao'))) score += 2;
    if (normalized.some(c => c.includes('qtde') || c.includes('quantidade'))) score += 2;
    if (score > bestScore) { bestScore = score; bestIndex = index; }
  });
  return bestIndex;
}
function makeUniqueHeaders(row) {
  const used = {};
  return row.map((value, index) => {
    const base = String(value || `Coluna ${index + 1}`).trim();
    used[base] = (used[base] || 0) + 1;
    return used[base] > 1 ? `${base} (${used[base]})` : base;
  });
}
function suggestColumnMapping(headers) {
  const mapping = {};
  headers.forEach((header, index) => {
    const norm = normalizeText(header);
    for (const [field, synonyms] of Object.entries(IMPORT_SYNONYMS)) {
      if (mapping[field] !== undefined) continue;
      if (synonyms.some(syn => norm === syn || norm.includes(syn))) mapping[field] = index;
    }
  });
  if (mapping.description === undefined && mapping.code !== undefined) mapping.description = mapping.code;
  return mapping;
}
function normalizeMatrixRows() {
  const imp = state.importer;
  const mappedIndexes = new Set(Object.values(imp.mapping).map(Number));
  const category = $('#importCategory')?.value || imp.selectedSheet || 'Importado';
  return imp.matrix.slice(imp.headerRow + 1).map((row, rowIndex) => {
    const getField = key => imp.mapping[key] === undefined ? '' : row[imp.mapping[key]];
    const code = String(getField('code') || '').trim();
    const description = String(getField('description') || code || '').trim();
    const normalizedDescription = normalizeText(description);
    const quantity = num(getField('quantity')) || 1;
    const width = getField('width'), height = getField('height'), length = getField('length'), area = getField('area');
    const details = {};
    row.forEach((value, index) => { if (!mappedIndexes.has(index) && value !== '' && value !== null && imp.headers[index]) details[imp.headers[index]] = value; });
    return {
      code, description, type: String(getField('type') || '').trim(), category,
      qtyRequired: quantity, unit: String(getField('unit') || 'un').trim() || 'un',
      color: String(getField('color') || '').trim(),
      dimensions: [width ? `L ${width}` : '', height ? `A ${height}` : '', length ? `C ${length}` : '', area ? `${area} m²` : ''].filter(Boolean).join(' · '),
      notes: String(getField('notes') || '').trim(), sourceDetails: details,
      source: imp.defaultSource || 'compra', paintingRequired: Boolean(imp.defaultPainting),
      importRow: imp.headerRow + rowIndex + 2
    };
  }).filter(row => {
    const text = normalizeText([row.code, row.description].join(' '));
    if (!row.code && !row.description) return false;
    if (/resumo|observacoes gerais|total previsto|total quantidade|responsavel|orientacao|checklist de conferencia/.test(text)) return false;
    return row.qtyRequired > 0;
  });
}

async function extractPdfLines(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const lines = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.map(item => ({
      text: String(item.str || '').trim(), x: item.transform?.[4] || 0, y: item.transform?.[5] || 0
    })).filter(item => item.text);
    items.sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);
    const grouped = [];
    items.forEach(item => {
      let line = grouped.find(group => Math.abs(group.y - item.y) <= 2.5);
      if (!line) { line = { y: item.y, items: [] }; grouped.push(line); }
      line.items.push(item);
    });
    grouped.sort((a, b) => b.y - a.y).forEach(group => {
      const text = group.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    });
  }
  return lines;
}

function parseKnownPdf(lines) {
  const joined = normalizeText(lines.join(' '));
  if (joined.includes('vidros da obra') || joined.includes('v temp 08') || joined.includes('laminado 08mm')) {
    return { parser: 'Vidros agrupados por código', rows: parseGlassPdf(lines) };
  }
  if (joined.includes('vedaportas') || joined.includes('vedaporta pivotante') || joined.includes('vedaporta giro')) {
    return { parser: 'Vedaportas', rows: parseDoorSealPdf(lines) };
  }
  return { parser: '', rows: [] };
}

function parseGlassPdf(lines) {
  const rows = [];
  let glassCode = '', glassDescription = '';
  lines.forEach(line => {
    const codeDesc = line.match(/^((?:VLC|V-TEMP)[A-Z0-9_\- ]*?)\s+(Laminado.+|Temperado.+)$/i);
    if (codeDesc) {
      glassCode = codeDesc[1].trim().replace(/\s+/g, ' ');
      glassDescription = codeDesc[2].trim();
      return;
    }
    if (/^(?:VLC|V-TEMP)/i.test(line) && !/CODIGO|DESCRICAO/i.test(normalizeText(line))) {
      const splitAt = line.search(/Laminado|Temperado/i);
      if (splitAt > 0) {
        glassCode = line.slice(0, splitAt).trim(); glassDescription = line.slice(splitAt).trim(); return;
      }
    }
    const row = line.match(/^(FD[A-Z0-9]+)\s+(\d+(?:[.,]\d+)?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i);
    if (row && glassCode) {
      rows.push({
        code: glassCode, description: glassDescription || glassCode, type: row[1], category: 'Vidros',
        qtyRequired: num(row[2]), unit: 'un', color: /OPACO/i.test(glassCode) ? 'Opaco' : (/INCOLOR/i.test(glassCode) ? 'Incolor' : ''),
        dimensions: `L ${row[3]} · A ${row[4]} · ${row[5]} m²`,
        sourceDetails: { largura: row[3], altura: row[4], areaM2: row[5], tipologia: row[1] }
      });
    }
  });
  return rows;
}

function parseDoorSealPdf(lines) {
  const rows = [];
  lines.forEach(line => {
    const row = line.match(/^(FD[A-Z0-9]+)\s+([\d.,]+)\s+(VEDAPORTA\s+.+?)\s+(\d+(?:[.,]\d+)?)\s+(RAL\s*[A-Z0-9]+)/i);
    if (row) rows.push({
      code: row[1], description: row[3].trim(), type: row[1], category: 'Vedaportas',
      qtyRequired: num(row[4]), unit: 'un', color: row[5].replace(/\s+/g, ' ').trim(),
      dimensions: `Largura ${row[2]}`, sourceDetails: { largura: row[2], modelo: row[3], cor: row[5] }
    });
  });
  return rows;
}

async function confirmImport() {
  const projectId = $('#importProject')?.value || state.currentProjectId;
  if (!projectId || !state.projects[projectId]) { toast('Selecione a obra de destino.', 'error'); return; }
  const category = ($('#importCategory')?.value || state.importer.selectedSheet || '').trim();
  const rows = state.importer.rows;
  if (!rows.length) { toast('Nenhuma linha válida para importar.', 'error'); return; }
  const button = $('#confirmImportBtn'); setBusy(button, true, 'Importando...');
  const updates = {};
  rows.forEach(row => {
    const id = push(ref(db, `materials/${projectId}`)).key;
    const payload = {
      ...row, id, projectId, category: category || row.category || 'Importado',
      source: row.source || state.importer.defaultSource || 'compra',
      paintingRequired: Boolean(row.paintingRequired),
      qtyReceived: 0, stockReservedQty: 0, paintingSentQty: 0,
      paintingReturnedQty: 0, separatedQty: 0, siteDeliveredQty: 0,
      importSource: state.importer.fileName, importType: state.importer.type,
      createdAt: now(), createdBy: state.user.uid, updatedAt: now(), updatedBy: state.user.uid
    };
    payload.status = deriveMaterialStatus(payload);
    updates[`materials/${projectId}/${id}`] = payload;
  });
  try {
    await update(ref(db), updates);
    await logActivity(projectId, 'importacao', `${rows.length} item(ns) importado(s) de ${state.importer.fileName}`);
    await recalculateProjectSummary(projectId);
    state.currentProjectId = projectId; localStorage.setItem('obraflow.currentProject', projectId); updateProjectSelect(); listenProjectData(projectId);
    toast(`${rows.length} item(ns) importado(s) com sucesso.`);
    resetImporter(); setRoute('materiais', { projectId });
  } catch (error) { toast(authErrorMessage(error), 'error'); }
  finally { setBusy(button, false); }
}

// Atualiza status vencidos ao abrir a aplicação e a cada hora.
async function refreshCurrentStatuses() {
  if (!state.currentProjectId || !Object.keys(state.materials).length) return;
  const updates = {};
  Object.entries(state.materials).forEach(([id, material]) => {
    const status = deriveMaterialStatus(material);
    if (status !== material.status) updates[`materials/${state.currentProjectId}/${id}/status`] = status;
  });
  if (Object.keys(updates).length) {
    try { await update(ref(db), updates); await recalculateProjectSummary(state.currentProjectId); }
    catch (error) { console.warn('Falha ao atualizar status:', error); }
  }
}
setInterval(refreshCurrentStatuses, 60 * 60 * 1000);
