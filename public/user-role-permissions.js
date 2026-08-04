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

const ROLE_ROUTES = {
  almoxarifado: new Set(['recebimento', 'pintura', 'separacao', 'calendario']),
  supervisor: new Set(['calendario', 'estoque'])
};

const DEFAULT_ROUTE = {
  almoxarifado: 'recebimento',
  supervisor: 'calendario'
};

const ROLE_LABELS = {
  gerente: 'Gerente',
  compras: 'Compras',
  almoxarifado: 'Almoxarifado',
  supervisor: 'Supervisor',
  producao: 'Produção',
  operador: 'Operador'
};

const roleDescriptions = {
  gerente: 'Acesso completo ao sistema, usuários, obras e todas as operações.',
  compras: 'Perfil de compras e gerenciamento de obras permitido pelo sistema.',
  almoxarifado: 'Acesso somente a Recebimento, Pintura, Separação e Calendário.',
  supervisor: 'Acesso somente a Calendário e Acompanhamento.',
  producao: 'Perfil de produção conforme as permissões operacionais atuais.',
  operador: 'Perfil operacional padrão do sistema.'
};

const CREATOR_APP_NAME = 'obraflow-user-creator';

let profile = null;
let users = {};
let stopProfile = null;
let stopUsers = null;
let editingUserId = '';
let uiTimer = null;
let navigationPending = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function isManager() {
  return profile?.role === 'gerente';
}

function restrictedRoutes() {
  return ROLE_ROUTES[profile?.role] || null;
}

function defaultRoute() {
  return DEFAULT_ROUTE[profile?.role] || 'dashboard';
}

function roleLabel(role) {
  return ROLE_LABELS[role] || 'Operador';
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
  if (code.includes('permission-denied')) return 'As regras do Firebase ainda não permitem salvar esse perfil.';
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
  const allowed = restrictedRoutes();
  if (!nav || !allowed) return;

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

    rememberAndHide(child, !hasVisibleRoute, 'restrictedLabel');
  });
}

function updateSidebarRole() {
  if (!profile) return;
  const label = document.querySelector('#sidebarUser .user-meta small');
  if (label) label.textContent = roleLabel(profile.role);
}

function updateNavigationVisibility() {
  const allowed = restrictedRoutes();

  document.querySelectorAll('#mainNav [data-route]').forEach(button => {
    const shouldHide = Boolean(allowed) && !allowed.has(button.dataset.route || '');
    rememberAndHide(button, shouldHide, 'restrictedRoute');
  });

  rememberAndHide(document.querySelector('#quickAddBtn'), Boolean(allowed), 'restrictedQuickAdd');

  const projectWrap = document.querySelector('.project-select-wrap');
  const route = currentRoute();
  const hideProject = profile?.role === 'supervisor'
    || (profile?.role === 'almoxarifado' && ['recebimento', 'calendario'].includes(route));
  rememberAndHide(projectWrap, hideProject, 'restrictedProject');

  if (allowed) updateNavigationLabels();
  else document.querySelectorAll('#mainNav .nav-label').forEach(label => rememberAndHide(label, false, 'restrictedLabel'));

  updateSidebarRole();
}

function navigateToFallback() {
  const allowed = restrictedRoutes();
  if (!allowed || navigationPending) return;
  navigationPending = true;

  const route = defaultRoute();
  const finish = () => {
    navigationPending = false;
    updateNavigationVisibility();
  };

  const button = document.querySelector(`#mainNav [data-route="${route}"]`);
  if (button) {
    button.hidden = false;
    button.click();
    setTimeout(finish, 150);
    return;
  }

  history.replaceState(null, '', `#${route}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  setTimeout(finish, 220);
}

function enforceCurrentRoute() {
  const allowed = restrictedRoutes();
  if (!allowed) return;

  const shell = document.querySelector('#appShell');
  if (!shell || shell.hidden) {
    setTimeout(enforceCurrentRoute, 120);
    return;
  }

  if (!allowed.has(currentRoute())) navigateToFallback();
  else updateNavigationVisibility();
}

function ensureSupervisorOption(select) {
  if (!select || select.querySelector('option[value="supervisor"]')) return;
  const option = document.createElement('option');
  option.value = 'supervisor';
  option.textContent = 'Supervisor';
  const production = select.querySelector('option[value="producao"]');
  select.insertBefore(option, production || null);
}

function attachRoleHint(select, hint) {
  if (!select || !hint) return;
  const update = () => {
    hint.textContent = roleDescription(select.value);
    const emphasized = ['almoxarifado', 'supervisor'].includes(select.value);
    hint.style.borderColor = emphasized ? 'rgba(15,118,110,.32)' : '';
    hint.style.background = emphasized ? '#f0fdfa' : '';
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

  ensureSupervisorOption(select);
  const storedRole = users[editingUserId]?.role;
  if (storedRole && select.value !== storedRole) select.value = storedRole;

  let hint = form.querySelector('[data-user-role-hint]');
  if (!hint) {
    hint = document.createElement('div');
    hint.dataset.userRoleHint = 'true';
    hint.className = 'import-note full';
    select.closest('label')?.insertAdjacentElement('afterend', hint);
  }

  attachRoleHint(select, hint);
}

function patchUserCards() {
  if (!isManager()) return;
  document.querySelectorAll('[data-edit-user]').forEach(button => {
    const user = users[button.dataset.editUser];
    const badge = button.closest('.user-card')?.querySelector('.role-badge');
    if (!user || !badge) return;
    const expected = roleLabel(user.role);
    if (badge.textContent !== expected) badge.textContent = expected;
  });
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
    ['supervisor', 'Supervisor'],
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
    toast(`Usuário criado com o perfil ${roleLabel(data.role)}.`);
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
  patchUserCards();
}

function scheduleUi(delay = 0) {
  clearTimeout(uiTimer);
  uiTimer = setTimeout(applyUi, delay);
}

function subscribeUsersIfManager() {
  stopUsers?.();
  stopUsers = null;
  users = {};
  if (!isManager()) return;

  stopUsers = onValue(ref(db, 'users'), snapshot => {
    users = snapshot.val() || {};
    scheduleUi(0);
  }, error => console.error('Falha ao carregar usuários para as permissões:', error));
}

document.addEventListener('click', event => {
  const editButton = event.target.closest?.('[data-edit-user]');
  if (editButton) {
    editingUserId = editButton.dataset.editUser || '';
    setTimeout(() => scheduleUi(0), 0);
  }

  const routeButton = event.target.closest?.('[data-route]');
  const allowed = restrictedRoutes();

  if (routeButton && allowed && !allowed.has(routeButton.dataset.route || '')) {
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
  stopUsers?.();
  stopProfile = null;
  stopUsers = null;
  profile = null;
  users = {};
  editingUserId = '';

  if (!user) {
    updateNavigationVisibility();
    return;
  }

  stopProfile = onValue(ref(db, `users/${user.uid}`), snapshot => {
    profile = snapshot.val() || null;
    subscribeUsersIfManager();
    scheduleUi(0);
    setTimeout(() => scheduleUi(0), 120);
    setTimeout(() => scheduleUi(0), 420);
  }, error => console.error('Falha ao carregar permissões do usuário:', error));
});

scheduleUi(0);
