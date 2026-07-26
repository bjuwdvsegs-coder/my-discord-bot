@echo off
title Discord Protection, Anime & Music Bot
color 0D
cls

echo ===================================================
echo   Discord Bot - Protection, Anime & Music
echo   Owner: 1325477924035498034
echo ===================================================
echo.

:: Kill any old stuck node instances
taskkill /F /IM node.exe >nul 2>&1

:: Wait a moment for port release
timeout /t 1 /nobreak >nul

:: Auto-detect Node.exe location
set "NODE_CMD=node"

if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files\nodejs\node.exe"
    goto :RUN_BOT
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files (x86)\nodejs\node.exe"
    goto :RUN_BOT
)
if exist "%LOCALAPPDATA%\Programs\node\node.exe" (
    set "NODE_CMD=%LOCALAPPDATA%\Programs\node\node.exe"
    goto :RUN_BOT
)

:RUN_BOT
echo [INFO] Starting bot with: %NODE_CMD%
echo [INFO] Bot is running... Press Ctrl+C to stop.
echo.

:: NODE_NO_WARNINGS suppresses DeprecationWarnings cleanly
set NODE_NO_WARNINGS=1
"%NODE_CMD%" index.js

echo.
echo ===================================================
echo   Bot has stopped. Restarting in 3 seconds...
echo ===================================================
timeout /t 3 /nobreak >nul

:: Auto-restart on crash
goto :RUN_BOT
