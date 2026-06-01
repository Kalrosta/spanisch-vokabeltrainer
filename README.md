# Spanisch B2 — Vokabeltrainer

Offline-fähige PWA, gleiche Architektur wie der Serbisch-Trainer. Vanilla JS, FSRS-V4, GitHub Pages.
Live unter `https://<dein-user>.github.io/spanisch-vokabeltrainer/`.

## Erstes Setup

1. Repo `spanisch-vokabeltrainer` auf GitHub anlegen, diese Dateien hineinkopieren (GitHub Desktop), committen, pushen.
2. GitHub → Repo → **Settings → Pages** → Source: `Deploy from a branch`, Branch `main` / `/ (root)`. Speichern.
3. Nach ~1 Min ist die URL live. Auf dem Handy im Browser öffnen → „Zum Home-Bildschirm" → installiert als App.

Die GitHub Action `build-data` läuft beim ersten Push automatisch und erzeugt `data/words.json` + `data/examples.json` aus `source/wortliste.xlsx`. (Die JSON sind hier schon vorgebaut, damit es ohne Action-Lauf sofort funktioniert.)

## Bedienung

- **Lernrichtung** DE→ES oder ES→DE umschaltbar.
- **Niveau-Filter a/b/c** und **Themenblock** auf der Startseite.
- Karte tippen oder „Umdrehen" → 4 FSRS-Bewertungen (Nochmal/Schwer/Gut/Leicht) mit Intervall-Vorschau.
- **Kenne ich schon** schiebt die Karte auf 60 Tage.
- **Notizfeld** pro Karte für eigene Eselsbrücken (lokal gespeichert).
- **Fehler melden** sammelt falsche Einträge, in den Daten als CSV exportierbar.
- Desktop: Leertaste = umdrehen, Tasten 1–4 = bewerten.

## a/b/c passt sich automatisch an

a/b/c wird **nicht** mehr fest aus der Liste gelesen, sondern live aus dem Lernstand abgeleitet:

| Stability (FSRS) | Einstufung |
|---|---|
| neu / < 7 Tage | c — neu/unsicher |
| 7–30 Tage | b — erkenne ich |
| ≥ 30 Tage | a — kann ich |

Die Spalte `Priorität` in der xlsx ist nur noch **Startwert** für nie geübte Karten.

### Einstufung zurück in die Datei spielen (optional, kein Terminal)

1. App → ⚙ Daten → **Aktuelle a/b/c-Liste exportieren (CSV)**.
2. Die `prio-update-*.csv` in den Ordner `updates/` legen, committen, pushen (GitHub Desktop).
3. Die Action `apply-prio` aktualisiert `source/wortliste.xlsx`, löscht die CSV, und der Folge-Commit baut die JSON neu.

## Backup

PWA-Speicher kann auf iOS nach längerer Inaktivität gelöscht werden. Daher: alle paar Tage
⚙ Daten → **Backup exportieren (JSON)**. Wiederherstellen über **Backup importieren**.

## Wortliste erweitern

`source/wortliste.xlsx` bearbeiten (Spalten: Nr, Deutsch, Spanisch, Wortart, Priorität, Themenblock,
Form/Hinweis, Beispiel_ES, Beispiel_DE, Tags), committen — die Action baut die JSON neu.
`Form/Hinweis` trägt die Grammatik (Genus `el/la`, Konjugationsklasse `-ar/-er/-ir`, Stem-Change `o→ue`,
unregelmäßige Formen). Wortart `Phrase`/`Redewendung` blendet Genus-/Konjugationsanzeige aus.

## Updates

Bei Code- **oder** Datenänderung in `sw.js` den `VERSION`-Zähler hochzählen, sonst hängt der Cache.
Die LF/CRLF-Warnung in GitHub Desktop ist harmlos.

## Struktur

```
spanisch-vokabeltrainer/
├── .github/workflows/build-data.yml   xlsx -> JSON bei Push
├── .github/workflows/apply-prio.yml   updates/*.csv -> xlsx
├── index.html  styles.css  app.js  fsrs.js
├── sw.js  manifest.json
├── icons/
├── data/words.json  data/examples.json   (generiert)
├── scripts/build.py  scripts/apply_prio.py
├── source/wortliste.xlsx                  (source of truth)
└── updates/                               (Ablage für a/b/c-Exporte)
```
