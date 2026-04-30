@echo off
chcp 65001 > nul
title CoNAI Build And Run
cd /d "%~dp0"

node scripts\run-built-if-needed.js %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo ================================================================
    echo  ERROR: build-and-run launcher failed with code %EXIT_CODE%
    echo ================================================================
    echo.
    pause
)

exit /b %EXIT_CODE%
