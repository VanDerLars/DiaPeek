// DiaPeek — lokale Übersetzungen / local translations.
// Alles ist direkt in der Extension gebündelt: kein Netzwerk, keine externen
// Übersetzungsdienste. Standard ist die System-/Browser-Sprache ("auto"),
// Englisch dient als Fallback.
//
// Wird als normales Script in den Options-/Popup-Seiten geladen und im Manifest
// vor content-iso.js registriert. Stellt global `DiaPeekI18N` bereit.

(function () {
  const DEFAULT_LANGUAGE = 'en';
  const AUTO_LANGUAGE = 'auto';

  // value 'auto' = System-/Browser-Sprache folgen.
  const LANGUAGES = [
    { value: 'auto', key: 'languageAuto' },
    { value: 'en', label: 'English' },
    { value: 'de', label: 'Deutsch' },
  ];

  const POSITIONS = [
    { value: 'left', key: 'posLeft' },
    { value: 'center', key: 'posCenter' },
    { value: 'right', key: 'posRight' },
  ];

  const MESSAGES = {
    en: {
      pageTitle: 'DiaPeek — Settings',
      subtitle: 'Opens links that would otherwise open a new tab in a Peek overlay.',
      enabled: 'Enable DiaPeek',
      general: 'General',
      languageLabel: 'Language',
      languageAuto: 'Automatic (system)',
      languageNote:
        "Follows the system/browser language by default. You can also pick a language explicitly.",
      appearance: 'Appearance',
      modeOverlayTitle: 'Sidepeek',
      modeOverlayDesc:
        'Docked in-page overlay (with split option). Embeds the page in an iframe.',
      modeWindowTitle: 'Window',
      modeWindowDesc:
        'Dedicated window. Works on every page (even non-embeddable ones) and closes when you click away.',
      positionLabel: 'Position',
      positionNote: 'Where the Peek overlay or window appears. Center is the default.',
      interceptHeading: 'What opens in a Peek?',
      interceptNewTab: 'Links that open a new tab',
      interceptNewTabHint: '(target="_blank", window.open, middle-click)',
      interceptShift: '⇧ Shift + click',
      interceptNote:
        '⌘ Cmd (new tab), ⌃ Ctrl (context menu) and ⌥ Option (native split) always stay native and are never intercepted.',
      save: 'Save',
      reset: 'Restore defaults',
      saved: 'Saved ✓',
      resetDone: 'Reset to defaults ✓',
      posLeft: 'Left',
      posCenter: 'Center',
      posRight: 'Right',
      popupEnabled: 'Enabled',
      popupSettings: 'Settings…',
      overlaySplit: 'Show as split (page stays usable on the left)',
      overlayTab: 'Open in a new tab',
      overlayClose: 'Close Peek (Esc)',
      overlayLoading: 'Loading…',
      overlayBlocked: 'This page blocks embedding — opening in its own window…',
      overlayOpenWindow: 'Open in its own window',
      winPromote: 'Open as a tab in the tab group',
      winClose: 'Close window',
    },
    de: {
      pageTitle: 'DiaPeek — Einstellungen',
      subtitle: 'Öffnet Links, die sonst einen neuen Tab öffnen würden, in einem Peek-Overlay.',
      enabled: 'DiaPeek aktiviert',
      general: 'Allgemein',
      languageLabel: 'Sprache',
      languageAuto: 'Automatisch (System)',
      languageNote:
        'Folgt standardmäßig der System-/Browser-Sprache. Alternativ lässt sich eine Sprache fest wählen.',
      appearance: 'Darstellung',
      modeOverlayTitle: 'Sidepeek',
      modeOverlayDesc:
        'Angedocktes In-Page-Overlay (mit Split-Option). Bettet die Seite per iframe ein.',
      modeWindowTitle: 'Fenster',
      modeWindowDesc:
        'Eigenes Fenster. Funktioniert auf allen Seiten (auch nicht-einbettbaren) und schließt beim Rausklicken.',
      positionLabel: 'Position',
      positionNote: 'Wo Overlay oder Fenster erscheinen. Standard ist die Mitte.',
      interceptHeading: 'Was im Peek öffnen?',
      interceptNewTab: 'Links, die einen neuen Tab öffnen',
      interceptNewTabHint: '(target="_blank", window.open, Mittelklick)',
      interceptShift: '⇧ Shift + Klick',
      interceptNote:
        '⌘ Cmd (neuer Tab), ⌃ Ctrl (Kontextmenü) und ⌥ Option (nativer Split) bleiben immer nativ und werden nicht abgefangen.',
      save: 'Speichern',
      reset: 'Standard wiederherstellen',
      saved: 'Gespeichert ✓',
      resetDone: 'Auf Standard zurückgesetzt ✓',
      posLeft: 'Links',
      posCenter: 'Mitte',
      posRight: 'Rechts',
      popupEnabled: 'Aktiviert',
      popupSettings: 'Einstellungen …',
      overlaySplit: 'Als Split anzeigen (Seite bleibt links bedienbar)',
      overlayTab: 'In neuem Tab öffnen',
      overlayClose: 'Peek schließen (Esc)',
      overlayLoading: 'Lädt …',
      overlayBlocked: 'Seite blockiert das Einbetten – öffne in eigenem Fenster …',
      overlayOpenWindow: 'In eigenem Fenster öffnen',
      winPromote: 'Als Tab in der Tab-Gruppe öffnen',
      winClose: 'Fenster schließen',
    },
  };

  function supportedLanguage(value) {
    const base = String(value || '')
      .toLowerCase()
      .split('-')[0];
    return Object.prototype.hasOwnProperty.call(MESSAGES, base) ? base : null;
  }

  // System-/Browser-Sprache ermitteln (lokal, über chrome.i18n bzw. navigator).
  function getSystemLanguage() {
    let raw = '';
    try {
      if (
        globalThis.chrome &&
        chrome.i18n &&
        typeof chrome.i18n.getUILanguage === 'function'
      ) {
        raw = chrome.i18n.getUILanguage();
      }
    } catch (e) {
      /* chrome.i18n evtl. nicht verfügbar */
    }
    if (!raw && typeof navigator !== 'undefined') {
      raw = navigator.language || (navigator.languages && navigator.languages[0]) || '';
    }
    return supportedLanguage(raw) || DEFAULT_LANGUAGE;
  }

  // Gespeicherter Einstellungswert: 'auto' | 'en' | 'de'.
  function normalizeLanguage(lang) {
    const base = String(lang || '')
      .toLowerCase()
      .split('-')[0];
    return base === 'en' || base === 'de' ? base : AUTO_LANGUAGE;
  }

  // Konkrete Sprache für UI-Texte: 'auto' → System/Browser, sonst die Wahl.
  function resolveLanguage(lang) {
    const normalized = normalizeLanguage(lang);
    return normalized === AUTO_LANGUAGE ? getSystemLanguage() : normalized;
  }

  function t(key, lang, vars) {
    const code = resolveLanguage(lang);
    let text = MESSAGES[code][key];
    if (text == null) text = MESSAGES[DEFAULT_LANGUAGE][key];
    if (text == null) text = key;
    if (vars) {
      text = text.replace(/\{(\w+)\}/g, (match, name) =>
        vars[name] != null ? String(vars[name]) : match
      );
    }
    return text;
  }

  // Nur noch drei Positionen; alte 9er-Werte werden migriert.
  function normalizePosition(value) {
    const v = String(value || '');
    if (v === 'left' || /-left$/.test(v)) return 'left';
    if (v === 'right' || /-right$/.test(v)) return 'right';
    return 'center';
  }

  function isPosition(value) {
    return value === 'left' || value === 'center' || value === 'right';
  }

  globalThis.DiaPeekI18N = {
    DEFAULT_LANGUAGE,
    AUTO_LANGUAGE,
    LANGUAGES,
    POSITIONS,
    MESSAGES,
    getSystemLanguage,
    normalizeLanguage,
    resolveLanguage,
    normalizePosition,
    isPosition,
    t,
  };
})();
