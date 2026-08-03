import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase,
  ref,
  onValue,
  set
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

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

let profile = null;
let users = {};
let stopProfile = null;
let stopUsers = null;
let editingUserId = '';
let navigationPending = false;
let decorateQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function roleLabel(role) {
  return ROLE_LABELS[role] || 'Operador';
}

function restrictedRoutes() {
  return ROLE_ROUTES[profile?.role] || null;
}

function routeAllowed(route) {
  const allowed = restrictedRoutes();
  return !allowed || allowed.has(route);
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

function authMessage(error) {
  const code = String(error?.code || '');
  if (code.includes('email-already-in-use')) return 'Este e-mail já possui acesso.';
  if (code.includes('invalid-email')) return 'Informe um e-mail válido.';
  if (code.includes('weak-password')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (code.includes('permission-denied')) return 'Seu perfil não possui permissão para criar este usuário.';
  return error?.message || 'Não foi possível criar o usuário.';
}

function setSidebarRole() {
  const label = document.querySelector('#sidebarUser .user-meta small');
  if (!label || !profile) return;
  const expected = roleLabel(profile.role);
  if (label.textContent !== expected) label.textContent = expected;
}

function updateNavigationVisibility() {
  if (!profile) return;
  const allowed = restrictedRoutes();
  const isManager = profile.role === 'gerente';

  document.querySelectorAll('#mainNav [data-route]').forEach(button => {
    const route = button.dataset.route || '';
    if (allowed) button.hidden = !allowed.has(route);
    else button.hidden = button.classList.contains('manager-only') && !isManager;
  });

  document.querySelectorAll('#mainNav .nav-label').forEach(label => {
    label.hidden = Boolean(allowed);
  });

  const quickAdd = document.querySelector('#quickAddBtn');
  if (quickAdd) quickAdd.hidden = Boolean(allowed);

  const projectWrap = document.querySelector('.project-select-wrap');
  if (projectWrap) {
    const hideProject = profile.role === 'supervisor'
      || (profile.role === 'almoxarifado' && ['recebimento', 'calendario'].includes(currentRoute()));
    projectWrap.hidden = hideProject;
  }

  setSidebarRole();
}

function navigateTo(route) {
  if (navigationPending) return;
  navigationPending = true;

  const attempt = () => {
    const button = document.querySelector(`#mainNav [data-route="${route}"]`);
    if (button) {
      button.hidden = false;
      button.click();
      setTimeout(() => {
        navigationPending = false;
        updateNavigationVisibility();
      }, 120);
      return;
    }

    history.replaceState(null, '', `#${route}`);
    setTimeout(() => {
      navigationPending = false;
      enforceCurrentRoute();
    }, 220);
  };

  setTimeout(attempt, 0);
}

function enforceCurrentRoute() {
  if (!profile || !restrictedRoutes()) return;
  const shell = document.querySelector('#appShell');
  if (!shell || shell.hidden) {
    setTimeout(enforceCurrentRoute, 120);
    return;
  }

  const route = currentRoute();
  if (!routeAllowed(route)) navigateTo(DEFAULT_ROUTE[profile.role]);
  else updateNavigationVisibility();
}

function addSupervisorOption(select) {
  if (!select || select.querySelector('option[value="supervisor"]')) return;
  const option = document.createElement('option');
  option.value = 'supervisor';
  option.textContent = 'Supervisor';
  const production = select.querySelector('option[value="producao"]');
  select.insertBefore(option, production || null);
}

function patchUserModal() {
  const select = document.querySelector('#userForm select[name="role"]');
  if (!select) return;
  addSupervisorOption(select);
  const storedRole = users[editingUserId]?.role;
  if (storedRole && select.value !== storedRole) select.value = storedRole;
}

function patchUserCards() {
  if (profile?.role !== 'gerente') return;
  document.querySelectorAll('[data-edit-user]').forEach(button => {
    const user = users[button.dataset.editUser];
    const badge = button.closest('.user-card')?.querySelector('.role-badge');
    if (!user || !badge) return;
    const expected = roleLabel(user.role);
    if (badge.textContent !== expected) badge.textContent = expected;
  });
}

function roleOptions(selected = 'almoxarifado') {
  return [
    ['almoxarifado', 'Almoxarifado'],
    ['supervisor', 'Supervisor'],
    ['compras', 'Compras'],
    ['producao', 'Produção'],
    ['operador', 'Operador'],
    ['gerente', 'Gerente']
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function closeCreateUserModal() {
  const root = document.querySelector('#modalRoot');
  if (root) root.innerHTML = '';
}

function openCreateUserModal() {
  if (profile?.role !== 'gerente') return;
  const root = document.querySelector('#modalRoot');
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop" data-create-user-backdrop>
      <section class="modal modal-sm" role="dialog" aria-modal="true" aria-label="Criar usuário">
        <header class="modal-head">
          <div><h2>Criar usuário</h2><p>Cadastre o acesso e escolha as permissões iniciais.</p></div>
          <button class="icon-btn modal-close" type="button" data-create-user-close>×</button>
        </header>
        <div class="modal-body">
          <form id="createSystemUserForm" class="form-grid">
            <label class="field full"><span>Nome</span><input name="name" autocomplete="name" required /></label>
            <label class="field full"><span>E-mail</span><input name="email" type="email" autocomplete="off" required /></label>
            <label class="field full"><span>Senha inicial</span><input name="password" type="password" minlength="6" autocomplete="new-password" required /></label>
            <label class="field full"><span>Perfil</span><select name="role">${roleOptions()}</select></label>
            <div class="import-note full">
              <strong>Almoxarifado:</strong> Recebimento, Pintura, Separação e Calendário.<br>
              <strong>Supervisor:</strong> Calendário e Acompanhamento.
            </div>
          </form>
        </div>
        <footer class="modal-foot">
          <button class="btn btn-ghost" type="button" data-create-user-close>Cancelar</button>
          <button id="saveCreatedSystemUser" class="btn btn-primary" type="button">Criar usuário</button>
        </footer>
      </section>
    </div>`;

  root.querySelectorAll('[data-create-user-close]').forEach(button => button.addEventListener('click', closeCreateUserModal));
  root.querySelector('[data-create-user-backdrop]')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeCreateUserModal();
  });

  root.querySelector('#saveCreatedSystemUser')?.addEventListener('click', createSystemUser);
}

async function createSystemUser(event) {
  if (profile?.role !== 'gerente') return;
  const form = document.querySelector('#createSystemUserForm');
  if (!form?.reportValidity()) return;

  const button = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Criando...';

  const creatorName = 'ObraFlowUserCreator';
  const creatorApp = getApps().find(item => item.name === creatorName)
    || initializeApp(firebaseConfig, creatorName);
  const creatorAuth = getAuth(creatorApp);

  try {
    await signOut(creatorAuth).catch(() => {});
    const credential = await createUserWithEmailAndPassword(
      creatorAuth,
      String(data.email || '').trim(),
      String(data.password || '')
    );

    const timestamp = Date.now();
    await set(ref(db, `users/${credential.user.uid}`), {
      name: String(data.name || '').trim(),
      email: String(data.email || '').trim(),
      role: data.role || 'operador',
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: auth.currentUser?.uid || ''
    });

    await signOut(creatorAuth).catch(() => {});
    closeCreateUserModal();
    toast('Usuário criado com sucesso.');
  } catch (error) {
    console.error('Falha ao criar usuário:', error);
    toast(authMessage(error), 'error');
    await signOut(creatorAuth).catch(() => {});
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function ensureCreateUserButton() {
  if (profile?.role !== 'gerente' || currentRoute() !== 'usuarios') return;
  if (document.querySelector('#createSystemUserBtn')) return;

  const pageHead = document.querySelector('#view .page-head');
  if (!pageHead) return;
  let actions = pageHead.querySelector('.page-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'page-actions';
    pageHead.appendChild(actions);
  }

  const button = document.createElement('button');
  button.id = 'createSystemUserBtn';
  button.type = 'button';
  button.className = 'btn btn-primary';
  button.textContent = '+ Criar usuário';
  button.addEventListener('click', openCreateUserModal);
  actions.appendChild(button);
}

function decorate() {
  decorateQueued = false;
  if (!profile) return;
  updateNavigationVisibility();
  patchUserModal();
  patchUserCards();
  ensureCreateUserButton();
}

function queueDecorate() {
  if (decorateQueued) return;
  decorateQueued = true;
  requestAnimationFrame(() => setTimeout(decorate, 0));
}

function subscribeUsersIfManager() {
  stopUsers?.();
  stopUsers = null;
  users = {};
  if (profile?.role !== 'gerente') return;

  stopUsers = onValue(ref(db, 'users'), snapshot => {
    users = snapshot.val() || {};
    queueDecorate();
  }, error => console.error('Falha ao carregar perfis de usuários:', error));
}

document.addEventListener('click', event => {
  const editButton = event.target.closest?.('[data-edit-user]');
  if (editButton) {
    editingUserId = editButton.dataset.editUser || '';
    setTimeout(queueDecorate, 0);
  }

  const routeButton = event.target.closest?.('[data-route]');
  if (!routeButton || !profile || !restrictedRoutes()) return;
  const route = routeButton.dataset.route || '';
  if (routeAllowed(route)) {
    setTimeout(updateNavigationVisibility, 80);
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  navigateTo(DEFAULT_ROUTE[profile.role]);
}, true);

window.addEventListener('hashchange', () => {
  setTimeout(enforceCurrentRoute, 0);
  setTimeout(updateNavigationVisibility, 80);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.querySelector('#createSystemUserForm')) closeCreateUserModal();
});

const observer = new MutationObserver(queueDecorate);
observer.observe(document.documentElement, { childList: true, subtree: true });

onAuthStateChanged(auth, user => {
  stopProfile?.();
  stopUsers?.();
  stopProfile = null;
  stopUsers = null;
  profile = null;
  users = {};
  editingUserId = '';

  if (!user) return;
  stopProfile = onValue(ref(db, `users/${user.uid}`), snapshot => {
    profile = snapshot.val() || null;
    subscribeUsersIfManager();
    queueDecorate();
    setTimeout(enforceCurrentRoute, 80);
    setTimeout(enforceCurrentRoute, 300);
  }, error => console.error('Falha ao carregar permissões do usuário:', error));
});
