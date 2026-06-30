@echo off
chcp 65001 > nul
title CoNAI Worker Only Runtime
cd /d "%~dp0..\.."

echo Manual worker-only launcher.
echo Normal startup: RUN_CoNAI.bat
echo Use this only when intentionally separating API and worker.
echo.

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
