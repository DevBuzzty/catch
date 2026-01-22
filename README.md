# YGO Card Manager

Eine lokale Desktop-App zum Verwalten von Yu-Gi-Oh Karten mit Import, Export, Duplikaterkennung und Cardcluster-Scraper.

## Voraussetzungen

- Node.js 18+
- npm

## Installation

```bash
npm install
```

## Entwicklung

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Tests

```bash
npm test
```

Optionaler Integrationstest (lädt eine bekannte Karte von cardcluster.com):

```bash
npm run test:integration
```

## Datenbank

Die SQLite-Datenbank liegt im userData-Verzeichnis von Electron, typischerweise:

- macOS: `~/Library/Application Support/YGO Card Manager/cards.sqlite`
- Windows: `%APPDATA%/YGO Card Manager/cards.sqlite`
- Linux: `~/.config/YGO Card Manager/cards.sqlite`

## CSV Import/Export

### Import

Der Import erwartet eine CSV mit Headerzeile. Spalten können sein:

- `de_name`
- `passcode`
- `en_name`

Wenn nur `de_name` vorhanden ist, wird der Datensatz trotzdem importiert.

Beispiel:

```csv
de_name,passcode,en_name
Dunkler Magier,46986414,Dark Magician
```

### Export

Der Export gibt alle Karten inklusive Details als CSV aus.

## Deck Import (Cardcluster)

Unter **Decks** kannst du eine Cardcluster-Deck-URL einfügen, um die Kartenliste zu importieren.
Die App zeigt danach, welche Karten du bereits besitzt und welche fehlen. Der Import nutzt
den `__NEXT_DATA__` Block von cardcluster.com und speichert das Deck lokal.

## Hinweise

- Scraping erfolgt ausschließlich über cardcluster.com.
- Suchreihenfolge: Passcode → Englisch → Deutsch.
- Passcode-Matching prüft bis zu 5 Kandidaten.
- Batchverarbeitung läuft standardmäßig in 25er Schritten (Settings anpassbar).
