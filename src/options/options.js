// DiaPeek — Einstellungsseite / settings page

const DEFAULTS = {
  enabled: true,
  mode: 'overlay', // 'overlay' (Sidepeek) | 'window' (eigenes Fenster)
  position: 'center', // 'left' | 'center' | 'right'
  language: 'auto', // 'auto' (system/browser) | 'en' | 'de'
  intercept: {
    newTabLinks: true, // target="_blank", window.open (feature-los), Mittelklick
    shiftClick: true, // Shift + Klick
  },
};

const I18N = globalThis.DiaPeekI18N;

function defaults() {
  return { ...DEFAULTS, intercept: { ...DEFAULTS.intercept } };
}

function merge(stored) {
  const s = stored || {};
  return { ...DEFAULTS, ...s, intercept: { ...DEFAULTS.intercept, ...(s.intercept || {}) } };
}

const $ = (id) => document.getElementById(id);

function t(key, lang) {
  return I18N ? I18N.t(key, lang) : key;
}

function normalizeLanguage(lang) {
  return I18N ? I18N.normalizeLanguage(lang) : 'auto';
}

function normalizePosition(pos) {
  return I18N
    ? I18N.normalizePosition(pos)
    : pos === 'left' || pos === 'right'
      ? pos
      : 'center';
}

// Übersetzt alle mit data-i18n markierten Elemente. Die Texte liegen lokal in
// src/i18n.js – es wird nichts nachgeladen.
function applyLanguage(lang) {
  const code = I18N ? I18N.resolveLanguage(lang) : 'en';
  document.documentElement.lang = code;
  document.title = t('pageTitle', code);
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n, code);
  });
}

function fill(s) {
  $('enabled').checked = s.enabled;
  $('language').value = normalizeLanguage(s.language);
  $('position').value = normalizePosition(s.position);
  const modeEl = document.querySelector('input[name="mode"][value="' + s.mode + '"]');
  if (modeEl) modeEl.checked = true;
  $('ic-newtab').checked = s.intercept.newTabLinks;
  $('ic-shift').checked = s.intercept.shiftClick;
}

function collect() {
  const modeSel = document.querySelector('input[name="mode"]:checked');
  return {
    enabled: $('enabled').checked,
    mode: modeSel ? modeSel.value : 'overlay',
    position: normalizePosition($('position').value),
    language: normalizeLanguage($('language').value),
    intercept: {
      newTabLinks: $('ic-newtab').checked,
      shiftClick: $('ic-shift').checked,
    },
  };
}

async function load() {
  const { settings } = await chrome.storage.sync.get('settings');
  const s = merge(settings);
  applyLanguage(s.language);
  fill(s);
}

function flash(text) {
  const st = $('status');
  st.textContent = text;
  setTimeout(() => (st.textContent = ''), 1800);
}

// Sprache sofort in der Oberfläche anwenden (gespeichert wird erst mit "Save").
$('language').addEventListener('change', () => applyLanguage($('language').value));

$('save').addEventListener('click', async () => {
  const s = collect();
  await chrome.storage.sync.set({ settings: s });
  applyLanguage(s.language);
  flash(t('saved', s.language));
});

$('reset').addEventListener('click', async () => {
  const d = defaults();
  applyLanguage(d.language);
  fill(d);
  await chrome.storage.sync.set({ settings: d });
  flash(t('resetDone', d.language));
});

load();
