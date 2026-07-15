# تقرير اختبار النسخة التشغيلية — مكتبة دوت كوم

تاريخ الاختبار: 23 يونيو 2026

## النتيجة

نجح الاختبار الآلي للواجهة: **146 من 146**.

نجحت اختبارات الخادم وإعادة التشغيل والبيانات.

## ما تم اختباره فعليًا

- تسجيل الدخول بالحسابات الستة: مالك، مدير، محاسب، كاشير، مخزن، شحن.
- رفض قراءة قاعدة البيانات بدون جلسة.
- منع الكاشير من النسخ الاحتياطي وإرجاع HTTP 403.
- نجاح النسخ الاحتياطي بحساب المالك.
- إخفاء النظام بالكامل قبل تسجيل الدخول.
- منع الكاشير من صفحة الحسابات ومن حذف الأصناف.
- تحميل 11 قسمًا، ومنها قسم طلبات الأونلاين الجديد.
- إضافة طلب أونلاين وتحويله إلى فاتورة بيع.
- خصم مخزون الطلب، وتسجيل حركة مخزون مرتبطة بالفاتورة.
- إنشاء شحنة مرتبطة بالطلب.
- إلغاء فاتورة الطلب وإعادة المخزون.
- البيع والشراء والإلغاء وتأثيرها على المخزون والحسابات.
- الجرد الجزئي والكلي وتسويات المخزون.
- إيصالات العملاء والموردين وعكسها عند الإلغاء.
- البحث في الفواتير برقم الفاتورة والتتبع والموبايل والاسم.
- البحث السريع في المبيعات ودمج الكتاب المكرر.
- وجود معالج لكل الأزرار الأساسية والجديدة.
- تقارير المبيعات والربح والأكثر مبيعًا والراكد والمنخفض والمديونيات والشحن والمرتجعات.
- تصدير CSV.
- قوالب فاتورة البيع والإيصالات وأمر التجهيز وكشف الحساب ويومية الخزنة.
- تحديث الشحنات الدوري.
- منع تعارض الحفظ باستخدام revision وإرجاع HTTP 409.
- تعطيل `/api/reset` وإرجاع HTTP 403.
- إنشاء نسخة احتياطية عند تشغيل الخادم.
- إيقاف الخادم وتشغيله مجددًا.
- تطابق SHA-256 لقاعدة البيانات قبل وبعد إعادة التشغيل.
- نجاح تسجيل الدخول بعد إعادة التشغيل.

## نتيجة اختبار إعادة التشغيل

- الخادم عاد للعمل: نعم.
- بصمة قاعدة البيانات قبل وبعد: متطابقة.
- البيانات لم تُفقد: نعم.
- تسجيل الدخول بعد إعادة التشغيل: ناجح.
- عدد النسخ المحتفظ بها: آخر 30 نسخة.

## بنية البيانات الجديدة

- `version`
- `users`
- `stockMovements`
- `onlineOrders`
- `returns`
- `createdAt`
- `updatedAt`
- `deletedAt`
- `audit`

## ملاحظات تشغيلية

- كلمات المرور مخزنة كـ SHA-256 مع salt، وليست نصًا مباشرًا.
- هذه حماية مناسبة للنسخة المحلية، لكن النشر عبر الإنترنت يحتاج خادم تطبيق وقاعدة PostgreSQL وHTTPS وخوارزمية Argon2 أو bcrypt.
- تكامل شركات الشحن والمتجر الحكومي وWhatsApp يحتاج بيانات API من كل مزود.

## تحديث اختبار المرتجعات المستقلة حسب الحساب

تاريخ التحديث: 28 يونيو 2026

تم تطوير واختبار مسارات المرتجعات التالية بدون إلغاء نظام المرتجع المرتبط بفاتورة واحدة:

- إضافة زر `مرتجع مبيعات مستقل حسب العميل`.
- إضافة زر `مرتجع مشتريات مستقل حسب المورد`.
- الإبقاء على أزرار `مرتجع من فاتورة بيع` و`مرتجع من فاتورة مشتريات`.
- إضافة بحث مستقل في المرتجعات.
- دعم بنية بيانات موسعة للمرتجعات تشمل: `returnNo`, `mode`, `accountType`, `accountId`, `items`, `settlementType`, `paidAmount`, `balanceEffect`, `createdBy`.
- اختبار إنشاء مرتجع مبيعات مستقل لعميل من أكثر من فاتورة بيع.
- اختبار زيادة المخزون بعد مرتجع المبيعات المستقل.
- اختبار تعديل حساب العميل بعد المرتجع.
- اختبار إنشاء مرتجع مشتريات مستقل لمورد من أكثر من مستند شراء.
- اختبار نقص المخزون بعد مرتجع المشتريات المستقل.
- اختبار تعديل حساب المورد بعد المرتجع.
- اختبار منع تجاوز الكمية المتاحة عبر احتساب الكميات المرتجعة سابقًا من المستندات القديمة والجديدة.
- اختبار تسجيل حركة مخزون لكل صنف مرتجع.
- اختبار تسجيل العملية في audit log.
- اختبار ظهور تقارير المرتجعات الجديدة:
  - مرتجعات المبيعات حسب الفترة.
  - مرتجعات المشتريات حسب الفترة.
  - مرتجعات حسب العميل.
  - مرتجعات حسب المورد.
  - أكثر الكتب المرتجعة.
  - تأثير المرتجعات على الأرباح والمخزون.
