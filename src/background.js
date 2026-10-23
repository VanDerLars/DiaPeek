// DiaPeek — Service Worker
// Nimmt abgefangene URLs entgegen und rendert das Peek-Overlay im Top-Frame.
// Verwaltet die declarativeNetRequest-Regel zum Entfernen der Framing-Header
// (X-Frame-Options / CSP), damit die Zielseite im iframe geladen werden kann.

const DEFAULTS = {
  enabled: true,
  mode: 'overlay', // 'overlay' (Sidepeek/In-Page) | 'window' (eigenes Fenster)
  position: 'center', // 'left' | 'center' | 'right'
  language: 'auto', // 'auto' (System/Browser) | 'en' | 'de'
  intercept: {
    newTabLinks: true, // target="_blank", window.open (feature-los), Mittelklick
    shiftClick: true, // Shift + Klick
  },
};

function mergeSettings(stored) {
  const s = stored || {};
  return {
    ...DEFAULTS,
    ...s,
    intercept: { ...DEFAULTS.intercept, ...(s.intercept || {}) },
  };
}

let cachedSettings = null;

async function getSettings() {
  // Im Service Worker cachen: spart einen Storage-Read pro Peek. Bei Änderungen
  // (siehe Listener unten) wird der Cache verworfen.
  if (cachedSettings) return cachedSettings;
  const { settings } = await chrome.storage.sync.get('settings');
  cachedSettings = mergeSettings(settings);
  return cachedSettings;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) cachedSettings = null;
});

// ---- declarativeNetRequest: Framing-Header entfernen -----------------------
// WICHTIG: Die Regel ist NUR aktiv, solange ein Peek offen ist, und NUR für die
// gepeekte Domain. Früher strippte sie dauerhaft die CSP ALLER Sub-Frames auf
// ALLEN Seiten — das brach z. B. das Anzeigen von Bildern in Slack. Jetzt bleibt
// der Normalbetrieb fremder Seiten unberührt.
const DNR_RULE_ID = 1001;
let stripHost = null; // aktuell gestrippte Domain (spart unnötige Rule-Updates)

async function setStripRule(url) {
  let host = null;
  try {
    host = new URL(url).hostname;
  } catch (e) {
    /* ungültige URL → keine Regel */
  }
  // Gleiche Domain wie beim offenen Peek → Regel ist bereits aktiv.
  if (host && host === stripHost) return;
  const addRules = host
    ? [
        {
          id: DNR_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'frame-options', operation: 'remove' },
              { header: 'content-security-policy', operation: 'remove' },
              { header: 'content-security-policy-report-only', operation: 'remove' },
            ],
          },
          // Nur Sub-Frames (unser Peek-iframe) und nur von der gepeekten Domain.
          condition: { resourceTypes: ['sub_frame'], requestDomains: [host] },
        },
      ]
    : [];
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules,
    });
    stripHost = host;
  } catch (e) {
    console.warn('[DiaPeek] DNR set-Fehler:', e);
  }
}

async function clearStripRule() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [DNR_RULE_ID] });
  } catch (e) {
    console.warn('[DiaPeek] DNR clear-Fehler:', e);
  }
  stripHost = null;
}

// Beim Start/Reload alte Session-Regeln sicher entfernen.
chrome.runtime.onInstalled.addListener(clearStripRule);
chrome.runtime.onStartup.addListener(clearStripRule);

// ---- Neuer Tab (nach Möglichkeit in derselben Tab-Gruppe wie der Opener) ----
async function createTabInGroup(url, opener) {
  // Aktuelle groupId des Opener-Tabs holen (kann veraltet sein). -1 = keine Gruppe.
  let groupId = -1;
  if (opener && opener.id != null) {
    try {
      const fresh = await chrome.tabs.get(opener.id);
      if (fresh && typeof fresh.groupId === 'number') groupId = fresh.groupId;
    } catch (e) {
      if (typeof opener.groupId === 'number') groupId = opener.groupId;
    }
  }

  const props = { url };
  if (opener && opener.id != null) {
    props.windowId = opener.windowId;
    if (typeof opener.index === 'number') props.index = opener.index + 1;
    props.openerTabId = opener.id; // hilft Dia, den Tab beim Opener einzuordnen
  }

  let tab;
  try {
    tab = await chrome.tabs.create(props);
  } catch (e) {
    tab = await chrome.tabs.create({ url }); // z. B. openerTabId ungültig
  }

  if (groupId > -1 && chrome.tabs && chrome.tabs.group) {
    try {
      await chrome.tabs.group({ groupId, tabIds: tab.id });
    } catch (e) {
      console.warn('[DiaPeek] tabs.group fehlgeschlagen:', e);
    }
  }
  return tab;
}

// ---- Peek-Fenster (Fallback für nicht einbettbare Seiten) ------------------
// Ein echtes Popup-Fenster (keine iframe-/CSP-Grenzen), proportional zur
// Hauptfenstergröße, an der in den Einstellungen gewählten Position (Standard:
// mittig), und schließt automatisch, sobald der Fokus auf ein anderes Fenster
// wechselt ("aus dem Fenster rausklicken").
let peekWindowId = null;
let peekOpener = null; // Kontext des Quell-Tabs (für "als Tab in Gruppe öffnen")
const PEEK_WINDOW_RATIO = 0.7;

const POSITION_VALUES = new Set(['left', 'center', 'right']);

// Alte 9er-Werte (top-left …) werden auf left/center/right migriert.
function normalizePosition(position) {
  const v = String(position || '');
  if (v === 'left' || /-left$/.test(v)) return 'left';
  if (v === 'right' || /-right$/.test(v)) return 'right';
  return 'center';
}

