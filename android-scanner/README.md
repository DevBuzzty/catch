# Android Scanner (APK)

Die Android-App scannt Karten per Kamera (OCR), erkennt Passcode/Name und sendet sie per WLAN an die Desktop-App.

## Voraussetzungen
- Android Studio (aktuelles Stable)
- Ein Android-Gerät im gleichen WLAN wie der Desktop

## Build / APK
1. Öffne `android-scanner/` in Android Studio.
2. Sync Gradle.
3. **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
4. APK auf dein Handy übertragen und installieren (Sideload).

## Nutzung
1. Desktop-App starten (Import-Tab zeigt IP + Port).
2. In der Android-App die IP/Port eingeben (z. B. `192.168.1.10:8787`).
3. **Start scanning** drücken und Karten nacheinander vor die Kamera halten.
4. Auf dem Desktop erscheinen die Karten im Import-Tab (Neu/Schon vorhanden).

## Hinweise
- OCR ist ein Einstieg: Der Passcode wird bevorzugt erkannt.
- Deutsche/englische Namen werden aus dem OCR-Text extrahiert.
