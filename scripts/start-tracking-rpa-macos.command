#!/bin/zsh
set -e

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
SERVICE_DIR="$PROJECT_ROOT/services/local-tracking-rpa"
LOCAL_ENV="$SERVICE_DIR/.env.local"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "خطأ: يجب تثبيت Node.js وnpm أولًا."
  exit 1
fi

if lsof -nP -iTCP:8788 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "خدمة التتبع تعمل بالفعل على الجهاز."
  exit 0
fi

if [[ -f "$LOCAL_ENV" ]]; then
  set -a
  source "$LOCAL_ENV"
  set +a
fi

if [[ -z "${TRACKING_RPA_SHARED_SECRET:-}" ]]; then
  echo "خطأ: أضف TRACKING_RPA_SHARED_SECRET داخل services/local-tracking-rpa/.env.local بصلاحية 600."
  exit 1
fi

if [[ ! -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]] && [[ ! -x "/Applications/Chromium.app/Contents/MacOS/Chromium" ]]; then
  echo "خطأ: لم يتم العثور على Google Chrome أو Chromium داخل Applications."
  exit 1
fi

cd "$SERVICE_DIR"
if [[ ! -d node_modules/playwright ]]; then
  echo "جاري تثبيت متطلبات خدمة التتبع..."
  npm ci
fi

echo "تم بدء خدمة التتبع محليًا على 127.0.0.1:8788."
exec npm start
