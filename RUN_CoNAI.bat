@echo off
chcp 65001 > nul
setlocal
title CoNAI Split Runtime Launcher
cd /d "%~dp0"

echo ========================================
echo CoNAI Split Runtime Launcher
echo ========================================
echo.
echo [1/2] Preparing integrated build...
node scripts\run-built-if-needed.js --build-only
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo ================================================================
    echo  ERROR: build failed with code %EXIT_CODE%
    echo ================================================================
    echo.
    pause
    exit /b %EXIT_CODE%
)

echo.
echo [2/2] Starting API and worker windows...
start "CoNAI API Runtime" /D "%~dp0" cmd /k node scripts\run-built-if-needed.js --api --skip-build
timeout /t 2 /nobreak > nul
start "CoNAI Worker Runtime" /D "%~dp0" cmd /k node scripts\run-built-if-needed.js --worker --skip-build

echo.
echo API and worker started in separate windows.
echo API/UI uses the configured PORT from .env.
echo Worker runs queue, scheduler, cleanup, and no HTTP by default.
echo.
exit /b 0