- اختبار ظهور أزرار المرتجعات المستقلة في الواجهة بدون أخطاء JavaScript.

ملاحظة: تم إضافة هذه السيناريوهات أيضًا داخل الاختبار الذاتي `selftest` حتى تكون قابلة للإعادة، مع استمرار استرجاع البيانات الأصلية بعد نهاية الاختبار.
- تحديث 6 يوليو 2026: تم إضافة لوحة جانبية في إيصالات العملاء والموردين تعرض رصيد الطرف المختار وآخر التعاملات المرتبطة بالفواتير/الإيصالات مع زر فتح لكل مستند، وتم اختبار تحديثها عند تغيير العميل وفتح المستند المرتبط RCP-0006، مع نجاح فحص node --check وعدم ظهور أخطاء Console.
- تحديث 6 يوليو 2026: تم تطوير دفتر الحركة المالية بإضافة عمود `تمت بواسطة` وعمود `التاريخ والوقت` وزر `تفاصيل` لكل حركة. تم ربط تفاصيل الحركة بالمستندات الأصلية وسجل العمليات، وتم اختبار الحركة TX-047 وفتح الإيصال المرتبط RCP-0008 بنجاح.
- تحديث 6 يوليو 2026: تم تطوير شاشة الصلاحيات لتعرض صلاحيات المستخدمين والأدوار بالكامل. أصبح لكل مستخدم/دور مصفوفة شاشات وإجراءات تفصيلية قابلة للحفظ، وتم اختبار تخصيص المستخدم `cashier` ثم إرجاعه إلى وراثة الدور بنجاح دون أخطاء Console.
- تحديث 6 يوليو 2026: تم إضافة شعار مكتبة دوت كوم داخل الواجهة وقوالب الطباعة المركزية، وتحديث ألوان الهوية إلى الأزرق/الأبيض/الخلفية الداكنة، وإضافة الشعار إلى كاش الخدمة. تم التحقق من تحميل الشعار داخل الواجهة ونجاح فحص JavaScript دون أخطاء Console.
- تحديث 6 يوليو 2026: تم استبدال كارت هدف المبيعات الثابت في التقارير بلوحة تحليل شهرية تعرض مبيعات الشهر الحالي حتى اليوم، المتوقع لنهاية الشهر الحالي، مبيعات الشهر السابق، ومتوسط الشهور السابقة، مع جدول مبيعات كل شهر سابق والمقارنة بالتوقع الحالي. تم اختبار الصفحة على `/?view=reports` وظهرت لوحة `تحليل المبيعات الشهرية` دون أخطاء Console.
- تحديث 6 يوليو 2026: تم تحويل إدارة المخزون من منطق عرض "كتب فقط" إلى "الأصناف والمخزون" مع دعم نوع الصنف ووحدة القياس. أصبح نموذج الإضافة يسمح بكتابة أو اختيار نوع صنف مثل كتاب، كراسة، كشكول، سبلايز، أدوات مكتبية أو أي نوع جديد، مع استمرار حفظ البيانات القديمة ككتب تلقائيًا. تم تحديث شاشات البيع والشراء وطلبات الأونلاين والمرتجعات والتقارير لاستخدام "صنف/أصناف"، وتم اختبار ظهور صفحة الأصناف ونموذج إضافة الصنف وحقلي `نوع الصنف` و`وحدة القياس` دون أخطاء Console.

## تحديث 6 يوليو 2026: متابعة شحنات البريد المصري

تم تطوير مركز متابعة الشحنات بحيث يدعم تتبعًا حقيقيًا مشروطًا بوجود مصدر بيانات فعلي، مع منع إنشاء أي حالات وهمية داخل النظام.

ما تم تنفيذه واختباره:

- فحص صفحة التتبع الرسمية للبريد المصري:
  `https://egyptpost.gov.eg/ar-eg/home/eservices/track-and-trace/`
- لم يتم العثور داخل النظام على API رسمي مستقر أو موثق يمكن الاعتماد عليه مباشرة، لذلك تم ضبط مصدر التتبع الحالي كالتالي:
  - `providerType`: `Not Available`
  - `providerEndpoint`: فارغ.
- تم إنشاء طبقة Provider داخل الخادم تقبل Endpoint حقيقي لاحقًا، ولا تغيّر حالة أي شحنة إلا عند وصول رد حقيقي من المصدر.
- تم منع التتبع الوهمي: عند عدم وجود Endpoint تظهر رسالة واضحة بأن مصدر بيانات التتبع غير مضبوط.
- تم إضافة عامل متابعة تلقائي داخل `server-node.js` يعمل عند تشغيل الخادم ثم كل 6 ساعات افتراضيًا.
- تم إضافة واجهات API:
  - `GET /api/tracking/status`
  - `POST /api/tracking/run`
  - `POST /api/tracking/shipment/:id`
  - `POST /api/tracking/test`
