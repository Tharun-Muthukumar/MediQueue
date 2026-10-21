@echo off
title MediQueue setup
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Download Node.js 22 LTS from https://nodejs.org
  echo then run this file again.
  echo.
  pause
  exit /b 1
)
node scripts\setup.mjs
echo.
pause
