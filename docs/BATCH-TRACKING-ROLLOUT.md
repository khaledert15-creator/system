# تتبع البريد المجمّع (١٠ أكواد في البحث الواحد)

## ما تغيّر

- **خدمة التتبع على الـMac (1.1.0):** مسار جديد `POST /track-batch` يكتب حتى ١٠ أكواد في صفحة البريد، ويضغط تتبع مرة واحدة، ويقرأ رد الموقع `GetShipmentDetails` لكل كود. البحث الفردي `/track` كما هو، لكنه أصبح يقرأ رد الموقع أولًا ونص الصفحة احتياطيًا. حد تكرار نفس الكود أصبح ساعة بدل ٦ ساعات، لأن النظام هو اللي بيحدد مواعيد التتبع (كل ساعتين للشحنة الخارجة للتسليم).
- **النظام:** العامل الخلفي ياخد حتى ١٠ شحنات في الدقيقة لو الخدمة بتعلن `maxBatchSize`، وإلا شحنة واحدة زي الأول. لما ييجي ميعاد شحنة، الشحنات اللي ميعادها جاي خلال ٣٠ دقيقة بتنضم لنفس البحث، فالمواعيد بتتجمع مع الوقت بدل ما تفضل متفرقة دقيقة بدقيقة. كل طلب للخدمة له رقم خاص بالشحنة. أي نتيجة لكود آخر تُرفض. لو الموقع حظر أو طلب تحقق أو حدّ الطلبات، الدورة تقف فورًا والعامل يستنى ١٥ لـ٣٠ دقيقة.

## الرجوع للبحث الفردي (بدون تسجيل حالة خاطئة)

الكود اللي يرجع من البحث المجمّع بـ `BATCH_FAILED` أو `BATCH_ITEM_MISSING` أو `BUSY` يتبحث منفردًا بـ `/track` في نفس الدورة. الخدمة ما بتسجّلش الكود ده كـ"تم تتبعه"، فالبحث الفردي ما يترفضش بسبب حد التكرار.

## التوافق (أي ترتيب للنشر)

| | الخدمة القديمة 1.0.0 | الخدمة الجديدة 1.1.0 |
|---|---|---|
| **النظام القديم** | كما هو | `/track` بدون تغيير؛ كود كود |
| **النظام الجديد** | `/health` بدون `maxBatchSize` يعني شحنة في الدقيقة؛ `/track-batch` يرجع 404 فيتبحث كل كود منفردًا | مجمّع |

## تحديث خدمة الـMac

الخدمة شغالة من `/Users/macbook/system mactabaa.com/services/local-tracking-rpa` عن طريق LaunchAgent `com.maktabaa.tracking-rpa`، وده بيعيد تشغيلها تلقائيًا لو وقفت.

```bash
cd "/Users/macbook/system mactabaa.com"
git fetch "<repo>" <branch>
git checkout FETCH_HEAD -- services/local-tracking-rpa/server.js services/local-tracking-rpa/tracking-parser.js services/local-tracking-rpa/package.json services/local-tracking-rpa/package-lock.json
launchctl kickstart -k gui/$(id -u)/com.maktabaa.tracking-rpa
```

بعدها `/health` لازم يرجّع `"agentVersion": "1.1.0"` و `"maxBatchSize": 10`. مفيش مكتبات جديدة، فمش محتاج `npm ci`.

## الرجوع للنسخة القديمة من خدمة الـMac

```bash
cd "/Users/macbook/system mactabaa.com"
git checkout HEAD -- services/local-tracking-rpa
launchctl kickstart -k gui/$(id -u)/com.maktabaa.tracking-rpa
```

النظام الجديد بيشتغل مع الخدمة القديمة، فممكن ترجع الخدمة لوحدها من غير ما ترجع النظام.

## مفيش migration

مفيش حقول جديدة في قاعدة البيانات. الشحنات بتتكتب في `shipments` و `trackingHistory` و `trackingRuns` بنفس الحقول.
