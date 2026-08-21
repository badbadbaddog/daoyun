@echo off
setlocal EnableExtensions

cd /d %~dp0

set PG_BIN=C:\PROGRA~1\PostgreSQL\16\bin
set PG_DATA=%TEMP%\daoyun-postgres
set PG_PORT=55433

if not exist %PG_BIN%\postgres.exe (
  echo [DaoYun] PostgreSQL 16 was not found: %PG_BIN%
  echo [DaoYun] Install PostgreSQL 16 or update PG_BIN in this file.
  pause
  exit /b 1
)

if not exist %PG_DATA%\PG_VERSION (
  echo [DaoYun] Initializing the local PostgreSQL data directory...
  %PG_BIN%\initdb.exe -D %PG_DATA% -U daoyun --auth=trust --encoding=UTF8 --no-locale
  if errorlevel 1 (
    echo [DaoYun] PostgreSQL initialization failed.
    pause
    exit /b 1
  )
)

%PG_BIN%\pg_isready.exe -h 127.0.0.1 -p %PG_PORT% >nul 2>&1
if errorlevel 1 (
  echo [DaoYun] Starting local PostgreSQL...
  start "DaoYun PostgreSQL" %PG_BIN%\postgres.exe -D %PG_DATA% -p %PG_PORT% -h 127.0.0.1
)

for /l %%I in (1,1,30) do (
  %PG_BIN%\pg_isready.exe -h 127.0.0.1 -p %PG_PORT% >nul 2>&1
  if not errorlevel 1 goto postgres_ready
  ping -n 2 127.0.0.1 >nul
)

echo [DaoYun] PostgreSQL did not become ready within 30 seconds.
pause
exit /b 1

:postgres_ready
%PG_BIN%\createdb.exe -h 127.0.0.1 -p %PG_PORT% -U daoyun daoyun_dev >nul 2>&1

echo [DaoYun] Starting the API...
start "DaoYun API" /D %~dp0 %ComSpec% /K pnpm api:local

echo [DaoYun] Starting the web app...
start "DaoYun Web" /D %~dp0 %ComSpec% /K pnpm dev --host 127.0.0.1

ping -n 4 127.0.0.1 >nul
start "" http://127.0.0.1:5173/

echo [DaoYun] Web: http://127.0.0.1:5173/
echo [DaoYun] API: http://127.0.0.1:3000/
echo [DaoYun] The browser was opened. Keep the PostgreSQL, API, and Web windows open.
exit /b 0
