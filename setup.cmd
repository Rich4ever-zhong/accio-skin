@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Accio Skin - setup

echo ============================================
echo  Accio Skin setup
echo ============================================
echo.
echo [1/2] Installing autostart (tray runs silently at login)...
powershell -NoProfile -ExecutionPolicy Bypass -File "install-startup.ps1"
echo.

echo [2/2] Patch Accio shortcuts with --remote-debugging-port=9222 ?
echo       This lets the tray ATTACH instead of restarting Accio.
echo       (a backup .lnk.bak is kept; undo with patch-shortcuts.ps1 -Restore)
choice /c YN /n /m "Patch shortcuts now? [Y/N]: "
if errorlevel 2 goto skip
powershell -NoProfile -ExecutionPolicy Bypass -File "patch-shortcuts.ps1"
goto done

:skip
echo Skipped. The tray will still work: it will take over a manually opened Accio.

:done
echo.
echo Done. From now on:
echo   - the tray starts with Windows and waits in the background
echo   - open Accio as usual, the skin is applied automatically
echo.
pause
