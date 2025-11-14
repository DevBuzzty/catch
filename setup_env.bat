@echo off
setlocal ENABLEDELAYEDEXPANSION

REM ------------------------------------------------------------
REM Erstellt (falls nötig) eine virtuelle Umgebung und installiert
REM alle Projektabhängigkeiten inklusive PyInstaller.
REM ------------------------------------------------------------

where python >NUL 2>&1
if errorlevel 1 (
    echo [Fehler] Python wurde nicht gefunden. Bitte installiere Python 3 und starte das Skript erneut.
    exit /b 1
)

if not exist .venv (
    echo [Info] Erstelle virtuelle Umgebung .venv ...
    python -m venv .venv
    if errorlevel 1 (
        echo [Fehler] Die virtuelle Umgebung konnte nicht erstellt werden.
        exit /b 1
    )
) else (
    echo [Info] Virtuelle Umgebung .venv bereits vorhanden.
)

echo [Info] Aktiviere virtuelle Umgebung ...
call .venv\Scripts\activate
if errorlevel 1 (
    echo [Fehler] Die virtuelle Umgebung konnte nicht aktiviert werden.
    exit /b 1
)

echo [Info] Aktualisiere pip ...
python -m pip install --upgrade pip
if errorlevel 1 goto :pip_error

if exist requirements.txt (
    echo [Info] Installiere Bibliotheken aus requirements.txt ...
    python -m pip install -r requirements.txt
    if errorlevel 1 goto :pip_error
) else (
    echo [Warnung] Keine requirements.txt gefunden.
)

echo [Info] Installiere PyInstaller ...
python -m pip install --upgrade pyinstaller
if errorlevel 1 goto :pip_error

echo.
echo [Erfolg] Alle Abhaengigkeiten wurden installiert. Du kannst jetzt build_exe.bat ausfuehren.
exit /b 0

:pip_error
echo [Fehler] Die Installation der Python-Abhaengigkeiten ist fehlgeschlagen.
exit /b 1
