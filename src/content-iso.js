// DiaPeek — ISOLATED-world Content-Script
// Fängt Link-Aktivierungen ab, die einen neuen Tab öffnen würden, und rendert
// das Peek-Overlay im Top-Frame.
//
// Feste, IMMER native Modifier (nicht abfangbar, per Design):
//   • Cmd + Klick     → neuer Tab
//   • Ctrl + Klick    → Kontextmenü (macOS)
//   • Option/Alt+Klick→ Dias nativer Split View
// Konfigurierbar (Opt-in) fängt DiaPeek ab:
//   • Links, die einen neuen Tab öffnen (target="_blank", window.open, Mittelklick)
//   • Shift + Klick

(() => {
  const isTop = window.top === window.self;

  const DEFAULTS = {
    enabled: true,
    position: 'center', // 'left' | 'center' | 'right'
    language: 'auto', // 'auto' (system/browser) | 'en' | 'de'
    intercept: {
      newTabLinks: true,
      shiftClick: true,
    },
  };

  let settings = DEFAULTS;
  let inPeekWindow = false; // true, wenn diese Seite im eigenen Peek-Fenster läuft

  // Alte 9er-Werte (top-left …) werden auf left/center/right migriert.
  function normalizePosition(pos) {
    if (globalThis.DiaPeekI18N) return globalThis.DiaPeekI18N.normalizePosition(pos);
    const v = String(pos || '');
    if (v === 'left' || /-left$/.test(v)) return 'left';
    if (v === 'right' || /-right$/.test(v)) return 'right';
    return 'center';
  }

  function positionClass(pos) {
    return 'pos-' + normalizePosition(pos);
  }

  // Alle UI-Texte kommen aus src/i18n.js (lokal gebündelt, kein Netzwerk).
  function tr(key) {
    const i18n = globalThis.DiaPeekI18N;
    return i18n ? i18n.t(key, settings.language) : key;
  }

  function mergeSettings(s) {
    s = s || {};
    return { ...DEFAULTS, ...s, intercept: { ...DEFAULTS.intercept, ...(s.intercept || {}) } };
  }

  function pushConfigToMain() {
    window.postMessage(
      {
        __diapeek: 'config',
        config: {
          enabled: settings.enabled,
          interceptWindowOpen: settings.enabled && settings.intercept.newTabLinks,
        },
      },
      '*'
    );
  }

  async function loadSettings() {
    try {
      // Direkt aus chrome.storage lesen statt den Service Worker pro Frame
      // aufzuwecken. Das ist beim Seitenaufbau deutlich schneller – besonders
      // auf Seiten mit vielen iframes (content-iso läuft in allen Frames).
      let stored;
      if (chrome.storage && chrome.storage.sync) {
        ({ settings: stored } = await chrome.storage.sync.get('settings'));
      } else {
        stored = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      }
      settings = mergeSettings(stored);
    } catch (e) {
      settings = DEFAULTS;
    }
    pushConfigToMain();
    // Sprachwechsel bei bereits geöffnetem Peek-Fenster sofort übernehmen.
    if (isTop && inPeekWindow) renderWindowChrome();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) loadSettings();
  });

  // ---- Abfangen -----------------------------------------------------------
  function resolveUrl(u) {
    try {
      return new URL(u, location.href).href;
    } catch (e) {
      return null;
    }
  }
  function isHttp(href) {
    return /^https?:/i.test(href || '');
  }
  // Direkte Dateien (Bilder, PDFs, Medien, Archive) NICHT peeken – im iframe
  // sinnlos, und es würde z. B. Slack-Bild-Thumbnails abfangen. Solche URLs soll
  // der Browser nativ behandeln.
  const FILE_EXT = new Set(
    'png jpg jpeg gif webp svg avif bmp ico tif tiff heic mp4 webm mov m4v mkv mp3 wav ogg m4a flac pdf zip gz tgz tar rar 7z dmg pkg exe msi apk csv tsv txt rtf doc docx xls xlsx ppt pptx odt ods'.split(' ')
  );
  function isPeekable(url) {
    try {
      const u = new URL(url, location.href);
      if (!/^https?:$/.test(u.protocol)) return false;
      const m = u.pathname.toLowerCase().match(/\.([a-z0-9]{1,5})$/);
      return !(m && FILE_EXT.has(m[1]));
    } catch (e) {
      return false;
    }
  }

  // iframe-Sandbox: Cross-origin-Inhalte bekommen die Sandbox (u. a. Schutz vor
  // Top-Navigation/Framebusting). Bei GLEICHER Origin (z. B. Reddit-Link auf
  // Reddit) wäre `allow-scripts + allow-same-origin` wirkungslos – das Frame
  // könnte seine Sandbox selbst entfernen – und Chrome loggt dafür eine Warnung
  // ("can escape its sandboxing"). Deshalb dort bewusst KEINE Sandbox: Der
  // Inhalt teilt ohnehin die Origin der Host-Seite.
  const IFRAME_SANDBOX =
    'allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox';

  function sandboxFor(url) {
    try {
      if (new URL(url, location.href).origin === location.origin) return null;
    } catch (e) {
      /* bei ungültiger URL Standard-Sandbox verwenden */
    }
    return IFRAME_SANDBOX;
  }
  function findAnchor(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    for (const n of path) if (n && n.tagName === 'A' && n.href) return n;
    let el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    return el && el.tagName === 'A' && el.href ? el : null;
  }

  function onClick(e) {
    if (inPeekWindow || e.defaultPrevented || !settings.enabled) return;
    if (e.button !== 0) return; // click = nur primäre Taste
    // Cmd (neuer Tab), Ctrl (Kontextmenü) und Option (nativer Split) bleiben
    // immer nativ und werden nie abgefangen.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const a = findAnchor(e);
    if (!a || !isHttp(a.href) || !isPeekable(a.href)) return;

    const ic = settings.intercept;
    let hit = false;
    if (e.shiftKey) {
      if (!ic.shiftClick) return; // Shift bleibt nativ (neues Fenster)
      hit = true;
    } else if (a.target === '_blank' && ic.newTabLinks) {
      hit = true;
    }
    if (!hit) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    peek(resolveUrl(a.href));
  }

  function onAux(e) {
    if (inPeekWindow || !settings.enabled || !settings.intercept.newTabLinks) return;
    if (e.button !== 1) return; // Mittelklick
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const a = findAnchor(e);
    if (!a || !isHttp(a.href) || !isPeekable(a.href)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    peek(resolveUrl(a.href));
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onAux, true);

  // window.open-Brücke aus content-main.js (MAIN world)
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (d && d.__diapeek === 'open' && d.url) peek(resolveUrl(d.url));
  });

  function peek(url) {
    if (!url) return;
    try {
      chrome.runtime.sendMessage({ type: 'PEEK', url });
    } catch (e) {
      /* SW evtl. inaktiv – Message weckt ihn */
    }
  }

  // ---- Overlay-Renderer (nur Top-Frame) -----------------------------------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'RENDER_OVERLAY' && isTop) renderOverlay(msg.url);
  });

  const OVERLAY_CSS = `
    :host { all: initial; }
    .backdrop { position: fixed; inset: 0; background: rgba(20,20,28,.38); animation: fade .12s ease-out; }
    .stage {
      position: fixed; inset: 0; display: flex; padding: 12px;
      align-items: stretch; pointer-events: none;
    }
    .stage.pos-left { justify-content: flex-start; }
    .stage.pos-center { justify-content: center; }
    .stage.pos-right { justify-content: flex-end; }
    .peek {
      box-sizing: border-box;
      width: min(60vw, 1100px); min-width: min(380px, calc(100vw - 24px));
      height: 100%; max-height: calc(100vh - 24px);
      background: #fff; border-radius: 12px; overflow: hidden;
      border: 1px solid rgba(0,0,0,.14);
      box-shadow: 0 24px 70px rgba(0,0,0,.40);
      display: flex; flex-direction: column;
      animation: pop .18s cubic-bezier(.2, .8, .2, 1); transform-origin: center;
      pointer-events: auto;
    }
    /* Split: randlos rechts angedockt, die Positionseinstellung wird dabei
       bewusst ignoriert. */
    .stage.split { padding: 0; justify-content: flex-end; }
    .stage.split .peek {
      width: 46vw; height: 100%; max-height: none; min-width: 0;
      border: 0; border-left: 1px solid rgba(0,0,0,.16);
      border-radius: 0; box-shadow: none;
    }
    .bar {
      display: flex; align-items: center; gap: 8px; height: 42px; flex: none;
      padding: 0 6px 0 14px; background: #f5f5f7;
      border-bottom: 1px solid rgba(0,0,0,.08);
      font: 12px/1 system-ui, -apple-system, sans-serif;
    }
    .addr { flex: 1; min-width: 0; color: #5f5f66; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .actions { display: flex; align-items: center; gap: 2px; }
    .actbtn {
      width: 28px; height: 28px; border: 0; background: transparent; color: #444;
      border-radius: 7px; cursor: pointer; font-size: 14px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
    }
    .actbtn:hover { background: rgba(0,0,0,.09); }
    .actbtn svg { width: 16px; height: 16px; display: block; pointer-events: none; }
    .actbtn[aria-pressed="true"] { background: rgba(0,122,255,.18); color: #007aff; }
    .actbtn.close:hover { background: #ff5f57; color: #fff; }
    .body { position: relative; flex: 1; }
    .frame { border: 0; width: 100%; height: 100%; background: #fff; }
    .loader {
      position: absolute; inset: 0; z-index: 1;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 14px; background: #fafafa; color: #555;
      font: 14px/1.4 system-ui, -apple-system, sans-serif; text-align: center; padding: 24px;
    }
    .loader.hidden { display: none; }
    .loader button { padding: 8px 14px; border-radius: 8px; border: 1px solid #ccc; background: #fff; color: #111; cursor: pointer; font: inherit; }
    @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
    @keyframes pop { from { transform: scale(.97); opacity: 0 } to { transform: scale(1); opacity: 1 } }
    @media (prefers-reduced-motion: reduce) { .peek, .backdrop { animation: none; } }
    @media (prefers-color-scheme: dark) {
      .peek { background: #1e1e20; border-color: rgba(255,255,255,.12); }
      .stage.split .peek { border-left-color: rgba(255,255,255,.12); }
      .bar { background: #2b2b2d; border-bottom-color: rgba(255,255,255,.09); }
      .addr { color: #b0b0b6; }
      .actbtn { color: #d8d8dc; }
      .actbtn:hover { background: rgba(255,255,255,.12); }
      .frame { background: #1e1e20; }
      .loader { background: #202022; color: #b0b0b6; }
      .loader button { background: #3a3a3c; color: #fff; border-color: #555; }
    }
  `;

  let host = null;
  let overlayTimers = [];
  const SPLIT_STYLE_ID = 'diapeek-split-css';
  const PEEK_W = '46vw';

  function isSplit() {
    return !!document.getElementById(SPLIT_STYLE_ID);
  }

  function exitSplit() {
    document.getElementById(SPLIT_STYLE_ID)?.remove();
  }

  // Eigenes In-Page-Split: Backdrop weg, Host-Seite in die linke Spalte, Peek
  // rechts, beide bedienbar. Es reicht NICHT, nur html{width} zu setzen — die
  // obersten Container (z. B. <shreddit-app>, <nav>) haben eigene Breiten oder
  // min-width und laufen sonst darüber hinaus. Deshalb injizieren wir ein
  // Stylesheet, das html, body und alle direkten body-Kinder begrenzt.
  // Best-effort: Seiten, deren Layout an der echten Viewport-Breite hängt,
  // reflowen nicht, sondern werden links beschnitten.
  function enterSplit() {
    if (!host || isSplit()) return;
    const root = host.shadowRoot;
    const backdrop = root.querySelector('.backdrop');
    if (backdrop) backdrop.style.display = 'none';
    const stage = root.querySelector('.stage');
    if (stage) stage.classList.add('split');
    const btn = root.querySelector('[data-act="split"]');
    if (btn) btn.setAttribute('aria-pressed', 'true');
    host.style.pointerEvents = 'none';
    const style = document.createElement('style');
    style.id = SPLIT_STYLE_ID;
    style.textContent = `
      html { width: calc(100% - ${PEEK_W}) !important; min-width: 0 !important; overflow-x: hidden !important; transition: width .16s ease !important; }
      html > body { width: 100% !important; min-width: 0 !important; max-width: 100% !important; overflow-x: hidden !important; }
      html > body > *:not(#diapeek-overlay-host) { max-width: calc(100vw - ${PEEK_W}) !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function exitSplitToModal() {
    if (!host) return;
    const root = host.shadowRoot;
    const backdrop = root.querySelector('.backdrop');
    if (backdrop) backdrop.style.display = '';
    const stage = root.querySelector('.stage');
    if (stage) stage.classList.remove('split');
    const btn = root.querySelector('[data-act="split"]');
    if (btn) btn.setAttribute('aria-pressed', 'false');
    host.style.pointerEvents = '';
    exitSplit();
  }

  function escClose(e) {
    if (e.key === 'Escape') closeOverlay();
  }

  // Entfernt das Overlay OHNE dem Background das Schließen zu melden — genutzt
  // beim internen Aufräumen direkt vor dem Rendern eines neuen Peeks (die
  // DNR-Regel wurde da bereits für die neue URL gesetzt und darf nicht weg).
  function teardown() {
    overlayTimers.forEach(clearTimeout);
    overlayTimers = [];
    exitSplit();
    if (host) {
      host.remove();
      host = null;
      document.removeEventListener('keydown', escClose, true);
    }
  }

  // Schließt das Peek und meldet es dem Background (→ DNR-Regel wird entfernt).
  function closeOverlay() {
    const wasOpen = !!host;
    teardown();
    if (wasOpen) {
      try {
        chrome.runtime.sendMessage({ type: 'PEEK_CLOSED' });
      } catch (e) {
        /* SW evtl. inaktiv */
      }
    }
  }

  function renderOverlay(url) {
    teardown();
    host = document.createElement('div');
    host.id = 'diapeek-overlay-host';
    host.style.cssText = 'all:initial; position:fixed; inset:0; z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${OVERLAY_CSS}</style>
      <div class="backdrop"></div>
      <div class="stage ${positionClass(settings.position)}">
        <div class="peek">
          <div class="bar">
            <div class="addr"></div>
            <div class="actions">
              <button class="actbtn" data-act="split" aria-pressed="false">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><line x1="9.75" y1="2.75" x2="9.75" y2="13.25"/></svg>
              </button>
              <button class="actbtn" data-act="tab">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.25H4.25A1.25 1.25 0 0 0 3 4.5v7.25A1.25 1.25 0 0 0 4.25 13h7.25A1.25 1.25 0 0 0 12.75 11.75V9"/><path d="M9.5 2.75h3.75V6.5"/><path d="M13.25 2.75 7.25 8.75"/></svg>
              </button>
              <button class="actbtn close" data-act="close">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
              </button>
            </div>
          </div>
          <div class="body">
            <div class="loader">
              <div class="loader-msg"></div>
              <button class="loader-fallback" style="display:none" data-act="window"></button>
            </div>
            <iframe class="frame"
              referrerpolicy="no-referrer-when-downgrade"></iframe>
          </div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);

    // Tooltips/Beschriftungen in der gewählten Sprache setzen.
    const splitBtn = root.querySelector('[data-act="split"]');
    const tabBtn = root.querySelector('[data-act="tab"]');
    const closeBtn = root.querySelector('[data-act="close"]');
    splitBtn.title = tr('overlaySplit');
    splitBtn.setAttribute('aria-label', tr('overlaySplit'));
    tabBtn.title = tr('overlayTab');
    tabBtn.setAttribute('aria-label', tr('overlayTab'));
    closeBtn.title = tr('overlayClose');
    closeBtn.setAttribute('aria-label', tr('overlayClose'));

    // URL/Host in die Kopfleiste (wie eine native Adressleiste).
    const addr = root.querySelector('.addr');
    try {
      const u = new URL(url);
      addr.textContent = u.host + (u.pathname === '/' ? '' : u.pathname);
    } catch (e) {
      addr.textContent = url;
    }
    addr.title = url;

    const frame = root.querySelector('.frame');
    const loader = root.querySelector('.loader');
    const loaderMsg = root.querySelector('.loader-msg');
    const fallbackBtn = root.querySelector('.loader-fallback');
    loaderMsg.textContent = tr('overlayLoading');
    fallbackBtn.textContent = tr('overlayOpenWindow');
    // Sandbox muss vor dem Setzen von src gesetzt sein.
    const sandbox = sandboxFor(url);
    if (sandbox) frame.setAttribute('sandbox', sandbox);
    let loaded = false;

    frame.addEventListener('load', () => {
      loaded = true;
      loader.classList.add('hidden');
      overlayTimers.forEach(clearTimeout);
      overlayTimers = [];
    });
    frame.src = url;

    // Die DNR-Regel entfernt X-Frame-Options/CSP, damit die meisten Seiten laden.
    // Manche blocken zusätzlich per JS-Framebusting/COEP oder brauchen
    // First-Party-Cookies — die lassen sich nicht ins iframe zwingen. Kommt kein
    // load, öffnen wir die Seite automatisch in einem neuen Tab.
    overlayTimers.push(
      setTimeout(() => {
        if (!loaded) {
          loaderMsg.textContent = tr('overlayBlocked');
          fallbackBtn.style.display = '';
        }
      }, 3000)
    );
    overlayTimers.push(
      setTimeout(() => {
        if (!loaded) {
          chrome.runtime.sendMessage({ type: 'OPEN_PEEK_WINDOW', url });
          closeOverlay();
        }
      }, 5000)
    );

    function act(a) {
      if (a === 'close') closeOverlay();
      else if (a === 'tab') {
        chrome.runtime.sendMessage({ type: 'OPEN_TAB', url });
        closeOverlay();
      } else if (a === 'window') {
        chrome.runtime.sendMessage({ type: 'OPEN_PEEK_WINDOW', url });
        closeOverlay();
      } else if (a === 'split') {
        if (isSplit()) exitSplitToModal();
        else enterSplit();
      }
    }

    root.querySelector('.backdrop').addEventListener('click', () => closeOverlay());
    root.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', () => act(b.dataset.act))
    );
    document.addEventListener('keydown', escClose, true);
  }

  // ---- Steuerleiste im eigenen Peek-Fenster -------------------------------
  function renderWindowChrome() {
    // Neu rendern, damit ein Sprachwechsel auch bei offenem Fenster greift.
    document.getElementById('diapeek-winbar')?.remove();
    const host = document.createElement('div');
    host.id = 'diapeek-winbar';
    host.style.cssText = 'all:initial; position:fixed; top:10px; right:10px; z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .bar { display:flex; gap:6px; background:rgba(20,20,22,.9); padding:5px; border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,.4); }
        .b { width:30px; height:30px; border:0; background:transparent; color:#fff; border-radius:7px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
        .b:hover { background:rgba(255,255,255,.16); }
        .b.close:hover { background:#ff5f57; }
        svg { width:16px; height:16px; display:block; pointer-events:none; }
      </style>
      <div class="bar">
        <button class="b" data-act="promote">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.25H4.25A1.25 1.25 0 0 0 3 4.5v7.25A1.25 1.25 0 0 0 4.25 13h7.25A1.25 1.25 0 0 0 12.75 11.75V9"/><path d="M9.5 2.75h3.75V6.5"/><path d="M13.25 2.75 7.25 8.75"/></svg>
        </button>
        <button class="b close" data-act="close">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
        </button>
      </div>`;
    (document.body || document.documentElement).appendChild(host);
    const promoteBtn = root.querySelector('[data-act="promote"]');
    const closeBtn = root.querySelector('[data-act="close"]');
    promoteBtn.title = tr('winPromote');
    promoteBtn.setAttribute('aria-label', tr('winPromote'));
    closeBtn.title = tr('winClose');
    closeBtn.setAttribute('aria-label', tr('winClose'));
    promoteBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PROMOTE_PEEK_WINDOW', url: location.href });
    });
    closeBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLOSE_PEEK_WINDOW' });
    });
  }

  // Beim Laden prüfen, ob diese Seite das eigene Peek-Fenster ist. Falls ja:
  // Steuerleiste zeigen und in diesem Fenster nichts abfangen.
  if (isTop) {
    try {
      chrome.runtime.sendMessage({ type: 'IS_PEEK_WINDOW' }, (resp) => {
        if (resp && resp.isPeekWindow) {
          inPeekWindow = true;
          renderWindowChrome();
        }
      });
    } catch (e) {
      /* SW evtl. inaktiv */
    }
  }

  loadSettings();
})();
