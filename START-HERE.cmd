@echo off
setlocal
title Dot Com Library System
cd /d "%~dp0"

echo ==========================================
echo   DOT COM LIBRARY - LOCAL SYSTEM
echo ==========================================
echo.
echo Starting the local database and application...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){exit 0} } catch { exit 1 }"

if errorlevel 1 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$node=(Get-Command node -ErrorAction SilentlyContinue).Source; if($node){Start-Process -FilePath $node -ArgumentList 'server-node.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden}else{Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0server.ps1' -WindowStyle Hidden}"
  powershell.exe -NoProfile -Command "Start-Sleep -Seconds 2"
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8775/health -TimeoutSec 1; if($r.StatusCode -eq 200){exit 0} } catch { exit 1 }"

if errorlevel 1 (
  echo Starting Omnichannel service...
  start "DotCom Omnichannel" /min cmd /k "cd /d ""%~dp0services\omnichannel"" && node src\server.js"
  powershell.exe -NoProfile -Command "Start-Sleep -Seconds 3"
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/api/health -TimeoutSec 4; if($r.StatusCode -ne 200){exit 1} } catch { exit 1 }"

if errorlevel 1 (
  echo.
  echo ERROR: The local server could not start.
  echo Please close any application using port 8765, then try again.
  echo See logs\server.log for details.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8775/health -TimeoutSec 4; if($r.StatusCode -ne 200){exit 1} } catch { exit 1 }"

if errorlevel 1 (
  echo.
  echo WARNING: Main app started, but Omnichannel service could not start.
  echo You can still use the main system, but Customer Service Center needs port 8775.
  echo Try: START-ALL.cmd
)

start "" "http://127.0.0.1:8765/"
echo.
echo System opened successfully.
echo The local database server is running in the background.
powershell.exe -NoProfile -Command "Start-Sleep -Seconds 2"
exit /b 0
