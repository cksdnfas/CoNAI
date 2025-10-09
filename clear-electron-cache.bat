@echo off
echo Clearing electron-builder cache...

rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache" 2>nul
rmdir /s /q "%APPDATA%\electron-builder" 2>nul

echo Cache cleared!
echo Now run: npm run electron:build
pause
