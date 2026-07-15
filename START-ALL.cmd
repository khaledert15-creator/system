@echo off
setlocal
title Dot Com Library System - All Services
cd /d "%~dp0"

echo ==========================================
echo   DOT COM LIBRARY - MAIN + OMNICHANNEL
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not installed or not in PATH.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){exit 0} } catch { exit 1 }"
if errorlevel 1 (
  echo Starting main app on 8765...
  start "DotCom Main App" /min cmd /c "cd /d ""%~dp0"" && node server-node.js"
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8775/health -TimeoutSec 1; if($r.StatusCode -eq 200){exit 0} } catch { exit 1 }"
if errorlevel 1 (
  echo Starting Omnichannel service on 8775...
  start "DotCom Omnichannel" /min cmd /k "cd /d ""%~dp0services\omnichannel"" && node src\server.js"
)

echo Waiting for services...
powershell.exe -NoProfile -Command "Start-Sleep -Seconds 4"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ok=$true; try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/api/health -TimeoutSec 4; if($r.StatusCode -ne 200){$ok=$false} } catch { $ok=$false }; try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8775/health -TimeoutSec 4; if($r.StatusCode -ne 200){$ok=$false} } catch { $ok=$false }; if($ok){exit 0}else{exit 1}"
if errorlevel 1 (
  echo.
  echo ERROR: One or more services did not start.
  echo Main app: http://127.0.0.1:8765/api/health
  echo Omnichannel: http://127.0.0.1:8775/health
  pause
  exit /b 1
)

start "" "http://127.0.0.1:8765/?view=omnichannel"
echo.
echo All services are running.
echo Main app: http://127.0.0.1:8765/
echo Omnichannel: http://127.0.0.1:8775/health
exit /b 0
