@echo off
setlocal
"%~dp0runtime\node.exe" "%~dp0server\dedicated\launch.mjs" portable-client %*
if errorlevel 1 (
  if not defined GH_NONINTERACTIVE pause
  exit /b 1
)
