@echo off
REM Erstellt eine Windows-Exe mit PyInstaller
if not exist .venv (
    echo [Info] Virtuelle Umgebung .venv nicht gefunden. Aktivieren Sie Ihre Python-Umgebung manuell.
) else (
    call .venv\Scripts\activate
)
pyinstaller --name CatchBoard --onefile --add-data "data;data" main.py
