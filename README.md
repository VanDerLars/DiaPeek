# DiaPeek

Chrome-/Chromium-Extension (Manifest V3) für den **Dia-Browser**. Links, die
sonst einen neuen Tab öffnen würden, werden stattdessen in einem **Peek-Overlay**
(angedocktes In-Page-Fenster) geöffnet.

Hintergrund und Architektur: siehe [PLAN.md](PLAN.md).

## Installation in Dia (Entwicklermodus)

1. In Dia die Erweiterungsseite öffnen (`chrome://extensions` bzw. über das Menü).
2. **Entwicklermodus** oben rechts aktivieren.
3. **„Entpackt laden"** klicken und diesen Ordner (`DiaPeek/`) auswählen.
4. Nach Code-Änderungen: bei der Extension auf **Neu laden** (↻) klicken.

> Icons liegen unter `icons/` (16/32/48/128 px). Neu generieren:
> `node icons/gen-icons.js` (reines Node, keine Abhängigkeiten).

## Tastenbelegung

Feste, **immer native** Modifier (nicht abfangbar, per Design):

| Aktion | Verhalten |
|---|---|
| **⌘ Cmd + Klick** | neuer Tab (nativ) |
| **⌃ Ctrl + Klick** | Kontextmenü (nativ, macOS) |
| **⌥ Option + Klick** | Dias nativer Split View |

**Konfigurierbar** (in den Einstellungen an/aus), öffnet im Peek:

| Auslöser | Standard |
|---|---|
| Links, die einen neuen Tab öffnen (`target="_blank"`, `window.open`, Mittelklick) | an |
| **⇧ Shift + Klick** | an |

## Darstellung (in den Optionen wählbar)

- **Sprache** — standardmäßig **automatisch** (System-/Browser-Sprache, über
  `chrome.i18n.getUILanguage()`; Englisch als Fallback). Alternativ fest
  Englisch oder Deutsch. Alle Texte sind **lokal** in der Extension gebündelt
  (`src/i18n.js` und `_locales/`); es wird nichts nachgeladen oder gesendet.
- **Position** — **Links**, **Mitte** (Standard) oder **Rechts**. Gilt für das
  Overlay und das Peek-Fenster; der Split bleibt rechts angedockt. Die Größe
  bleibt wie gehabt groß (`width: min(60vw, 1100px)`, volle Höhe).
- **Sidepeek** — angedocktes In-Page-Overlay (Standard, mit Split-Option; bettet
  per iframe ein).
- **Fenster** — jeder Peek öffnet direkt ein eigenes Fenster (~70 % der
  Hauptfenstergröße, an der gewählten Position; schließt beim Rausklicken).
  Funktioniert auf allen Seiten, auch nicht-einbettbaren.

## Peek-Overlay (Sidepeek) — Bedienung

- **✕ / Esc** — schließen
- **↗** — in neuem Tab öffnen
- **◧** — als eigenes In-Page-Split anzeigen (Umschalter; Seite links bleibt bedienbar)

## Peek-Fenster — Bedienung

- **↗** — als Tab in der Tab-Gruppe des Ausgangs-Tabs öffnen (best-effort, s. u.)
- **✕** — Fenster schließen
- Rausklicken (Fokus auf anderes Fenster) schließt es ebenfalls.

## Wie es funktioniert (Kurzform)

1. **Abfangen** — `content-main.js` (MAIN world) patcht `window.open`;
   `content-iso.js` (ISOLATED) fängt die konfigurierten Klicks ab.
2. **Rendern** — `background.js` lässt das Overlay im Top-Frame zeichnen.
3. **Einbetten ermöglichen** — eine `declarativeNetRequest`-Regel entfernt die
   `X-Frame-Options`/`CSP`-Header, damit auch YouTube, Google & Co. im iframe
   laden. Die Regel ist **nur aktiv, solange ein Peek offen ist**, und **nur für
   die gepeekte Domain** (Sub-Frames) — fremde Seiten (z. B. Slack) werden im
   Normalbetrieb nicht beeinflusst.

## Bekannte Grenzen

- **Eigenes In-Page-Split** (◧): Dias natives Split View ist nicht per
  Extension-API auslösbar (dafür gibt es ⌥ Option + Klick). Unser Split injiziert
  ein Stylesheet, das `html`, `body` **und alle obersten Body-Container**
  (inkl. `position:fixed`-Elemente wie Header/Fortschrittsbalken) auf die linke
  Spalte begrenzt; das Peek dockt randlos rechts an (kein Rand/Schatten, nur eine
  Trennlinie). Nur `html { width }` reicht nicht — High-Level-Tags (z. B.
  `<shreddit-app>`, `<nav>`) haben eigene Breiten. Best-effort: Seiten, deren
  **inneres** Layout an der echten Viewport-Breite hängt (z. B. LinkedIn),
  reflowen nicht, sondern werden im linken Bereich nur beschnitten — die
  Viewport-Breite kann ein Content-Script nicht ändern.
- Seiten mit **COEP/COOP**, **JS-Framebusting** oder Login-/Cookie-Wänden lassen
  sich nicht ins iframe zwingen → automatischer Fallback: **eigenes Peek-Fenster**
  (echtes Popup, an der gewählten Position – Standard mittig –, ~70 % dessen
  Größe; schließt sich, sobald
  man aus dem Fenster rausklickt). Manuell auch über den Button im Ladehinweis.
- `window.open()`-Aufrufe **mit** Fenster-Features (z. B. OAuth-Popups) werden
  bewusst *nicht* abgefangen, um solche Flows nicht zu zerstören.
- **Kein Peek** auf Browser-internen Seiten (Chrome Web Store, `chrome://` /
  `dia://`, Extension-Seiten) — dort verbietet der Browser Content-Scripts.

## Verworfene Ansätze

- **Popup-Fenster** als wählbarer Render-Modus: entfernt. (Als *Fallback* für
  nicht einbettbare Seiten kommt es aber zurück — an der gewählten Position,
  proportional,
  auto-schließend; siehe „Bekannte Grenzen".)
- **Side Panel** (`chrome.sidePanel`): `open()` verlangt eine User-Geste, die
  beim Weg Link→Content-Script→Background verloren geht; ein anderer nativer Weg
  existiert nicht → entfernt.

## Status

Abfang-Schicht + Peek-Overlay (mit In-Page-Split) + Einstellungen implementiert
und getestet. Vollständiger Extension-Load muss in Dia manuell erfolgen
(Datei-Dialog ist nicht automatisierbar).
