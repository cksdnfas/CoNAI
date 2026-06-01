@echo off
chcp 65001 > nul
title CoNAI Build And Run
cd /d "%~dp0"

call "%~dp0RUN_CoNAI.bat" %*
exit /b %ERRORLEVEL%
