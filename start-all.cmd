@echo off
REM start-all.cmd — start every backend process the demo needs.
REM
REM   1. voice-service  (Python, 127.0.0.1:8000)  — speaker verification
REM   2. backend        (Node,   :3000)           — the API the phone calls
REM   3. ngrok          (only if PUBLIC_BASE_URL / Twilio is in use)
REM
REM The mobile app (Metro, :8081) is started separately with `npx expo start`
REM inside mobile-app, because it prints a QR code you need to see.
REM
REM Each service gets its own window so one crash is visible and the others
REM keep running — a crashed voice service must not take billing down.

setlocal
cd /d "%~dp0"

echo === Voice Lock service (port 8000) ===
if not exist "voice-service\.venv\Scripts\python.exe" (
  echo [!] voice-service\.venv not found.
  echo     Create it once:
  echo       cd voice-service
  echo       python -m venv .venv
  echo       .venv\Scripts\pip install -r requirements.txt
  echo.
  echo     Continuing without Voice Lock — billing still works.
) else (
  start "Voice Lock :8000" cmd /k "cd /d %~dp0voice-service && .venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"
)

echo === Backend (port 3000) ===
start "Backend :3000" cmd /k "cd /d %~dp0backend && npm start"

if exist "backend\.env" (
  findstr /C:"PUBLIC_BASE_URL=https" "backend\.env" >nul 2>&1
  if not errorlevel 1 (
    echo === ngrok tunnel (PUBLIC_BASE_URL is set^) ===
    start "ngrok" cmd /k "ngrok http 3000"
  )
)

echo.
echo Started. Next:
echo   cd mobile-app
echo   npx expo start
echo.
echo Voice Lock mode is read from backend\.env ^(VOICE_LOCK_MODE^).
endlocal