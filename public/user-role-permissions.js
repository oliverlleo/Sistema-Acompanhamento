import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signOut,
  deleteUser,
  setPersistence,
  inMemoryPersistence
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue, set } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDtfxhvronefOV9MoDj-GvUUiJ3TLfb8qc',
  authDomain: 'sistemsquared.firebaseapp.com',
  databaseURL: 'https://sistemsquared-default-rtdb.firebaseio.com',
  projectId: 'sistemsquared',
  storageBucket: 'sistemsquared.firebasestorage.app',
  messagingSenderId: '43452051582',
  appId: '1:43452051582:web:08a19296448eb66d0b282f'
};

const app = getApps().find(candidate => candidate.name === '[DEFAULT]')
  || (getApps().length ? getApp() : initializeApp(firebaseConfig));
const auth = getAuth(app);
const db = getDatabase(app);

const ALMOXARIFADO_ROUTES = new Set(['recebimento', 'pintura', 'separacao', 'calendario']);
const FALLBACK_ROUTE = 'recebimento';
const CREATOR_APP_NAME = 'obraflow-user-creator';

const roleDescriptions = {
  gerente: 'Acesso completo ao sistema, usuários, obras e todas as operações.',
  compras: 'Perfil de compras e gerenciamento de obras permitido pelo sistema.',
  almoxarifado: 'Acesso somente a Recebimento, Pintura, Separação e Calendário.',
  producao: 'Perfil de produção conforme as permissões operacionais atuais.',
  operador: 'Perfil operacional padrão do sistema.'
};

let profile = null;
let stopProfile = null;
let uiTimer = null;
let navigationPending = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function isManager() {
  return profile?.role === 'gerente';
}

