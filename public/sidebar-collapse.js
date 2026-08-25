const STORAGE_KEY = 'obraflow.sidebarCollapsed';
const desktopMedia = window.matchMedia('(min-width: 901px)');

const appShell = document.querySelector('#appShell');
const toggle = document.querySelector('#collapseSidebarBtn');
const sidebar = document.querySelector('#sidebar');

function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePreference(collapsed) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // O recolhimento continua funcionando mesmo se o armazenamento estiver indisponível.
  }
}

function setCollapsed(collapsed, persist = false) {
  if (!appShell || !toggle || !sidebar) return;

  const desktopCollapsed = desktopMedia.matches && Boolean(collapsed);
  appShell.classList.toggle('sidebar-collapsed', desktopCollapsed);

  const label = desktopCollapsed ? 'Abrir menu lateral' : 'Recolher menu lateral';
  toggle.textContent = desktopCollapsed ? '›' : '‹';
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('title', label);
  toggle.setAttribute('aria-expanded', String(!desktopCollapsed));
  sidebar.setAttribute('data-collapsed', desktopCollapsed ? 'true' : 'false');

  if (persist && desktopMedia.matches) writePreference(desktopCollapsed);
}

function prepareTooltips() {
  document.querySelectorAll('#mainNav .nav-item').forEach(button => {
    const label = button.textContent.replace(/\s+/g, ' ').trim();
    if (label) button.setAttribute('title', label);
  });

  const logout = document.querySelector('#logoutBtn');
  if (logout) logout.setAttribute('title', 'Sair');
}

if (appShell && toggle && sidebar) {
  prepareTooltips();
  setCollapsed(readPreference());

  toggle.addEventListener('click', () => {
    const collapsed = appShell.classList.contains('sidebar-collapsed');
    setCollapsed(!collapsed, true);
  });

  desktopMedia.addEventListener?.('change', () => {
    setCollapsed(readPreference());
  });
}
