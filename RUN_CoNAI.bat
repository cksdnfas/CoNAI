@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo CoNAI AlphaTest Quick Start
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Please install Node.js 18+ first.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not available in PATH.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%i in ('node -p "process.versions.node"') do set NODE_MAJOR=%%i
if "%NODE_MAJOR%"=="24" (
  echo [WARN] Node 24 detected. CoNAI now tests against newer better-sqlite3,
  echo        but if install fails, please retry with Node 22 LTS.
  echo.
)

echo [1/4] Checking .env...
if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo   - .env created from .env.example
  ) else (
    echo   - .env.example not found, skipping
  )
) else (
  echo   - .env already exists
)

echo.
echo [2/4] Installing root dependencies...
call npm install
if errorlevel 1 goto :fail

echo.
echo [3/4] Installing workspace dependencies...
call npm run install:all
if errorlevel 1 goto :fail

echo.
echo [4/4] Starting CoNAI dev servers...
echo   - Backend:  http://localhost:1666
for /f "tokens=2 delims==" %%a in ('findstr /b /c:"FRONTEND_URL=" ".env"') do set FRONTEND_URL=%%a
if not defined FRONTEND_URL set FRONTEND_URL=http://localhost:1677
echo   - Frontend: %FRONTEND_URL%
echo.
call npm run dev
if errorlevel 1 goto :fail

goto :eof

:fail
echo.
echo [ERROR] CoNAI startup failed.
echo Check the log output above.
pause
exit /b 1
