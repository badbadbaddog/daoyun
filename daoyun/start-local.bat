@echo off
setlocal EnableExtensions

cd /d "%~dp0"
node scripts\start-local.mjs
set "DAOYUN_EXIT_CODE=%ERRORLEVEL%"

if not "%DAOYUN_EXIT_CODE%"=="0" pause
exit /b %DAOYUN_EXIT_CODE%
