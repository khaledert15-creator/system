# Local Tracking RPA Agent

خدمة محلية مستقلة لتتبع شحنات البريد المصري من Chrome ظاهر على جهاز Mac.

مهم:

- لا تستخدم stealth.
- لا تستخدم proxies.
- لا تستخدم captcha solving.
- لا تتجاوز Cloudflare أو أي تحقق بشري.
- عند ظهور Cloudflare/CAPTCHA يتم إرجاع `manualReviewRequired=true`.

التشغيل:

أنشئ ملف `.env.local` غير المتتبع داخل هذا المجلد، وضع فيه سرًا قويًا، ثم شغّل سكربت macOS:

```bash
chmod 600 .env.local
../../scripts/start-tracking-rpa-macos.command
```

محتوى الملف:

```dotenv
TRACKING_RPA_SHARED_SECRET=replace-with-a-long-random-secret
```

الرابط المحلي:

```text
http://127.0.0.1:8788
```

اختبار الصحة:

```text
curl -H "Authorization: Bearer $TRACKING_RPA_SHARED_SECRET" http://127.0.0.1:8788/health
```

تتبع شحنة:

```text
POST /track
Authorization: Bearer <secret>
{
  "shipmentId": "SH-227",
  "trackingNumber": "ENO33289195EG",
  "provider": "egypt_post"
}
```

الاستجابات التجريبية معطلة افتراضيًا. يمكن تفعيلها مؤقتًا في بيئة الاختبار فقط باستخدام `TRACKING_RPA_ALLOW_MOCKS=true`:

```json
{ "provider": "mock_success", "trackingNumber": "ENO33289190EG" }
{ "provider": "mock_site_blocked", "trackingNumber": "ENO33289190EG" }
{ "provider": "mock_human_verification", "trackingNumber": "ENO33289190EG" }
```
