// DiaPeek — Toolbar-Popup (Schnellzugriff) / quick settings

const DEFAULTS = {
  enabled: true,
  mode: 'overlay',
  position: 'center',
  language: 'auto',
  intercept: { newTabLinks: true, shiftClick: true },
};

const I18N = globalThis.DiaPeekI18N;

function merge(stored) {
  const s = stored || {};
  return { ...DEFAULTS, ...s, intercept: { ...DEFAULTS.intercept, ...(s.intercept || {}) } };
}

function applyLanguage(lang) {
  const code = I18N ? I18N.resolveLanguage(lang) : 'en';
  document.documentElement.lang = code;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = I18N ? I18N.t(el.dataset.i18n, code) : el.dataset.i18n;
  });
}

const enabledEl = document.getElementById('enabled');

async function save(patch) {
  const { settings } = await chrome.storage.sync.get('settings');
  const next = merge(settings);
  Object.assign(next, patch);
  await chrome.storage.sync.set({ settings: next });
}

async function load() {
  const { settings } = await chrome.storage.sync.get('settings');
  const s = merge(settings);
  applyLanguage(s.language);
  enabledEl.checked = s.enabled;
}

enabledEl.addEventListener('change', () => save({ enabled: enabledEl.checked }));
document.getElementById('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());

load();