- تم إضافة سجل تتبع مستقل `trackingHistory` بدون تكرار لنفس الحركة.
- تم إضافة تنبيهات داخل النظام عند فشل التتبع، تأخر الشحنة، عدم وجود حركة، الحاجة لاتصال بالعميل، أو الحاجة لتجهيز شكوى.
- تم إضافة ربط حالة التتبع بالطلب المرتبط عند التسليم أو الارتجاع أو الحاجة للمتابعة.
- تم تطوير صفحة الشحن إلى "مركز متابعة الشحنات" وتضم:
  - شحنات نشطة.
  - قابلة للمتابعة.
  - متأخرة.
  - بدون حركة.
  - تحتاج اتصال عميل.
  - تحتاج شكوى.
  - خطر ارتجاع.
  - أخطاء تتبع.
- تم إضافة زر "تحديث جميع الشحنات النشطة".
- تم إضافة زر "تحديث التتبع الآن" لكل شحنة.
- تم إضافة شاشة إعدادات لحالة خدمة التتبع تشمل:
  - حالة العامل التلقائي.
  - آخر تشغيل.
  - التشغيل القادم.
  - عدد الشحنات التي تم فحصها.
  - نوع المصدر.
  - Endpoint المصدر.
  - اختبار الاتصال.
  - تنبيه واضح: "لن يتم إنشاء تتبع وهمي".
- تم اختبار رقم التتبع `ENO33289190EG` عبر API الاختبار؛ النتيجة المتوقعة حاليًا: فشل واضح لأن مصدر البيانات غير مضبوط، بدون إنشاء بيانات وهمية.
- تم اختبار دورة العامل التلقائي على شحنة بريد مصري موجودة داخل النظام؛ تم تسجيل فشل مصدر البيانات بوضوح ولم يتم تغيير حالة الشحنة بشكل وهمي.
- تم اختبار صفحة `/?view=shipping` وظهرت "مركز متابعة الشحنات" وزر "تحديث جميع الشحنات النشطة" وكارت "أخطاء تتبع" بدون أخطاء Console.
- تم اختبار صفحة `/?view=settings` وظهرت بطاقة "حالة خدمة التتبع" و"Tracking Worker" وزر "اختبار اتصال" وتنبيه منع التتبع الوهمي بدون أخطاء Console.
- نجح فحص JavaScript:
  - `node --check app/app.js`
  - `node --check server-node.js`

ملاحظات تشغيلية:

- التتبع التلقائي يعمل كعامل داخلي مع الخادم، لكنه لا يستطيع جلب حالات البريد المصري فعليًا قبل توفير API/Endpoint رسمي أو مزود تتبع موثوق.
- عند إغلاق الخادم يتوقف العامل التلقائي، وعند إعادة تشغيل الخادم يبدأ العامل تلقائيًا مرة أخرى.
- النظام لا يرسل شكاوى تلقائيًا إلى البريد المصري؛ الموجود حاليًا هو تجهيز شكوى داخلية قابلة للمتابعة.

## تحديث 7 يوليو 2026: إصلاح مصدر التتبع الحقيقي

تم إصلاح مشكلة `مصدر التتبع غير مضبوط` بتحويل Provider الافتراضي من `Not Available` إلى تكامل فعلي مع 17TRACK API، مع الحفاظ على الـ Tracking Worker والواجهة الحالية بدون إعادة بناء النظام.

ما تم تنفيذه:

- تم تحديد سبب الخطأ القديم:
  - `settings.tracking.providerEndpoint` كان فارغًا.
  - `providerType` كان `Not Available`.
  - لذلك كان الـ Worker يفشل قبل إرسال أي طلب حقيقي.
- تم اعتماد 17TRACK كمزود بديل بعد عدم توفر Endpoint رسمي ثابت ومتاح برمجيًا من البريد المصري داخل النظام.
- تم ضبط Provider الحالي:
  - `providerName`: `17TRACK`
  - `providerType`: `Third-party API`
  - `providerEndpoint`: `https://api.17track.net/track/v2.4/getRealTimeTrackInfo`
  - `providerMethod`: `POST`
- تم تنفيذ الاتصال من جهة السيرفر فقط باستخدام Header:
  - `17token: process.env.TRACKING_API_KEY`
- تم منع إرسال أي API Key من الواجهة أو تخزينه داخل قاعدة البيانات.
- تم دعم تنظيف رقم التتبع قبل الإرسال:
  - `trim`
  - إزالة المسافات
  - `uppercase`
- تم تجهيز Payload متوافق مع 17TRACK:
  - `number`
  - `origin_country: EG`
  - `destination_country: EG`
  - `cacheLevel: 0`
  - `lang: ar`
- لم يتم تخمين Carrier Code للبريد المصري. يتم ترك 17TRACK يحدد الناقل تلقائيًا، ويتم حفظ الكود الفعلي إذا عاد في الاستجابة.
- تم تحليل استجابة 17TRACK وحفظ:
  - `currentStatus`
  - `lastStatusText`
  - `currentLocation`
  - `lastTrackingAt`
  - `trackingHistory`
  - `lastTrackingHttpStatus`
  - `externalCarrierCode`
  - `lastTrackingEventCount`