function isWarehouse() {
  return profile?.role === 'almoxarifado';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function toast(message, type = 'success') {
  const host = document.querySelector('#toastHost');
  if (!host) return;
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  host.appendChild(element);
  setTimeout(() => element.remove(), 3800);
}

function authErrorMessage(error) {
  const code = String(error?.code || '');
  if (code.includes('email-already-in-use')) return 'Este e-mail já está cadastrado.';
  if (code.includes('invalid-email')) return 'Informe um e-mail válido.';
  if (code.includes('weak-password')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (code.includes('operation-not-allowed')) return 'Ative o acesso por E-mail/Senha no Firebase Authentication.';
  if (code.includes('permission-denied')) return 'A gerente não possui permissão para criar este usuário nas regras atuais.';
  return error?.message || 'Não foi possível concluir a operação.';
}

function roleDescription(role) {
  return roleDescriptions[role] || roleDescriptions.operador;
}

function rememberAndHide(element, shouldHide, prefix) {
  if (!element) return;
  const hiddenKey = `${prefix}Hidden`;
  const previousKey = `${prefix}PreviousHidden`;

  if (shouldHide) {
    if (!element.dataset[hiddenKey]) {
      element.dataset[hiddenKey] = '1';
      element.dataset[previousKey] = element.hidden ? '1' : '0';
    }
    element.hidden = true;
    return;
  }

  if (element.dataset[hiddenKey]) {
    element.hidden = element.dataset[previousKey] === '1';
    delete element.dataset[hiddenKey];
    delete element.dataset[previousKey];
  }
}

function updateNavigationLabels() {
  const nav = document.querySelector('#mainNav');
  if (!nav) return;
  const children = [...nav.children];

  children.forEach((child, index) => {
    if (!child.classList.contains('nav-label')) return;
    let hasVisibleRoute = false;

    for (let position = index + 1; position < children.length; position += 1) {
      const candidate = children[position];
      if (candidate.classList.contains('nav-label')) break;
      if (candidate.matches?.('[data-route]') && !candidate.hidden) {
        hasVisibleRoute = true;
        break;
      }
    }

    rememberAndHide(child, isWarehouse() && !hasVisibleRoute, 'almoxLabel');
  });
}

function updateSidebarRole() {
  if (!profile) return;
  const label = document.querySelector('#sidebarUser .user-meta small');
  if (label && isWarehouse()) label.textContent = 'Almoxarifado';
}

function updateNavigationVisibility() {
  const warehouse = isWarehouse();

  document.querySelectorAll('#mainNav [data-route]').forEach(button => {
    const allowed = ALMOXARIFADO_ROUTES.has(button.dataset.route || '');
    rememberAndHide(button, warehouse && !allowed, 'almoxRoute');
  });

  rememberAndHide(document.querySelector('#quickAddBtn'), warehouse, 'almoxQuickAdd');
  updateNavigationLabels();
  updateSidebarRole();
}

function navigateToFallback() {
  if (!isWarehouse() || navigationPending) return;
  navigationPending = true;

  const finish = () => {
    navigationPending = false;
    updateNavigationVisibility();
  };

  const button = document.querySelector(`#mainNav [data-route="${FALLBACK_ROUTE}"]`);
  if (button) {
    button.hidden = false;
    button.click();
    setTimeout(finish, 120);
    return;
  }

  history.replaceState(null, '', `#${FALLBACK_ROUTE}`);
  setTimeout(finish, 180);
}

function enforceCurrentRoute() {
  if (!isWarehouse()) return;

  const shell = document.querySelector('#appShell');
  if (!shell || shell.hidden) {
    setTimeout(enforceCurrentRoute, 120);
    return;
  }

  if (!ALMOXARIFADO_ROUTES.has(currentRoute())) navigateToFallback();
  else updateNavigationVisibility();
}

function attachRoleHint(select, hint) {
  if (!select || !hint) return;
  const update = () => {
    hint.textContent = roleDescription(select.value);
    hint.style.borderColor = select.value === 'almoxarifado' ? 'rgba(15,118,110,.32)' : '';
    hint.style.background = select.value === 'almoxarifado' ? '#f0fdfa' : '';
  };

  if (!select.dataset.roleHintBound) {
    select.dataset.roleHintBound = '1';
    select.addEventListener('change', update);
  }
  update();
}

function decorateEditUserModal() {
  const form = document.querySelector('#userForm');
  const select = form?.querySelector('select[name="role"]');
  if (!form || !select) return;

  let hint = form.querySelector('[data-user-role-hint]');
  if (!hint) {
    hint = document.createElement('div');
    hint.dataset.userRoleHint = 'true';
    hint.className = 'import-note full';
    select.closest('label')?.insertAdjacentElement('afterend', hint);
  }

  attachRoleHint(select, hint);
}

function closeCreateUserModal() {
  const root = document.querySelector('#modalRoot');
  if (root?.querySelector('[data-create-user-modal]')) root.innerHTML = '';
}

function roleOptions(selected = 'almoxarifado') {
  return [
    ['gerente', 'Gerente'],
    ['compras', 'Compras'],
    ['almoxarifado', 'Almoxarifado'],
    ['producao', 'Produção'],
    ['operador', 'Operador']
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function openCreateUserModal() {
  if (!isManager()) {
    toast('Somente a gerente pode criar usuários.', 'error');
    return;
  }

  const root = document.querySelector('#modalRoot');
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop" data-create-user-modal>
      <section class="modal modal-sm" role="dialog" aria-modal="true" aria-label="Criar usuário">
        <header class="modal-head">
          <div><h2>Criar usuário</h2><p>Cadastre o acesso e defina as permissões da pessoa.</p></div>
          <button type="button" class="icon-btn modal-close" data-create-user-close aria-label="Fechar">×</button>
        </header>
        <div class="modal-body">
          <form id="createSystemUserForm" class="form-grid">
            <label class="field full"><span>Nome *</span><input name="name" autocomplete="name" required /></label>
            <label class="field full"><span>E-mail *</span><input name="email" type="email" autocomplete="off" required /></label>
            <label class="field full"><span>Senha inicial *</span><input name="password" type="password" minlength="6" autocomplete="new-password" required /></label>
            <label class="field full"><span>Perfil</span><select name="role">${roleOptions('almoxarifado')}</select></label>
            <div class="import-note full" data-create-role-hint>${escapeHtml(roleDescription('almoxarifado'))}</div>
          </form>
        </div>
        <footer class="modal-foot">
          <button type="button" class="btn btn-ghost" data-create-user-close>Cancelar</button>
          <button id="saveCreatedUserBtn" type="button" class="btn btn-primary">Criar usuário</button>
        </footer>
      </section>
    </div>`;

  root.querySelectorAll('[data-create-user-close]').forEach(button => button.addEventListener('click', closeCreateUserModal));
  root.querySelector('[data-create-user-modal]')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeCreateUserModal();
  });

  attachRoleHint(
    root.querySelector('#createSystemUserForm select[name="role"]'),
    root.querySelector('[data-create-role-hint]')
  );
  root.querySelector('#saveCreatedUserBtn')?.addEventListener('click', createSystemUser);
}

async function creatorAuthInstance() {
  let creatorApp = getApps().find(candidate => candidate.name === CREATOR_APP_NAME);
  if (!creatorApp) creatorApp = initializeApp(firebaseConfig, CREATOR_APP_NAME);

  const creatorAuth = getAuth(creatorApp);
  await setPersistence(creatorAuth, inMemoryPersistence);
  if (creatorAuth.currentUser) await signOut(creatorAuth);
  return creatorAuth;
}

async function createSystemUser() {
  if (!isManager()) {
    toast('Somente a gerente pode criar usuários.', 'error');
    return;
  }

  const form = document.querySelector('#createSystemUserForm');
  const button = document.querySelector('#saveCreatedUserBtn');
  if (!form?.reportValidity() || !button) return;

  const data = Object.fromEntries(new FormData(form).entries());
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Criando...';

  let creatorAuth = null;
  let credential = null;

  try {
    creatorAuth = await creatorAuthInstance();
    credential = await createUserWithEmailAndPassword(
      creatorAuth,
      String(data.email || '').trim(),
      String(data.password || '')
    );

    const timestamp = Date.now();
    try {
      await set(ref(db, `users/${credential.user.uid}`), {
        name: String(data.name || '').trim(),
        email: credential.user.email,
        role: data.role || 'almoxarifado',
        active: true,
        createdAt: timestamp,
        createdBy: auth.currentUser?.uid || '',
        updatedAt: timestamp
      });
    } catch (profileError) {
      await deleteUser(credential.user).catch(() => {});
      throw profileError;
    }

    await signOut(creatorAuth).catch(() => {});
    closeCreateUserModal();
    toast(`Usuário criado com o perfil ${data.role === 'almoxarifado' ? 'Almoxarifado' : data.role}.`);
  } catch (error) {
    console.error('Falha ao criar usuário:', error);
    toast(authErrorMessage(error), 'error');
    if (creatorAuth?.currentUser) await signOut(creatorAuth).catch(() => {});
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function injectCreateUserUi() {
  if (!isManager() || currentRoute() !== 'usuarios') return;

  const view = document.querySelector('#view');
  const pageHead = view?.querySelector('.page-head');
  if (!pageHead) return;

  let actions = pageHead.querySelector('.page-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'page-actions';
    pageHead.appendChild(actions);
  }

  if (!actions.querySelector('#createSystemUserBtn')) {
    const button = document.createElement('button');
    button.id = 'createSystemUserBtn';
    button.type = 'button';
    button.className = 'btn btn-primary';
    button.textContent = '+ Criar usuário';
    button.addEventListener('click', openCreateUserModal);
    actions.appendChild(button);
  }

  const note = [...view.querySelectorAll('.import-note')]
    .find(element => element.textContent.includes('Criar primeiro acesso'));
  if (note) {
    note.textContent = 'Crie o usuário diretamente por esta tela ou mantenha a opção de primeiro acesso. Depois você pode alterar o perfil e bloquear o acesso a qualquer momento.';
  }
}

function applyUi() {
  updateNavigationVisibility();
  enforceCurrentRoute();
  injectCreateUserUi();
  decorateEditUserModal();
}

function scheduleUi(delay = 0) {
  clearTimeout(uiTimer);
  uiTimer = setTimeout(applyUi, delay);
}

document.addEventListener('click', event => {
  const routeButton = event.target.closest?.('[data-route]');

  if (routeButton && isWarehouse() && !ALMOXARIFADO_ROUTES.has(routeButton.dataset.route || '')) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    navigateToFallback();
    return;
  }

  if (routeButton) {
    scheduleUi(40);
    setTimeout(() => scheduleUi(0), 240);
  }
}, true);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeCreateUserModal();
});

window.addEventListener('hashchange', () => scheduleUi(0));

const nav = document.querySelector('#mainNav');
if (nav) new MutationObserver(() => scheduleUi(0)).observe(nav, { childList: true, subtree: true });

const view = document.querySelector('#view');
if (view) new MutationObserver(() => scheduleUi(0)).observe(view, { childList: true, subtree: true });

const modalRoot = document.querySelector('#modalRoot');
if (modalRoot) new MutationObserver(() => scheduleUi(0)).observe(modalRoot, { childList: true, subtree: true });

onAuthStateChanged(auth, user => {
  stopProfile?.();
  stopProfile = null;
  profile = null;

  if (!user) {
    updateNavigationVisibility();
    return;
  }

  stopProfile = onValue(ref(db, `users/${user.uid}`), snapshot => {
    profile = snapshot.val() || null;
    scheduleUi(0);
    setTimeout(() => scheduleUi(0), 120);
    setTimeout(() => scheduleUi(0), 420);
  }, error => console.error('Falha ao carregar permissões do usuário:', error));
});

scheduleUi(0);
