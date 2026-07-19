# Omnichannel Customer Service Center

خدمة مستقلة داخل نفس Repository لنظام مكتبة دوت كوم. تحفظ المحادثات والرسائل في PostgreSQL عبر Prisma، وتقرأ بيانات العملاء/الطلبات/الفواتير/الشحنات من النظام الحالي قراءة فقط.

## التشغيل

يوجد Environment واحد فقط للنظام. انسخ ملف الإعداد الموحد من جذر المشروع:

```bash
cp .env.example .env
```

عدّل القيم داخل `.env`، خصوصًا كلمات المرور والأسرار والروابط العامة، ثم شغّل كل الخدمات من جذر المشروع:

```bash
docker compose up -d --build
```

إذا لم تستخدم Docker، استخدم PostgreSQL متاحًا واضبط `DATABASE_URL` في ملف `.env` الموجود في جذر المشروع، ثم ثبّت الاعتمادات:

```bash
npm install
```

شغّل Prisma:

```bash
npm run generate
npm run migrate
npm run seed
```

شغّل الخدمة:

```bash
npm start
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
- عند الربط الخارجي يجب تفعيل HTTPS وإدخال Meta credentials في ملف `.env` على السيرفر فقط.

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

## قائمة تجهيز الربط الخارجي

1. Public HTTPS URL.
2. PostgreSQL دائم مع Volume ونسخة احتياطية.
3. `DATABASE_URL`.
4. `META_APP_SECRET`.
5. `META_WEBHOOK_VERIFY_TOKEN`.
6. WhatsApp/Messenger tokens in environment variables.
7. Register webhook URLs at Meta.
8. Start with WhatsApp Secondary, not Primary.
