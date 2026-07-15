# Omnichannel Customer Service Center

خدمة مستقلة داخل نفس Repository لنظام مكتبة دوت كوم. تحفظ المحادثات والرسائل في PostgreSQL عبر Prisma، وتقرأ بيانات العملاء/الطلبات/الفواتير/الشحنات من النظام الحالي قراءة فقط.

## التشغيل المحلي

1. جهز PostgreSQL محليًا، أو شغّله سريعًا من ملف Docker المرفق:

```bash
docker compose up -d
```

إذا لم تستخدم Docker، استخدم أي PostgreSQL متاح واضبط `DATABASE_URL`.

2. انسخ `.env.example` إلى `.env` واضبط `DATABASE_URL`.
3. ثبّت الاعتمادات:

```bash
npm install
```

4. شغّل Prisma:

```bash
npm run generate
npm run migrate:dev
npm run seed
```

5. شغّل الخدمة:

```bash
npm run dev
```

الخدمة تعمل افتراضيًا على:

```text
http://127.0.0.1:8775
```

## نقاط مهمة

- لا يتم تخزين رسائل Omnichannel داخل `data/database.json`.
- WhatsApp الأساسي موجود كـ Channel Account بحالة `not_connected` فقط ولا يتم لمسه.
- WhatsApp Secondary و Messenger يعملان محليًا عبر Mock Providers.
- Webhook endpoints جاهزة بدون أي Access Tokens حقيقية.
- في production يجب تفعيل HTTPS وإدخال Meta credentials في environment variables فقط.

## Endpoints مختصرة

- `GET /health`
- `GET /ready`
- `GET /api/events` SSE
- `GET /api/channels`
- `GET /api/channel-accounts`
- `GET /api/conversations`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/claim`
- `POST /api/conversations/:id/assign`
- `POST /api/conversations/:id/messages`
- `POST /api/mock/whatsapp/incoming`
- `POST /api/mock/messenger/incoming`
- `GET /webhooks/whatsapp`
- `POST /webhooks/whatsapp`
- `GET /webhooks/messenger`
- `POST /webhooks/messenger`

## Production checklist

1. Public HTTPS URL.
2. Production PostgreSQL.
3. `DATABASE_URL`.
4. `META_APP_SECRET`.
5. `META_WEBHOOK_VERIFY_TOKEN`.
6. WhatsApp/Messenger tokens in environment variables.
7. Register webhook URLs at Meta.
8. Start with WhatsApp Secondary, not Primary.
