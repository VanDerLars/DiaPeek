# DiaPeek — Implementierungsplan

Chrome-Extension (Manifest V3) für den **Dia-Browser**: Links, die sonst einen
neuen Tab/ein neues Fenster öffnen würden, werden stattdessen in einem
**Peek-Fenster** geöffnet. Umschaltbar zwischen drei Render-Varianten.

---

## 1. Empirische Grundlage (in Dia live getestet)

Getestet am 2026-07-01 in der angebundenen Dia-Instanz (Chromium 149, kein
„Google Chrome"-Brand im `userAgentData` → bestätigt Dia).

| Test | Methode | Ergebnis in Dia |
|---|---|---|
| A / B | `window.open(url)` / `'_blank'` | neuer **Tab** |
| C | `window.open(…, 'popup')` | **Popup-Fenster** (landet auf anderem Monitor) |
| D | `window.open(…, 'width=520,height=680')` | **Popup-Fenster** über dem Browser (brauchbar) |
| E | `target="_blank"` | neuer **Tab** |
| F | echter `_blank`-Klick | neues **Hauptfenster** |
| G | Cmd+Klick | neuer **Tab** |

**Zentrale Erkenntnisse:**

1. **Dia hat kein von einer Seite auslösbares natives Peek.** Das „Peek" war ein
   **Arc**-Feature (ausgelöst u. a. durch `target="_blank"` und Shift+Klick). Dia
   hat es weggelassen — `target="_blank"` wird als normaler Tab behandelt. Deshalb
   scheitern die Arc-Tricks (z. B. `target="_blank"` injizieren) in Dia.
2. **Wir müssen das Peek komplett selbst rendern.**
3. **Reines Seiten-JS / ein Userscript reicht nicht.** Wenn die Zielseite in ein
   In-Page-`<iframe>` geladen wird, blockieren viele Seiten (YouTube, Google,
   Banking, X, eingeloggte Apps) das Einbetten per `X-Frame-Options` und
   `CSP: frame-ancestors`. **Nur eine echte Extension** kann diese Header per
   `declarativeNetRequest` entfernen. → Das ist der Hauptgrund, warum ähnliche
   Ansätze bei Dia (und generell) scheitern, und der Grund, warum DiaPeek eine
   Extension und kein Userscript ist.

## 2. Grundarchitektur

```
   Klick / window.open auf der Seite
              │
              ▼
   ┌─────────────────────────────┐
   │ ABFANG-SCHICHT (Content-JS)  │
   │  • MAIN-world: window.open   │   fängt „öffne neuen Tab/Fenster" ab,
   │    monkey-patch              │   preventDefault, extrahiert Ziel-URL
   │  • ISOLATED: capturing       │
   │    click/auxclick + modifier │
   └──────────────┬──────────────┘
                  │  Ziel-URL + Kontext
                  ▼
   ┌─────────────────────────────┐
   │ DISPATCHER (liest Setting    │
   │  renderMode)                 │
   └───┬──────────┬──────────┬────┘
       ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌───────────┐
   │Overlay │ │ Popup  │ │Side Panel │
   │(iframe)│ │(window)│ │ (iframe)  │
   └────────┘ └────────┘ └───────────┘
       │                     │
       └──── DNR entfernt X-Frame-Options / CSP frame-ancestors
             (nur bei iframe-basierten Modi Overlay & Side Panel)
```

**Komponenten**

- **`content-main.js`** (`world: "MAIN"`, `document_start`): patcht `window.open`
  (und optional `HTMLFormElement.prototype.submit`), damit auch skriptgetriebene
  Öffnungen erwischt werden — der ISOLATED-World-Kontext sieht das echte
  `window.open` nicht. Meldet abgefangene URLs per `window.postMessage` an
  `content-iso.js`.
- **`content-iso.js`** (ISOLATED, `document_start`, `all_frames:true`,
  `match_about_blank:true`): capturing-Phase-Listener für `click` **und**
  `auxclick` (Mittelklick = auxclick seit Chrome 55). Erkennt `target="_blank"`,
  Cmd/Ctrl-, Shift- und Mittelklick über `event.metaKey/ctrlKey/shiftKey` und
  `event.button`. Findet den echten Anchor via `composedPath()` (offenes Shadow
  DOM). `preventDefault()` + `stopImmediatePropagation()`. Baut das Overlay-UI,
  hält `chrome.*`, spricht mit dem Background.
- **`background.js`** (Service Worker): Dispatcher, `chrome.windows.create`
  (Popup), `chrome.sidePanel` (Side Panel), `chrome.tabs.create` (In neuem Tab
  öffnen), DNR-Regel-Verwaltung, Settings, und das „Sicherheitsnetz"
  (`chrome.tabs.onCreated` via `openerTabId` / `chrome.webNavigation`) für
  Öffnungen, die die Abfang-Schicht nicht erwischt (closed Shadow DOM,
  cross-origin iframes, native Öffnungen).
- **`options.html` / `popup.html`**: Einstellungen bzw. Schnell-Umschalter.

## 3. Die drei Render-Varianten (per Setting wählbar)

### A) In-Page Iframe-Overlay  *(Standard, entspricht dem Screenshot)*
- Rechts angedocktes Overlay im **Top-Frame**, in **Shadow DOM** gekapselt (damit
  Seiten-CSS unsere UI nicht beeinflusst und umgekehrt).
- Kopfleiste mit Buttons wie im Screenshot: **✕ Schließen**, **⤢ In neuem Tab
  öffnen**, **▨ Split** *(best-effort, siehe Risiken)*.
- `<iframe>` lädt die Ziel-URL. Links daneben bleibt die „eigentliche Seite"
  abgedunkelt sichtbar.
- **Framing ermöglichen:** DNR entfernt für `resourceType: "sub_frame"` die Header
  `x-frame-options` und `content-security-policy` — entweder session-weit
  gescoped auf Sub-Frames, oder (sicherer) dynamisch pro Peek nur für die
  Ziel-URL, danach wieder entfernt.
- **Framebusting-Schutz:** iframe mit `sandbox` **ohne** `allow-top-navigation`
  (aber mit `allow-scripts allow-forms allow-same-origin allow-popups`) für
  **cross-origin** Ziele, damit `top.location = …`-Ausbrüche die Hauptseite
  nicht kapern. Bei **gleicher Origin** (z. B. Reddit → Reddit) wird bewusst
  keine Sandbox gesetzt: `allow-scripts + allow-same-origin` ließe das Frame
  seine Sandbox selbst entfernen (Chrome-Warnung) und böte keinen echten Schutz.
- **Fallback:** Seiten, die trotz Header-Stripping nicht einbettbar sind (COEP/COOP,
  JS-Framebusting) → automatisch auf **Popup-Fenster** (Variante B) ausweichen.
- Deckt ~95 % der Seiten ab, beste Optik, höchster Aufwand.

### B) Echtes Popup-Fenster  *(robust, wie Test D)*
- `chrome.windows.create({ url, type: "popup", width, height, top, left })`,
  positioniert über dem aktuellen Fenster (Bounds aus `chrome.windows.getCurrent`).
- **Kein** Header-Stripping nötig → funktioniert auf **100 %** der Seiten.
- Nachteil: separates OS-Fenster (im Fenster-Wechsler, kann hinter den Browser
  rutschen). Eigene Split/Expand-Buttons kaum möglich (native Fenster-Chrome).
- Optional: Fenster-ID merken und wiederverwenden, statt bei jedem Peek ein neues
  zu öffnen.

### C) Chromium Side Panel  *(nativ angedockt)*
- `chrome.sidePanel.setOptions({ path: "sidepanel/viewer.html?url=…" })` +
  `chrome.sidePanel.open({ windowId })`. `viewer.html` bettet die Ziel-URL per
  iframe ein → **gleiches Header-Stripping wie Variante A** nötig.
- **Dia-Voraussetzung:** Side Panel erst seit Dia **v1.10.1** (2025-12-17) —
  `chrome.sidePanel` zur Laufzeit feature-detecten, Variante sonst ausgrauen.
- **User-Gesture-Einschränkung:** `sidePanel.open()` verlangt eine User-Geste. Der
  Message-Roundtrip Content→Background kann die Geste „verlieren". Lösungspfad:
  Panel einmalig durch Klick auf das Extension-Icon öffnen; danach nur noch den
  Panel-Inhalt (URL) aktualisieren. In der Doku/UX als Einschränkung kennzeichnen.

## 4. Abfang-Schicht — Details (aus Recherche verifiziert)

- **Kein einzelner Listener erwischt alles** → mehrschichtig:
  1. Capturing `click` + `auxclick` am `document` (fängt Anchor-`_blank`,
     Modifier-Klicks, Mittelklick; Enter-Aktivierung läuft über `click`).
  2. MAIN-world `window.open`-Patch (skriptgetriebene Öffnungen).
  3. Optional Navigation API `navigate`-Event (MAIN, same-origin) für
     SPA-Navigationen.
  4. Background-Netz `chrome.tabs.onCreated`/`webNavigation` für Nachzügler
     (closed Shadow DOM, cross-origin iframes, native Öffnungen) → Tab schließen +
     ins Peek umleiten. *Caveat: der ungewollte Tab blitzt evtl. kurz auf.*
- **`preventDefault()` allein reicht nicht:** es stoppt nur die Anchor-Standard-
  Navigation, nicht ein `window.open()` im Seiten-Handler → deshalb der MAIN-Patch.
- **Shadow DOM:** offene Roots via `composedPath()`; geschlossene Roots nur über
  MAIN-Patch/Background-Netz abfangbar.
- **Iframes:** same-origin via `all_frames:true`. Abfang in einem Sub-Frame →
  Nachricht an Background → Background weist Content-Script im **Top-Frame** an, das
  Overlay zu zeichnen (ein Frame kann nicht über den Top-Frame malen). Cross-origin
  Sub-Frames brauchen eigene Injektion (durch `host_permissions: <all_urls>`
  abgedeckt).
- **Konfigurierbar** (Settings): welche Klicktypen abgefangen werden — alle
  `_blank`, Cmd/Ctrl-Klick, Shift-Klick, Mittelklick, einfache cross-origin Links
  (Default aus).

## 5. Dia-Eigenheiten (Checkliste)

- **UA weicht ab** → **kein** UA-Sniffing; stattdessen Feature-Detection.
- **`chrome.sidePanel` erst ab v1.10.1** → detecten, Variante C ggf. ausgrauen.
- **Extensions „second-class", kein Auto-Import** → Dev-Loop: „Entwicklermodus"
  in Dias Erweiterungsseite, „Entpackt laden", nach Änderungen neu laden.
- **Eigene New-Tab-Oberfläche** → **nicht** auf `chrome_url_overrides` verlassen
  (tun wir nicht).
- **Tab-Gruppen/Spaces-Semantik weicht ab** (Dia: Cmd-Klick öffnet ab v1.14 in
  neuer Tab-*Gruppe*) → „In neuem Tab öffnen" live testen, dass es korrekt landet.
- **Keyboard-Shortcuts** können von Dia abgefangen werden → `chrome.commands` nicht
  als einzigen Auslöser; In-Page-Fallback anbieten.
- **Popup-Fenster sind in Dia first-class** (ab v1.14 mit Find/Print) → Variante B
  sollte sauber laufen; auf „leeres, nicht schließbares Popup" (Arc-Bug-Klasse)
  testen.
- **Alles empirisch verifizieren** — Dias Doku ist dünn/als SPA nicht crawlbar; wir
  haben die Live-Test-Möglichkeit über die angebundene Instanz.

## 6. declarativeNetRequest (Header-Stripping)

- Permission `declarativeNetRequestWithHostAccess` + `host_permissions: <all_urls>`.
- Regel: **Response-Header entfernen** `x-frame-options` und
  `content-security-policy`, gefiltert auf `resourceType: ["sub_frame"]`.
- **Sicherheit:** betrifft nur den eingebetteten Peek-Frame, nicht die Hauptseite.
  Trotzdem schwächt es den Clickjacking-Schutz der eingebetteten Seite → möglichst
  eng scopen (dynamische Regel pro Peek nur für die Ziel-URL, nach Schließen
  entfernen). DNR kann nur ganze Header entfernen, nicht einzelne CSP-Direktiven.

## 7. Phasenplan

- **Phase 0 — Scaffold & Baseline** *(z. T. erledigt)*: `manifest.json`, entpackt in
  Dia laden, Content-Script-Injektion prüfen, DNR-Header-Stripping verifizieren
  (YouTube in Test-iframe mit/ohne Regel).
- **Phase 1 — Abfang-Kern**: MAIN `window.open`-Patch + ISOLATED
  click/auxclick/Modifier. Abgefangene URLs nur loggen (noch kein Rendering).
  Abdeckung auf echten Seiten prüfen.
- **Phase 2 — Variante B (Popup)**: einfachster Renderer, keine Framing-Probleme →
  schnelles lauffähiges MVP.
- **Phase 3 — Variante A (Overlay)**: DNR-Header-Stripping + Sandbox + Fallback +
  Screenshot-getreue UI mit Buttons. Das Flaggschiff.
- **Phase 4 — Variante C (Side Panel)**: inkl. User-Gesture-Handling.
- **Phase 5 — Settings/Options + Action-Popup**: Modus-Auswahl, Klicktyp-Schalter,
  Per-Site-Regeln, `chrome.storage.sync`.
- **Phase 6 — Dia-Härtung & Politur**: Test-Matrix (Wikipedia, YouTube, Google, X,
  Banking, SPA, Shadow DOM, iframes), Split-View best-effort, Edge Cases, Shortcut.

## 8. Dateistruktur

```
DiaPeek/
  manifest.json
  src/
    content-main.js        # MAIN world: window.open-Patch, Nav-API
    content-iso.js         # ISOLATED: Listener, Overlay-UI, Messaging
    background.js          # Service Worker: Dispatcher, windows/sidePanel/tabs, DNR, Netz
    overlay/overlay.css
    sidepanel/viewer.html
    sidepanel/viewer.js
    options/options.html|js|css
    popup/popup.html|js
    common/settings.js     # Defaults + storage-Helfer
    common/messages.js     # Message-Typen
    dnr/rules.json         # statische DNR-Regeln (falls genutzt)
  icons/
  PLAN.md
  README.md
```

## 9. Offene Risiken / Best-effort

- **DNR schwächt Framing-Schutz der eingebetteten Seite** → eng scopen, dokumentieren.
- **Framebusting-JS** → Sandbox ohne `allow-top-navigation`.
- **Side-Panel-User-Gesture** → Panel ggf. erst per Icon öffnen, dann Inhalt updaten.
- **Dias natives „Split View" ist nicht per API auslösbar** → Split-Button
  best-effort (in Tab öffnen, oder eigenes Side-by-Side-Layout).
- **iframe-Ladefehler zuverlässig erkennen** ist schwer: In Dia getestet — das
  iframe-`load`-Event feuert **auch** bei `X-Frame-Options: DENY` (github.com), taugt
  also nicht als Erfolgs-Indikator. Deshalb: (a) DNR entfernt die Header, sodass der
  Blockfall meist entfällt; (b) ein „In eigenem Fenster öffnen"-Button (↗) ist immer
  sichtbar; (c) robustere Erkennung via `chrome.webNavigation` am Sub-Frame ist ein
  Ausbau für später.
- **Cross-origin Sub-Frame → Top-Frame-Overlay** über Background relayen.
- **COEP/COOP-Seiten** lassen sich nicht sinnvoll „ent-framen" → Popup-Fallback.
```
