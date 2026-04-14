@echo off
chcp 65001 > nul
title CoNAI Integrated Runner
cd /d "%~dp0"

node scripts\run-integrated-if-needed.js %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo ================================================================
    echo  ERROR: integrated runner failed with code %EXIT_CODE%
    echo ================================================================
    echo.
    pause
)

exit /b %EXIT_CODE%
