@echo off
title MediQueue (API :4000, web :5173)
cd /d "%~dp0"
if not exist "backend\node_modules" (
  echo First run detected - running setup...
  node scripts\setup.mjs || (pause & exit /b 1)
)
echo.
echo Starting MediQueue. Your browser opens in a few seconds.
echo Keep this window open while you use the app. Press Ctrl+C to stop.
echo.
start "" /b cmd /c "timeout /t 7 /nobreak >nul & start http://localhost:5173"
npm run dev
