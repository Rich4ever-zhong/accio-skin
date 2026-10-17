@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Accio Skin

rem Resolve node: .nodepath file first, then PATH
set "NODE_EXE="
if exist ".nodepath" for /f "usebackq delims=" %%p in (".nodepath") do if exist "%%p" set "NODE_EXE=%%p"
if defined NODE_EXE goto run

for /f "delims=" %%n in ('where node 2^>nul') do set "NODE_EXE=%%n"
if defined NODE_EXE goto run

echo.
echo Node.js not found (needs v22+).
echo   1) Install Node 22 LTS: https://nodejs.org
echo   2) Or write the full path of node.exe into .nodepath in this folder
echo.
pause
exit /b 1

:run
echo Using node: %NODE_EXE%
echo.
"%NODE_EXE%" injector.mjs %*
echo.
pause