// Position des Peek-Fensters innerhalb des aktuellen Browserfensters.
// Standard ist "center" (mittig). Die gleiche Einstellung steuert auch die
// Position des In-Page-Overlays (siehe content-iso.js).
function windowPosition(position, win, width, height) {
  const pos = POSITION_VALUES.has(position) ? position : normalizePosition(position);
  const W = win.width || 1200;
  const H = win.height || 900;
  const baseLeft = Number.isFinite(win.left) ? win.left : 0;
  const baseTop = Number.isFinite(win.top) ? win.top : 0;

  let left;
  if (pos === 'left') left = baseLeft;
  else if (pos === 'right') left = baseLeft + W - width;
  else left = baseLeft + (W - width) / 2;

  // Vertikal immer mittig – die Einstellung betrifft nur links/mitte/rechts.
  const top = baseTop + (H - height) / 2;

  return { left: Math.round(left), top: Math.round(top) };
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === peekWindowId) {
    peekWindowId = null;
    peekOpener = null;
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (peekWindowId == null) return;
  // Fokus ging auf ein ANDERES Fenster (z. B. Hauptfenster) → Peek-Fenster zu.
  // Bei Wechsel zu einer anderen App (WINDOW_ID_NONE) bleibt es offen.
  if (windowId !== peekWindowId && windowId !== chrome.windows.WINDOW_ID_NONE) {
    const id = peekWindowId;
    peekWindowId = null;
    peekOpener = null;
    chrome.windows.remove(id).catch(() => {});
  }
});

async function openPeekWindow(url, opener, position) {
  if (opener) peekOpener = opener;
  let width = 900;
  let height = 700;
  let left;
  let top;
  try {
    const win = await chrome.windows.getCurrent();
    const W = win.width || 1200;
    const H = win.height || 900;
    width = Math.round(W * PEEK_WINDOW_RATIO);
    height = Math.round(H * PEEK_WINDOW_RATIO);
    if (!position) {
      try {
        position = (await getSettings()).position;
      } catch (e) {
        position = 'center';
      }
    }
    ({ left, top } = windowPosition(position, win, width, height));
  } catch (e) {
    /* Standardgröße/-position durch den Browser */
  }

  // Vorhandenes Peek-Fenster wiederverwenden (neu positionieren + URL setzen).
  if (peekWindowId != null) {
    try {
      const tabs = await chrome.tabs.query({ windowId: peekWindowId });
      if (tabs[0]) await chrome.tabs.update(tabs[0].id, { url });
      await chrome.windows.update(peekWindowId, {
        focused: true,
        ...(left != null ? { left, top, width, height } : {}),
      });
      return;
    } catch (e) {
      peekWindowId = null;
    }
  }

  const w = await chrome.windows.create({
    url,
    type: 'popup',
    width,
    height,
    ...(left != null ? { left, top } : {}),
    focused: true,
  });
  peekWindowId = w.id;
}

// ---- Nachrichten ----------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'GET_SETTINGS') {
      sendResponse(await getSettings());
      return;
    }

    if (msg.type === 'OPEN_TAB') {
      await createTabInGroup(msg.url, sender.tab);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'OPEN_PEEK_WINDOW') {
      await openPeekWindow(msg.url, sender.tab);
      sendResponse({ ok: true });
      return;
    }

    // Content-Script fragt beim Laden, ob seine Seite das Peek-Fenster ist.
    if (msg.type === 'IS_PEEK_WINDOW') {
      sendResponse({
        isPeekWindow: !!(
          sender.tab &&
          peekWindowId != null &&
          sender.tab.windowId === peekWindowId
        ),
      });
      return;
    }

    if (msg.type === 'CLOSE_PEEK_WINDOW') {
      const winId = peekWindowId;
      peekWindowId = null;
      peekOpener = null;
      if (winId != null) chrome.windows.remove(winId).catch(() => {});
      sendResponse({ ok: true });
      return;
    }

    // Peek-Fenster als Tab (in der Gruppe des ursprünglichen Quell-Tabs) öffnen.
    if (msg.type === 'PROMOTE_PEEK_WINDOW') {
      const opener = peekOpener;
      const winId = peekWindowId;
      peekWindowId = null; // Blur-Handler nicht mehr auslösen
      peekOpener = null;
      await createTabInGroup(msg.url, opener);
      if (winId != null) chrome.windows.remove(winId).catch(() => {});
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'PEEK_CLOSED') {
      await clearStripRule();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'PEEK') {
      const s = await getSettings();
      if (!s.enabled) {
        sendResponse({ ok: false, disabled: true });
        return;
      }
      // Modus "Fenster": direkt eigenes Fenster öffnen (kein iframe/DNR nötig).
      if (s.mode === 'window') {
        await openPeekWindow(msg.url, sender.tab, s.position);
        sendResponse({ ok: true, handled: 'window' });
        return;
      }
      // Modus "Sidepeek": Header-Stripping für diese Domain, dann Overlay rendern.
      await setStripRule(msg.url);
      try {
        await chrome.tabs.sendMessage(
          sender.tab.id,
          { type: 'RENDER_OVERLAY', url: msg.url },
          { frameId: 0 }
        );
        sendResponse({ ok: true, handled: 'overlay' });
      } catch (e) {
        // Top-Frame nicht erreichbar → Regel zurück, als Fenster öffnen.
        await clearStripRule();
        await openPeekWindow(msg.url, sender.tab);
        sendResponse({ ok: true, handled: 'window-fallback' });
      }
      return;
    }
  })();
  return true; // asynchrone Antwort
});