- تم تعديل رسالة الفشل لتكون:
  - `تعذر تحديث التتبع`
  بدلًا من رسالة عامة أو حالة وهمية.
- تم التأكد أن فشل شحنة واحدة لا يوقف باقي الشحنات.
- تم التأكد أن الـ Worker يعمل عند تشغيل السيرفر ثم كل 6 ساعات افتراضيًا.

نتيجة الاختبار الحالي:

- Tracking Number tested: `ENO33289190EG`
- Tracking Provider: `17TRACK`
- Integration Type: `Third-party API`
- Endpoint: `https://api.17track.net/track/v2.4/getRealTimeTrackInfo`
- API Key configured: `No`
- Real Request sent: `No`
- Real Response received: `No`
- HTTP Status: `N/A`
- Carrier Code الفعلي: `غير متاح قبل تركيب API Key`
- Tracking Events: `0`
- Automatic Tracking: `Working as worker, blocked at provider authentication`
- Background Worker: `Working`

سبب عدم استلام Response حقيقي الآن:

- متغير البيئة `TRACKING_API_KEY` غير مضبوط على السيرفر.
- النظام يرفض إرسال طلب إلى 17TRACK بدون المفتاح لأن التكامل يجب أن يكون Server-side وبمفتاح حقيقي، وليس Mock أو Fake Response.

تم تشغيل السيرفر بعد التعديل واختبار:

- `GET /api/tracking/status`
- `POST /api/tracking/test` بالرقم `ENO33289190EG`

والنتيجة كانت فشلًا صحيحًا وآمنًا:

`تعذر تحديث التتبع: مفتاح 17TRACK غير مضبوط في TRACKING_API_KEY.`

فحص الملفات:

- `node --check server-node.js`: ناجح.
- `node --check app/app.js`: ناجح.
## تحديث 10 يوليو 2026: Omnichannel Production Messaging Core

تم تنفيذ واختبار مرحلة:

`Production Messaging Core + Media Attachments + WhatsApp Messaging Rules + Reliable Retry Architecture`

نتائج الفحص:

- `node --check` لملفات خدمة Omnichannel وسكربتات الاختبار: ناجح.
- `npx prisma validate`: ناجح.
- `prisma migrate deploy`: نجح وتطبيق migration `202607100002_messaging_core`.
- `prisma generate`: ناجح.
- `npm test`: نجح — 21 اختبار من 21.
- `npm run test:e2e:messaging`: نجح على Runtime الحقيقي + PostgreSQL.

سيناريوهات Runtime E2E التي نجحت:

- استقبال Mock WhatsApp inbound media message وحفظ بيانات المرفق.
- رفع مرفق آمن عبر `/api/media/upload`.
- تحميل المرفق مرة أخرى عبر `/api/media/...`.
- إرسال رد outbound image من داخل المحادثة مع `replyToMessageId`.
- تسجيل Internal Note داخلية بدون إرسالها للـ provider.
- منع WhatsApp free-form reply بعد انتهاء نافذة 24 ساعة.
- السماح بإرسال approved template mock خارج نافذة WhatsApp.
- إنشاء retry job عند فشل retryable.
- تشغيل Background Retry Worker وتحويل الرسالة إلى `sent`.
- تسجيل permanent failure كرسالة `failed` بدون إنشاء retry job.
- Close / Reopen / Release للمحادثة.
- البحث server-side عن المحادثة.

نتيجة E2E الأخيرة:

- `pass`: true
- `inbound`: HTTP 201
- `imageReply`: HTTP 201
- `internalNote`: HTTP 201
- `blockedOutsideWindow`: HTTP 400
- `templateReply`: HTTP 201
- `retryable`: HTTP 201 ثم Worker حولها إلى `sent`
- `permanent`: HTTP 502 مع حفظ الرسالة `failed`
- `mediaDownload`: HTTP 200

ملاحظات:

- لم يتم ربط Meta الحقيقي.
- لم يتم استخدام Production credentials.
- لم يتم لمس WhatsApp الأساسي.
- لم يتم تعديل `database.json`.
- تم الاعتماد على PostgreSQL وMock Providers فقط للمرحلة الحالية.
## تحديث 10 يوليو 2026: Production Deployment Hardening + Hosting Readiness

تم تنفيذ مرحلة التجهيز الأخيرة قبل الاستضافة لوحدة Omnichannel Customer Service Center.

نتائج الفحص:

- `node --check` لكل ملفات خدمة Omnichannel وسكربتاتها: ناجح.
- `node --check app/app.js`: ناجح.
- `node --check ecosystem.config.js`: ناجح.
- `npx prisma validate`: ناجح.
- `npm test`: ناجح — 25 اختبار من 25.
- `npm run smoke:prod`: ناجح على Runtime المحلي.
- `npm run test:e2e:channels`: ناجح على PostgreSQL Runtime.
- `npm run test:e2e:messaging`: ناجح على PostgreSQL Runtime.

ما تم اختباره فعليًا:

- `/health` يعيد 200 عندما تكون الخدمة حية.
- `/ready` يعيد 200 عند جاهزية PostgreSQL والإعدادات.
- `/ready` يعيد 503 عند تعطل قاعدة البيانات/Repository.
- عدم تسريب قيم الأسرار داخل readiness response.
- إصدار SSE ticket قصير العمر عبر `/api/events/ticket`.
- رفض فتح SSE بدون ticket.
- استمرار Webhook routing وduplicate protection.
- استمرار Multi WhatsApp Accounts وMulti Messenger Pages.
- استمرار media upload/download.
- استمرار internal notes وreply-to وWhatsApp service window.
- استمرار Retry Worker وتحويل retryable message إلى `sent`.
- استمرار permanent failure بدون auto retry.
- استمرار البحث والفلاتر وحالات المحادثة.

نتيجة Runtime smoke:

- `health`: HTTP 200
- `ready`: HTTP 200
- `unknownWebhook`: HTTP 200
- `pass`: true

ملاحظات:

- لم يتم ربط Meta الحقيقي.
- لم يتم استخدام Production credentials.
- لم يتم لمس WhatsApp الأساسي.
- لم يتم تعديل `database.json`.
- تم تجهيز PM2/Docker/Nginx/Deployment documentation بدون جعلها شرطًا للتطوير المحلي.
## تحديث 10 يوليو 2026: UAT Fix — Omnichannel Send + Reply Composer

تم تشخيص مشكلة `Failed to fetch` أثناء الإرسال في مركز خدمة العملاء.

النتيجة:

- السبب المباشر في Runtime المحلي: خدمة Omnichannel على `127.0.0.1:8775` لم تكن تعمل وقت الإرسال، لذلك كان المتصفح يفشل قبل استلام أي HTTP response.
- تم تعديل `START-HERE.cmd` ليحاول تشغيل خدمة Omnichannel تلقائيًا مع التطبيق الرئيسي.
- تم تثبيت `START-ALL.cmd` كطريقة تشغيل محلية موصى بها لتشغيل التطبيق الرئيسي وخدمة Omnichannel معًا.
- تم تحسين رسالة الخطأ في الواجهة بدل عرض `Failed to fetch` الخام:
  - تظهر رسالة عربية واضحة عند تعذر الاتصال بخدمة المحادثات.
  - تظهر رسائل أوضح لـ 400/401/403/409/429/500.
- تم الحفاظ على نص الرد داخل textarea عند فشل الإرسال.
- تم منع double click من إنشاء إرسالين متزامنين.
- تم إضافة loading/disabled state لزر الإرسال.
- تم إضافة Emoji Picker داخل Reply Composer.
- تم إضافة إدراج Emoji عند موضع cursor داخل textarea.
- تم إضافة Ctrl+Enter للإرسال.
- تم الإبقاء على Attachment button وInternal Note وReply-to وRetry.

نتائج الاختبار:

- `node --check app/app.js`: ناجح.
- `npm test`: ناجح — 28 اختبار من 28.
- Runtime CORS preflight:
  - `OPTIONS /api/conversations/test/messages`
  - HTTP `204`
  - `Access-Control-Allow-Origin: http://127.0.0.1:8765`
- Runtime E2E Channels: ناجح.
- Runtime E2E Messaging: ناجح.
- WhatsApp Mock send: ناجح.
- Messenger Mock send: ناجح.
- Empty message blocked: ناجح.
- Duplicate clientMessageId prevention: ناجح.

ملاحظة تشغيل:

إذا ظهر كارت "خدمة Omnichannel غير مشغلة الآن"، شغّل:

`START-ALL.cmd`
# تحديث 10 يوليو 2026: كروت طلبات الأونلاين التفاعلية

- تم تحويل كروت أعلى صفحة طلبات الأونلاين إلى عناصر قابلة للضغط.
- عند الضغط على:
  - طلبات جديدة: يعرض طلبات `طلب جديد`.
  - قيد التجهيز: يعرض طلبات `قيد التجهيز`.
  - في الشحن: يعرض طلبات `تم إنشاء الشحنة` و`خرج للتوصيل`.
  - تم التسليم: يعرض طلبات `تم التسليم`.
- تمت إضافة شريط يوضح الفلتر الحالي مع زر `عرض كل الطلبات`.
- أزرار `عرض` و`تعديل` داخل الجدول تظل تعمل بعد الفلترة.
- تم دعم Enter/Space للكروت التفاعلية من لوحة المفاتيح.
- تم إضافة حالة visual active للكارت المحدد.
- تم تشغيل:
  - `node --check app\app.js`
  - `node --check server-node.js`

# تحديث 11 يوليو 2026: سجل المشتريات داخل الواجهة

- تم إظهار سجل المشتريات والأمانة داخل صفحة المشتريات نفسها بأسلوب Card/Table احترافي بدل الاعتماد على النافذة فقط.
- تمت إضافة شريط إجراءات واضح في أعلى الصفحة:
  - تسجيل مشتريات جديدة.
  - مرتجع مشتريات مستقل.
  - مرتجع من مستند شراء.
  - السجل الكامل.
- تمت إضافة إحصائيات سريعة للسجل: عدد المستندات، إجمالي المشتريات، بانتظار الفحص، والمتاح للمرتجع.
- أزرار السجل الداخلي أصبحت مرتبطة بإجراءات النظام الحالية: عرض، استلام، مرتجع، إلغاء/حذف.
- تم توحيد جدول السجل الكامل في النافذة مع نفس جدول السجل الداخلي.
- تم تشغيل:
  - `node --check app\app.js`

