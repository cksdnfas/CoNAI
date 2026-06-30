@echo off
chcp 65001 > nul
setlocal
title CoNAI Runtime Supervisor
cd /d "%~dp0"

echo ========================================
echo CoNAI Runtime Supervisor
echo ========================================
echo.
echo [1/3] Stopping existing runtime processes...
node "%~dp0scripts\stop-existing-runtime.js"
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo ================================================================
    echo  ERROR: runtime stop preflight failed with code %EXIT_CODE%
    echo ================================================================
    echo.
    pause
    exit /b %EXIT_CODE%
)

echo.
echo [2/3] Truncating SQLite WAL files...
node "%~dp0scripts\checkpoint-runtime-databases.js"
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo ================================================================
    echo  ERROR: database checkpoint failed with code %EXIT_CODE%
    echo ================================================================
    echo.
    pause
    exit /b %EXIT_CODE%
)

echo.
echo [3/3] Starting API + worker under one supervisor...
node "%~dp0scripts\run-built-if-needed.js" --split
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo ================================================================
    echo  ERROR: runtime supervisor failed with code %EXIT_CODE%
    echo ================================================================
    echo.
    pause
    exit /b %EXIT_CODE%
)

exit /b %EXIT_CODE%
