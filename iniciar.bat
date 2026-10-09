@echo off
cd /d "%~dp0"
set HOST=127.0.0.1
where node >nul 2>nul && (set NODE=node) || (set NODE=%LOCALAPPDATA%\node-portatil\node-v24.21.0-win-x64\node.exe)
start "" http://127.0.0.1:8080
"%NODE%" server.js
pause
