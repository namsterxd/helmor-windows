@echo off
setlocal
set "HELMOR_WINDOWS_TEST_SCRIPT=%~dp0test-windows.ps1"
set "HELMOR_WINDOWS_TEST_SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $script = Get-Content -Raw -LiteralPath $env:HELMOR_WINDOWS_TEST_SCRIPT; & ([scriptblock]::Create($script)) %*"
exit /b %ERRORLEVEL%
