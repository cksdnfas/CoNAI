@echo off
chcp 65001 > nul
title CoNAI Runtime Supervisor
cd /d "%~dp0"

echo RUN_CoNAI_BUILD_AND_RUN.bat is a compatibility alias.
echo Use RUN_CoNAI.bat for normal startup.
echo.
call "%~dp0RUN_CoNAI.bat" %*
exit /b %ERRORLEVEL%