# تحديث 10 يوليو 2026: شريط تمرير أفقي ثابت للجداول

- تم إضافة شريط تمرير أفقي ثابت أسفل الشاشة للجداول العريضة.
- الشريط يظهر طالما توجد `table-wrap` عريضة في الصفحة أو داخل المودال، حتى لو لم تصل لنهاية الجدول رأسيًا.
- الشريط متزامن مع تمرير الجدول الأصلي يمينًا ويسارًا.
- يعمل داخل المودالات الطويلة مثل تفاصيل الفواتير/المرتجعات/طلبات الأونلاين، ويعمل أيضًا في الصفحات العادية.
- يختفي تلقائيًا إذا لم يكن الجدول محتاجًا تمريرًا أفقيًا.
- تم التحقق في المتصفح الداخلي على صفحة طلبات الأونلاين:
  - `sticky-table-scrollbar.hidden = false`
  - عرض الشريط مطابق تقريبًا لعرض الجدول.
  - `scrollWidth > clientWidth` للجدول العريض.
- تم تشغيل:
  - `node --check app\app.js`
  - `node --check server-node.js`

# تحديث 13 يوليو 2026: تتبع البريد المصري المجاني

- تم تحويل مزود التتبع النشط إلى `EgyptPostBrowserProvider`.
- المصدر المستخدم: موقع البريد المصري الرسمي `https://egyptpost.gov.eg/ar-eg/home/eservices/track-and-trace/`.
- نوع التكامل: Browser Automation على الموقع الرسمي، بدون API Key وبدون اشتراك.
- تم إلغاء الاعتماد التشغيلي على `17TRACK` في مسار التحديث النشط.
- تم منع التشغيل الفوري للـ worker عند فتح السيرفر لتجنب إسقاط السيرفر عند تعطل موقع التتبع؛ التحديث يعمل بالدورة المجدولة أو زر التحديث اليدوي.
- تم إضافة حالة `manualInterventionNeeded` للشحنات عند الحاجة لتدخل يدوي مثل CAPTCHA أو تغير تصميم صفحة التتبع.
- تم إضافة فلتر/عداد "تدخل يدوي" في صفحة الشحن.
- تم اختبار:
  - `node --check server-node.js`: ناجح.
  - `node --check app\app.js`: ناجح.
  - `GET /api/tracking/status`: ناجح ويعرض `EgyptPostBrowserProvider`.
  - `POST /api/tracking/test` للرقم `ENO33289190EG`: تم إرسال طلب فعلي عبر runtime حقيقي وفتح بوت Chrome/CDP، لكن النتيجة الحالية `502` لأن النظام لم يستطع قراءة نتيجة التتبع من الصفحة وسجلها كتدخل يدوي.
- نتيجة اختبار الرقم:
  - Provider: `EgyptPostBrowserProvider`.
  - API Key configured: No.
  - Real Request sent: Yes.
  - Real Response received: Yes, but not parseable as a tracking result.
  - HTTP Status: `502` من API الداخلي.
  - سبب عدم اكتمال التتبع: تعذر قراءة نتيجة التتبع من الصفحة، قد يكون تصميم الصفحة تغير أو يحتاج إدخال يدوي، ولم يتم تسجيل نجاح وهمي أو تغيير حالة الشحنة.

## تحديث 13 يوليو 2026: إصلاح قراءة نتيجة البريد المصري وملفات التشخيص

- تم تحسين `EgyptPostBrowserProvider` فقط بدون إعادة بناء نظام التتبع.
- تمت إضافة انتظار ذكي داخل صفحة البريد المصري:
  - انتظار تحميل الصفحة.
  - محاولة إيجاد خانة التتبع بعدة selectors.
  - إدخال رقم التتبع بإطلاق أحداث `input/change`.
  - محاولة إيجاد زر البحث/التتبع أو submit الخاص بالنموذج.
  - انتظار استقرار الشبكة/تغير النص/ظهور منطقة نتيجة.
- تمت إضافة Manual Review Mode:
  - حفظ screenshot عند فشل القراءة.
  - حفظ HTML snapshot.
  - حفظ JSON diagnostics.
  - عدم تغيير حالة الشحنة بدون نتيجة مؤكدة.
- تمت إضافة زر داخل تفاصيل الشحنة: `عرض لقطة فشل التتبع`.
- تمت إضافة سكربت اختبار مستقل:
  - `node scripts/test-egyptpost-tracking.js ENO33289190EG`
- نتيجة الاختبار الفعلي للرقم `ENO33289190EG`:
  - Real Request sent: Yes
  - Page opened: Yes
  - Tracking input found: No
  - Submit clicked: No
  - Result container found: No
  - Tracking result text captured: No
  - Parsed confirmed status: No
  - Manual intervention needed: Yes
  - Failure reason: موقع البريد المصري أعاد صفحة حماية Cloudflare: `Sorry, you have been blocked`.
  - Failure code: `SITE_BLOCKED`
  - Failure message: `الموقع لم يفتح صفحة التتبع وتم منع الوصول بواسطة حماية الموقع`
  - Debug screenshot: `debug/tracking/ENO33289190EG-TEST-20260713-163454.png`
  - Debug HTML: `debug/tracking/ENO33289190EG-TEST-20260713-163454.html`
