@echo off
chcp 65001 > nul
title CoNAI Worker Only Runtime
cd /d "%~dp0..\.."

echo [UNSUPPORTED] Split runtime has known state-consistency defects:
echo   - Graph workflow cancel marks a still-running execution as failed
echo   - Settings changes never reach the worker process
echo   - Temp/canvas files are never expired, and tagger daemons load twice
echo.
echo Normal startup: RUN_CoNAI.bat (single-process runtime)
echo.

set CONAI_ALLOW_SPLIT_RUNTIME=true

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
