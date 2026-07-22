# تشغيل خدمة التتبع على macOS للإنتاج

الخدمة تعمل على جهاز Mac وتستمع محليًا فقط على `127.0.0.1:8788`. لا تفتح هذا المنفذ في Hostinger Firewall، ولا تستخدم Funnel أو رابطًا عامًا.

## 1. تجهيز شبكة Tailscale الخاصة

1. ثبّت Tailscale على جهاز Mac وعلى خادم الإنتاج.
2. سجّل الجهازين في الـTailnet نفسها، وتأكد من ظهورهما في لوحة Tailscale.
3. على الماك، انشر منفذ localhost داخل الـTailnet فقط:

```bash
tailscale serve --bg 8788
tailscale serve status
```

استخدم عنوان HTTPS الخاص الذي يعرضه الأمر، مثل `https://mac-name.tailnet-name.ts.net`. هذا هو عنوان `TRACKING_RPA_BASE_URL`، وليس `http://127.0.0.1:8788`.

## 2. تشغيل الـAgent على الماك

من جذر المستودع:

```bash
printf 'TRACKING_RPA_SHARED_SECRET=%s\n' 'ضع-سرًا-عشوائيًا-طويلًا' > services/local-tracking-rpa/.env.local
chmod 600 services/local-tracking-rpa/.env.local
chmod +x scripts/start-tracking-rpa-macos.command
./scripts/start-tracking-rpa-macos.command
```

السكربت يتحقق من Node.js وChrome، يثبت الحزم عند الحاجة، يمنع تشغيل نسختين، ويستخدم Profile مستقلًا داخل `services/local-tracking-rpa/.rpa-profile`.

اختبار محلي:

```bash
set -a; source services/local-tracking-rpa/.env.local; set +a
curl -H "Authorization: Bearer $TRACKING_RPA_SHARED_SECRET" http://127.0.0.1:8788/health
```

الطلب بلا Bearer Token يجب أن يرجع `401`.

## 3. التشغيل التلقائي بعد تسجيل الدخول

انسخ `deployment/macos/com.maktabaa.tracking-rpa.plist.example` إلى `~/Library/LaunchAgents/com.maktabaa.tracking-rpa.plist`، واستبدل `__REPOSITORY_PATH__` بالمسار الفعلي، ثم:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.maktabaa.tracking-rpa.plist
```

للإيقاف:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.maktabaa.tracking-rpa.plist
```

## 4. متغيرات Production

ضعها في بيئة السيرفر فقط، ولا تضع السر في GitHub أو الواجهة:

```dotenv
TRACKING_RPA_ENABLED=true
TRACKING_RPA_BASE_URL=https://mac-name.tailnet-name.ts.net
TRACKING_RPA_SHARED_SECRET=نفس-السر-الموجود-على-الماك
TRACKING_RPA_TIMEOUT_MS=120000
```

مع PM2:

```bash
pm2 restart server-node --update-env
pm2 logs server-node --lines 100
```

مع Docker Compose أضف القيم إلى ملف `.env` على السيرفر ثم نفّذ `docker compose up -d`.

## 5. الاختبار والتشخيص

من خادم الإنتاج اختبر العنوان الخاص:

```bash
curl -H "Authorization: Bearer $TRACKING_RPA_SHARED_SECRET" "$TRACKING_RPA_BASE_URL/health"
```

تظهر في النظام حالة الخدمة، آخر اتصال ناجح، والمهام المعلقة. إذا كان الماك Offline يسجل النظام `TRACKING_AGENT_OFFLINE`، ولا يغير الحالة الحالية للشحنة، ويضع المهمة لإعادة المحاولة حسب الجدول. زر «إعادة محاولة المهام المعلقة» يشغلها فور عودة الخدمة.

## 6. تدوير السر وRollback

لتدوير السر: أنشئ قيمة جديدة، حدّث `.env.local` على الماك وبيئة السيرفر، ثم أعد تشغيل الـAgent وMain App واختبر `/health`. لا تطبع القيمة في السجلات.

للـRollback: اضبط `TRACKING_RPA_ENABLED=false` وأعد تشغيل Main App. لإيقاف Agent استخدم `launchctl bootout` أو أوقف العملية المحلية. لا يحتاج Rollback إلى تغيير قاعدة البيانات.