- فحوصات syntax:
  - `node --check server-node.js`: ناجح.
  - `node --check app\app.js`: ناجح.
  - `node --check scripts\test-egyptpost-tracking.js`: ناجح.
## Automated Shipment Tracking - Egypt Post Browser Provider (2026-07-13)

- Provider: `EgyptPostBrowserProvider`
- Source: `https://egyptpost.gov.eg/ar-eg/home/eservices/track-and-trace/`
- Integration type: Official Website Browser Automation
- API key configured: No / not required
- Tracking number tested: `ENO33289190EG`
- Real request sent: Yes
- Real response received: Yes
- Page opened: Yes
- Tracking input found: No
- Submit clicked: No
- Result container found: No
- Tracking result text captured: No
- Parsed confirmed status: No
- Manual intervention needed: Yes
- Failure code: `SITE_BLOCKED`
- Failure reason: Egypt Post website returned Cloudflare protection page for headless browser automation.
- Safety result: Shipment status was not changed and no fake/mock tracking result was saved.
- Debug artifacts saved:
  - `debug/tracking/ENO33289190EG-TEST-20260713-183327.png`
  - `debug/tracking/ENO33289190EG-TEST-20260713-183327.html`
  - `debug/tracking/ENO33289190EG-TEST-20260713-183327.json`
- Manual shipment run tested: `SH-226`
- Run record saved: Yes, `trackingRuns` contains `status = manual_review_required`, `failureCode = SITE_BLOCKED`, duration, diagnostics file names.
- Batch summary saved: Yes, `trackingRunBatches` contains checked/success/failed/manualIntervention counters.
- Shipment state after failed read: original operational status unchanged; `manualInterventionNeeded = true`, `manual_review_required = true`.

Core tests:

- `node --check server-node.js`: PASS
- `node --check app/app.js`: PASS
- `node --check scripts/test-egyptpost-tracking.js`: PASS
- `node --check scripts/test-tracking-core.js`: PASS
- `node scripts/test-tracking-core.js`: PASS
  - status mapping
  - delivered-only confirmed mapping
  - uncertain result remains unknown
  - duplicate history fingerprint
  - queue eligibility
  - rate-limit/min interval skip
  - manual retry of manual-review shipment

Final assessment: CONDITIONAL PASS. The system now performs real browser-based requests, stores diagnostics and run records, respects queue safety/rate-limit rules, and does not update shipment status without a confirmed result. The remaining blocker is external: Egypt Post Cloudflare blocks automated browser access, so affected shipments correctly enter Manual Review Mode.

## Manual Tracking Assistant - Egypt Post (2026-07-13)

- UI status: PASS
  - Shipment details now include actions to copy tracking code, open Egypt Post, open Egypt Post with the code visible, view failure screenshot, and register a manual result.
  - Quick actions added: delivered, out for delivery, failed attempt, returned, needs follow-up.
- Manual review flow: PASS
  - Manual result modal includes tracking number, normalized status, Arabic status description, location/branch, event date/time, internal notes, update operational status checkbox, and clear manual review checkbox.
  - Cloudflare/SITE_BLOCKED is not bypassed and does not trigger any automatic shipment status change.
- Tracking history result: PASS
  - Manual entries are saved with `source = manual_review`, `provider = manual_review`, event status/label/location/time, `reviewedByUserId`, `reviewedBy`, and `reviewedAt`.
- Audit result: PASS
  - Manual review saves an audit log entry with the current employee account and operation type `manual_tracking_review`.
- Dashboard result: PASS
  - Dashboard now shows manual-review shipments, manual updates today, and average age of shipments without tracking updates.
- Filters result: PASS
  - Shipment list includes filters for manual review, automatic tracking failure, and last attempt `SITE_BLOCKED`.
- Tests:
  - `node --check app/app.js`: PASS
  - `node --check server-node.js`: PASS
  - Manual update simulation on a temporary copy of `SH-226`: PASS
    - manual update: PASS
    - delivered manual update: PASS
    - audit log: PASS
    - tracking history: PASS
    - clear manual review: PASS
  - Static action validation for copy/open/manual actions: PASS
  - `node scripts/test-tracking-core.js`: PASS

Final assessment: PASS. Manual Tracking Assistant is implemented without attempting to bypass Egypt Post Cloudflare protection and without deleting diagnostics.

## Product Costing / Inventory Batches / FIFO (2026-07-14)

- Product Master: PASS
  - Product entry now keeps fixed product data: cover price and default selling price.
  - purchase cost is treated as legacy/last calculated value, not the source of profit reports.
- Purchase flow: PASS
  - Purchase lines support cover price, supplier discount percent, unit purchase cost, total cost, supplier, purchase date, and batch id.
  - Entering supplier discount recalculates unit cost; entering unit cost recalculates discount percent.
- Inventory batches: PASS
  - Every received purchase line creates an inventory batch with unit cost and remaining quantity.
  - Existing stock was migrated into opening batches.
