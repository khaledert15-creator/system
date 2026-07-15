# Local Tracking RPA Agent

خدمة محلية مستقلة لتجربة تتبع شحنات البريد المصري من Chrome ظاهر على جهاز المستخدم.

مهم:

- لا تستخدم stealth.
- لا تستخدم proxies.
- لا تستخدم captcha solving.
- لا تتجاوز Cloudflare أو أي تحقق بشري.
- عند ظهور Cloudflare/CAPTCHA يتم إرجاع `manualReviewRequired=true`.

التشغيل:

```bash
npm install
npm run install:browsers
npm run start
```

الرابط المحلي:

```text
http://127.0.0.1:8788
```

اختبار الصحة:

```text
GET /health
```

تتبع شحنة:

```text
POST /track
{
  "shipmentId": "SH-227",
  "trackingNumber": "ENO33289195EG",
  "provider": "egypt_post"
}
```

للاختبارات الآمنة بدون فتح الموقع:

```json
{ "provider": "mock_success", "trackingNumber": "ENO33289190EG" }
{ "provider": "mock_site_blocked", "trackingNumber": "ENO33289190EG" }
{ "provider": "mock_human_verification", "trackingNumber": "ENO33289190EG" }
```
