# Catch – digitales Spielbrett für die Tafel

Dieses Projekt stellt ein komplett offline nutzbares Spielbrett zur Verfügung, das Sie direkt auf einem USB-Stick transportieren können. Die Anwendung wurde für interaktive Tafeln oder große Displays konzipiert und lässt sich mit eigenen Inhalten wie Bildern, Geräuschen oder Emoji-Rätseln füllen.

## Funktionen im Überblick

- **Anpassbares Spielbrett** mit 5×6 Feldern (Start & Ziel inklusive). Jedes Feld kann einer der vier Kategorien zugeordnet werden: Bilder erraten, Geräusche erraten, Emoji-Rätsel oder Filter-Rätsel.
- **Individuelle Hintergründe** für jedes Feld – perfekt, um die von Schüler:innen gemalten Bilder zu verwenden.
- **Flexible Spieler:innen-Verwaltung** mit beliebig vielen Teams, individuellen Farben und automatischer Rangliste.
- **Digitale Spielfiguren** (farbige Punkte) und integrierter Würfel (1–6).
- **Vier Rätseltypen** mit zufälliger Auswahl ohne Wiederholungen, bis alle Aufgaben gezeigt wurden:
  - Bildausschnitt erraten → bei richtiger Antwort erscheint das komplette Bild, bei falscher Antwort geht die Figur zurück zum Start.
  - Geräusch erraten → spielt eine Audiodatei ab.
  - Emoji-Rätsel → Text- oder Emoji-Kombination als Hinweis.
  - Filterrätsel → gefiltertes Bild erraten.
- **Cheer-Animation** und Rangliste, sobald Teams das Ziel erreichen.
- **Speicher- und Vorlagenfunktion**, damit eigene Inhalte dauerhaft erhalten bleiben und leicht dupliziert werden können.

## Ordnerstruktur

```
catch/           Python-Paket mit der Anwendung
main.py          Einstiegspunkt (für Python & PyInstaller)
requirements.txt Benötigte Bibliotheken
data/            Alle spielrelevanten Daten und Medien
  ├─ game_state.json   Aktueller Spielstand (wird automatisch erzeugt)
  ├─ template.json     Vorlage, die als Ausgangsbasis dient
  └─ media/            Bilder, Sounds und Hintergründe
```

> **Wichtig:** Verteilen Sie immer den kompletten Projektordner (inklusive `data/` und `media/`). So bleiben alle hochgeladenen Inhalte intakt.

## Projekt lokal starten

1. Python 3.10 oder neuer installieren.
2. Abhängigkeiten installieren:

   ```bash
   python -m venv .venv
   .venv/Scripts/activate  # Windows
   source .venv/bin/activate  # macOS/Linux
   pip install -r requirements.txt
   ```

3. Anwendung starten:

   ```bash
   python main.py
   ```

   Beim ersten Start wird automatisch eine leere Vorlage geladen.

## Eigene Inhalte hinzufügen

1. Öffnen Sie das Programm (`python main.py`).
2. Nutzen Sie im Menü **Bearbeiten → Puzzles verwalten**:
   - **Bildrätsel**: geben Sie eine Lösung ein und wählen Sie anschließend den Bildausschnitt sowie das vollständige Bild aus (separate Dateien). Die Dateien werden automatisch in den `data/media/`-Ordner kopiert.
   - **Geräuschrätsel**: wählen Sie eine MP3/WAV/OGG-Datei und hinterlegen Sie die Lösung.
   - **Emoji-Rätsel**: tragen Sie Emoji/Text und die zugehörige Lösung ein.
   - **Filterrätsel**: wählen Sie ein Bild, das mit einem Filter versehen wurde, und geben Sie die Lösung ein.
3. **Spieler:innen** verwalten Sie über **Bearbeiten → Spieler:innen**. Neue Teams können angelegt, Farben gesetzt und bestehende Teams entfernt werden.
4. **Spielfelder** bearbeiten Sie, indem Sie auf ein Feld klicken und anschließend im Menü **Spielbrett → Ausgewähltes Feld bearbeiten** die Kategorie oder den Hintergrund anpassen.
5. Speichern nicht vergessen – über den Button rechts oder über **Datei → Speichern**.

Alle Medien werden automatisch in die passenden Unterordner kopiert, sodass das Spiel ohne zusätzliche Pfadeinstellungen funktioniert.

## Spiel speichern & Vorlage aktualisieren

- `Datei → Speichern` legt den aktuellen Stand in `data/game_state.json` ab.
- `Datei → Speichern unter…` erlaubt das Exportieren in eine andere JSON-Datei (z. B. als Sicherung).
- `Datei → Vorlage aktualisieren` überschreibt `data/template.json` mit dem aktuellen Stand.
- `Datei → Vorlage neu laden` lädt die zuletzt gespeicherte Vorlage – praktisch, wenn Sie das Spiel für eine neue Klasse zurücksetzen möchten.

## Spiel als Windows-Executable (.exe)

1. Stellen Sie sicher, dass Sie die Abhängigkeiten installiert haben.
2. Installieren Sie PyInstaller (falls noch nicht vorhanden):

   ```bash
   pip install pyinstaller
   ```

3. Bauen Sie die ausführbare Datei (alternativ können Sie die mitgelieferten Skripte `build_exe.bat` bzw. `build_exe.sh` verwenden):

   ```bash
   pyinstaller --name CatchBoard --onefile --add-data "data;data" main.py
   ```

   - `--add-data "data;data"` sorgt dafür, dass die Vorlagen und Medien mit in die `.exe` kopiert werden.
   - Die fertige Datei finden Sie anschließend im Ordner `dist/`.

4. Kopieren Sie **den gesamten dist-Ordner** oder die erstellte `.exe` samt `data/`-Ordner auf einen USB-Stick. Die `.exe` funktioniert komplett offline.

> Tipp: Wenn Sie das Spiel auf mehreren Rechnern nutzen möchten, kopieren Sie einfach den kompletten Projektordner auf jeden USB-Stick. Änderungen an Rätseln oder Spielständen landen ausschließlich im `data/`-Verzeichnis.

## Hinweise

- Für reibungslose Audio-Wiedergabe empfiehlt es sich, WAV-Dateien zu verwenden. MP3 und OGG funktionieren ebenfalls, sofern die Codecs vom System unterstützt werden.
- Achten Sie darauf, dass Bilder nicht zu groß sind (idealerweise kleiner als 2000×2000 px), damit sie schnell geladen werden.
- Auf Touch-Displays können Felder ebenfalls angetippt werden – die Benutzeroberfläche ist vollständig mit Maus oder Finger bedienbar.

Viel Spaß beim Gestalten Ihres eigenen Klassen-Spiels! 🎉