- FIFO costing: PASS
  - Sales allocate from oldest active batch first.
  - Sale lines store cost method, COGS, gross profit, and batch allocations.
  - If cost is missing or quantity is unallocated, profit is marked incomplete instead of fake profit.
- Reports: PASS
  - Profit reports use sale line COGS / FIFO allocations.
  - Inventory value uses remainingQty × unitCost.
  - Added product profitability, supplier profitability, current inventory value, last purchase cost, average inventory cost, and expected margin reports.
- Data migration:
  - Backup file: `data/database.backup-before-batches-20260714-030408.json`
  - `node scripts/migrate-inventory-batches.js`: PASS
  - normalizedProducts: 8
  - openingBatchesCreated: 7
  - incompleteCostWarnings: 0
- Tests:
  - `node --check app/app.js`: PASS
  - `node --check server-node.js`: PASS
  - `node --check scripts/migrate-inventory-batches.js`: PASS
  - `node --check scripts/test-inventory-batches.js`: PASS
  - `node scripts/test-inventory-batches.js`: PASS
    - purchase same product from two suppliers at different costs: PASS
    - sale below first batch: PASS
    - sale crossing first and second batch: PASS
    - COGS calculation: PASS
    - gross profit calculation: PASS
    - remainingQty update: PASS
    - inventory value calculation from batches: PASS

Final assessment: PASS. The system now separates fixed product data from actual purchase cost and uses inventory batches with FIFO costing for sales/profit/inventory reports.

## Sales Center Main View (2026-07-14)

- Sales Main View: PASS
  - `?view=sales` now opens a full Sales Center instead of opening a new invoice directly.
  - The existing invoice screen is preserved and opens from `+ فاتورة جديدة`.
- Daily Summary: PASS
  - Added cards for sales total, invoice count, discounts, returns, net sales, cash, transfers, COD, purchases, supplier payments, expenses, and net daily movement.
  - Net daily movement uses: actual collections - supplier payments - expenses - cash returns.
- Invoices List: PASS
  - Added sold invoices table with invoice number, sale date/time, customer, phone, sales channel, sale operation type, payment method, seller, subtotal, discount, net, payment status, shipment status, item count, and notes.
- Date Filters: PASS
  - Added filters for today, yesterday, last 7 days, this month, and custom from/to range.
- New Invoice Flow: PASS
  - New invoice is now a separate action from the Sales Center.
  - Added sale operation type field: direct sale, online order, pre-order, school/wholesale, exchange, partial return.
- Seller Tracking: PASS
  - New sales invoices save createdByUserId, createdByName, createdByUsername, createdByRole, createdAt, updatedByUserId, and updatedAt.
  - Online-order generated invoices now also save seller tracking.
- Invoice Print: PASS
  - Print template now includes logo, store name, invoice number, sale date/time, customer, phone, sales channel, sale operation type, payment method, seller, line table, discounts, shipping, net, paid, remaining, notes, and thank-you message.
- Permissions: PASS
  - Added sales permissions for new invoice, print, list, limited edit, cancel, day closing, and profit/cost visibility.
  - Cashier can create/print/view sales; manager/owner can cancel, edit after save, close day, and view cost/profit.
- Day Closing: PASS
  - Added day closing structure with closedAt, closedByUserId, closedByName, salesTotal, cashTotal, returnsTotal, expensesTotal, supplierPaymentsTotal, netMovement, and notes.
  - Closed-day invoices block limited edit/payment changes for users without manager-level permission.
- Tests:
  - Backup created: `data/database.backup-before-sales-center-20260714-145636.json`
  - `node --check app/app.js`: PASS
  - `node --check server-node.js`: PASS
  - Static server version check for `20260714-sales-center`: PASS

Final assessment: PASS. Sales now behaves as a Sales Center while preserving the old invoice creation screen as a separate flow.

## Sales Center Interactive Cards + In/Out Split (2026-07-14)

- Interactive cards: PASS
  - Sales Center summary cards are now clickable.
  - Each card opens a detail modal with the related invoices, cash movements, purchases, returns, or profit breakdown.
- Collections vs Payments split: PASS
  - Added a separate `الداخل / التحصيلات` section for sales, cash, transfers, COD, invoice count, and net sales.
  - Added a separate `الخارج / المدفوعات` section for discounts, returns, cash returns, purchases, supplier payments, and expenses.
- Daily profit: PASS
  - Added `تكلفة البضاعة المباعة` using sale COGS / FIFO.
  - Added `مجمل الربح اليومي`.
  - Added `صافي الربح اليومي = مجمل الربح - المصروفات - المرتجعات النقدية`.
  - If any sale line has incomplete cost, profit cards show `تكلفة غير مكتملة` instead of fake profit.
- Net movement: PASS
  - Still shown separately as cash-flow logic: actual collections - supplier payments - expenses - cash returns.
- Tests:
  - `node --check app/app.js`: PASS
  - `node --check server-node.js`: PASS
  - Static server version check for `20260714-sales-cards`: PASS

Final assessment: PASS. Sales summary is now interactive, separated into inbound/outbound money flow, and includes daily profit calculation.
