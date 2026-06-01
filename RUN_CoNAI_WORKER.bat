@echo off
chcp 65001 > nul
title CoNAI Worker Runtime
cd /d "%~dp0"

node scripts\run-built-if-needed.js --worker %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo ================================================================
    echo  ERROR: worker runtime launcher failed with code %EXIT_CODE%
    echo ================================================================
    echo.
    pause
)

exit /b %EXIT_CODE%

