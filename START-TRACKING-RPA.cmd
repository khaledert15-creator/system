@echo off
setlocal
cd /d "%~dp0services\local-tracking-rpa"
echo Starting Local Tracking RPA Agent on http://127.0.0.1:8788
echo Chrome will open visibly when tracking runs. Do not bypass Cloudflare or CAPTCHA.
if not exist node_modules (
  echo.
  echo Dependencies are not installed.
  echo Run: npm install
  echo Then: npm run install:browsers
  echo.
)
npm run start
pause
