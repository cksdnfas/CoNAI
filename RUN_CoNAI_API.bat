@echo off
chcp 65001 > nul
title CoNAI API Runtime
cd /d "%~dp0"

node scripts\run-built-if-needed.js --api %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo ================================================================
    echo  ERROR: API runtime launcher failed with code %EXIT_CODE%
    echo ================================================================
    echo.
    pause
)

exit /b %EXIT_CODE%

