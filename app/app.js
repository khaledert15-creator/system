const STORAGE_KEY = "dotcom-books-erp-v2-fallback";
const SESSION_KEY = "dotcom-books-session";
const PURCHASE_DRAFT_KEY = "dotcom-purchase-draft-v1";
const EGYPT_GOVERNORATES = [
  "القاهرة", "الجيزة", "الإسكندرية", "الدقهلية", "البحر الأحمر", "البحيرة", "الفيوم",
  "الغربية", "الإسماعيلية", "المنوفية", "المنيا", "القليوبية", "الوادي الجديد", "السويس",
  "أسوان", "أسيوط", "بني سويف", "بورسعيد", "دمياط", "الشرقية", "جنوب سيناء",
  "كفر الشيخ", "مطروح", "الأقصر", "قنا", "شمال سيناء", "سوهاج"
];
const DEFAULT_SHIPPING_COMPANIES = ["بوسطة", "Mylerz", "Aramex", "البريد المصري", "مندوب داخلي"];
const DEFAULT_CASH_ACCOUNTS = ["الخزينة الرئيسية", "البنك الأهلي", "InstaPay", "المحافظ الإلكترونية"];
const DEFAULT_EXPENSE_TYPES = ["تكلفة شحن البريد المصري","عمولة تحصيل البريد المصري","تكلفة مرتجع","تغليف وأكياس","إعلانات وتسويق","رواتب وأجور","إيجار","اتصالات وإنترنت","استضافة وبرامج","أدوات مكتبية","صيانة","نقل ومواصلات","مصروفات بنكية","مصروفات أخرى"];
const DEFAULT_INCOME_TYPES = ["تعويض من شركة شحن","عمولة من مورد","خدمات إضافية","بيع مواد أو كراتين","إيراد متنوع"];
const EGYPT_POST_TRACKING_URL = "https://egyptpost.gov.eg/ar-eg/home/eservices/track-and-trace/";
const TRACKING_PROVIDER_NAME = "EgyptPostBrowserProvider";
let serverConnected = false;
let saveQueue = Promise.resolve();
let sessionToken = sessionStorage.getItem(SESSION_KEY) || "";
let currentUser = null;
let dbRevision = "";
let saveConflict = false;
let lastSuccessfulSaveAt = "";
let lastSaveError = null;
let purchaseRetryState = null;
let purchaseOtherTabDetected = false;
let systemTabChannel = null;
const SYSTEM_TAB_ID = globalThis.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random()}`;

const ROLE_VIEWS = {
  "مالك": ["dashboard","books","sales","onlineOrders","purchases","returns","parties","shipping","accounting","reports","hr","omnichannel","settings"],
  "مدير": ["dashboard","books","sales","onlineOrders","purchases","returns","parties","shipping","accounting","reports","hr","omnichannel","settings"],
  "محاسب": ["dashboard","books","sales","onlineOrders","purchases","returns","parties","accounting","reports"],
  "كاشير": ["dashboard","sales","onlineOrders","returns","parties","omnichannel"],
  "مخزن": ["dashboard","books","onlineOrders","purchases","returns","shipping"],
  "شحن": ["dashboard","onlineOrders","shipping","omnichannel"]
};
const ACTION_ROLES = {
  "delete-book": ["مالك","مدير"], "delete-party": ["مالك","مدير"], "delete-shipment": ["مالك","مدير"],
  "cancel-sale": ["مالك","مدير"], "edit-sale-payment": ["مالك","مدير","محاسب"], "close-sales-day": ["مالك","مدير"],
  "view-sales-profit": ["مالك","مدير","محاسب"], "limited-edit-sale": ["مالك","مدير"],
  "delete-cash": ["مالك","مدير","محاسب"], "delete-employee": ["مالك","مدير"],
  "save-settings": ["مالك","مدير"], "restore-db": ["مالك","مدير"], "backup-db": ["مالك","مدير","محاسب"],
  "manage_seasons": ["مالك"], "purge_demo_data": ["مالك"], "factory_reset_system": ["مالك"],
  "open-factory-reset": ["مالك"], "factory-reset-preview": ["مالك"], "factory-reset-prepare": ["مالك"], "factory-reset-execute": ["مالك"],
  "audit-log": ["مالك","مدير","محاسب"], "add-cash-in": ["مالك","مدير","محاسب"],
  "view-item-cost-profit": ["مالك","مدير","محاسب"], "allow-negative-stock": ["مالك"], "export-audit-log": ["مالك","مدير","محاسب"],
  "view-best-customers": ["مالك","مدير","محاسب"], "view-best-suppliers": ["مالك","مدير","محاسب"],
  "add-cash-out": ["مالك","مدير","محاسب"], "add-employee": ["مالك","مدير"],
  "add-expense": ["مالك","مدير","محاسب"], "approve-expense": ["مالك","مدير","محاسب"],
  "add-other-income": ["مالك","مدير","محاسب"], "approve-other-income": ["مالك","مدير","محاسب"],
  "create-settlement": ["مالك","مدير","محاسب"], "approve-settlement": ["مالك","مدير"],
  "finance.collection.view": ["مالك","مدير","محاسب","شحن"], "finance.collection.create": ["مالك","مدير","محاسب","شحن"],
  "finance.collection.settle": ["مالك","مدير"], "finance.collection.reverse": ["مالك","مدير"],
  "manage-finance-types": ["مالك","مدير"], "reverse-financial-transaction": ["مالك","مدير"],
  "view-financial-reports": ["مالك","مدير","محاسب"], "approve-settlement-difference": ["مالك","مدير"],
  "add-cash-account": ["مالك","مدير"], "edit-cash-account": ["مالك","مدير"],
  "customize-role": ["مالك","مدير"], "customize-user": ["مالك","مدير"],
  "show-tracking-debug": ["مالك","مدير"],
  "omni-refresh": ["مالك","مدير","كاشير","شحن"], "omni-open": ["مالك","مدير","كاشير","شحن"],
  "omni-claim": ["مالك","مدير","كاشير","شحن"], "omni-send": ["مالك","مدير","كاشير","شحن"],
  "omni-simulate-whatsapp": ["مالك","مدير"], "omni-simulate-messenger": ["مالك","مدير"]
  ,"order.quick.create":["مالك","مدير","كاشير"],"order.quick.confirm":["مالك","مدير","كاشير"],"order.quick.edit":["مالك","مدير","كاشير"],
  "order.discount.override":["مالك","مدير"],"order.payment.receive":["مالك","مدير","كاشير"],
  "order.prepare":["مالك","مدير","مخزن"],"order.pack":["مالك","مدير","مخزن"],"order.shipping":["مالك","مدير","شحن"]
};

const ROLE_DEFINITIONS = [
  { id: "مالك", label: "المالك", scope: "كامل النظام والتقارير والأرباح" },
  { id: "مدير", label: "مدير النظام", scope: "المستخدمون والإعدادات وكل العمليات" },
  { id: "محاسب", label: "محاسب", scope: "القيود والخزائن والعملاء والموردون" },
  { id: "كاشير", label: "بائع / كاشير", scope: "إنشاء مبيعات وطلبات دون صلاحيات إدارية" },
  { id: "مخزن", label: "أمين مخزن", scope: "المخزون والمشتريات والمرتجعات والشحن" },
  { id: "شحن", label: "مسؤول الشحن", scope: "الشركات والشحنات والتتبع" }
];

const VIEW_DEFINITIONS = [
  ["dashboard", "لوحة المتابعة", "عرض المؤشرات والتنبيهات"],
  ["books", "الأصناف والمخزون", "كتب، سبلايز، كراسات، كشاكيل، باركود، جرد ومخزون"],
  ["sales", "المبيعات", "فواتير البيع ونقطة البيع"],
  ["onlineOrders", "طلبات الأونلاين", "طلبات المتجر والتحويل لفاتورة وشحنة"],
  ["purchases", "المشتريات والأمانة", "مستندات الشراء والأمانة والاستلام"],
  ["returns", "المرتجعات", "مرتجع المبيعات والمشتريات"],
  ["parties", "العملاء والموردون", "الحسابات وكشوف الأطراف"],
  ["shipping", "الشحن والتوصيل", "الشحنات وشركات الشحن والتتبع"],
  ["accounting", "المالية", "المصروفات والإيرادات والتسويات والخزائن"],
  ["reports", "التقارير والتحليلات", "التقارير والتصدير والطباعة"],
  ["hr", "الموظفون والرواتب", "الموظفون والحضور والرواتب"],
  ["omnichannel", "مركز خدمة العملاء", "Inbox موحد للمحادثات والقنوات"],
  ["settings", "الإعدادات والصلاحيات", "إدارة الإعدادات والنسخ والصلاحيات"]
];

const PERMISSION_ACTIONS = [
  ["الأصناف والمخزون", [["add-book","إضافة صنف"],["view-book","عرض صنف"],["view-item-movement","عرض كشف حركة الصنف"],["view-item-cost-profit","عرض تكلفة/ربحية الصنف"],["allow-negative-stock","السماح بالبيع فوق الرصيد"],["edit-book","تعديل صنف"],["delete-book","حذف صنف"],["adjust-stock","تسوية مخزون"],["stock-count","جرد المخزون"]]],
  ["المبيعات", [["new-sale-invoice","فاتورة جديدة"],["add-sale-line","إضافة صنف للفاتورة"],["reset-sale","تفريغ الفاتورة"],["save-sale","حفظ فاتورة بيع"],["show-sales-list","عرض فواتير البيع"],["print-sale","طباعة فاتورة بيع"],["register-sale-customer","تسجيل عميل من الفاتورة"],["edit-sale-payment","تعديل/تحصيل فاتورة"],["limited-edit-sale","تعديل محدود لفاتورة"],["cancel-sale","إلغاء فاتورة بيع"],["close-sales-day","قفل اليومية"],["print-sales-day","طباعة تقرير اليوم"],["view-sales-profit","عرض أرباح وتكلفة المبيعات"]]],
  ["طلبات الأونلاين", [["online-order-stat","فلترة الطلبات من المربعات"],["add-online-order","إضافة طلب أونلاين"],["view-online-order","عرض طلب أونلاين"],["edit-online-order","تعديل طلب أونلاين"],["convert-order-sale","إنشاء فاتورة من الطلب"],["create-order-shipment","إنشاء شحنة من الطلب"],["print-online-order","طباعة طلب أونلاين"],["order.quick.create","إنشاء طلب واتساب سريع"],["order.quick.confirm","تأكيد طلب واتساب"],["order.quick.edit","تعديل طلب واتساب"],["order.discount.override","تعديل خصم النظام"],["order.payment.receive","تسجيل استلام دفعة"],["order.prepare","تجهيز الطلبات"],["order.pack","تغليف الطلبات"],["order.shipping","تسليم الطلب للشحن"]]],
  ["المشتريات", [["add-purchase-line","إضافة صنف شراء"],["save-purchase","حفظ مستند شراء"],["show-purchases-list","عرض مستندات الشراء"],["receive-purchase","اعتماد استلام مشتريات"],["delete-purchase","حذف مستند شراء"]]],
  ["المرتجعات", [["new-sale-return-customer","مرتجع مبيعات مستقل"],["new-purchase-return-supplier","مرتجع مشتريات مستقل"],["open-return-search","بحث المرتجعات"],["open-sale-return-list","مرتجع من فاتورة بيع"],["open-purchase-return-list","مرتجع من فاتورة شراء"],["start-sale-return","بدء مرتجع بيع"],["start-purchase-return","بدء مرتجع شراء"],["view-return","عرض مرتجع"],["print-return","طباعة مرتجع"]]],
  ["العملاء والموردون", [["add-customer","إضافة عميل"],["add-supplier","إضافة مورد"],["statement","كشف حساب"],["edit-party","تعديل عميل/مورد"],["delete-party","حذف عميل/مورد"],["party-voucher","إيصال طرف"],["view-party-voucher","عرض إيصال طرف"],["cancel-party-voucher","إلغاء إيصال طرف"]]],
  ["الشحن", [["view-shipment","عرض شحنة"],["update-shipment","تعديل شحنة"],["add-shipment-complaint","إضافة شكوى شحنة"],["manage-shipment-complaints","إدارة شكاوى الشحنة"],["delete-shipment","حذف شحنة"],["update-tracking-now","تتبع شحنة الآن"],["update-all-tracking","تتبع الشحنات النشطة"],["test-local-rpa","اختبار خدمة التتبع"],["retry-pending-tracking","إعادة محاولة مهام التتبع"],["show-tracking-debug","عرض بيانات تشخيص التتبع"],["shipping-companies","شركات الشحن"],["edit-shipping-company","تعديل شركة شحن"],["delete-shipping-company","حذف شركة شحن"]]],
  ["المالية", [["finance.collection.view","عرض تحصيل الأوردرات"],["finance.collection.create","تسجيل تحصيل لدى شركة الشحن"],["finance.collection.settle","استلام تحصيل في الخزنة"],["finance.collection.reverse","عكس تحصيل أوردر"],["add-expense","إضافة مصروف"],["approve-expense","اعتماد مصروف"],["add-other-income","إضافة إيراد آخر"],["approve-other-income","اعتماد إيراد آخر"],["create-settlement","إنشاء تسوية تحصيل"],["approve-settlement","اعتماد تسوية"],["approve-settlement-difference","اعتماد فرق تسوية"],["manage-finance-types","إدارة الأنواع المالية"],["reverse-financial-transaction","إنشاء قيد عكسي"],["view-financial-reports","عرض التقارير المالية"],["add-cash-in","قبض عام"],["add-cash-out","صرف عام"],["view-cash","تفاصيل حركة مالية"],["edit-cash","تعديل حركة مالية"],["delete-cash","حذف حركة مالية"],["add-cash-account","إضافة خزنة"],["edit-cash-account","تعديل خزنة"],["cash-transfer","تحويل بين الخزن"],["trial-balance","ميزان المراجعة"],["chart-accounts","دليل الحسابات"],["print-cash-daily","يومية الخزنة"]]],
  ["التقارير", [["open-report","فتح تقرير"],["export-report","تصدير CSV"],["view-best-customers","عرض تقرير أفضل العملاء"],["view-best-suppliers","عرض تقرير أفضل الموردين"],["whatsapp-report","تجهيز تقرير واتساب"],["print-statement","طباعة كشف حساب"],["print-voucher","طباعة إيصال"]]],
  ["مركز خدمة العملاء", [["omni-refresh","تحديث مركز خدمة العملاء"],["omni-open","فتح محادثة"],["omni-claim","استلام محادثة"],["omni-send","إرسال رد"],["omni-simulate-whatsapp","اختبار WhatsApp رقم 2"],["omni-simulate-messenger","اختبار Messenger"]]],
  ["الموظفون والإعدادات", [["add-employee","إضافة موظف"],["view-employee","عرض موظف"],["edit-employee","تعديل موظف"],["delete-employee","حذف موظف"],["save-settings","حفظ الإعدادات"],["backup-db","نسخة احتياطية"],["restore-db","استعادة نسخة"],["manage_seasons","إدارة المواسم"],["purge_demo_data","تنظيف البيانات التجريبية"],["factory_reset_system","إعادة ضبط النظام بالكامل"],["audit-log","سجل العمليات"],["export-audit-log","تصدير سجل العمليات"],["customize-role","تخصيص دور"],["customize-user","تخصيص مستخدم"]]]
];

const seed = {
  version: 3,
  governorates: EGYPT_GOVERNORATES,
  shippingCompanies: DEFAULT_SHIPPING_COMPANIES.map((name, index) => ({ id: `SC-${String(index + 1).padStart(3, "0")}`, name, active: true })),
  cashAccounts: DEFAULT_CASH_ACCOUNTS.map((name, index) => ({ id: `CA-${String(index + 1).padStart(3, "0")}`, name, openingBalance: 0, active: true })),
  settings: {
    companyName: "مكتبة دوت كوم",
    currency: "ج.م",
    seasonStart: 8,
    staleDays: 120,
    approvalDiscount: 20,
    allowNegativeStock: true,
    financialYear: "يناير – ديسمبر"
  },
  books: [
    { id: "B001", name: "المعاصر رياضيات 3 إعدادي", author: "", publisher: "المعاصر", category: "كتب دراسية", grade: "الثالث الإعدادي", shelf: "A-01", barcode: "DC100001", extraBarcode: "", cost: 118, price: 160, stock: 22, reorder: 8, supplierId: "S001", owned: true, lastSale: "2026-06-19" },
    { id: "B002", name: "الأضواء لغة عربية 6 ابتدائي", author: "", publisher: "نهضة مصر", category: "كتب دراسية", grade: "السادس الابتدائي", shelf: "A-03", barcode: "DC100002", extraBarcode: "", cost: 105, price: 145, stock: 6, reorder: 10, supplierId: "S002", owned: true, lastSale: "2026-06-18" },
    { id: "B003", name: "كتاب الامتحان كيمياء ثانوية عامة", author: "", publisher: "الامتحان", category: "كتب دراسية", grade: "الثالث الثانوي", shelf: "B-02", barcode: "DC100003", extraBarcode: "", cost: 170, price: 220, stock: 14, reorder: 6, supplierId: "S001", owned: false, returnDeadline: "2026-07-25", lastSale: "2026-06-14" },
    { id: "B004", name: "قواعد جارتين", author: "عمرو عبد الحميد", publisher: "عصير الكتب", category: "روايات", grade: "", shelf: "C-04", barcode: "DC100004", extraBarcode: "", cost: 112, price: 150, stock: 0, reorder: 5, supplierId: "S003", owned: true, lastSale: "2026-05-08" },
    { id: "B005", name: "أرض زيكولا", author: "عمرو عبد الحميد", publisher: "عصير الكتب", category: "روايات", grade: "", shelf: "C-04", barcode: "DC100005", extraBarcode: "", cost: 105, price: 140, stock: 11, reorder: 5, supplierId: "S003", owned: true, lastSale: "2026-03-01" }
  ],
  customers: [
    { id: "C001", name: "عميل نقدي", phone: "", governorate: "", city: "", address: "", type: "تجزئة", creditLimit: 0, balance: 0, points: 0 },
    { id: "C002", name: "مكتبة المستقبل", phone: "01000000001", governorate: "الجيزة", city: "", address: "", type: "جملة", creditLimit: 25000, balance: 6200, points: 0 },
    { id: "C003", name: "أحمد محمود", phone: "01000000002", governorate: "القاهرة", city: "", address: "", type: "تجزئة", creditLimit: 3000, balance: 450, points: 135 }
  ],
  suppliers: [
    { id: "S001", name: "دار المعارف للتوزيع", phone: "01010000001", creditLimit: 50000, balance: 17800, terms: 30 },
    { id: "S002", name: "نهضة مصر", phone: "01010000002", creditLimit: 75000, balance: 24100, terms: 45 },
    { id: "S003", name: "عصير الكتب", phone: "01010000003", creditLimit: 30000, balance: 9200, terms: 30 }
  ],
  sales: [
    { id: "INV-1048", date: "2026-06-20", customerId: "C001", channel: "تجزئة", payment: "نقدي", subtotal: 580, discount: 20, total: 560, status: "معتمدة", lines: [{ bookId: "B001", qty: 2, price: 160 }, { bookId: "B005", qty: 2, price: 140 }] },
    { id: "INV-1047", date: "2026-06-19", customerId: "C002", channel: "جملة", payment: "آجل", subtotal: 2100, discount: 210, total: 1890, status: "معتمدة", lines: [] }
  ],
  purchases: [
    { id: "PUR-312", date: "2026-06-18", supplierId: "S001", type: "شراء", total: 8240, status: "مستلمة" },
    { id: "PUR-311", date: "2026-06-17", supplierId: "S003", type: "أمانة", total: 4500, status: "مستلمة" }
  ],
  shipments: [
    { id: "SH-208", orderId: "INV-1047", company: "بوسطة", tracking: "BST-908173", customer: "مكتبة المستقبل", city: "الجيزة", cost: 75, status: "في الطريق", updated: "2026-06-20" },
    { id: "SH-207", orderId: "INV-1043", company: "Mylerz", tracking: "MY-551209", customer: "محمد علي", city: "القاهرة", cost: 65, status: "تم التسليم", updated: "2026-06-19" }
  ],
  cash: [
    { id: "TX-1", date: "2026-06-20", type: "قبض", account: "الخزينة الرئيسية", party: "مبيعات نقدية", amount: 560, note: "فاتورة INV-1048" },
    { id: "TX-2", date: "2026-06-20", type: "صرف", account: "الخزينة الرئيسية", party: "مصروف توصيل", amount: 120, note: "توصيلات اليوم" },
    { id: "TX-3", date: "2026-06-19", type: "قبض", account: "البنك الأهلي", party: "مكتبة المستقبل", amount: 3000, note: "تحصيل مديونية" }
  ],
  employees: [
    { id: "E001", name: "مدير النظام", role: "مالك", salary: 0, attendance: "حاضر", permissions: "كامل" },
    { id: "E002", name: "محمد حسن", role: "محاسب", salary: 8000, attendance: "حاضر", permissions: "الحسابات والمخزون" },
    { id: "E003", name: "أحمد سعيد", role: "بائع / كاشير", salary: 6500, attendance: "حاضر", permissions: "المبيعات فقط" }
  ],
  receipts: [],
  audit: [
    { id: "AUD-001", date: "2026-06-20T09:00:00", action: "تهيئة النظام", entity: "النظام", entityId: "SYSTEM", user: "مدير النظام" }
  ]
};

let data = loadFallbackData();
const requestedView = new URLSearchParams(location.search).get("view");
let currentView = ["dashboard", "books", "sales", "onlineOrders", "purchases", "returns", "parties", "shipping", "accounting", "reports", "hr", "settings", "omnichannel"].includes(requestedView)
  ? requestedView
  : "dashboard";
let partyTab = "customers";
let salesScreenMode = "main";
let salesDateFilter = "today";
let salesFilterFrom = today();
let salesFilterTo = today();
let draftSale = { customerId: "", channel: "تجزئة", saleOperationType: "بيع مباشر", payment: "نقدي", date: today(), paid: 0, invoiceDiscount: 0, invoiceDiscountType: "percent", lines: [{ bookId: "", qty: 1, price: 0, discount: 0, discountType: "percent" }] };
const emptyPurchaseDraft = () => ({ supplierId: "S001", supplierInvoiceNumber: "", type: "شراء", payment: "آجل", returnDeadline: "", status: "تم الفحص والاستلام", paid: 0, shipping: 0, invoiceDiscount: 0, invoiceDiscountType: "percent", lines: [{ bookId: "", qty: 1, cost: 0, discount: 0, discountType: "percent" }] });
function loadPurchaseDraft() { try { const value=JSON.parse(localStorage.getItem(PURCHASE_DRAFT_KEY)||"null"); return value?.lines?.length ? value : emptyPurchaseDraft(); } catch { return emptyPurchaseDraft(); } }
function persistPurchaseDraft() { localStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify(draftPurchase)); }
function clearPurchaseDraft() { localStorage.removeItem(PURCHASE_DRAFT_KEY); }
function hasUnsavedPurchaseDraft() { return Boolean(draftPurchase?.supplierInvoiceNumber || draftPurchase?.lines?.some(line => line.bookId)); }
let draftPurchase = loadPurchaseDraft();

function announceSystemTab() {
  try {
    systemTabChannel = new BroadcastChannel("dotcom-system-tabs-v1");
    systemTabChannel.addEventListener("message", event => {
      if (event.data?.tabId && event.data.tabId !== SYSTEM_TAB_ID) {
        purchaseOtherTabDetected = true;
        if (currentView === "purchases") toast("يوجد تبويب آخر مفتوح للنظام. استخدم تبويبًا واحدًا أثناء إدخال الفواتير.", "error");
      }
      if (event.data?.type === "hello") systemTabChannel.postMessage({ type:"present", tabId:SYSTEM_TAB_ID });
    });
    systemTabChannel.postMessage({ type:"hello", tabId:SYSTEM_TAB_ID });
  } catch {}
}
announceSystemTab();
let pendingOnlineOrderDraft = null;
let onlineOrderQuickFilter = "";
let onlineOrdersMode = "orders";
let shippingSessionCompany = "";
let quickShippingOrderId = "";
let batchShippingPreviewRows = [];
const emptyQuickOrderDraft = () => ({ phone:"", customerId:"", customerName:"", governorate:"", city:"", address:"", addressMark:"", alternativePhone:"", lines:[], shippingCost:0, shippingManual:false, paymentPlan:"cash_on_delivery", paymentMethod:"الدفع عند الاستلام", paidAmount:0, paymentConfirmed:false, receiptMethod:"كاش", cashAccountId:"", orderDiscount:0, orderDiscountType:"percent", notes:"", chatwootConversationId:"", savedOrderId:"" });
let quickOrderDraft = emptyQuickOrderDraft();
let quickOrderSearch = "";
let quickOrderContextRender = false;
let quickOrderAutofocusPending = true;
let shippingQuickFilter = "";
let recordFocusTimer = null;
let shipmentRefreshTimer = null;
let lastShipmentRefresh = null;
const SHIPMENT_REFRESH_INTERVAL = 60000;
const OMNICHANNEL_BASE = window.OMNICHANNEL_BASE
  || localStorage.getItem("OMNICHANNEL_BASE")
  || (["127.0.0.1", "localhost"].includes(location.hostname)
    ? "http://127.0.0.1:8775"
    : `${location.origin}/omnichannel-api`);
let omniEventSource = null;
let selectedOmniConversationId = "";
let selectedOmniChannelAccountId = "";
let selectedOmniReplyToMessageId = "";
let selectedOmniAttachment = null;
let omniSendingConversations = new Set();
let omniSlashReplies = [];
let omniSlashIndex = 0;
let omniMediaRecorder = null;
let omniMediaChunks = [];
let omniMediaStream = null;
let stickyTableScroll = { wrap: null, bar: null, inner: null, syncing: false, raf: null };
let financeTab = "expenses";
let financeReportFilters = { preset:"month", from:"", to:"", movementType:"", account:"", expenseType:"", carrier:"" };
let pendingFinanceFormDraft = null;
let pendingFinanceConfirmation = null;
let orderCollectionDraft = { trackingNumber:"", amount:"", collectionDate:"", shipmentId:"", differenceReason:"", notes:"", registrationType:"collected_by_carrier", account:"" };
let orderCollectionMode = "single";
let orderCollectionBatchRows = [];
let orderCollectionSearch = "";
let notificationFilter = "unread";

function moneyCents(value) {
  const number = Number(normalizeArabicNumericText(value));
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100);
}

function centsMoney(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function sumMoney(list, selector) {
  return centsMoney(list.reduce((sum, item) => sum + moneyCents(selector(item)), 0));
}

const root = document.getElementById("view-root");
const modal = document.getElementById("modal-backdrop");
const modalBody = document.getElementById("modal-body");
const modalTitle = document.getElementById("modal-title");
const modalEyebrow = document.getElementById("modal-eyebrow");

function loadFallbackData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : structuredClone(seed);
  } catch {
    return structuredClone(seed);
  }
}

function authHeaders(extra = {}) {
  return { ...extra, ...(sessionToken ? { "X-Session-Token": sessionToken } : {}) };
}

const orderWorkflowRequests = new Map();

function orderAuthenticationError(status, result = {}) {
  if (status === 401) {
    sessionStorage.removeItem(SESSION_KEY);
    sessionToken = "";
    currentUser = null;
    const message = "انتهت جلسة الدخول، برجاء تحديث الصفحة أو تسجيل الدخول مرة أخرى";
    showLogin(message);
    return Object.assign(new Error(message), { code:result.code || "AUTHENTICATION_REQUIRED", status });
  }
  if (status === 403) {
    return Object.assign(new Error("ليس لديك صلاحية لتنفيذ هذا الإجراء"), { code:result.code || "PERMISSION_DENIED", status });
  }
  return null;
}

function normalizeSessionUser(user) {
  const roles = { owner:"مالك", manager:"مدير", accountant:"محاسب", cashier:"كاشير", warehouse:"مخزن", shipping:"شحن" };
  const names = { owner:"مالك النظام", manager:"مدير النظام", accountant:"المحاسب", cashier:"الكاشير", warehouse:"مسؤول المخزن", shipping:"مسؤول الشحن" };
  return { ...user, role:roles[user?.role] || user?.role, name:user?.name && !/^(System|Accountant|Cashier|Warehouse|Shipping)/.test(user.name) ? user.name : names[user?.username] || user?.name };
}

function allPermissionActions() {
  return PERMISSION_ACTIONS.flatMap(group => group[1].map(item => item[0]));
}

function defaultPermissionsForRole(role) {
  const views = [...(ROLE_VIEWS[role] || [])];
  if (!views.includes("omnichannel")) views.push("omnichannel");
  const actions = allPermissionActions().filter(action => {
    const allowedRoles = ACTION_ROLES[action];
    return !allowedRoles || allowedRoles.includes(role);
  });
  return { views, actions };
}

function permissionSettings() {
  data.settings.permissions = data.settings.permissions || { roles: {}, users: {} };
  data.settings.permissions.roles = data.settings.permissions.roles || {};
  data.settings.permissions.users = data.settings.permissions.users || {};
  return data.settings.permissions;
}

function rolePermissions(role) {
  const defaults = defaultPermissionsForRole(role);
  const saved = data.settings?.permissions?.roles?.[role];
  return {
    views: Array.isArray(saved?.views) ? saved.views : defaults.views,
    actions: Array.isArray(saved?.actions) ? saved.actions : defaults.actions
  };
}

function effectivePermissionsForUser(user = currentUser) {
  if (!user) return { views: [], actions: [] };
  const inherited = rolePermissions(user.role);
  const saved = data.settings?.permissions?.users?.[user.username];
  if (!saved) return inherited;
  return {
    views: Array.isArray(saved.views) ? saved.views : inherited.views,
    actions: Array.isArray(saved.actions) ? saved.actions : inherited.actions
  };
}

function permissionSummary(perms) {
  return `${perms.views.length}/${VIEW_DEFINITIONS.length} شاشة · ${perms.actions.length}/${allPermissionActions().length} إجراء`;
}

function actorSnapshot() {
  return {
    userId: currentUser?.id || "",
    username: currentUser?.username || "system",
    name: currentUser?.name || currentUser?.username || "النظام",
    role: currentUser?.role || "نظام"
  };
}

function negativeStockError(book, requestedQuantity, ownReserved = 0) {
  const available = Math.max(0,Number(book?.stock || 0)-Number(book?.reservedStock||0)+Number(ownReserved||0));
  const requested = Number(requestedQuantity || 0);
  if (requested <= available) return "";
  if (data.settings.allowNegativeStock && canAction("allow-negative-stock")) return "";
  return `لا يمكن إتمام البيع. الرصيد المتاح من «${book?.name || "الصنف"}» هو ${available} والكمية المطلوبة ${requested}.`;
}

function recordNegativeStockOverride(book, requestedQuantity, documentId) {
  if (Number(requestedQuantity || 0) <= Number(book?.stock || 0)) return;
  data.audit.push(auditEntry({
    action:"تجاوز المخزون السالب بصلاحية",
    operationType:"تجاوز المخزون السالب",
    moduleName:"المبيعات",
    entityType:"المخزون",
    entity:"المخزون",
    entityId:book.id,
    documentNo:documentId,
    details:`${book.name}: المتاح ${Number(book.stock || 0)}، المطلوب ${Number(requestedQuantity || 0)}`
  }));
}

function actorLabel(item = {}) {
  const name = item.createdBy || item.updatedBy || item.user || "غير مسجل";
  const username = item.createdByUsername || item.updatedByUsername || "";
  const role = item.createdByRole || item.updatedByRole || "";
  return `${name}${username ? ` (${username})` : ""}${role ? ` — ${role}` : ""}`;
}

function dateTimeLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fmtDate(value);
  return date.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}

function arabicDateTimeLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fmtDate(value);
  const day = new Intl.DateTimeFormat("ar-EG", { day:"numeric", month:"long", year:"numeric" }).format(date);
  const time = new Intl.DateTimeFormat("ar-EG", { hour:"numeric", minute:"2-digit" }).format(date);
  return `${day} – ${time}`;
}

function normalizeCashMovement(item = {}) {
  const normalized = { ...item };
  const fallbackStamp = normalized.createdAt || normalized.updatedAt || (normalized.date ? `${normalized.date}T00:00:00` : new Date().toISOString());
  normalized.category = normalized.category || (normalized.type === "صرف" ? "مصروفات أخرى" : "تحصيل");
  normalized.createdAt = normalized.createdAt || fallbackStamp;
  normalized.updatedAt = normalized.updatedAt || normalized.createdAt;
  normalized.createdBy = normalized.createdBy || normalized.user || "غير مسجل (بيانات قديمة)";
  normalized.createdByUsername = normalized.createdByUsername || "";
  normalized.createdByRole = normalized.createdByRole || "";
  return normalized;
}

function stampCashMovements() {
  const actor = actorSnapshot();
  const now = new Date().toISOString();
  (data.cash || []).forEach(item => {
    if (!item.createdAt) item.createdAt = now;
    if (!item.updatedAt) item.updatedAt = item.createdAt;
    if (!item.createdBy) item.createdBy = actor.name;
    if (!item.createdByUsername) item.createdByUsername = actor.username;
    if (!item.createdByRole) item.createdByRole = actor.role;
    if (!item.createdById) item.createdById = actor.userId;
    if (!item.category) item.category = item.type === "صرف" ? "مصروفات أخرى" : "تحصيل";
  });
}

function canView(view) {
  return Boolean(currentUser && effectivePermissionsForUser(currentUser).views.includes(view));
}

function canAction(action) {
  if (!currentUser) return false;
  if (action === "online-order-stat") return canView("onlineOrders");
  if (action === "shipping-stat") return canView("shipping");
  if (["add-shipment-complaint", "manage-shipment-complaints"].includes(action)) return canView("shipping");
  if (!allPermissionActions().includes(action)) {
    const allowed = ACTION_ROLES[action];
    return !allowed || allowed.includes(currentUser.role);
  }
  return effectivePermissionsForUser(currentUser).actions.includes(action);
}

function requireAction(action) {
  if (canAction(action)) return true;
  toast("ليس لديك صلاحية لتنفيذ هذا الإجراء.", "error");
  return false;
}

async function initializeAuth() {
  if (location.protocol === "file:") {
    document.getElementById("server-warning").hidden = false;
    document.getElementById("login-message").textContent = "شغّل START-HERE.cmd أولًا؛ الدخول والحفظ غير متاحين من ملف HTML.";
    return;
  }
  if (new URLSearchParams(location.search).get("selftest") === "1" && !sessionToken) {
    await login("owner", "DotCom@2026", true);
    return;
  }
  if (sessionToken) {
    try {
      const response = await fetch("/api/session", { headers: authHeaders(), cache: "no-store" });
      if (response.ok) {
        currentUser = normalizeSessionUser((await response.json()).user);
        showApplication();
        await initializeDatabase();
        return;
      }
    } catch {}
    sessionStorage.removeItem(SESSION_KEY);
    sessionToken = "";
  }
  showLogin();
}

function showLogin(message = "") {
  document.getElementById("login-screen").hidden = false;
  document.getElementById("app-shell").hidden = true;
  document.getElementById("login-message").textContent = message;
}

function showApplication() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-shell").hidden = false;
  document.getElementById("current-user-name").textContent = currentUser?.name || currentUser?.username || "مستخدم";
  document.getElementById("current-user-role").textContent = currentUser?.role || "—";
  document.querySelectorAll(".nav-item").forEach(item => item.hidden = !canView(item.dataset.view));
  document.getElementById("sidebar-new-sale").hidden = !canView("sales") || !canAction("new-sale-invoice");
  const collapsed = localStorage.getItem("dotcom-sidebar-collapsed") === "1";
  document.getElementById("app-shell").classList.toggle("sidebar-collapsed", collapsed);
  if (!canView(currentView)) currentView = "dashboard";
}

async function login(username, password, quiet = false) {
  const message = document.getElementById("login-message");
  if (message && !quiet) message.textContent = "جارٍ التحقق...";
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ username, password })
    });
    const raw = await response.text();
    let result;
    try { result = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error(raw || "الخادم أرسل ردًا غير مفهوم. أعد تشغيل السيرفر ثم جرّب مرة أخرى."); }
    if (!response.ok) throw new Error(result.message || "تعذر تسجيل الدخول.");
    sessionToken = result.token;
    currentUser = normalizeSessionUser(result.user);
    sessionStorage.setItem(SESSION_KEY, sessionToken);
    showApplication();
    await initializeDatabase();
    return true;
  } catch (error) {
    showLogin(error.message || "تعذر الاتصال بالخادم.");
    return false;
  }
}

async function logout() {
  try { await fetch("/api/logout", { method: "POST", headers: authHeaders() }); } catch {}
  sessionStorage.removeItem(SESSION_KEY);
  sessionToken = "";
  currentUser = null;
  showLogin("تم تسجيل الخروج.");
}

function setStorageStatus(message, connected) {
  const status = document.getElementById("storage-status");
  const mode = document.getElementById("storage-mode");
  const dot = document.querySelector(".sync-dot");
  if (status) status.textContent = lastSuccessfulSaveAt && message === "البيانات محفوظة" ? `${message} · آخر حفظ ${new Date(lastSuccessfulSaveAt).toLocaleTimeString("ar-EG")}` : message;
  if (mode) mode.textContent = connected ? "قاعدة بيانات محلية دائمة" : "حفظ احتياطي داخل المتصفح";
  if (dot) dot.style.background = connected ? "#8bb9f3" : "#4a82d0";
}

function getNotificationItems() {
  const stateByKey=new Map((data.notifications||[]).map(item=>[item.key||item.id,item]));
  const items = (data.notifications || [])
    .filter(item => item.status !== "closed" && item.type !== "delivered")
    .map(item => ({
      id: item.id,key:item.key||item.id,
      kind: "tracking-alert",
      entityId: item.shipmentId,
      orderId: data.shipments.find(shipment => shipment.id === item.shipmentId)?.orderId || "",
      priority: item.priority === "critical" ? 1 : item.priority === "high" ? 1 : item.priority === "warning" ? 2 : 3,
      title: item.trackingNumber || item.shipmentId || "تنبيه تتبع",
      description: item.message || "",
      tone: item.priority === "critical" || item.priority === "high" ? "red" : item.priority === "warning" ? "gold" : "blue",
      icon: item.priority === "critical" ? "!" : item.type === "return_risk" || item.type === "returned" ? "↶" : "▣",
      source:"الشحن والتتبع",createdAt:item.createdAt,updatedAt:item.updatedAt
    }));
  data.books
    .filter(book => book.stock <= book.reorder)
    .forEach(book => items.push({
      id: `stock-${book.id}`,key:`stock-${book.id}`,
      kind: "stock",
      entityId: book.id,
      priority: book.stock <= 0 ? 1 : 2,
      title: book.name,
      description: `الرصيد ${book.stock} ${itemUnitLabel(book)}، وحد إعادة الطلب ${book.reorder}.`,
      tone: "red",
      icon: "!",source:"المخزون",createdAt:book.updatedAt||book.createdAt
    }));
  data.books
    .filter(book => book.lastSale && (Date.now() - new Date(book.lastSale).getTime()) / 86400000 >= data.settings.staleDays)
    .forEach(book => items.push({
      id: `stale-${book.id}`,key:`stale-${book.id}`,
      kind: "stale",
      entityId: book.id,
      priority: 3,
      title: `صنف راكد: ${book.name}`,
      description: `آخر بيع ${fmtDate(book.lastSale)} — راجع العرض أو المرتجع.`,
      tone: "",
      icon: "↶",source:"المخزون",createdAt:book.lastSale
    }));
  data.books
    .filter(book => !book.owned && book.returnDeadline)
    .forEach(book => items.push({
      id: `consignment-${book.id}`,key:`consignment-${book.id}`,
      kind: "consignment",
      entityId: book.id,
      priority: 2,
      title: `أمانة: ${book.name}`,
      description: `موعد المرتجع ${fmtDate(book.returnDeadline)}.`,
      tone: "blue",
      icon: "◇",source:"المشتريات والأمانة",createdAt:book.returnDeadline
    }));
  data.shipments
    .filter(shipment => shipment.status !== "تم التسليم")
    .forEach(shipment => items.push({
      id: `shipment-${shipment.id}`,key:`shipment-${shipment.id}`,
      kind: "shipment",
      entityId: shipment.id,
      orderId: shipment.orderId,
      priority: shipment.status === "مرتجع" ? 1 : 3,
      title: shipment.tracking,
      description: `${shipment.customer} — ${shipment.status}.`,
      tone: "blue",
      icon: "▣",source:"الشحن",createdAt:shipment.updatedAt||shipment.createdAt
    }));
  data.onlineOrders
    .filter(order => !order.deletedAt && !["تم التسليم","ملغي"].includes(order.status) && ((Date.now() - new Date(order.createdAt || order.date).getTime()) / 3600000 >= (order.status === "طلب جديد" ? 2 : 24)))
    .forEach(order => items.push({
      id:`order-${order.id}`,key:`order-${order.id}`, kind:"online-order", entityId:order.id, priority:order.status === "طلب جديد" ? 1 : 2,
      title:`طلب متأخر: ${order.id}`, description:`${order.customerName} — ${order.status}.`, tone:"red", icon:"●",source:"طلبات الأونلاين",createdAt:order.createdAt||order.date
    }));
  (data.complaints||[]).filter(item=>!["closed","resolved"].includes(item.status||item.complaintStatus)).forEach(item=>items.push({
    id:`complaint-${item.id}`,key:`complaint-${item.id}`,kind:"complaint",entityId:item.shipmentId,priority:1,title:"شكوى شحن مفتوحة",
    description:`شكوى رقم ${item.complaintNumber||item.complaintReference||item.id} · الشحنة ${item.trackingNumber||"—"}`,tone:"red",icon:"!",source:"شكاوى الشحن",createdAt:item.createdAt||item.openedAt
  }));
  (data.orderCollections||[]).filter(item=>item.status!=="reversed"&&Math.abs(Number(item.difference||0))>.009&&!item.settlementId).forEach(item=>items.push({
    id:`collection-difference-${item.id}`,key:`collection-difference-${item.id}`,kind:"collection",entityId:item.id,priority:1,title:"تحصيل يحتاج مراجعة",
    description:`${item.orderId||item.trackingNumber} · يوجد فرق ${money(Math.abs(item.difference))}`,tone:"red",icon:"!",source:"تحصيل الأوردرات",createdAt:item.createdAt
  }));
  (data.carrierSettlements||[]).filter(item=>!item.deletedAt&&!item.approvedAt).forEach(item=>items.push({
    id:`settlement-${item.id}`,key:`settlement-${item.id}`,kind:"settlement",entityId:item.id,priority:2,title:"تسوية بانتظار الاعتماد",
    description:`${item.id} · ${(item.lines||[]).length} شحنة`,tone:"gold",icon:"⌛",source:"تسويات التحصيل",createdAt:item.createdAt
  }));
  const activeKeys=new Set(items.map(item=>item.key));
  (data.notifications||[]).filter(item=>item.uiStatus&&item.uiStatus!=="resolved"&&!activeKeys.has(item.key||item.id)).forEach(item=>items.push({
    id:item.id,key:item.key||item.id,kind:item.kind||"resolved",entityId:item.entityId||"",priority:4,
    title:item.title||"تنبيه تمت معالجته",description:item.description||"انتهى سبب التنبيه ولم يعد يحتاج متابعة.",
    tone:"",icon:"✓",source:item.source||"النظام",createdAt:item.createdAt,updatedAt:item.updatedAt,status:"resolved"
  }));
  return items.map(item=>{
    const saved=stateByKey.get(item.key);
    const status=item.status==="resolved"?"resolved":saved?.uiStatus||(["read","resolved"].includes(saved?.status)?saved.status:"unread");
    return {...item,status,readAt:saved?.readAt||"",updatedAt:item.updatedAt||item.createdAt};
  }).sort((a,b)=>a.status===b.status?a.priority-b.priority:a.status==="unread"?-1:1);
}

function updateNotificationBadge() {
  const count = getNotificationItems().filter(item=>item.status==="unread").length;
  const badgeElement = document.getElementById("notification-count");
  const button=document.getElementById("notification-btn");
  if (badgeElement) {
    badgeElement.textContent = count > 0 ? String(count) : "";
    badgeElement.hidden = count === 0;
    badgeElement.setAttribute("aria-hidden", count === 0 ? "true" : "false");
  }
  if(button)button.title=count?"تنبيهات النظام التي تحتاج متابعتك":"لا توجد تنبيهات جديدة";
}

function setNotificationStatus(key,status) {
  let record=(data.notifications||[]).find(item=>(item.key||item.id)===key);
  const now=new Date().toISOString();
  if(!record){record={id:nextId("NTF-",data.notifications),key,type:"ui-state",channel:"in-app",createdAt:now};data.notifications.push(record);}
  record.uiStatus=status;record.readAt=status==="read"?(record.readAt||now):record.readAt||"";record.updatedAt=now;
}

function markNotificationRead(key,{save=true}={}) {
  const item=getNotificationItems().find(row=>row.key===key);
  setNotificationStatus(key,"read");
  const record=(data.notifications||[]).find(row=>(row.key||row.id)===key);
  if(record&&item)Object.assign(record,{title:item.title,description:item.description,source:item.source,kind:item.kind,entityId:item.entityId});
  updateNotificationBadge();
  if(save)saveData("تحديد إشعار كمقروء","الإشعارات",key);
}

function notificationActionButtons(item) {
  if(item.kind==="collection")return `<div class="notification-actions"><button class="row-action" data-modal-action="notification-open-collection" data-id="${item.entityId}" data-notification-key="${esc(item.key)}">فتح التحصيل</button></div>`;
  if(item.kind==="settlement")return `<div class="notification-actions"><button class="row-action" data-modal-action="notification-open-settlement" data-id="${item.entityId}" data-notification-key="${esc(item.key)}">فتح التسوية</button></div>`;
  if(item.kind==="complaint")return `<div class="notification-actions"><button class="row-action" data-modal-action="notification-view-shipment" data-id="${item.entityId}" data-notification-key="${esc(item.key)}">فتح الشحنة</button></div>`;
  if (item.kind === "tracking-alert") return `<div class="notification-actions"><button class="row-action" data-modal-action="notification-view-shipment" data-id="${item.entityId}">تفاصيل الشحنة</button><button class="row-action" data-modal-action="notification-shipping-page">مركز المتابعة</button></div>`;
  if (item.kind === "online-order") return `<div class="notification-actions"><button class="row-action" data-modal-action="notification-view-order" data-id="${item.entityId}">التفاصيل</button><button class="row-action" data-modal-action="notification-edit-order" data-id="${item.entityId}">تعديل</button><button class="row-action" data-modal-action="notification-orders-page">كل الطلبات</button></div>`;
  if (item.kind === "shipment") {
    const linkedInvoice = data.sales.some(sale => sale.id === item.orderId);
    return `<div class="notification-actions"><button class="row-action" data-modal-action="notification-view-shipment" data-id="${item.entityId}">تفاصيل الشحنة</button>${linkedInvoice ? `<button class="row-action" data-modal-action="notification-view-invoice" data-id="${item.orderId}">فتح الفاتورة</button>` : ""}<button class="row-action" data-modal-action="notification-edit-shipment" data-id="${item.entityId}">تعديل</button><button class="row-action" data-modal-action="notification-shipping-page">متابعة الشحن</button></div>`;
  }
  if (item.kind === "stock") {
    return `<div class="notification-actions"><button class="row-action" data-modal-action="notification-view-book" data-id="${item.entityId}">التفاصيل</button><button class="row-action" data-modal-action="notification-edit-book" data-id="${item.entityId}">تعديل</button><button class="row-action" data-modal-action="notification-adjust-stock" data-id="${item.entityId}">تسوية</button><button class="row-action" data-modal-action="notification-buy-book" data-id="${item.entityId}">إنشاء شراء</button></div>`;
  }
  return `<div class="notification-actions"><button class="row-action" data-modal-action="notification-view-book" data-id="${item.entityId}">التفاصيل</button><button class="row-action" data-modal-action="notification-edit-book" data-id="${item.entityId}">تعديل</button><button class="row-action" data-modal-action="notification-books-page">فتح المخزون</button></div>`;
}

function dashboardAlertItem(item) {
  const isShipment = item.kind === "shipment" || item.kind === "tracking-alert";
  const isOrder = item.kind === "online-order";
  const linkedInvoice = isShipment && data.sales.some(sale => sale.id === item.orderId);
  return `<article class="alert-item dashboard-alert-item" data-action="dashboard-alert-open" data-kind="${item.kind}" data-id="${item.entityId}" role="button" tabindex="0" aria-label="فتح تفاصيل ${esc(item.title)}">
    <div class="alert-badge ${item.tone}">${item.icon}</div>
    <div class="dashboard-alert-content">
      <strong>${esc(item.title)}</strong>
      <span>${esc(item.description)}</span>
      <div class="dashboard-inline-actions">
        <button class="row-action primary-action" data-action="dashboard-alert-open" data-kind="${item.kind}" data-id="${item.entityId}">التفاصيل</button>
        <button class="row-action" data-action="${isShipment ? "dashboard-alert-edit-shipment" : isOrder ? "edit-online-order" : "dashboard-alert-edit-book"}" data-id="${item.entityId}">تعديل</button>
        ${item.kind === "stock" ? `<button class="row-action" data-action="dashboard-alert-adjust-stock" data-id="${item.entityId}">تسوية المخزون</button><button class="row-action" data-action="dashboard-alert-buy-book" data-id="${item.entityId}">إنشاء شراء</button>` : ""}
        ${linkedInvoice ? `<button class="row-action" data-action="dashboard-alert-view-invoice" data-id="${item.orderId}">الفاتورة</button>` : ""}
      </div>
    </div>
    <span class="dashboard-alert-arrow" aria-hidden="true">→</span>
  </article>`;
}

function showNotificationCenter() {
  const allItems=getNotificationItems();
  const items=allItems.filter(item=>notificationFilter==="all"||item.status===notificationFilter);
  openModal("التنبيهات والإجراءات", "مركز المتابعة", `
    <div class="notification-toolbar"><div class="finance-tabs">${[["all","الكل"],["unread","غير مقروء"],["resolved","تم حله"]].map(([value,label])=>`<button class="tab ${notificationFilter===value?"active":""}" data-modal-action="notification-filter" data-filter="${value}">${label}</button>`).join("")}</div>${allItems.some(item=>item.status==="unread")?`<button class="btn ghost small" data-modal-action="notification-read-all">تحديد الكل كمقروء</button>`:""}</div>
    <div class="alert-list notification-list">
      ${items.map(item => `<article class="alert-item notification-item ${item.status}" data-notification-key="${esc(item.key)}">
        <div class="alert-badge ${item.tone}">${item.icon}</div>
        <div class="notification-content"><strong>${esc(item.title)}</strong><span>${esc(item.description)}</span><small>${esc(item.source)} · ${arabicDateTimeLabel(item.updatedAt||item.createdAt)}</small>${notificationActionButtons(item)}</div>
        <div class="notification-state">${item.status==="unread"?`<span class="badge danger">جديد</span><button class="row-action" data-modal-action="notification-mark-read" data-key="${esc(item.key)}">تحديد كمقروء</button>`:item.status==="resolved"?badge("تم حله","gray"):badge("مقروء","blue")}</div>
      </article>`).join("") || `<div class="empty-state"><div class="empty-icon">✓</div><h3>لا توجد تنبيهات عاجلة</h3><p>كل المؤشرات في وضع مستقر.</p></div>`}
    </div>
    ${items.length ? `<div class="form-actions"><button class="btn ghost" data-modal-action="notification-refresh">تحديث التنبيهات</button><button class="btn secondary" data-modal-action="notification-reports">فتح التقارير</button></div>` : ""}`);
}

function shipmentRefreshText() {
  if (!lastShipmentRefresh) return "في انتظار أول تحديث تلقائي";
  return `آخر تحديث ${lastShipmentRefresh.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · تلقائي حسب حالة الشحنة`;
}

function dashboardShipmentsMarkup() {
  return data.shipments
    .slice()
    .sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")))
    .slice(0, 4)
    .map(shipment => `<button class="activity-item dashboard-shipment-item" data-action="dashboard-view-shipment" data-id="${shipment.id}" aria-label="فتح الشحنة ${esc(shipment.tracking)}">
      <div class="alert-badge blue">▣</div>
      <div><strong>${esc(shipment.company)} — ${esc(shipment.tracking)}</strong><span>${esc(shipment.customer)}، ${esc(shipment.city)} · ${esc(shipment.status)}</span></div>
      <span class="shipment-updated">${fmtDate(shipment.updated)}</span>
    </button>`)
    .join("") || `<div class="empty-state compact"><div class="empty-icon">▣</div><h3>لا توجد شحنات مسجلة</h3></div>`;
}

function updateDashboardShipmentCard(refreshing = false) {
  const list = document.getElementById("dashboard-shipment-list");
  const status = document.getElementById("shipment-refresh-status");
  const button = document.querySelector('[data-action="refresh-dashboard-shipments"]');
  if (list) list.innerHTML = dashboardShipmentsMarkup();
  if (status) status.textContent = refreshing ? "جارٍ جلب أحدث البيانات..." : shipmentRefreshText();
  if (button) {
    button.classList.toggle("refreshing", refreshing);
    button.disabled = refreshing;
  }
}

async function refreshDashboardShipments({ silent = false } = {}) {
  if (currentView === "dashboard") updateDashboardShipmentCard(true);
  try {
    if (serverConnected) {
      const response = await fetch(`/api/db-shipments-refresh=${Date.now()}`, { headers: authHeaders(), cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const remote = normalizeData(await response.json());
      data.shipments = remote.shipments;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
    lastShipmentRefresh = new Date();
    if (currentView === "dashboard") updateDashboardShipmentCard(false);
    if (!silent) toast("تم تحديث الشحنات الجارية.");
    return true;
  } catch {
    if (currentView === "dashboard") updateDashboardShipmentCard(false);
    if (!silent) toast("تعذر تحديث الشحنات الآن؛ سيتم المحاولة تلقائيًا.", "error");
    return false;
  }
}

async function reloadRemoteData() {
  if (!serverConnected) return false;
  const response = await fetch(`/api/db?reload=${Date.now()}`, { headers: authHeaders(), cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  data = normalizeData(await response.json());
  dbRevision = response.headers.get("X-DB-Revision") || dbRevision;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  updateNotificationBadge();
  return true;
}

async function runTrackingApi(path, successMessage) {
  if (!serverConnected) return toast("التتبع الفعلي يحتاج تشغيل النظام من START-HERE.cmd لأن الطلب يتم من السيرفر.", "error");
  const shipmentId = decodeURIComponent(String(path).split("/").pop() || "");
  const shipment = shipmentId ? data.shipments.find(item => item.id === shipmentId) : null;
  if (shipment && isTerminalShipment(shipment)) {
    toast("انتهى تتبع هذه الشحنة.", "error");
    return null;
  }
  const buttons = shipmentId ? [...document.querySelectorAll(`[data-action="update-tracking-now"][data-id="${CSS.escape(shipmentId)}"]`)] : [];
  buttons.forEach(button => { button.disabled = true; button.dataset.originalText = button.textContent; button.textContent = "جارٍ التحديث..."; });
  try {
    const requestId = globalThis.crypto?.randomUUID?.() || `web-${Date.now()}`;
    const response = await fetch(path, { method: "POST", headers: authHeaders({ "Content-Type": "application/json", "X-Request-ID":requestId }) });
    const result = await response.json().catch(() => ({}));
    dbRevision = response.headers.get("X-DB-Revision") || dbRevision;
    await reloadRemoteData();
    if (currentView === "shipping") renderShipping();
    if (!response.ok || result.ok === false) {
      const message = result.code === "TERMINAL_SHIPMENT_STATUS" ? "انتهى تتبع هذه الشحنة." : (result.persistenceFailed ? "وصلت النتيجة ولكن تعذر حفظها." : (result.message || result.errors?.[0]?.error || "تعذر تحديث التتبع"));
      throw new Error(message);
    }
    if (Number(result.manualIntervention || 0) > 0) {
      toast("فشل التتبع الآلي: موقع البريد يمنع التشغيل الآلي. تم تعليم الشحنة كمراجعة يدوية.", "error");
      return result;
    }
    if (Number(result.failed || 0) > 0) {
      const code = result.errors?.[0]?.failureCode || result.failureCode || "";
      const message = code === "TRACKING_AGENT_OFFLINE" ? "خدمة التتبع غير متصلة." : code === "RESULT_NOT_FOUND" ? "لم يتم العثور على نتيجة." : (result.errors?.[0]?.error || "تعذر تحديث التتبع. لم يتم تغيير حالة الشحنة.");
      toast(message, "error");
      return result;
    }
    toast(Number(result.successful || 0) > 0 ? "تم تحديث التتبع وحفظ النتيجة." : (successMessage || "تم تنفيذ طلب التتبع."));
    return result;
  } catch (error) {
    await reloadRemoteData().catch(() => {});
    if (currentView === "shipping") renderShipping();
    toast(error.message || "تعذر تحديث التتبع من المصدر الفعلي.", "error");
    return null;
  } finally {
    buttons.forEach(button => { button.disabled = false; button.textContent = button.dataset.originalText || "تحديث إلكتروني"; delete button.dataset.originalText; });
  }
}

function updateShipmentTrackingNow(id) {
  return runTrackingApi(`/api/tracking/shipment/${encodeURIComponent(id)}`, "تم طلب تحديث التتبع من المصدر الفعلي.");
}

function updateAllTrackingNow() {
  return runTrackingApi("/api/tracking/run", "تم تشغيل دورة متابعة الشحنات النشطة.");
}

async function testLocalRpaService() {
  if (!serverConnected) return toast("اختبار خدمة التتبع يحتاج تشغيل السيرفر الأساسي.", "error");
  try {
    const response = await fetch("/api/tracking/rpa/test", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: "{}"
    });
    const result = await response.json().catch(() => ({}));
    const rpa = result.localRpa || {};
    if (response.ok && result.ok) {
      toast("خدمة التتبع متصلة وجاهزة.");
    } else {
      toast(rpa.message || "خدمة التتبع المحلية غير متصلة حاليًا، وسيتم إعادة المحاولة تلقائيًا.", "error");
    }
    if (currentView === "shipping") updateTrackingWorkerNotice();
    return result;
  } catch (error) {
    toast(error.message || "تعذر اختبار خدمة التتبع.", "error");
    return null;
  }
}

async function retryPendingTracking() {
  if (!serverConnected) return toast("يلزم الاتصال بالسيرفر لإعادة المحاولة.", "error");
  const result = await runTrackingApi("/api/tracking/retry-pending", "تمت إعادة محاولة مهام التتبع المعلقة.");
  if (currentView === "shipping") updateTrackingWorkerNotice();
  return result;
}

async function showTrackingDebug(id) {
  const shipment = data.shipments.find(item => item.id === id);
  const debug = shipment?.trackingDebug || {};
  if (!debug.screenshotFile && !debug.htmlFile && !debug.jsonFile) return toast("لا توجد لقطة فشل تتبع محفوظة لهذه الشحنة.", "error");
  openModal("لقطة فشل التتبع", `الشحنة ${esc(id)}`, `<div class="alert-item"><div class="alert-badge gold">⚑</div><div><strong>يتم تحميل ملفات التشخيص...</strong><span>سيتم عرض الصورة وملخص القراءة.</span></div></div>`);
  try {
    const fetchDebug = async file => {
      if (!file) return null;
      const response = await fetch(`/api/tracking/debug/${encodeURIComponent(file)}`, { headers: authHeaders(), cache: "no-store" });
      if (!response.ok) throw new Error("تعذر تحميل ملف التشخيص.");
      return response;
    };
    const imageResponse = await fetchDebug(debug.screenshotFile);
    const jsonResponse = await fetchDebug(debug.jsonFile).catch(() => null);
    const htmlResponse = await fetchDebug(debug.htmlFile).catch(() => null);
    const imageUrl = imageResponse ? URL.createObjectURL(await imageResponse.blob()) : "";
    const json = jsonResponse ? await jsonResponse.json().catch(() => ({})) : {};
    const htmlText = htmlResponse ? await htmlResponse.text().catch(() => "") : "";
    modalBody.innerHTML = `
      <div class="alert-item warning"><div class="alert-badge gold">⚑</div><div><strong>${esc(shipment.trackingError || "يحتاج تدخل يدوي")}</strong><span>تم حفظ لقطة وHTML snapshot عند فشل قراءة نتيجة التتبع.</span></div></div>
      <div class="metric-strip">
        <div class="mini-metric"><span>Page opened</span><strong>${json.pageOpened ? "Yes" : "No"}</strong></div>
        <div class="mini-metric"><span>Input found</span><strong>${json.trackingInputFound ? "Yes" : "No"}</strong></div>
        <div class="mini-metric"><span>Submit clicked</span><strong>${json.submitClicked ? "Yes" : "No"}</strong></div>
        <div class="mini-metric"><span>Result text</span><strong>${json.trackingResultTextCaptured ? "Yes" : "No"}</strong></div>
      </div>
      ${imageUrl ? `<div style="margin-top:14px"><img src="${imageUrl}" alt="Tracking debug screenshot" style="max-width:100%;border:1px solid var(--border);border-radius:16px"></div>` : ""}
      <details style="margin-top:14px"><summary>النص المقروء من النتيجة</summary><pre style="white-space:pre-wrap;direction:ltr;text-align:left;max-height:260px;overflow:auto">${esc(json.resultText || json.bodyTextSample || "")}</pre></details>
      <details style="margin-top:10px"><summary>HTML snapshot preview</summary><pre style="white-space:pre-wrap;direction:ltr;text-align:left;max-height:260px;overflow:auto">${esc(htmlText.slice(0, 12000))}</pre></details>
      <div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`;
  } catch (error) {
    modalBody.innerHTML = `<div class="alert-item danger"><div class="alert-badge red">!</div><div><strong>تعذر عرض لقطة فشل التتبع</strong><span>${esc(error.message || "حدث خطأ أثناء تحميل ملف التشخيص.")}</span></div></div><div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`;
  }
}

async function fetchTrackingStatus() {
  if (!serverConnected) return null;
  try {
    const response = await fetch("/api/tracking/status", { headers: authHeaders(), cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function updateSettingsTrackingStatus() {
  const state = document.getElementById("settings-tracking-state");
  if (!state) return;
  const status = await fetchTrackingStatus();
  if (!state.isConnected) return;
  const service = status?.localRpa || {};
  state.textContent = service.connected ? "متصل" : "غير متصل";
  state.className = service.connected ? "text-success" : "text-danger";
  const lastSuccess = document.getElementById("settings-tracking-last-success");
  const pending = document.getElementById("settings-tracking-pending");
  if (lastSuccess) lastSuccess.textContent = dateTimeLabel(service.lastSuccessfulRunAt);
  if (pending) pending.textContent = String(Number(status?.queue?.pending || 0));
}

async function testTrackingConnection() {
  if (!serverConnected) return toast("اختبار الاتصال يحتاج تشغيل السيرفر.", "error");
  const input = document.getElementById("tracking-test-number");
  const trackingNumber = normalizeTrackingNumber(input?.value || "ENO33289190EG");
  try {
    const response = await fetch("/api/tracking/test", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ trackingNumber })
    });
    const result = await response.json().catch(() => ({}));
    const target = document.getElementById("tracking-test-result");
    if (target) target.innerHTML = response.ok ? `<span class="text-success">تم استلام Response حقيقي.</span>` : `<span class="text-danger">${esc(result.message || "تعذر الاتصال بالمصدر الفعلي.")}</span>`;
    toast(response.ok ? "اختبار الاتصال نجح." : (result.message || "تعذر الاتصال بالمصدر الفعلي."), response.ok ? "" : "error");
  } catch (error) {
    toast(error.message || "تعذر اختبار الاتصال.", "error");
  }
}

function startShipmentAutoRefresh() {
  if (shipmentRefreshTimer) clearInterval(shipmentRefreshTimer);
  shipmentRefreshTimer = setInterval(() => refreshDashboardShipments({ silent: true }), SHIPMENT_REFRESH_INTERVAL);
}

async function initializeDatabase() {
  try {
    const response = await fetch("/api/db", { headers: authHeaders(), cache: "no-store" });
    if (response.ok) {
      dbRevision = response.headers.get("X-DB-Revision") || "";
      const remote = await response.json();
      const needsMigration = Number(remote.version || 0) < 3 || !Array.isArray(remote.users) || !Array.isArray(remote.stockMovements) || !Array.isArray(remote.onlineOrders) || !Array.isArray(remote.governorates) || !Array.isArray(remote.shippingCompanies);
      data = normalizeData(remote);
      serverConnected = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setStorageStatus("البيانات محفوظة", true);
      render();
      if (needsMigration) await persistToServer();
      lastShipmentRefresh = new Date();
      updateDashboardShipmentCard(false);
      startShipmentAutoRefresh();
      openRequestedDialog();
      scheduleSelfTest();
      return;
    }

    if (response.status === 404) {
      data = normalizeData(data);
      serverConnected = true;
      await persistToServer();
      setStorageStatus("تم إنشاء قاعدة البيانات", true);
      render();
      lastShipmentRefresh = new Date();
      updateDashboardShipmentCard(false);
      startShipmentAutoRefresh();
      openRequestedDialog();
      scheduleSelfTest();
      return;
    }
    throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    serverConnected = false;
    data = normalizeData(data);
    setStorageStatus("تعذر الاتصال بالخادم", false);
    render();
    lastShipmentRefresh = new Date();
    updateDashboardShipmentCard(false);
    startShipmentAutoRefresh();
    openRequestedDialog();
    toast("تعذر الاتصال بقاعدة البيانات المحلية؛ تم تفعيل الحفظ الاحتياطي داخل المتصفح.", "error");
    scheduleSelfTest();
  }
}

let requestedDialogOpened = false;
function openRequestedDialog() {
  if (requestedDialogOpened) return;
  const params = new URLSearchParams(location.search);
  const dialog = params.get("dialog");
  const focus = params.get("focus");
  if (focus?.includes(":")) {
    requestedDialogOpened = true;
    const [kind, id] = focus.split(":");
    setTimeout(() => navigateToRecord(kind, id, params.get("mode") || "view"), 80);
    return;
  }
  if (dialog === "old-invoices") {
    requestedDialogOpened = true;
    setTimeout(showSalesList, 80);
  } else if (dialog?.startsWith("dashboard-")) {
    requestedDialogOpened = true;
    setTimeout(() => showDashboardStatDetails(dialog.replace("dashboard-", "")), 80);
  } else if (dialog === "notifications") {
    requestedDialogOpened = true;
    setTimeout(showNotificationCenter, 80);
  } else if (dialog === "add-book") {
    requestedDialogOpened = true;
    setTimeout(addBookModal, 80);
  } else if (dialog === "stock-count") {
    requestedDialogOpened = true;
    setTimeout(stockCountModal, 80);
  } else if (dialog === "stock-count-full") {
    requestedDialogOpened = true;
    setTimeout(() => openInventoryCountForm(data.books, "كلي"), 80);
  }
}

let selfTestScheduled = false;
function scheduleSelfTest() {
  if (selfTestScheduled || new URLSearchParams(location.search).get("selftest") !== "1") return;
  selfTestScheduled = true;
  setTimeout(runSelfTest, 150);
}

function normalizePhone(value) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return String(value || "")
    .replace(/[٠-٩]/g, digit => String(arabicDigits.indexOf(digit)))
    .replace(/\D/g, "");
}

function normalizeTrackingNumber(value = "") {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function validTrackingNumber(value = "") {
  return /^[A-Z0-9]{8,30}$/.test(normalizeTrackingNumber(value));
}

function isEgyptPostCarrier(value = "") {
  const text = String(value || "").toLowerCase();
  return text.includes("egypt") || text.includes("post") || text.includes("البريد") || text.includes("المصري");
}

function normalizeTrackingStatusText(text = "") {
  const lower = String(text || "").toLowerCase();
  if (/delivered|تم التسليم|سلمت/.test(lower)) return "delivered";
  if (/returned to sender|رجوع للمرسل|رجعت للمرسل|عاد للمرسل|return|مرتجع|عودة|إرجاع/.test(lower)) return "returned";
  if (/محاولة تسليم ثالثة|attempt_3/.test(lower)) return "delivery_attempt_3";
  if (/محاولة تسليم ثانية|attempt_2/.test(lower)) return "delivery_attempt_2";
  if (/محاولة تسليم أولى|attempt|محاولة|تعذر/.test(lower)) return "delivery_attempt_1";
  if (/unavailable|غير متواجد|لم يستلم|address|عنوان/.test(lower)) return "delivery_attempt_1";
  if (/out for delivery|خرج للتوصيل|خارج للتسليم|جاري التسليم/.test(lower)) return "out_for_delivery";
  if (/transit|في الطريق|في مرحلة نقل/.test(lower)) return "in_transit";
  if (/accepted|استلام|تم الشحن/.test(lower)) return "shipped";
  return "unknown";
}

const SHIPPING_STATUSES = {
  shipped: { label:"تم الشحن", legacy:"تم التسليم للشركة", tone:"blue" },
  in_transit: { label:"في مرحلة نقل", legacy:"في الطريق", tone:"violet" },
  out_for_delivery: { label:"جاري التسليم", legacy:"خرج للتوصيل", tone:"warning" },
  delivery_attempt_1: { label:"محاولة تسليم أولى", legacy:"في الطريق", tone:"attempt" },
  delivery_attempt_2: { label:"محاولة تسليم ثانية", legacy:"في الطريق", tone:"attempt" },
  delivery_attempt_3: { label:"محاولة تسليم ثالثة", legacy:"في الطريق", tone:"attempt" },
  delivered: { label:"تم التسليم", legacy:"تم التسليم", tone:"success" },
  returned: { label:"مرتجع", legacy:"مرتجع", tone:"danger" }
};

function shipmentStatusCode(item = {}) {
  const direct = [item.shippingStatus, item.trackingStatus, item.normalizedStatus].find(value => SHIPPING_STATUSES[value]);
  if (direct) return direct;
  const text = String(item.status || item.currentStatus || "").trim();
  if (/تم التسليم$|delivered/i.test(text)) return "delivered";
  if (/مرتجع|returned|return_to_sender|returned_to_sender/i.test(text)) return "returned";
  if (/محاولة.*ثالث|attempt_3/i.test(text)) return "delivery_attempt_3";
  if (/محاولة.*ثان|attempt_2/i.test(text)) return "delivery_attempt_2";
  if (/محاولة|تعذر التسليم|attempt/i.test(text)) return "delivery_attempt_1";
  if (/جاري التسليم|خرج للتوصيل|out_for_delivery/i.test(text)) return "out_for_delivery";
  if (/في مرحلة نقل|في الطريق|in_transit|sorting/i.test(text)) return "in_transit";
  return "shipped";
}

function isTerminalShipment(item = {}) {
  return ["delivered", "returned"].includes(shipmentStatusCode(item));
}

function shipmentStatusMeta(item = {}) {
  const code = shipmentStatusCode(item);
  return { code, ...(SHIPPING_STATUSES[code] || SHIPPING_STATUSES.shipped) };
}

function shipmentStatusOptions(selected = "shipped") {
  return Object.entries(SHIPPING_STATUSES).map(([code, meta]) => `<option value="${code}" ${selected === code ? "selected" : ""}>${meta.label}</option>`).join("");
}

function shipmentStatusBadge(item = {}) {
  const meta = shipmentStatusMeta(item);
  return `<span class="shipment-status-badge ${meta.tone}" data-status="${meta.code}">${meta.label}</span>`;
}

function normalizeGovernorate(value) {
  const text = String(value || "").trim();
  const aliases = {
    "القاهره": "القاهرة", "الجيزه": "الجيزة", "الاسكندرية": "الإسكندرية",
    "الاسكندريه": "الإسكندرية", "الدقهليه": "الدقهلية", "البحيره": "البحيرة",
    "الغربيه": "الغربية", "الاسماعيليه": "الإسماعيلية", "المنوفيه": "المنوفية",
    "المنيا": "المنيا", "القليوبيه": "القليوبية", "السويس": "السويس",
    "اسوان": "أسوان", "اسيوط": "أسيوط", "بني سويف": "بني سويف",
    "بورسعيد": "بورسعيد", "دمياط": "دمياط", "الشرقيه": "الشرقية",
    "كفرالشيخ": "كفر الشيخ", "مطروح": "مطروح", "الاقصر": "الأقصر",
    "قنا": "قنا", "سوهاج": "سوهاج"
  };
  const canonical = aliases[text] || text;
  return EGYPT_GOVERNORATES.includes(canonical) ? canonical : "";
}

function governorateOptions(selected = "") {
  const current = normalizeGovernorate(selected);
  return `<option value="">اختر المحافظة...</option>${EGYPT_GOVERNORATES.map(name => `<option value="${name}" ${current === name ? "selected" : ""}>${name}</option>`).join("")}`;
}

function activeCashAccounts() {
  const list = Array.isArray(data.cashAccounts) ? data.cashAccounts : [];
  return list.filter(account => !account.deletedAt && account.active !== false && String(account.name || "").trim());
}

function normalizeCashAccountName(value) {
  const text = String(value || "").trim();
  return activeCashAccounts().find(account => account.name === text)?.name || text;
}

function cashAccountOptions(selected = "") {
  const current = normalizeCashAccountName(selected) || activeCashAccounts()[0]?.name || "";
  return activeCashAccounts().map(account => `<option value="${esc(account.name)}" ${account.name === current ? "selected" : ""}>${esc(account.name)}</option>`).join("");
}

function refundCashAccountOptions(selectedId = "") {
  const accounts = activeCashAccounts();
  const currentId = accounts.some(account => account.id === selectedId) ? selectedId : accounts.length === 1 ? accounts[0].id : "";
  return `${accounts.length > 1 ? `<option value="">اختر الخزنة...</option>` : ""}${accounts.map(account => `<option value="${esc(account.id)}" ${account.id === currentId ? "selected" : ""}>${esc(account.name)}</option>`).join("")}`;
}

function cashAccountBalance(name) {
  const account = activeCashAccounts().find(item => item.name === name);
  const opening = Number(account?.openingBalance || 0);
  return activeCash().reduce((sum, item) => {
    if ((item.account || "") !== name) return sum;
    const amount = Number(item.amount || 0);
    return sum + (item.type === "قبض" ? amount : item.type === "صرف" ? -amount : 0);
  }, opening);
}

function carrierFinanceSettings(companyOrName = "") {
  const company = typeof companyOrName === "object" ? companyOrName : (data.shippingCompanies || []).find(item => item.name === companyOrName);
  const egyptPost = /البريد|egypt.?post/i.test(company?.name || companyOrName);
  return {
    commissionRate: Number(company?.finance?.commissionRate ?? (egyptPost ? 0.5 : 0)),
    minimumCommission: Number(company?.finance?.minimumCommission ?? (egyptPost ? 5 : 0)),
    commissionBasis: company?.finance?.commissionBasis || "total_collection",
    customCommissionBase: Number(company?.finance?.customCommissionBase || 0),
    deductShippingCost: company?.finance?.deductShippingCost !== false,
    deductReturnFees: company?.finance?.deductReturnFees !== false,
    autoCreateExpenses: company?.finance?.autoCreateExpenses !== false,
    shippingExpenseType: company?.finance?.shippingExpenseType || (egyptPost ? "تكلفة شحن البريد المصري" : "مصروفات أخرى"),
    commissionExpenseType: company?.finance?.commissionExpenseType || (egyptPost ? "عمولة تحصيل البريد المصري" : "مصروفات أخرى"),
    returnExpenseType: company?.finance?.returnExpenseType || "تكلفة مرتجع",
    active: company?.finance?.active !== false
  };
}

function shipmentFinanceValues(shipment = {}) {
  const sale = (data.sales || []).find(item => item.id === (shipment.invoiceId || shipment.orderId));
  const customerShippingCharge = Number(shipment.customerShippingCharge ?? sale?.shippingCost ?? sale?.shipping ?? 0);
  const productsValue = Number(shipment.productsValue ?? Math.max(0, Number(sale?.total || 0) - customerShippingCharge));
  const collectionAmount = Number(shipment.collectionAmount ?? (productsValue + customerShippingCharge));
  const expectedCost = Number(shipment.carrierShippingCostExpected ?? shipment.cost ?? 0);
  const settings = shipment.carrierFinanceSnapshot || carrierFinanceSettings(shipment.company || shipment.carrier);
  const base = settings.commissionBasis === "products_only" ? productsValue : settings.commissionBasis === "custom" ? Number(settings.customCommissionBase || 0) : collectionAmount;
  const baseCents=moneyCents(base);
  const computedCommissionCents = baseCents <= 0 ? 0 : Math.max(
    Math.round(baseCents * Number(settings.commissionRate || 0) / 100),
    moneyCents(settings.minimumCommission || 0)
  );
  const expectedCommission = Number(shipment.collectionCommissionExpected ?? centsMoney(computedCommissionCents));
  return {
    productsValue, customerShippingCharge, collectionAmount,
    carrierShippingCostExpected: expectedCost,
    collectionCommissionExpected: Number(expectedCommission.toFixed(2)),
    expectedNetSettlement: centsMoney(moneyCents(collectionAmount) - (settings.deductShippingCost === false ? 0 : moneyCents(expectedCost)) - moneyCents(expectedCommission))
  };
}

function totalCashBalance() {
  return activeCashAccounts().reduce((sum, account) => sum + cashAccountBalance(account.name), 0);
}

function activeShippingCompanies() {
  const list = Array.isArray(data.shippingCompanies) ? data.shippingCompanies : [];
  return list.filter(company => !company.deletedAt && company.active !== false && String(company.name || "").trim());
}

function normalizeShippingCompanyName(value) {
  const text = String(value || "").trim();
  const company = activeShippingCompanies().find(item => item.name === text);
  return company?.name || "";
}

function shippingCompanyOptions(selected = "") {
  const current = normalizeShippingCompanyName(selected) || selected || activeShippingCompanies()[0]?.name || "";
  return `<option value="">اختر شركة الشحن...</option>${activeShippingCompanies().map(company => `<option value="${esc(company.name)}" ${company.name === current ? "selected" : ""}>${esc(company.name)}</option>`).join("")}`;
}

function getCustomerFrom(customers, id) {
  return customers.find(customer => customer.id === id && !customer.deletedAt);
}

function customerSnapshot(customer, fallback = {}) {
  return {
    name: customer?.name || fallback.customerName || "",
    phone: customer?.phone || fallback.phone || "",
    governorate: normalizeGovernorate(customer?.governorate || fallback.governorate),
    city: customer?.city || fallback.city || "",
    address: customer?.address || fallback.address || ""
  };
}

function normalizeData(value) {
  const normalized = value && typeof value === "object" ? structuredClone(value) : structuredClone(seed);
  ["books", "customers", "suppliers", "sales", "purchases", "shipments", "cash", "employees", "receipts", "audit", "users", "stockMovements", "onlineOrders", "returns", "shippingCompanies", "cashAccounts", "trackingHistory", "trackingRuns", "notifications", "complaints", "inventoryBatches", "dayClosings", "expenseTypes", "incomeTypes", "expenses", "otherIncome", "carrierSettlements", "orderCollections", "orderPayments", "orderRefunds", "customerCredits", "customerCreditUses"].forEach(key => {
    if (!Array.isArray(normalized[key])) normalized[key] = [];
  });
  normalized.version = Math.max(3, Number(normalized.version || 0));
  normalized.governorates = [...EGYPT_GOVERNORATES];
  const existingCompanyNames = new Set(normalized.shippingCompanies.map(company => String(company.name || company).trim()).filter(Boolean));
  DEFAULT_SHIPPING_COMPANIES.forEach(name => {
    if (!existingCompanyNames.has(name)) normalized.shippingCompanies.push({ id: `SC-${String(normalized.shippingCompanies.length + 1).padStart(3, "0")}`, name, active: true });
  });
  const existingAccountNames = new Set(normalized.cashAccounts.map(account => String(account.name || account).trim()).filter(Boolean));
  DEFAULT_CASH_ACCOUNTS.forEach(name => {
    if (!existingAccountNames.has(name)) normalized.cashAccounts.push({ id: `CA-${String(normalized.cashAccounts.length + 1).padStart(3, "0")}`, name, openingBalance: 0, active: true });
  });
  const expenseNames = new Set(normalized.expenseTypes.map(item => String(item.name || item)));
  DEFAULT_EXPENSE_TYPES.forEach((name, index) => {
    if (!expenseNames.has(name)) normalized.expenseTypes.push({ id:`ET-${String(index + 1).padStart(3, "0")}`, name, category:/شحن|تحصيل|مرتجع/.test(name) ? "شحن" : "تشغيل", mode:/شحن|تحصيل|مرتجع/.test(name) ? "آلي ويدوي" : "يدوي", active:true });
  });
  const incomeNames = new Set(normalized.incomeTypes.map(item => String(item.name || item)));
  DEFAULT_INCOME_TYPES.forEach((name, index) => {
    if (!incomeNames.has(name)) normalized.incomeTypes.push({ id:`IT-${String(index + 1).padStart(3, "0")}`, name, active:true });
  });
  normalized.expenseTypes = normalized.expenseTypes.map((type, index) => typeof type === "string"
    ? { id:`ET-${String(index + 1).padStart(3, "0")}`, name:type, category:"تشغيل", mode:"يدوي", active:true }
    : { ...type, id:type.id || `ET-${String(index + 1).padStart(3, "0")}`, active:type.active !== false });
  normalized.incomeTypes = normalized.incomeTypes.map((type, index) => typeof type === "string"
    ? { id:`IT-${String(index + 1).padStart(3, "0")}`, name:type, description:"", active:true }
    : { ...type, id:type.id || `IT-${String(index + 1).padStart(3, "0")}`, description:type.description || "", active:type.active !== false });
  normalized.expenses.forEach(item => {
    const type = normalized.expenseTypes.find(row => row.id === item.expenseTypeId) || normalized.expenseTypes.find(row => row.name === item.expenseType);
    if (type) {
      item.expenseTypeId = type.id;
      item.expenseType = item.expenseType || type.name;
    }
  });
  normalized.otherIncome.forEach(item => {
    const type = normalized.incomeTypes.find(row => row.id === item.incomeTypeId) || normalized.incomeTypes.find(row => row.name === item.incomeType);
    if (type) {
      item.incomeTypeId = type.id;
      item.incomeType = item.incomeType || type.name;
    }
  });
  normalized.cash.forEach(item => {
    const name = String(item.account || "").trim();
    if (name && !existingAccountNames.has(name) && !normalized.cashAccounts.some(account => account.name === name)) {
      normalized.cashAccounts.push({ id: `CA-${String(normalized.cashAccounts.length + 1).padStart(3, "0")}`, name, openingBalance: 0, active: true });
    }
  });
  const stamp = new Date().toISOString();
  const addMeta = item => ({ createdAt: item.createdAt || stamp, updatedAt: item.updatedAt || item.createdAt || stamp, deletedAt: item.deletedAt || null, ...item });
  ["books","customers","suppliers","sales","purchases","shipments","cash","employees","receipts","onlineOrders","shippingCompanies","cashAccounts","dayClosings"].forEach(key => {
    normalized[key] = normalized[key].map(addMeta);
  });
  normalized.shippingCompanies = normalized.shippingCompanies.map((company, index) => ({
    id: company.id || `SC-${String(index + 1).padStart(3, "0")}`,
    name: String(company.name || company || "").trim(),
    active: company.active !== false,
    ...company,
    name: String(company.name || company || "").trim()
  })).filter(company => company.name);
  normalized.cashAccounts = normalized.cashAccounts.map((account, index) => ({
    id: account.id || `CA-${String(index + 1).padStart(3, "0")}`,
    name: String(account.name || account || "").trim(),
    openingBalance: Number(account.openingBalance || 0),
    active: account.active !== false,
    ...account,
    name: String(account.name || account || "").trim(),
    openingBalance: Number(account.openingBalance || 0)
  })).filter(account => account.name);
  if (!normalized.users.length) {
    normalized.users = [
      { id:"U001", username:"owner", name:"مالك النظام", role:"مالك", salt:"s01", passwordHash:"2dbab9e2692dc22862154db758fd08face95e6d15b5fb2390995dad66bd0452c", active:true },
      { id:"U002", username:"manager", name:"مدير النظام", role:"مدير", salt:"s02", passwordHash:"a29c2fcb2de4e5175719cb5dfed4043da44b9baa5a87430eba6d1223e488d563", active:true },
      { id:"U003", username:"accountant", name:"المحاسب", role:"محاسب", salt:"s03", passwordHash:"6b44de984c5a4ce8691a0bef70b679e88135ad7f4d05a11ffef3cc04e8c76a85", active:true },
      { id:"U004", username:"cashier", name:"الكاشير", role:"كاشير", salt:"s04", passwordHash:"440aade91695513e752ac4ce674d1639c3ed697d0c4d2806edc15bd073e0aa61", active:true },
      { id:"U005", username:"warehouse", name:"مسؤول المخزن", role:"مخزن", salt:"s05", passwordHash:"5c37d675c0fffbedd0f6acd3d75d409ee5c3a336574a058b575de03aeda5e9fd", active:true },
      { id:"U006", username:"shipping", name:"مسؤول الشحن", role:"شحن", salt:"s06", passwordHash:"7a53924916afbcba18d1f58c093f7fe110f88539803186401fdb2f280a769000", active:true }
    ];
  }
  normalized.sales = normalized.sales.map(sale => ({
    paid: sale.paid ?? (sale.payment === "آجل" ? 0 : sale.total || 0),
    remaining: sale.remaining ?? (sale.payment === "آجل" ? sale.total || 0 : 0),
    lines: sale.lines || [],
    saleOperationType: sale.saleOperationType || sale.operationType || (sale.onlineOrderId ? "طلب أونلاين" : "بيع مباشر"),
    createdByUserId: sale.createdByUserId || sale.createdById || "",
    createdByName: sale.createdByName || sale.createdBy || "غير محدد",
    ...sale
  }));
  normalized.purchases = normalized.purchases.map(purchase => ({
    paid: purchase.paid ?? 0,
    remaining: purchase.remaining ?? purchase.total ?? 0,
    lines: purchase.lines || [],
    shipping: purchase.shipping || 0,
    ...purchase
  }));
  normalized.books = normalized.books.map(book => ({
    ...book,
    reservedStock: Math.max(0, Number(book.reservedStock || 0)),
    itemType: book.itemType || (String(book.category || "").includes("كتب") || book.author || book.publisher || book.grade ? "كتاب" : "صنف عام"),
    unit: book.unit || "قطعة",
    purchaseDiscount: Number(book.purchaseDiscount || 0),
    coverPrice: Number(book.coverPrice ?? book.purchaseListPrice ?? book.price ?? 0),
    defaultSellingPrice: Number(book.defaultSellingPrice ?? book.price ?? 0),
    lastPurchasePrice: Number(book.lastPurchasePrice ?? book.cost ?? 0),
    purchaseListPrice: Number(book.purchaseListPrice ?? book.coverPrice ?? book.price ?? 0)
  }));
  normalized.inventoryBatches = normalized.inventoryBatches.map(batch => ({
    id: batch.id || batch.batchId,
    batchId: batch.batchId || batch.id,
    productId: batch.productId || batch.bookId,
    bookId: batch.bookId || batch.productId,
    purchaseInvoiceId: batch.purchaseInvoiceId || batch.purchaseId || batch.sourceId || "",
    supplierId: batch.supplierId || "",
    receivedQty: Number(batch.receivedQty || 0),
    remainingQty: Number(batch.remainingQty || 0),
    unitCost: Number(batch.unitCost || 0),
    coverPrice: Number(batch.coverPrice || 0),
    purchaseDate: batch.purchaseDate || batch.date || today(),
    source: batch.source || "purchase",
    status: batch.status || "active",
    createdAt: batch.createdAt || stamp,
    updatedAt: batch.updatedAt || batch.createdAt || stamp,
    deletedAt: batch.deletedAt || null
  })).filter(batch => batch.productId && batch.batchId);
  const existingOpeningProducts = new Set(normalized.inventoryBatches.filter(batch => batch.source === "opening_balance").map(batch => batch.productId));
  normalized.books.forEach(book => {
    const stock = Number(book.stock || 0);
    if (stock > 0 && !existingOpeningProducts.has(book.id) && !normalized.inventoryBatches.some(batch => batch.productId === book.id)) {
      const unitCost = Number(book.lastPurchasePrice || book.cost || 0);
      normalized.inventoryBatches.push({
        id: `OB-${book.id}`,
        batchId: `OB-${book.id}`,
        productId: book.id,
        bookId: book.id,
        purchaseInvoiceId: "opening_balance",
        supplierId: book.supplierId || "",
        receivedQty: stock,
        remainingQty: stock,
        unitCost,
        coverPrice: Number(book.coverPrice || book.purchaseListPrice || book.price || 0),
        purchaseDate: book.createdAt ? String(book.createdAt).slice(0, 10) : today(),
        source: "opening_balance",
        status: unitCost > 0 ? "active" : "cost_incomplete",
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
        warning: unitCost > 0 ? "" : "تكلفة افتتاحية غير مؤكدة"
      });
    }
  });
  normalized.customers = normalized.customers.map(customer => ({
    governorate: normalizeGovernorate(customer.governorate),
    city: customer.city || "",
    address: customer.address || "",
    ...customer,
    governorate: normalizeGovernorate(customer.governorate)
  }));
  normalized.settings = { ...seed.settings, ...(normalized.settings || {}) };
  normalized.settings.permissions = normalized.settings.permissions || { roles: {}, users: {} };
  normalized.settings.permissions.roles = normalized.settings.permissions.roles || {};
  normalized.settings.permissions.users = normalized.settings.permissions.users || {};
  normalized.settings.tracking = {
    enabled: true,
    providerName: TRACKING_PROVIDER_NAME,
    providerType: "Browser Automation",
    providerEndpoint: EGYPT_POST_TRACKING_URL,
    providerMethod: "BROWSER",
    originCountry: "EG",
    destinationCountry: "EG",
    cacheLevel: 0,
    intervalHours: 6,
    minIntervalHours: 6,
    maxConcurrent: 1,
    minDelaySeconds: 15,
    activeShipmentMaxAgeDays: 45,
    maxAttempts: 5,
    timeoutMs: 45000,
    retryCount: 1,
    noMovementHours: 48,
    complaintNoMovementHours: 72,
    rateLimitMs: 15000,
    slaRules: { defaultDays: 4, byGovernorate: {}, weekends: ["Friday"] },
    statusMapping: {},
    ...(normalized.settings.tracking || {})
  };
  normalized.settings.tracking.providerName = TRACKING_PROVIDER_NAME;
  normalized.settings.tracking.providerType = "Browser Automation";
  normalized.settings.tracking.providerEndpoint = EGYPT_POST_TRACKING_URL;
  normalized.settings.tracking.providerMethod = "BROWSER";
  normalized.settings.tracking.mode = "Browser Automation";
  normalized.settings.tracking.cost = "Free";
  normalized.settings.tracking.subscriptionRequired = false;
  normalized.settings.tracking.apiKeyRequired = false;
  normalized.settings.tracking.originCountry = normalized.settings.tracking.originCountry || "EG";
  normalized.settings.tracking.destinationCountry = normalized.settings.tracking.destinationCountry || "EG";
  normalized.settings.tracking.cacheLevel = Number(normalized.settings.tracking.cacheLevel ?? 0);
  normalized.settings.tracking.intervalHours = [1, 3, 6, 12, 24].includes(Number(normalized.settings.tracking.intervalHours)) ? Number(normalized.settings.tracking.intervalHours) : 6;
  normalized.settings.tracking.minIntervalHours = [1, 3, 6, 12, 24].includes(Number(normalized.settings.tracking.minIntervalHours)) ? Number(normalized.settings.tracking.minIntervalHours) : normalized.settings.tracking.intervalHours;
  normalized.settings.tracking.maxConcurrent = Math.min(2, Math.max(1, Number(normalized.settings.tracking.maxConcurrent || 1)));
  normalized.settings.tracking.minDelaySeconds = Math.max(5, Number(normalized.settings.tracking.minDelaySeconds || 15));
  normalized.settings.tracking.activeShipmentMaxAgeDays = Math.max(1, Number(normalized.settings.tracking.activeShipmentMaxAgeDays || 45));
  normalized.settings.tracking.maxAttempts = Math.max(1, Number(normalized.settings.tracking.maxAttempts || 5));
  normalized.settings.tracking.timeoutMs = Math.max(45000, Number(normalized.settings.tracking.timeoutMs || 45000));
  normalized.settings.tracking.rateLimitMs = Math.max(10000, Number(normalized.settings.tracking.rateLimitMs || 15000));
  normalized.onlineOrders = normalized.onlineOrders.map(order => {
    const linkedCustomer = normalized.customers.find(customer =>
      !customer.deletedAt &&
      ((order.customerId && customer.id === order.customerId) ||
       (normalizePhone(order.phone) && normalizePhone(customer.phone) === normalizePhone(order.phone)))
    );
    const legacyStatusMap = {
      "بانتظار التأكيد": "طلب جديد",
      "تم التأكيد": "قيد التجهيز",
      "تم تأكيد الطلب": "قيد التجهيز",
      "جاري التجهيز": "قيد التجهيز",
      "أمر تجهيز": "قيد التجهيز",
      "تم تجهيز الشحنة": "تم إنشاء الشحنة",
      "تم التغليف": "تم إنشاء الشحنة",
      "تم التسليم لشركة الشحن": "خرج للتوصيل",
      "في الطريق": "خرج للتوصيل"
    };
    return {
      ...order,
      customerId: linkedCustomer?.id || order.customerId || "",
      governorate: normalizeGovernorate(order.governorate || linkedCustomer?.governorate),
      city: order.city || linkedCustomer?.city || "",
      address: order.address || linkedCustomer?.address || "",
      status: legacyStatusMap[order.status] || order.status || "طلب جديد"
    };
  });
  normalized.shipments = normalized.shipments.map(shipment => {
    const linkedOrder = normalized.onlineOrders.find(order => order.id === shipment.onlineOrderId);
    const linkedSale = normalized.sales.find(sale =>
      sale.id === shipment.invoiceId ||
      sale.id === shipment.orderId ||
      (linkedOrder && sale.id === linkedOrder.saleId) ||
      (shipment.onlineOrderId && sale.onlineOrderId === shipment.onlineOrderId)
    );
    const carrier = shipment.carrier || shipment.company || "";
    const trackingNumber = normalizeTrackingNumber(shipment.trackingNumber || shipment.tracking || "");
    const isEgyptPost = isEgyptPostCarrier(carrier);
    return {
      ...shipment,
      shipmentNo: shipment.shipmentNo || shipment.id,
      carrier,
      carrierCode: shipment.carrierCode || (isEgyptPost ? "EGYPT_POST" : ""),
      trackingNumber,
      tracking: trackingNumber || shipment.tracking || "",
      trackingEnabled: shipment.trackingEnabled ?? (isEgyptPost && Boolean(trackingNumber)),
      trackingProvider: shipment.trackingProvider || (isEgyptPost ? normalized.settings.tracking.providerName : ""),
      currentStatus: shipment.currentStatus || shipment.status || "",
      normalizedStatus: shipment.normalizedStatus || normalizeTrackingStatusText(shipment.currentStatus || shipment.status || ""),
      customerName: shipment.customerName || shipment.customer || "",
      customerPhone: shipment.customerPhone || shipment.phone || "",
      trackingErrorCount: Number(shipment.trackingErrorCount || 0),
      alertLevel: shipment.alertLevel || "info",
      delayHours: Number(shipment.delayHours || 0),
      delayDays: Number(shipment.delayDays || 0),
      requiresComplaint: Boolean(shipment.requiresComplaint),
      requiresCustomerCall: Boolean(shipment.requiresCustomerCall),
      returnRisk: Boolean(shipment.returnRisk),
      invoiceId: linkedSale?.id || shipment.invoiceId || (String(shipment.orderId || "").startsWith("INV-") ? shipment.orderId : ""),
      onlineOrderId: shipment.onlineOrderId || linkedSale?.onlineOrderId || "",
      governorate: normalizeGovernorate(shipment.governorate || linkedOrder?.governorate || linkedSale?.customerSnapshot?.governorate),
      city: shipment.city || linkedOrder?.city || linkedSale?.customerSnapshot?.city || "",
      address: shipment.address || linkedOrder?.address || linkedSale?.customerSnapshot?.address || ""
    };
  });
  normalized.onlineOrders.forEach(order => {
    const linkedSale = normalized.sales.find(sale => sale.id === order.saleId || sale.onlineOrderId === order.id);
    const linkedShipment = normalized.shipments.find(shipment => shipment.id === order.shipmentId || shipment.onlineOrderId === order.id || shipment.invoiceId === linkedSale?.id);
    if (linkedSale) {
      order.saleId = linkedSale.id;
      linkedSale.onlineOrderId = order.id;
      linkedSale.customerId = linkedSale.customerId || order.customerId;
      linkedSale.customerSnapshot = linkedSale.customerSnapshot || customerSnapshot(getCustomerFrom(normalized.customers, linkedSale.customerId), order);
    }
    if (linkedShipment) {
      order.shipmentId = linkedShipment.id;
      linkedShipment.onlineOrderId = order.id;
      if (linkedSale) {
        linkedShipment.invoiceId = linkedSale.id;
        linkedShipment.orderId = linkedSale.id;
        linkedSale.shipmentId = linkedShipment.id;
      }
      const shipmentStatusMap = { "جديدة":"تم إنشاء الشحنة", "تم التجهيز":"تم إنشاء الشحنة", "تم التسليم للشركة":"خرج للتوصيل", "في الطريق":"خرج للتوصيل", "خرج للتوصيل":"خرج للتوصيل", "تم التسليم":"تم التسليم", "مرتجع":"مرتجع" };
      order.status = shipmentStatusMap[linkedShipment.status] || order.status;
    } else if (linkedSale && !["ملغي","مرتجع"].includes(order.status)) {
      order.status = "تم إنشاء الفاتورة";
    }
  });
  normalized.cash = normalized.cash.map(item => {
    const movement = normalizeCashMovement(item);
    const refs = [movement.id, ...cashRelatedReferences(movement)].filter(Boolean);
    const auditMatch = normalized.audit.slice().reverse().find(row => {
      const text = `${row.entityId || ""} ${row.action || ""}`;
      return refs.some(ref => text.includes(ref));
    });
    if (auditMatch && (!item.createdBy || String(movement.createdBy).startsWith("غير مسجل"))) {
      movement.createdBy = auditMatch.user || movement.createdBy;
      movement.createdByUsername = auditMatch.username || movement.createdByUsername || "";
      movement.createdByRole = auditMatch.role || movement.createdByRole || "";
      movement.createdById = auditMatch.userId || movement.createdById || "";
      if (!item.createdAt) movement.createdAt = auditMatch.date || movement.createdAt;
      movement.updatedAt = movement.updatedAt || movement.createdAt;
    }
    return movement;
  });
  normalized.settings = { ...seed.settings, ...(normalized.settings || {}) };
  normalized.settings.permissions = normalized.settings.permissions || { roles: {}, users: {} };
  normalized.settings.permissions.roles = normalized.settings.permissions.roles || {};
  normalized.settings.permissions.users = normalized.settings.permissions.users || {};
  normalized.settings.tracking = {
    enabled: true,
    providerName: TRACKING_PROVIDER_NAME,
    providerType: "Browser Automation",
    providerEndpoint: EGYPT_POST_TRACKING_URL,
    providerMethod: "BROWSER",
    originCountry: "EG",
    destinationCountry: "EG",
    cacheLevel: 0,
    intervalHours: 6,
    minIntervalHours: 6,
    maxConcurrent: 1,
    minDelaySeconds: 15,
    activeShipmentMaxAgeDays: 45,
    maxAttempts: 5,
    timeoutMs: 45000,
    retryCount: 1,
    noMovementHours: 48,
    complaintNoMovementHours: 72,
    rateLimitMs: 15000,
    slaRules: { defaultDays: 4, byGovernorate: {}, weekends: ["Friday"] },
    statusMapping: {},
    ...(normalized.settings.tracking || {})
  };
  normalized.settings.tracking.providerName = TRACKING_PROVIDER_NAME;
  normalized.settings.tracking.providerType = "Browser Automation";
  normalized.settings.tracking.providerEndpoint = EGYPT_POST_TRACKING_URL;
  normalized.settings.tracking.providerMethod = "BROWSER";
  normalized.settings.tracking.mode = "Browser Automation";
  normalized.settings.tracking.cost = "Free";
  normalized.settings.tracking.subscriptionRequired = false;
  normalized.settings.tracking.apiKeyRequired = false;
  normalized.settings.tracking.intervalHours = [1, 3, 6, 12, 24].includes(Number(normalized.settings.tracking.intervalHours)) ? Number(normalized.settings.tracking.intervalHours) : 6;
  normalized.settings.tracking.minIntervalHours = [1, 3, 6, 12, 24].includes(Number(normalized.settings.tracking.minIntervalHours)) ? Number(normalized.settings.tracking.minIntervalHours) : normalized.settings.tracking.intervalHours;
  normalized.settings.tracking.maxConcurrent = Math.min(2, Math.max(1, Number(normalized.settings.tracking.maxConcurrent || 1)));
  normalized.settings.tracking.minDelaySeconds = Math.max(5, Number(normalized.settings.tracking.minDelaySeconds || 15));
  normalized.settings.tracking.activeShipmentMaxAgeDays = Math.max(1, Number(normalized.settings.tracking.activeShipmentMaxAgeDays || 45));
  normalized.settings.tracking.maxAttempts = Math.max(1, Number(normalized.settings.tracking.maxAttempts || 5));
  normalized.settings.tracking.timeoutMs = Math.max(45000, Number(normalized.settings.tracking.timeoutMs || 45000));
  normalized.settings.tracking.rateLimitMs = Math.max(10000, Number(normalized.settings.tracking.rateLimitMs || 15000));
  return normalized;
}

async function persistToServer() {
  const response = await fetch("/api/db", {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json; charset=utf-8", ...(dbRevision ? { "If-Match": dbRevision } : {}) }),
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    if (response.status === 409) saveConflict = true;
    if (response.status === 401) showLogin("انتهت جلسة الدخول. سجّل الدخول مرة أخرى.");
    const error = new Error(result.message || "تعذر حفظ قاعدة البيانات.");
    error.code = result.code || (response.status === 409 ? "DATABASE_WRITE_BLOCKED_STALE_REVISION" : "DATABASE_WRITE_FAILED");
    error.revision = result.revision || "";
    throw error;
  }
  const result = await response.json().catch(() => ({}));
  dbRevision = response.headers.get("X-DB-Revision") || result.revision || dbRevision;
  lastSuccessfulSaveAt = new Date().toISOString();
  saveConflict = false;
  lastSaveError = null;
}

function saveData(action = "", entity = "", entityId = "") {
  lastSaveError = null;
  stampCashMovements();
  if (action) {
    data.audit.push(auditEntry({
      action,
      operationType: action,
      moduleName: entity,
      entityType: entity,
      entity,
      entityId,
      documentNo: entityId
    }));
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  if (!serverConnected) return Promise.resolve(false);

  setStorageStatus("جارٍ حفظ البيانات...", true);
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => persistToServer())
    .then(() => {
      setStorageStatus("البيانات محفوظة", true);
      return true;
    })
    .catch(error => {
      lastSaveError = error;
      setStorageStatus("فشل الحفظ على القرص", false);
      toast(error.message || "حدث خطأ أثناء حفظ البيانات.", "error");
      return false;
    });
  return saveQueue;
}

window.addEventListener("beforeunload", event => {
  if (!hasUnsavedPurchaseDraft()) return;
  event.preventDefault();
  event.returnValue = "";
});

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isCorruptedDisplayText(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  return /[\uFFFD]|â|Ã|Â|ë|ï¿½|ط[\u00A0-\u02FF]|ظ[\u00A0-\u02FF]|آ[·]/.test(text);
}

function cleanDisplayText(value = "", fallback = "غير متاح", emptyFallback = fallback) {
  const text = String(value || "").trim();
  if (!text || text === "—" || text === "—") return emptyFallback;
  if (isCorruptedDisplayText(text)) return fallback;
  return text;
}

function latestShipmentTrackingRun(shipmentId) {
  return (data.trackingRuns || [])
    .filter(row => row.shipmentId === shipmentId)
    .sort((a, b) => new Date(b.finishedAt || b.startedAt || 0) - new Date(a.finishedAt || a.startedAt || 0))[0] || null;
}

function shipmentTrackingHistory(shipmentId) {
  return (data.trackingHistory || [])
    .filter(row => row.shipmentId === shipmentId)
    .sort((a, b) => new Date(b.eventAt || b.fetchedAt || 0) - new Date(a.eventAt || a.fetchedAt || 0));
}

function shipmentTrackingSummary(item = {}) {
  const history = shipmentTrackingHistory(item.id);
  const latestHistory = history.find(row => !isCorruptedDisplayText(row.statusText) || !isCorruptedDisplayText(row.location));
  const lastRun = latestShipmentTrackingRun(item.id);
  const failureCode = lastRun?.failureCode || item.trackingDiagnostics?.failureCode || item.trackingDebug?.failureCode || "";
  const failureMessage = lastRun?.failureMessage || item.trackingDiagnostics?.failureMessage || item.trackingError || "";
  const siteBlocked = failureCode === "SITE_BLOCKED" || /Cloudflare|block|يمنع|حماية/i.test(failureMessage);
  const hasConfirmed = Boolean(latestHistory?.statusText || latestHistory?.location);
  if (hasConfirmed) {
    return {
      statusText: cleanDisplayText(latestHistory.statusText || item.lastStatusText, "غير متاح", "لا توجد حركة مؤكدة"),
      location: cleanDisplayText(latestHistory.location || item.currentLocation, "غير متاح", "لا يوجد موقع مؤكد"),
      movement: latestHistory.eventAt || latestHistory.fetchedAt ? dateTimeLabel(latestHistory.eventAt || latestHistory.fetchedAt) : "لا توجد حركة مؤكدة",
      hasConfirmed: true,
      lastRun,
      failureCode,
      failureMessage,
      siteBlocked
    };
  }
  return {
    statusText: siteBlocked ? "فشل التتبع الآلي" : "لا توجد حركة مؤكدة",
    location: isCorruptedDisplayText(item.currentLocation) ? "غير متاح" : "لا يوجد موقع مؤكد",
    movement: "لا توجد حركة مؤكدة",
    hasConfirmed: false,
    lastRun,
    failureCode,
    failureMessage,
    siteBlocked
  };
}

function money(value) {
  return `${Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ${data.settings.currency}`;
}

function fmtDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function operationDateParts(value = new Date()) {
  const date = new Date(value);
  return {
    dateOnly: date.toISOString().slice(0, 10),
    dayName: new Intl.DateTimeFormat("ar-EG", { weekday: "long" }).format(date),
    time: date.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  };
}

function userLabel(user = currentUser) {
  return user?.name || user?.username || "النظام";
}

function auditEntry(payload = {}) {
  const actor = actorSnapshot();
  const now = payload.createdAt || new Date().toISOString();
  const parts = operationDateParts(now);
  const entry = {
    operationId: payload.operationId || payload.id || `OP-${Date.now()}`,
    operationType: payload.operationType || payload.action || "عملية",
    moduleName: payload.moduleName || payload.entity || "",
    entityType: payload.entityType || payload.entity || "",
    entityId: payload.entityId || "",
    documentNo: payload.documentNo || payload.entityId || "",
    action: payload.action || payload.operationType || "",
    oldValue: payload.oldValue ?? "",
    newValue: payload.newValue ?? "",
    userId: payload.userId || actor.userId || "",
    employeeName: payload.employeeName || actor.name || "النظام",
    employeeRole: payload.employeeRole || actor.role || "",
    username: payload.username || actor.username || "",
    user: payload.employeeName || actor.name || "النظام",
    role: payload.employeeRole || actor.role || "",
    date: now,
    dayName: payload.dayName || parts.dayName,
    time: payload.time || parts.time,
    createdAt: now,
    notes: payload.notes || "",
    entity: payload.entity || payload.moduleName || "",
    entityId: payload.entityId || ""
  };
  return AuditIds.assignUniqueAuditId(data.audit || [], entry);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nextId(prefix, list) {
  const max = list.reduce((acc, item) => {
    const number = Number(String(item.id).replace(/\D/g, ""));
    return Math.max(acc, number || 0);
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function nextReturnNo(prefix) {
  const max = (data.returns || []).reduce((acc, item) => {
    const value = item.returnNo || item.returnInvoiceId || item.id || "";
    if (!String(value).startsWith(prefix)) return acc;
    return Math.max(acc, Number(String(value).replace(/\D/g, "")) || 1000);
  }, 1000);
  return `${prefix}${max + 1}`;
}

function getBook(id) { return data.books.find(item => item.id === id); }
function getCustomer(id) { return data.customers.find(item => item.id === id); }
function getSupplier(id) { return data.suppliers.find(item => item.id === id); }
function activeCash() { return data.cash.filter(item => !item.deletedAt); }
function isLockedCash(item) { return !!(item && (item.locked || item.receiptId)); }
function activeSalesList() { return data.sales.filter(sale => !sale.deletedAt && sale.status !== "ملغاة"); }

function itemTypeLabel(item) {
  return item?.itemType || (String(item?.category || "").includes("كتب") || item?.author || item?.publisher || item?.grade ? "كتاب" : "صنف عام");
}

function itemUnitLabel(item) {
  return item?.unit || "قطعة";
}

function itemSubtitle(item) {
  return [itemTypeLabel(item), item.category, item.author, item.publisher, item.grade].filter(Boolean).join(" · ");
}

function normalizeSmartSearch(value) {
  return String(value || "")
    .toLocaleLowerCase("ar")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, digit => "٠١٢٣٤٥٦٧٨٩".indexOf(digit))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeArabicDigits(value = "") {
  return String(value)
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

function normalizeArabicNumericText(value = "") {
  return normalizeArabicDigits(value)
    .replace(/[٫،]/g, ".")
    .replace(/٬/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, "");
}

function isIntegerNumericInput(input) {
  return input.matches([
    ".sale-qty", ".purchase-qty", ".ool-qty", ".count-actual-stock",
    ".customer-return-qty", ".supplier-return-qty", ".sale-return-qty",
    "#sale-quick-qty", "#purchase-quick-qty", "#tracking-min-delay",
    "#tracking-max-attempts", "#tracking-no-movement", "#tracking-complaint-hours",
    "[name^='qty-']", "[name^='returnQty-']", "[name^='actual-']",
    "[name='stock']", "[name='reorder']", "[name='terms']"
  ].join(","));
}

function configureNumericInput(input) {
  if (!(input instanceof HTMLInputElement) || (input.type !== "number" && input.dataset.numericInput !== "true")) return false;
  if (input.dataset.numericInput !== "true") {
    input.dataset.numericInput = "true";
    input.dataset.numericKind = isIntegerNumericInput(input) ? "integer" : "decimal";
    input.dataset.allowNegative = ["balance", "openingBalance"].includes(input.name) ? "true" : "false";
    input.type = "text";
    input.inputMode = input.dataset.numericKind === "integer" ? "numeric" : "decimal";
  }
  return true;
}

function numericFieldAttributes({ id = "", name = "", value = 0, kind = "decimal", min = 0 } = {}) {
  return `${id ? `id="${esc(id)}" ` : ""}name="${esc(name)}" type="text" inputmode="${kind === "integer" ? "numeric" : "decimal"}" data-numeric-input="true" data-numeric-kind="${kind}" data-allow-negative="false" min="${min}" value="${esc(value)}"`;
}

function sanitizeNumericInputValue(input, { commit = false } = {}) {
  if (!configureNumericInput(input)) return "";
  const integer = input.dataset.numericKind === "integer";
  const allowNegative = input.dataset.allowNegative === "true";
  let value = normalizeArabicNumericText(input.value);
  const negative = allowNegative && value.startsWith("-");
  value = value.replace(/-/g, "").replace(/[^0-9.]/g, "");
  const parts = value.split(".");
  value = integer ? parts[0] : `${parts.shift() || ""}${parts.length ? `.${parts.join("")}` : ""}`;
  if (negative) value = `-${value}`;
  if (!commit && ["", "-", ".", "-.", "0.", "-0."].includes(value)) return value;
  if (!commit) return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const min = input.hasAttribute("min") ? Number(input.getAttribute("min")) : null;
  const max = input.hasAttribute("max") ? Number(input.getAttribute("max")) : null;
  let normalized = integer ? Math.trunc(number) : number;
  if (!allowNegative && normalized < 0) normalized = 0;
  if (Number.isFinite(min)) normalized = Math.max(min, normalized);
  if (Number.isFinite(max)) normalized = Math.min(max, normalized);
  return String(normalized);
}

function isEditableElement(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
}

function bookSearchText(book = {}) {
  return normalizeSmartSearch([
    book.id, book.name, book.barcode, book.extraBarcode, book.internalCode,
    book.itemType, book.category, book.grade, book.publisher, book.author,
    book.teacher, book.keywords, book.aliases, book.shelf, itemTypeLabel(book)
  ].filter(Boolean).join(" "));
}

function smartBookSearch(term, limit = 8) {
  const query = normalizeSmartSearch(term);
  if (!query) return [];
  const words = query.split(/\s+/).filter(Boolean);
  return data.books
    .filter(book => !book.deletedAt)
    .map(book => {
      const text = bookSearchText(book);
      const compact = text.replace(/\s+/g, "");
      let score = 0;
      if (text.includes(query) || compact.includes(query.replace(/\s+/g, ""))) score += 20;
      words.forEach(word => {
        if (text.includes(word)) score += 6;
        else if ([...new Set(text.split(/\s+/))].some(token => token.includes(word) || word.includes(token))) score += 2;
      });
      if (normalizeSmartSearch(book.barcode) === query || normalizeSmartSearch(book.extraBarcode) === query || normalizeSmartSearch(book.id) === query) score += 40;
      return { book, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.book.name).localeCompare(String(b.book.name), "ar"))
    .slice(0, limit)
    .map(item => item.book);
}

function bookSuggestionButton(book, action, extra = "") {
  const summary = productInventorySummary(book.id);
  return `<button type="button" data-action="${action}" data-id="${book.id}">
    <strong>${esc(book.name)}</strong>
    <span>${esc(book.barcode || book.id)} · ${esc(itemTypeLabel(book))} · رصيد ${Number(book.stock || 0).toLocaleString("ar-EG")} ${esc(itemUnitLabel(book))} · بيع ${money(productDefaultSellingPrice(book))} · متوسط تكلفة ${summary.hasIncompleteCost ? "تكلفة غير مكتملة" : money(summary.averageInventoryCost)}${extra}</span>
  </button>`;
}

function bookPickerLabel(book, includeStock = true) {
  if (!book) return "";
  const parts = [book.name, book.barcode || book.id, itemTypeLabel(book)];
  if (includeStock) parts.push(`رصيد ${Number(book.stock || 0).toLocaleString("ar-EG")} ${itemUnitLabel(book)}`);
  return parts.filter(Boolean).join(" - ");
}

function bookPickerDatalist(id, includeStock = true) {
  return `<datalist id="${esc(id)}">${data.books.filter(book => !book.deletedAt).map(book => `<option value="${esc(bookPickerLabel(book, includeStock))}"></option>`).join("")}</datalist>`;
}

function productCoverPrice(book = {}) {
  return Number(book.coverPrice ?? book.purchaseListPrice ?? book.price ?? 0);
}

function productDefaultSellingPrice(book = {}) {
  return Number(book.defaultSellingPrice ?? book.price ?? 0);
}

function activeInventoryBatches(productId) {
  return (data.inventoryBatches || [])
    .filter(batch => !batch.deletedAt && (batch.productId || batch.bookId) === productId && Number(batch.remainingQty || 0) > 0)
    .sort((a, b) => String(a.purchaseDate || "").localeCompare(String(b.purchaseDate || "")) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.batchId || a.id).localeCompare(String(b.batchId || b.id)));
}

function latestApprovedPurchaseCost(productId) {
  const approved = (data.purchases || [])
    .filter(purchase => !purchase.deletedAt && !/ملغاة|بانتظار|قيد/.test(String(purchase.status || "")) && (purchase.lines || []).some(line => (line.bookId || line.productId) === productId))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id || "").localeCompare(String(b.id || "")));
  const purchase = approved.at(-1);
  if (!purchase) return null;
  const matchingLines = (purchase.lines || []).filter(line => (line.bookId || line.productId) === productId);
  const line = matchingLines.at(-1);
  if (!line) return null;
  const quantity = Number(line.qty || line.quantity || 0);
  const explicitTotal = line.totalCost ?? line.finalNet ?? line.total;
  const total = explicitTotal === undefined || explicitTotal === null ? NaN : Number(explicitTotal);
  const unitCost = quantity > 0 && Number.isFinite(total)
    ? total / quantity
    : Number(line.unitPurchaseCost ?? line.cost ?? NaN);
  return Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : null;
}

function productInventorySummary(productId) {
  const book = getBook(productId) || {};
  const batches = activeInventoryBatches(productId);
  const currentStockQty = batches.reduce((sum, batch) => sum + Number(batch.remainingQty || 0), 0);
  const currentInventoryValue = batches.reduce((sum, batch) => sum + Number(batch.remainingQty || 0) * Number(batch.unitCost || 0), 0);
  const averageInventoryCost = currentStockQty > 0 ? currentInventoryValue / currentStockQty : 0;
  const lastPurchaseCost = latestApprovedPurchaseCost(productId);
  const selling = productDefaultSellingPrice(book);
  const expectedMarginAtDefaultPrice = selling > 0 && averageInventoryCost > 0 ? ((selling - averageInventoryCost) / selling) * 100 : null;
  const hasIncompleteCost = batches.some(batch => !Number(batch.unitCost || 0) || batch.status === "cost_incomplete");
  return { batches, currentStockQty, currentInventoryValue, averageInventoryCost, lastPurchaseCost, expectedMarginAtDefaultPrice, hasIncompleteCost };
}

function createInventoryBatch({ productId, purchaseInvoiceId, supplierId, qty, unitCost, coverPrice, purchaseDate, source = "purchase" }) {
  data.inventoryBatches = data.inventoryBatches || [];
  const id = nextId("BAT-", data.inventoryBatches.map(batch => ({ id: batch.batchId || batch.id })));
  const batch = {
    id,
    batchId: id,
    productId,
    bookId: productId,
    purchaseInvoiceId,
    supplierId,
    receivedQty: Number(qty || 0),
    remainingQty: Number(qty || 0),
    unitCost: Number(unitCost || 0),
    coverPrice: Number(coverPrice || 0),
    purchaseDate: purchaseDate || today(),
    source,
    status: Number(unitCost || 0) > 0 ? "active" : "cost_incomplete",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null
  };
  data.inventoryBatches.push(batch);
  return batch;
}

function allocateInventoryFIFO(productId, quantity) {
  const allocations = [];
  let remaining = Number(quantity || 0);
  let costOfGoodsSold = 0;
  let costIncomplete = false;
  activeInventoryBatches(productId).forEach(batch => {
    if (remaining <= 0) return;
    const take = Math.min(remaining, Number(batch.remainingQty || 0));
    if (take <= 0) return;
    batch.remainingQty = Number((Number(batch.remainingQty || 0) - take).toFixed(6));
    batch.updatedAt = new Date().toISOString();
    if (!Number(batch.unitCost || 0)) costIncomplete = true;
    costOfGoodsSold += take * Number(batch.unitCost || 0);
    allocations.push({ batchId: batch.batchId || batch.id, qty: take, unitCost: Number(batch.unitCost || 0) });
    remaining -= take;
  });
  if (remaining > 0) {
    costIncomplete = true;
    allocations.push({ batchId: "UNALLOCATED", qty: remaining, unitCost: null });
  }
  return { allocations, costOfGoodsSold: Number(costOfGoodsSold.toFixed(2)), costIncomplete, unallocatedQty: Number(Math.max(0, remaining).toFixed(6)) };
}

function saleLineRevenue(line) {
  return Number((line.totalSellingPrice ?? line.finalNet ?? (Number(line.qty || line.quantity || 0) * Number(line.price || line.unitSellingPrice || 0))) || 0);
}

function saleLineCogs(line) {
  if (line.costIncomplete) return null;
  if (line.costOfGoodsSold !== undefined && line.costOfGoodsSold !== null) return Number(line.costOfGoodsSold || 0);
  if (Array.isArray(line.batchAllocations) && line.batchAllocations.length) {
    let complete = true;
    const total = line.batchAllocations.reduce((sum, allocation) => {
      if (allocation.unitCost === undefined || allocation.unitCost === null) complete = false;
      return sum + Number(allocation.qty || 0) * Number(allocation.unitCost || 0);
    }, 0);
    return complete ? Number(total.toFixed(2)) : null;
  }
  const book = getBook(line.bookId || line.productId);
  const summary = book ? productInventorySummary(book.id) : null;
  if (!summary || summary.hasIncompleteCost) return null;
  return Number((Number(line.qty || line.quantity || 0) * Number(summary.averageInventoryCost || 0)).toFixed(2));
}

function salesCogsSummary(sales = activeSalesList()) {
  let cost = 0;
  let incompleteLines = 0;
  sales.forEach(sale => (sale.lines || []).forEach(line => {
    const lineCost = saleLineCogs(line);
    if (lineCost === null) incompleteLines += 1;
    else cost += lineCost;
  }));
  return { cost: Number(cost.toFixed(2)), incompleteLines };
}

function resolveBookPickerValue(value) {
  const query = String(value || "").trim();
  if (!query) return null;
  const normalized = normalizeSmartSearch(query);
  return data.books.find(book => !book.deletedAt && normalizeSmartSearch(bookPickerLabel(book, true)) === normalized)
    || data.books.find(book => !book.deletedAt && normalizeSmartSearch(bookPickerLabel(book, false)) === normalized)
    || data.books.find(book => !book.deletedAt && [book.id, book.barcode, book.extraBarcode, book.internalCode].filter(Boolean).some(code => normalizeSmartSearch(code) === normalized))
    || smartBookSearch(query, 1)[0]
    || null;
}

function selectSaleLineBook(index, value) {
  const book = resolveBookPickerValue(value);
  if (!book) {
    if (!String(value || "").trim()) {
      draftSale.lines[index].bookId = "";
      draftSale.lines[index].price = 0;
      renderSales();
    }
    return;
  }
  const duplicateIndex = draftSale.lines.findIndex((line, lineIndex) => lineIndex !== index && line.bookId === book.id);
  if (duplicateIndex >= 0) {
    draftSale.lines[duplicateIndex].qty += Number(draftSale.lines[index].qty || 1);
    draftSale.lines.splice(index, 1);
  } else {
    draftSale.lines[index].bookId = book.id;
    draftSale.lines[index].price = productDefaultSellingPrice(book);
  }
  renderSales();
}

function selectPurchaseLineBook(index, value) {
  const book = resolveBookPickerValue(value);
  if (!book) {
    if (!String(value || "").trim()) {
      draftPurchase.lines[index].bookId = "";
      draftPurchase.lines[index].cost = 0;
      renderPurchases();
    }
    return;
  }
  draftPurchase.lines[index].bookId = book.id;
  draftPurchase.lines[index].coverPriceAtPurchase = productCoverPrice(book);
  draftPurchase.lines[index].supplierDiscountPercent = Number(draftPurchase.lines[index].supplierDiscountPercent || 0);
  draftPurchase.lines[index].cost = calculateDiscountedPurchaseCost(draftPurchase.lines[index].coverPriceAtPurchase, draftPurchase.lines[index].supplierDiscountPercent) || Number(book.lastPurchasePrice || book.cost || 0);
  draftPurchase.lines[index].discount = draftPurchase.lines[index].supplierDiscountPercent;
  draftPurchase.lines[index].discountType = draftPurchase.lines[index].discountType || "percent";
  renderPurchases();
}

function syncPurchaseLineCost(index, source) {
  const line = draftPurchase.lines[index];
  if (!line) return;
  const cover = Math.max(0, Number(line.coverPriceAtPurchase || 0));
  if (source === "discount") {
    const discount = Math.min(100, Math.max(0, Number(line.supplierDiscountPercent || 0)));
    line.supplierDiscountPercent = discount;
    line.discount = discount;
    line.cost = calculateDiscountedPurchaseCost(cover, discount);
  } else if (source === "cost") {
    const cost = Math.max(0, Number(line.cost || 0));
    line.cost = cost;
    line.supplierDiscountPercent = cover > 0 ? Number(Math.max(0, Math.min(100, ((cover - cost) / cover) * 100)).toFixed(2)) : 0;
    line.discount = line.supplierDiscountPercent;
  }
}

function itemTypeOptions(selected = "") {
  const defaults = ["كتاب", "كراسة", "كشكول", "سبلايز", "أدوات مكتبية", "شنط", "هدايا", "صنف عام"];
  return [...new Set([...defaults, ...data.books.map(item => item.itemType).filter(Boolean)])]
    .map(type => `<option value="${esc(type)}" ${type === selected ? "selected" : ""}>${esc(type)}</option>`)
    .join("");
}

function itemUnitOptions(selected = "") {
  const defaults = ["قطعة", "نسخة", "علبة", "دستة", "باكت", "كرتونة", "طقم"];
  return [...new Set([...defaults, ...data.books.map(item => item.unit).filter(Boolean)])]
    .map(unit => `<option value="${esc(unit)}" ${unit === selected ? "selected" : ""}>${esc(unit)}</option>`)
    .join("");
}

function badge(text, kind = "") {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

function stockBadge(book) {
  const label = `${book.stock} ${itemUnitLabel(book)}`;
  if (book.stock <= 0) return badge(label, "danger");
  if (book.stock <= book.reorder) return badge(label, "warning");
  return badge(label);
}

function toast(message, type = "") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.innerHTML = `<span>${type === "error" ? "!" : "✓"}</span><strong>${esc(message)}</strong>`;
  document.getElementById("toast-root").appendChild(item);
  setTimeout(() => item.remove(), 3200);
}

function openModal(title, eyebrow, html) {
  modalTitle.textContent = title;
  modalEyebrow.textContent = eyebrow;
  modalBody.innerHTML = html;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  stickyTableScroll.wrap = null;
  scheduleStickyTableScrollbar();
}

function closeModal() {
  modal.hidden = true;
  modalBody.innerHTML = "";
  document.body.style.overflow = "";
  stickyTableScroll.wrap = null;
  refreshStickyTableScrollbar();
}

function financeConfirmation({ title, description, confirmLabel, tone="primary", onConfirm }) {
  pendingFinanceConfirmation=onConfirm;
  openModal(title,"تأكيد إجراء مالي",`<div class="confirmation-copy"><div class="confirmation-icon ${tone}">!</div><p>${esc(description)}</p></div><div class="form-actions"><button class="btn ${tone==="danger"?"danger":""}" type="button" data-action="confirm-finance-action">${esc(confirmLabel)}</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>`);
  setTimeout(()=>modalBody.querySelector('[data-action="confirm-finance-action"]')?.focus(),0);
}

function ensureStickyTableScrollbar() {
  if (stickyTableScroll.bar) return stickyTableScroll.bar;
  const bar = document.createElement("div");
  bar.className = "sticky-table-scrollbar";
  bar.hidden = true;
  bar.setAttribute("aria-label", "شريط تمرير أفقي ثابت للجدول");
  const inner = document.createElement("div");
  inner.className = "sticky-table-scrollbar-inner";
  bar.appendChild(inner);
  document.body.appendChild(bar);
  stickyTableScroll.bar = bar;
  stickyTableScroll.inner = inner;
  bar.addEventListener("scroll", () => {
    if (!stickyTableScroll.wrap || stickyTableScroll.syncing) return;
    stickyTableScroll.syncing = true;
    stickyTableScroll.wrap.scrollLeft = bar.scrollLeft;
    stickyTableScroll.syncing = false;
  });
  return bar;
}

function tableWrapVisible(wrap) {
  if (!wrap || !wrap.isConnected) return false;
  const rect = wrap.getBoundingClientRect();
  return rect.width > 40 && rect.height > 20 && !wrap.closest("[hidden]");
}

function tableWrapNeedsSticky(wrap) {
  return tableWrapVisible(wrap) && wrap.scrollWidth > wrap.clientWidth + 4;
}

function findStickyTableWrap() {
  if (tableWrapNeedsSticky(stickyTableScroll.wrap)) return stickyTableScroll.wrap;
  const scope = modal.hidden ? root : modalBody;
  const wraps = [...scope.querySelectorAll(".table-wrap")].filter(tableWrapNeedsSticky);
  if (!wraps.length) return null;
  return wraps.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const aVisible = Math.max(0, Math.min(ar.bottom, window.innerHeight) - Math.max(ar.top, 0));
    const bVisible = Math.max(0, Math.min(br.bottom, window.innerHeight) - Math.max(br.top, 0));
    const aScore = aVisible || Math.max(1, 100000 - Math.abs(ar.top));
    const bScore = bVisible || Math.max(1, 100000 - Math.abs(br.top));
    return bScore - aScore;
  })[0];
}

function refreshStickyTableScrollbar() {
  const bar = ensureStickyTableScrollbar();
  const wrap = findStickyTableWrap();
  if (!wrap) {
    bar.hidden = true;
    stickyTableScroll.wrap = null;
    return;
  }
  stickyTableScroll.wrap = wrap;
  const rect = wrap.getBoundingClientRect();
  const containerRect = modal.hidden ? null : modal.querySelector(".modal")?.getBoundingClientRect();
  const bottom = containerRect ? Math.max(8, window.innerHeight - containerRect.bottom + 8) : 8;
  bar.hidden = false;
  bar.style.left = `${Math.max(8, rect.left)}px`;
  bar.style.width = `${Math.max(120, Math.min(rect.width, window.innerWidth - Math.max(8, rect.left) - 8))}px`;
  bar.style.bottom = `${bottom}px`;
  stickyTableScroll.inner.style.width = `${wrap.scrollWidth}px`;
  if (bar.scrollLeft !== wrap.scrollLeft) bar.scrollLeft = wrap.scrollLeft;
}

function scheduleStickyTableScrollbar() {
  if (stickyTableScroll.raf) cancelAnimationFrame(stickyTableScroll.raf);
  stickyTableScroll.raf = requestAnimationFrame(() => {
    stickyTableScroll.raf = null;
    refreshStickyTableScrollbar();
  });
}

function statCard(label, value, note, icon, tone = "", trend = "", action = "") {
  const interactive = Boolean(action);
  const isOnlineOrderFilter = String(action || "").startsWith("online-orders:");
  const isShippingFilter = String(action || "").startsWith("shipping:");
  const isSalesStat = String(action || "").startsWith("sales:");
  const actionName = isOnlineOrderFilter ? "online-order-stat" : isShippingFilter ? "shipping-stat" : isSalesStat ? "sales-stat" : "dashboard-stat";
  const activeClass = (isOnlineOrderFilter && action === `online-orders:${onlineOrderQuickFilter}`)
    || (isShippingFilter && action === `shipping:${shippingQuickFilter}`)
    ? "active" : "";
  return `
    <article class="stat-card ${interactive ? "interactive" : ""} ${activeClass}" ${interactive ? `data-action="${actionName}" data-stat="${action}" role="button" tabindex="0" aria-label="عرض تفاصيل ${esc(label)}"` : ""}>
      <div class="stat-top">
        <div class="stat-icon ${tone}">${icon}</div>
        ${trend ? `<span class="trend ${trend.startsWith("-") ? "down" : ""}">${esc(trend)}</span>` : ""}
      </div>
      <label>${esc(label)}</label>
      <strong>${value}</strong>
      <small>${esc(note)}</small>
      ${interactive ? `<span class="stat-open">عرض التفاصيل والإجراءات →</span>` : ""}
    </article>`;
}

function renderDashboard() {
  const sales = activeSalesList();
  const totalSales = sales.reduce((sum, inv) => sum + inv.total, 0);
  const inventoryCost = data.books.reduce((sum, book) => sum + productInventorySummary(book.id).currentInventoryValue, 0);
  const customerDebt = data.customers.reduce((sum, item) => sum + item.balance, 0);
  const lowStock = data.books.filter(book => book.stock <= book.reorder);
  const staleBooks = data.books.filter(book => {
    if (!book.lastSale) return true;
    return (Date.now() - new Date(book.lastSale).getTime()) / 86400000 >= data.settings.staleDays;
  });
  const consignment = data.books.filter(book => !book.owned);
  const dashboardAlerts = getNotificationItems();
  const maxChart = Math.max(...sales.map(s => s.total), 1000);
  const manualReviewShipments = data.shipments.filter(item => !item.deletedAt && (item.manualInterventionNeeded || item.manual_review_required));
  const todayKey = new Date().toISOString().slice(0, 10);
  const manualUpdatedToday = (data.trackingHistory || []).filter(row => row.source === "manual_review" && String(row.reviewedAt || row.createdAt || "").slice(0, 10) === todayKey).length;
  const notUpdatedAges = data.shipments.filter(item => !item.deletedAt && !item.lastTrackingAt).map(item => Math.max(0, (Date.now() - new Date(item.createdAt || item.updatedAt || Date.now()).getTime()) / 86400000));
  const avgNotUpdatedAge = notUpdatedAges.length ? Math.round(notUpdatedAges.reduce((sum, age) => sum + age, 0) / notUpdatedAges.length) : 0;

  root.innerHTML = `
    <div class="welcome">
      <span class="eyebrow">صباح الخير، مدير النظام</span>
      <h2>أداء المكتبة تحت عينك، من مكان واحد.</h2>
      <p>متابعة فورية للمبيعات والمخزون والمديونيات والشحنات. الأرقام الحالية تجريبية ويمكنك تعديلها وإضافة بياناتك الحقيقية.</p>
    </div>
    <div class="stats-grid">
      ${statCard("إجمالي المبيعات", money(totalSales), "إجمالي الفواتير المسجلة", "↗", "", "+12.4%", "sales")}
      ${statCard("قيمة المخزون", money(inventoryCost), `${data.books.length} صنف مسجل`, "▤", "gold", "+4.1%", "inventory")}
      ${statCard("مديونية العملاء", money(customerDebt), "أرصدة آجلة قائمة", "👤", "blue", "", "customer-debt")}
      ${statCard("أصناف تحتاج انتباه", lowStock.length, "منخفضة أو سالبة المخزون", "!", "red", "", "stock-alerts")}
      ${statCard("شحنات تحتاج مراجعة", manualReviewShipments.length, "تحتاج مراجعة يدوية بعد تعذر التحديث", "⚑", "gold", "", "shipping")}
      ${statCard("تحديث يدوي اليوم", manualUpdatedToday, "نتائج تتبع سجلها الموظفون", "✓", "blue", "", "shipping")}
      ${statCard("متوسط عمر غير المحدث", `${avgNotUpdatedAge} يوم`, "شحنات بلا آخر تحديث تتبع", "⌁", "red", "", "shipping")}
    </div>
    <div class="dashboard-grid">
      <article class="card">
        <div class="card-header">
          <div><h3>حركة المبيعات الأخيرة</h3><p>قيمة الفواتير مقارنة بصافي الربح التقديري</p></div>
          <button class="btn ghost small" data-view-jump="reports">عرض التقارير</button>
        </div>
        <div class="card-body">
          <div class="chart">
            <div class="chart-y"><span>${money(maxChart)}</span><span>${money(maxChart / 2)}</span><span>0</span></div>
            <div class="bars">
              ${sales.slice(-7).map((sale, index) => {
                const profit = sale.lines.reduce((sum, line) => {
                  const book = getBook(line.bookId);
                  return sum + ((line.price || 0) - (book?.cost || 0)) * line.qty;
                }, sale.total * .18);
                return `<div class="bar-group">
                  <div class="bar" style="height:${Math.max(12, sale.total / maxChart * 86)}%"></div>
                  <div class="bar alt" style="height:${Math.max(8, profit / maxChart * 86)}%"></div>
                  <span class="bar-label">${index + 1}</span>
                </div>`;
              }).join("")}
            </div>
          </div>
          <div class="chart-legend"><span><i class="legend-dot"></i>المبيعات</span><span><i class="legend-dot alt"></i>الربح التقديري</span></div>
        </div>
      </article>
      <article class="card">
        <div class="card-header"><div><h3>تنبيهات تحتاج قرارًا</h3><p>اضغط على التنبيه لفتح التفاصيل أو اختر إجراءً مباشرًا</p></div>${dashboardAlerts.length ? `<button class="badge danger alert-count-button" data-action="open-notifications" aria-label="عرض كل التنبيهات">${dashboardAlerts.length}</button>` : ""}</div>
        <div class="card-body alert-list">
          ${dashboardAlerts.slice(0, 3).map(dashboardAlertItem).join("") || `<div class="empty-state compact"><div class="empty-icon">✓</div><h3>لا توجد تنبيهات عاجلة</h3><p>كل المؤشرات في وضع مستقر.</p></div>`}
          ${dashboardAlerts.length > 3 ? `<button class="dashboard-alert-more" data-action="open-notifications">عرض كل التنبيهات (${dashboardAlerts.length})</button>` : ""}
        </div>
      </article>
    </div>
    <div class="dashboard-grid" style="margin-top:18px">
      <article class="card">
        <div class="card-header"><div><h3>أحدث الفواتير</h3><p>آخر عمليات البيع المسجلة</p></div><button class="btn secondary small" data-view-jump="sales">فاتورة جديدة</button></div>
        <div class="table-wrap">
          <table><thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>القناة</th><th>الإجمالي</th><th>الحالة</th></tr></thead>
          <tbody>${data.sales.slice().reverse().slice(0, 5).map(sale => `<tr><td><strong>${sale.id}</strong><br><span class="muted">${fmtDate(sale.date)}</span></td><td>${esc(getCustomer(sale.customerId)?.name || "عميل نقدي")}</td><td>${esc(sale.channel)}</td><td class="money">${money(sale.total)}</td><td>${badge(sale.status, sale.status === "معتمدة" ? "" : "warning")}</td></tr>`).join("")}</tbody></table>
        </div>
      </article>
      <article class="card" id="dashboard-shipments-card">
        <div class="card-header">
          <div><h3>الشحنات الجارية</h3><p id="shipment-refresh-status">${shipmentRefreshText()}</p></div>
          <div class="shipment-card-actions"><button class="btn ghost small refresh-button" data-action="refresh-dashboard-shipments"><span class="refresh-icon">↻</span> تحديث الآن</button><button class="btn ghost small" data-view-jump="shipping">متابعة</button></div>
        </div>
        <div class="card-body activity-list" id="dashboard-shipment-list">
          ${dashboardShipmentsMarkup()}
        </div>
      </article>
    </div>`;
}

function requiredDashboardStatsForRole(role) {
  if (role === "كاشير") return ["sales", "stock-alerts"];
  if (role === "مخزن") return ["inventory", "stock-alerts"];
  if (role === "شحن") return ["shipping"];
  return ["sales", "inventory", "customer-debt", "stock-alerts"];
}

function showDashboardStatDetails(type) {
  const activeSales = activeSalesList();
  if (type === "sales") {
    const total = activeSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const paid = activeSales.reduce((sum, sale) => sum + Number(sale.paid ?? sale.total ?? 0), 0);
    const remaining = activeSales.reduce((sum, sale) => sum + Number(sale.remaining || 0), 0);
    openModal("تفاصيل إجمالي المبيعات", "لوحة المتابعة", `
      <div class="metric-strip">
        <div class="mini-metric"><span>إجمالي المبيعات</span><strong>${money(total)}</strong></div>
        <div class="mini-metric"><span>المحصل</span><strong>${money(paid)}</strong></div>
        <div class="mini-metric"><span>المتبقي</span><strong>${money(remaining)}</strong></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th><th>المتبقي</th><th></th></tr></thead><tbody>
        ${activeSales.slice().reverse().map(sale => `<tr><td><strong>${sale.id}</strong></td><td>${fmtDate(sale.date)}</td><td>${esc(getCustomer(sale.customerId)?.name || "عميل نقدي")}</td><td class="money">${money(sale.total)}</td><td class="money">${money(sale.remaining || 0)}</td><td><div class="row-actions"><button class="row-action" data-modal-action="dashboard-view-sale" data-id="${sale.id}">عرض</button>${sale.remaining ? `<button class="row-action" data-modal-action="dashboard-collect-sale" data-id="${sale.id}">تحصيل</button>` : ""}</div></td></tr>`).join("")}
      </tbody></table></div>
      <div class="form-actions"><button class="btn" data-modal-action="dashboard-go" data-view="sales">مركز المبيعات</button><button class="btn secondary" data-modal-action="dashboard-sales-search">بحث الفواتير</button><button class="btn ghost" data-modal-action="dashboard-go" data-view="reports">تقرير المبيعات</button></div>`);
    return;
  }

  if (type === "inventory") {
    const inventory = data.books.slice().sort((a, b) => productInventorySummary(b.id).currentInventoryValue - productInventorySummary(a.id).currentInventoryValue);
    const totalCost = inventory.reduce((sum, book) => sum + productInventorySummary(book.id).currentInventoryValue, 0);
    const totalRetail = inventory.reduce((sum, book) => sum + Math.max(0, productInventorySummary(book.id).currentStockQty) * productDefaultSellingPrice(book), 0);
    openModal("تفاصيل قيمة المخزون", "لوحة المتابعة", `
      <div class="metric-strip">
        <div class="mini-metric"><span>قيمة التكلفة</span><strong>${money(totalCost)}</strong></div>
        <div class="mini-metric"><span>قيمة البيع المتوقعة</span><strong>${money(totalRetail)}</strong></div>
        <div class="mini-metric"><span>عدد الوحدات</span><strong>${inventory.reduce((sum, book) => sum + book.stock, 0)}</strong></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الرصيد</th><th>التكلفة</th><th>قيمة الرصيد</th><th>الموقع</th><th></th></tr></thead><tbody>
        ${inventory.map(book => { const summary = productInventorySummary(book.id); return `<tr><td><strong>${esc(book.name)}</strong><br><span class="muted">${esc(book.barcode)}</span></td><td>${stockBadge(book)}</td><td class="money">${summary.hasIncompleteCost ? "تكلفة غير مكتملة" : money(summary.averageInventoryCost)}</td><td class="money">${summary.hasIncompleteCost ? "تكلفة غير مكتملة" : money(summary.currentInventoryValue)}</td><td>${esc(book.shelf || "—")}</td><td><div class="row-actions"><button class="row-action" data-modal-action="dashboard-view-book" data-id="${book.id}">عرض</button><button class="row-action" data-modal-action="dashboard-edit-book" data-id="${book.id}">تعديل</button><button class="row-action" data-modal-action="dashboard-adjust-book" data-id="${book.id}">تسوية</button></div></td></tr>`; }).join("")}
      </tbody></table></div>
      <div class="form-actions"><button class="btn" data-modal-action="dashboard-go" data-view="books">إدارة المخزون</button><button class="btn secondary" data-modal-action="dashboard-add-book">إضافة صنف</button></div>`);
    return;
  }

  if (type === "customer-debt") {
    const debtors = data.customers.filter(customer => customer.balance > 0).sort((a, b) => b.balance - a.balance);
    openModal("تفاصيل مديونية العملاء", "لوحة المتابعة", `
      <div class="metric-strip">
        <div class="mini-metric"><span>إجمالي المديونية</span><strong>${money(debtors.reduce((sum, customer) => sum + customer.balance, 0))}</strong></div>
        <div class="mini-metric"><span>عملاء عليهم رصيد</span><strong>${debtors.length}</strong></div>
        <div class="mini-metric"><span>متجاوزو الحد</span><strong>${debtors.filter(customer => customer.creditLimit && customer.balance > customer.creditLimit).length}</strong></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>العميل</th><th>الموبايل</th><th>الرصيد</th><th>الحد الائتماني</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${debtors.map(customer => `<tr><td><strong>${esc(customer.name)}</strong></td><td><span dir="ltr">${esc(customer.phone || "—")}</span></td><td class="money">${money(customer.balance)}</td><td class="money">${money(customer.creditLimit)}</td><td>${customer.creditLimit && customer.balance > customer.creditLimit ? badge("متجاوز الحد", "danger") : badge("قائم", "warning")}</td><td><div class="row-actions"><button class="row-action" data-modal-action="dashboard-statement" data-id="${customer.id}">كشف حساب</button><button class="row-action" data-modal-action="dashboard-receipt" data-id="${customer.id}">إيصال استلام</button></div></td></tr>`).join("") || `<tr><td colspan="6" class="text-center muted">لا توجد مديونيات عملاء حاليًا.</td></tr>`}
      </tbody></table></div>
      <div class="form-actions"><button class="btn" data-modal-action="dashboard-go-parties">إدارة العملاء</button><button class="btn ghost" data-modal-action="dashboard-go" data-view="accounting">الخزنة والإيصالات</button></div>`);
    return;
  }

  const attention = data.books.filter(book => book.stock <= book.reorder).sort((a, b) => a.stock - b.stock);
  openModal("أصناف تحتاج انتباه", "لوحة المتابعة", `
    <div class="metric-strip">
      <div class="mini-metric"><span>صفري أو سالب</span><strong>${attention.filter(book => book.stock <= 0).length}</strong></div>
      <div class="mini-metric"><span>تحت حد الطلب</span><strong>${attention.filter(book => book.stock > 0).length}</strong></div>
      <div class="mini-metric"><span>إجمالي الأصناف</span><strong>${attention.length}</strong></div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الرصيد</th><th>حد الطلب</th><th>العجز المقترح</th><th>المورد</th><th></th></tr></thead><tbody>
      ${attention.map(book => `<tr><td><strong>${esc(book.name)}</strong><br><span class="muted">${esc(book.shelf || "بدون موقع")}</span></td><td>${stockBadge(book)}</td><td>${book.reorder}</td><td>${Math.max(0, book.reorder - book.stock)}</td><td>${esc(getSupplier(book.supplierId)?.name || "غير محدد")}</td><td><div class="row-actions"><button class="row-action" data-modal-action="dashboard-adjust-book" data-id="${book.id}">تسوية</button><button class="row-action" data-modal-action="dashboard-edit-book" data-id="${book.id}">تعديل الحد</button></div></td></tr>`).join("") || `<tr><td colspan="6" class="text-center muted">لا توجد أصناف تحتاج انتباه.</td></tr>`}
    </tbody></table></div>
    <div class="form-actions"><button class="btn" data-modal-action="dashboard-go" data-view="purchases">إنشاء شراء / توريد</button><button class="btn secondary" data-modal-action="dashboard-go" data-view="books">فتح المخزون</button></div>`);
}

function renderBooks() {
  root.innerHTML = `
    <div class="section-title">
      <div><h2>الأصناف والمخزون</h2><p>إدارة كل المنتجات: كتب، سبلايز، كراسات، كشاكيل، باركود، مواقع وحدود إعادة الطلب.</p></div>
      <div class="actions"><button class="btn secondary" data-action="stock-count">▤ جرد مخزني</button><button class="btn" data-action="add-book">＋ إضافة صنف</button></div>
    </div>
    <div class="stats-grid">
      ${statCard("إجمالي الأصناف", data.books.length, "منتج مسجل", "▤")}
      ${statCard("إجمالي الوحدات", data.books.reduce((s, b) => s + b.stock, 0), "الرصيد الدفتري الحالي", "▥", "blue")}
      ${statCard("منخفض المخزون", data.books.filter(b => b.stock > 0 && b.stock <= b.reorder).length, "تحتاج إعادة طلب", "!", "gold")}
      ${statCard("رصيد صفري/سالب", data.books.filter(b => b.stock <= 0).length, "تحتاج مراجعة عاجلة", "−", "red")}
    </div>
    <article class="card">
      <div class="toolbar">
        <div class="search"><input id="book-search" placeholder="بحث باسم الصنف أو الباركود أو المورد/الناشر..."></div>
        <select id="book-category" class="filter-select"><option value="">كل التصنيفات</option>${[...new Set(data.books.map(b => b.category))].map(c => `<option>${esc(c)}</option>`).join("")}</select>
        <select id="book-stock-filter" class="filter-select"><option value="">كل حالات المخزون</option><option value="low">منخفض</option><option value="zero">صفري أو سالب</option><option value="consignment">أمانة</option></select>
        <button class="btn ghost" onclick="window.print()">⇩ طباعة</button>
      </div>
      <div class="table-wrap" id="books-table">${booksTable(data.books.filter(item => !item.deletedAt))}</div>
    </article>`;
}

function booksTable(books) {
  if (!books.length) return document.getElementById("empty-state-template").innerHTML;
  return `<table>
    <thead><tr><th>الصنف</th><th>النوع</th><th>الباركود</th><th>المورد</th><th>الموقع</th><th>التكلفة</th><th>سعر البيع</th><th>الرصيد</th><th>الملكية</th><th></th></tr></thead>
    <tbody>${books.map(book => { const summary = productInventorySummary(book.id); return `<tr data-record-type="book" data-record-id="${book.id}">
      <td><div class="book-cell"><div class="book-cover">${esc(book.name.charAt(0))}</div><div><strong>${esc(book.name)}</strong><span>${esc(itemSubtitle(book) || "—")}</span></div></div></td>
      <td>${badge(itemTypeLabel(book), "blue")}<br><span class="muted">${esc(itemUnitLabel(book))}</span></td>
      <td><strong>${esc(book.barcode)}</strong>${book.extraBarcode ? `<br><span class="muted">${esc(book.extraBarcode)}</span>` : ""}</td>
      <td>${esc(getSupplier(book.supplierId)?.name || "غير محدد")}</td>
      <td>${esc(book.shelf || "—")}</td>
      <td class="money">${summary.hasIncompleteCost ? "تكلفة غير مكتملة" : money(summary.averageInventoryCost)}</td>
      <td class="money">${money(productDefaultSellingPrice(book))}</td>
      <td>${stockBadge(book)}</td>
      <td>${book.owned ? badge("مملوك") : badge("أمانة", "blue")}</td>
      <td><div class="row-actions"><button class="row-action" data-action="view-book" data-id="${book.id}">عرض</button><button class="row-action" data-action="open-product-movement" data-id="${book.id}">عرض حركة الصنف</button><button class="row-action" data-action="edit-book" data-id="${book.id}">تعديل</button><button class="row-action" data-action="adjust-stock" data-id="${book.id}">تسوية</button><button class="row-action text-danger" data-action="delete-book" data-id="${book.id}">حذف</button></div></td>
    </tr>`; }).join("")}</tbody>
  </table>`;
}

function searchCustomers(term) {
  const normalized = String(term || "").trim().toLowerCase();
  if (!normalized) return [];
  const phone = normalizePhone(normalized);
  return data.customers
    .filter(customer => !customer.deletedAt && (
      customer.name.toLowerCase().includes(normalized) ||
      (phone && normalizePhone(customer.phone).includes(phone))
    ))
    .slice(0, 8);
}

function saleCustomerDetailsMarkup(customer) {
  if (!customer) {
    return `<div class="customer-summary empty"><strong>لم يتم اختيار عميل</strong><span>ابحث بالاسم أو رقم الهاتف، أو سجّل عميلًا جديدًا.</span></div>`;
  }
  return `<div class="customer-summary">
    <strong>${esc(customer.name)} <small>${esc(customer.id)}</small></strong>
    <span><b>الهاتف:</b> <span dir="ltr">${esc(customer.phone || "—")}</span></span>
    <span><b>العنوان:</b> ${esc([customer.governorate, customer.city, customer.address].filter(Boolean).join("، ") || "غير مسجل")}</span>
  </div>`;
}

function resetSaleDraft() {
  const cashCustomer = (data.customers || []).find(customer => !customer.deletedAt && (customer.id === "C001" || customer.name === "عميل نقدي"));
  draftSale = { customerId: cashCustomer?.id || "", channel: "تجزئة", saleOperationType: "بيع مباشر", payment: "نقدي", date: today(), paid: 0, invoiceDiscount: 0, invoiceDiscountType: "percent", lines: [{ bookId: "", qty: 1, price: 0, discount: 0, discountType: "percent" }] };
}

function saleCreatedByName(sale = {}) {
  return sale.createdByName || sale.createdBy || sale.createdByUsername || "غير محدد";
}

function saleCreatedById(sale = {}) {
  return sale.createdByUserId || sale.createdById || "";
}

function saleDateKey(sale = {}) {
  return String(sale.date || sale.createdAt || "").slice(0, 10);
}

function dateAddDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function salesFilterRange(filter = salesDateFilter) {
  const now = today();
  if (filter === "yesterday") {
    const yesterday = dateAddDays(now, -1);
    return { from: yesterday, to: yesterday, label: "أمس" };
  }
  if (filter === "last7") return { from: dateAddDays(now, -6), to: now, label: "آخر 7 أيام" };
  if (filter === "month") return { from: now.slice(0, 8) + "01", to: now, label: "هذا الشهر" };
  if (filter === "custom") return { from: salesFilterFrom || now, to: salesFilterTo || now, label: "فترة مخصصة" };
  return { from: now, to: now, label: "اليوم" };
}

function salesInRange(filter = salesDateFilter) {
  const range = salesFilterRange(filter);
  return (data.sales || [])
    .filter(sale => !sale.deletedAt && saleDateKey(sale) >= range.from && saleDateKey(sale) <= range.to)
    .filter(sale => sale.status !== "ملغاة")
    .filter(sale => canAction("view-sales-profit") || !saleCreatedById(sale) || saleCreatedById(sale) === currentUser?.id || sale.createdByUsername === currentUser?.username || sale.createdByName === currentUser?.name)
    .sort((a, b) => String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || "")) || String(b.id).localeCompare(String(a.id)));
}

function salesPaymentBucket(sale = {}) {
  const payment = String(sale.payment || "");
  if (payment === "نقدي") return "cash";
  if (["تحويل بنكي", "InstaPay", "محفظة", "Visa"].includes(payment)) return "transfer";
  if (payment === "الدفع عند الاستلام") return "cod";
  return "other";
}

function salesReturnsAmount(from, to) {
  return (data.returns || [])
    .filter(item => !item.deletedAt && returnKind(item.type) === "sale" && String(item.date || item.createdAt || "").slice(0, 10) >= from && String(item.date || item.createdAt || "").slice(0, 10) <= to)
    .reduce((sum, item) => sum + Number(item.subtotal ?? item.amount ?? 0), 0);
}

function salesCashReturnsAmount(from, to) {
  return (data.returns || [])
    .filter(item => !item.deletedAt && returnKind(item.type) === "sale" && String(item.date || item.createdAt || "").slice(0, 10) >= from && String(item.date || item.createdAt || "").slice(0, 10) <= to)
    .reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
}

function purchaseTotalForRange(from, to) {
  return (data.purchases || [])
    .filter(item => !item.deletedAt && item.status !== "ملغاة" && String(item.date || item.createdAt || "").slice(0, 10) >= from && String(item.date || item.createdAt || "").slice(0, 10) <= to)
    .reduce((sum, item) => sum + Number(item.total || 0), 0);
}

function cashOutForRange(from, to, matcher = () => true) {
  return activeCash()
    .filter(item => item.type === "صرف" && String(item.date || item.createdAt || "").slice(0, 10) >= from && String(item.date || item.createdAt || "").slice(0, 10) <= to && matcher(item))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function salesDailySummary(filter = salesDateFilter) {
  const range = salesFilterRange(filter);
  const sales = salesInRange(filter);
  const salesTotal = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const invoiceCount = sales.length;
  const discounts = sales.reduce((sum, sale) => sum + Number(sale.discount || sale.invoiceDiscountAmount || 0), 0);
  const returnsTotal = salesReturnsAmount(range.from, range.to);
  const cashReturns = salesCashReturnsAmount(range.from, range.to);
  const netSales = salesTotal - returnsTotal;
  const cashTotal = sales.filter(sale => salesPaymentBucket(sale) === "cash").reduce((sum, sale) => sum + Number(sale.paid || 0), 0);
  const transferTotal = sales.filter(sale => salesPaymentBucket(sale) === "transfer").reduce((sum, sale) => sum + Number(sale.paid || 0), 0);
  const codTotal = sales.filter(sale => salesPaymentBucket(sale) === "cod").reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const actualCollections = sales.reduce((sum, sale) => sum + Number(sale.paid || 0), 0);
  const purchasesTotal = purchaseTotalForRange(range.from, range.to);
  const supplierPayments = cashOutForRange(range.from, range.to, item => /مشتريات|توريد|مورد|شراء/i.test(`${item.category || ""} ${item.note || ""}`));
  const expenses = cashOutForRange(range.from, range.to, item => !/مرتجع|مشتريات|توريد|مورد|شراء/i.test(`${item.category || ""} ${item.note || ""}`));
  const netMovement = actualCollections - supplierPayments - expenses - cashReturns;
  const cogsSummary = salesCogsSummary(sales);
  const grossProfit = cogsSummary.incompleteLines ? null : netSales - cogsSummary.cost;
  const netProfit = grossProfit === null ? null : grossProfit - expenses - cashReturns;
  const totalIn = actualCollections;
  const totalOut = supplierPayments + expenses + cashReturns;
  return { range, sales, salesTotal, invoiceCount, discounts, returnsTotal, cashReturns, netSales, cashTotal, transferTotal, codTotal, actualCollections, purchasesTotal, supplierPayments, expenses, netMovement, cogs: cogsSummary.cost, incompleteCostLines: cogsSummary.incompleteLines, grossProfit, netProfit, totalIn, totalOut };
}

function formatProfitValue(value, incompleteLines = 0) {
  return incompleteLines ? "تكلفة غير مكتملة" : money(value || 0);
}

function salesDayClosing(dateKey = today()) {
  return (data.dayClosings || []).find(item => !item.deletedAt && item.date === dateKey);
}

function saleCanBeModified(sale = {}) {
  const closed = salesDayClosing(saleDateKey(sale));
  if (!closed) return true;
  return canAction("close-sales-day");
}

function paymentStatusLabel(sale = {}) {
  if (Number(sale.remaining || 0) <= 0) return "مسددة";
  if (Number(sale.paid || 0) > 0) return "مدفوعة جزئيًا";
  return "غير مسددة";
}

function saleNotesSummary(sale = {}) {
  return String(sale.notes || sale.note || (sale.onlineOrderId ? `طلب ${sale.onlineOrderId}` : "") || "—").slice(0, 70);
}

function salesMainInvoicesTable(list) {
  if (!list.length) return `<div class="empty-state"><div class="empty-icon">◇</div><h3>لا توجد فواتير في هذه الفترة</h3><p>غيّر الفترة أو اضغط + فاتورة جديدة لتسجيل عملية بيع.</p></div>`;
  return `<table><thead><tr><th>الفاتورة</th><th>تاريخ ووقت البيع</th><th>العميل</th><th>الهاتف</th><th>القناة</th><th>نوع العملية</th><th>الدفع</th><th>البائع</th><th>قبل الخصم</th><th>الخصم</th><th>الصافي</th><th>حالة الدفع</th><th>الشحن</th><th>الأصناف</th><th>ملاحظات</th><th></th></tr></thead><tbody>
    ${list.map(sale => {
      const customer = getCustomer(sale.customerId);
      const snapshot = sale.customerSnapshot || {};
      const shipment = shipmentForSale(sale.id);
      const itemCount = (sale.lines || []).reduce((sum, line) => sum + Number(line.qty || line.quantity || 0), 0);
      return `<tr data-record-type="invoice" data-record-id="${esc(sale.id)}">
        <td><strong>${esc(sale.id)}</strong></td>
        <td>${esc(dateTimeLabel(sale.createdAt || sale.date))}</td>
        <td>${esc(customer?.name || snapshot.name || "عميل غير محدد")}</td>
        <td><span dir="ltr">${esc(customer?.phone || snapshot.phone || "—")}</span></td>
        <td>${esc(sale.channel || "—")}</td>
        <td>${esc(sale.saleOperationType || sale.operationType || "بيع مباشر")}</td>
        <td>${esc(sale.payment || "—")}</td>
        <td>${esc(saleCreatedByName(sale))}</td>
        <td class="money">${money(sale.subtotal || 0)}</td>
        <td class="money">${money(sale.discount || 0)}</td>
        <td class="money">${money(sale.total || 0)}</td>
        <td>${badge(paymentStatusLabel(sale), Number(sale.remaining || 0) > 0 ? "warning" : "")}</td>
        <td>${shipment ? `${badge(shipment.status || "شحنة", "blue")}<br><span class="muted">${esc(shipment.tracking || shipment.id)}</span>` : "—"}</td>
        <td>${Number(itemCount).toLocaleString("ar-EG")}</td>
        <td>${esc(saleNotesSummary(sale))}</td>
        <td><div class="row-actions"><button class="row-action" data-action="view-sale" data-id="${esc(sale.id)}">عرض</button><button class="row-action" data-action="print-sale" data-id="${esc(sale.id)}">طباعة</button>${!["ملغاة","مرتجع"].includes(sale.status) ? `<button class="row-action" data-action="return-sale" data-id="${esc(sale.id)}">مرتجع</button>` : ""}<button class="row-action" data-action="limited-edit-sale" data-id="${esc(sale.id)}">تعديل محدود</button>${canAction("cancel-sale") ? `<button class="row-action text-danger" data-action="cancel-sale" data-id="${esc(sale.id)}">إلغاء</button>` : ""}</div></td>
      </tr>`;
    }).join("")}
  </tbody></table>`;
}

function salesMiniReports(summary) {
  const bySeller = new Map();
  const byPayment = new Map();
  const byChannel = new Map();
  summary.sales.forEach(sale => {
    bySeller.set(saleCreatedByName(sale), (bySeller.get(saleCreatedByName(sale)) || 0) + Number(sale.total || 0));
    byPayment.set(sale.payment || "غير محدد", (byPayment.get(sale.payment || "غير محدد") || 0) + Number(sale.total || 0));
    byChannel.set(sale.channel || "غير محدد", (byChannel.get(sale.channel || "غير محدد") || 0) + Number(sale.total || 0));
  });
  const list = map => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, total]) => `<li><span>${esc(name)}</span><strong>${money(total)}</strong></li>`).join("") || `<li><span>لا توجد بيانات</span><strong>—</strong></li>`;
  return `<div class="sales-report-grid">
    <article class="card"><h3>مبيعات حسب البائع</h3><ul class="compact-report-list">${list(bySeller)}</ul></article>
    <article class="card"><h3>مبيعات حسب طريقة الدفع</h3><ul class="compact-report-list">${list(byPayment)}</ul></article>
    <article class="card"><h3>مبيعات حسب قناة البيع</h3><ul class="compact-report-list">${list(byChannel)}</ul></article>
  </div>`;
}

function simpleRowsTable(title, columns, rows) {
  return `<div class="card-header compact"><div><h3>${esc(title)}</h3><p>تفاصيل الرقم المختار من مركز المبيعات.</p></div></div><div class="table-wrap"><table><thead><tr>${columns.map(col => `<th>${esc(col)}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${columns.length}" class="text-center muted">لا توجد بيانات مطابقة.</td></tr>`}</tbody></table></div>`;
}

function cashRowsForSalesSummary(summary, type) {
  const range = summary.range;
  return activeCash().filter(item => {
    const dateKey = String(item.date || item.createdAt || "").slice(0, 10);
    if (dateKey < range.from || dateKey > range.to) return false;
    const text = `${item.category || ""} ${item.note || ""}`;
    if (type === "supplier-payments") return item.type === "صرف" && /مشتريات|توريد|مورد|شراء/i.test(text);
    if (type === "expenses") return item.type === "صرف" && !/مرتجع|مشتريات|توريد|مورد|شراء/i.test(text);
    return true;
  });
}

function showSalesStatDetails(stat) {
  const key = String(stat || "").replace("sales:", "");
  const summary = salesDailySummary();
  const saleRows = summary.sales.map(sale => `<tr><td>${esc(sale.id)}</td><td>${esc(dateTimeLabel(sale.createdAt || sale.date))}</td><td>${esc(getCustomer(sale.customerId)?.name || sale.customerSnapshot?.name || "—")}</td><td>${esc(sale.payment || "—")}</td><td>${esc(saleCreatedByName(sale))}</td><td class="money">${money(sale.total || 0)}</td><td><button class="row-action" data-modal-action="view-sale" data-id="${esc(sale.id)}">عرض</button></td></tr>`);
  const saleColumns = ["الفاتورة", "الوقت", "العميل", "الدفع", "البائع", "الصافي", ""];
  let title = "تفاصيل مركز المبيعات";
  let content = "";
  if (["sales-total", "invoice-count", "net-sales", "cash", "transfers", "cod"].includes(key)) {
    const filtered = key === "cash" ? summary.sales.filter(s => salesPaymentBucket(s) === "cash")
      : key === "transfers" ? summary.sales.filter(s => salesPaymentBucket(s) === "transfer")
      : key === "cod" ? summary.sales.filter(s => salesPaymentBucket(s) === "cod")
      : summary.sales;
    title = ({ "sales-total":"إجمالي مبيعات اليوم", "invoice-count":"عدد فواتير اليوم", "net-sales":"صافي المبيعات", cash:"إجمالي النقدية", transfers:"إجمالي التحويلات", cod:"الدفع عند الاستلام" })[key];
    content = simpleRowsTable(title, saleColumns, filtered.map(sale => `<tr><td>${esc(sale.id)}</td><td>${esc(dateTimeLabel(sale.createdAt || sale.date))}</td><td>${esc(getCustomer(sale.customerId)?.name || sale.customerSnapshot?.name || "—")}</td><td>${esc(sale.payment || "—")}</td><td>${esc(saleCreatedByName(sale))}</td><td class="money">${money(sale.total || 0)}</td><td><button class="row-action" data-modal-action="view-sale" data-id="${esc(sale.id)}">عرض</button></td></tr>`));
  } else if (key === "discounts") {
    title = "إجمالي الخصومات";
    content = simpleRowsTable(title, ["الفاتورة", "العميل", "خصم الفاتورة/الأصناف", "الصافي", ""], summary.sales.filter(s => Number(s.discount || 0) > 0).map(sale => `<tr><td>${esc(sale.id)}</td><td>${esc(getCustomer(sale.customerId)?.name || sale.customerSnapshot?.name || "—")}</td><td class="money">${money(sale.discount || 0)}</td><td class="money">${money(sale.total || 0)}</td><td><button class="row-action" data-modal-action="view-sale" data-id="${esc(sale.id)}">عرض</button></td></tr>`));
  } else if (["returns", "cash-returns"].includes(key)) {
    title = key === "cash-returns" ? "المرتجعات النقدية" : "إجمالي المرتجعات";
    const rows = (data.returns || []).filter(item => !item.deletedAt && returnKind(item.type) === "sale" && String(item.date || item.createdAt || "").slice(0, 10) >= summary.range.from && String(item.date || item.createdAt || "").slice(0, 10) <= summary.range.to);
    content = simpleRowsTable(title, ["المرتجع", "الحساب", "التاريخ", "الإجمالي", "المدفوع نقدًا", ""], rows.map(item => `<tr><td>${esc(returnNo(item))}</td><td>${esc(returnAccountName(item) || "—")}</td><td>${fmtDate(item.date)}</td><td class="money">${money(item.subtotal ?? item.amount ?? 0)}</td><td class="money">${money(item.paidAmount || 0)}</td><td><button class="row-action" data-modal-action="view-return" data-id="${esc(item.id)}">عرض</button></td></tr>`));
  } else if (key === "purchases") {
    title = "مشتريات اليوم";
    const rows = (data.purchases || []).filter(item => !item.deletedAt && item.status !== "ملغاة" && String(item.date || item.createdAt || "").slice(0, 10) >= summary.range.from && String(item.date || item.createdAt || "").slice(0, 10) <= summary.range.to);
    content = simpleRowsTable(title, ["المستند", "المورد", "التاريخ", "الإجمالي", "المدفوع"], rows.map(item => `<tr><td>${esc(item.id)}</td><td>${esc(getSupplier(item.supplierId)?.name || "—")}</td><td>${fmtDate(item.date)}</td><td class="money">${money(item.total || 0)}</td><td class="money">${money(item.paid || 0)}</td></tr>`));
  } else if (["supplier-payments", "expenses"].includes(key)) {
    title = key === "supplier-payments" ? "مدفوعات الموردين" : "مصروفات اليوم";
    const rows = cashRowsForSalesSummary(summary, key);
    content = simpleRowsTable(title, ["الحركة", "التاريخ", "الحساب", "الطرف/البيان", "المبلغ"], rows.map(item => `<tr><td>${esc(item.id)}</td><td>${fmtDate(item.date)}</td><td>${esc(item.account || "—")}</td><td>${esc(item.party || item.category || item.note || "—")}</td><td class="money">${money(item.amount || 0)}</td></tr>`));
  } else if (["cogs", "gross-profit", "net-profit", "net-movement"].includes(key)) {
    title = ({ cogs:"تكلفة البضاعة المباعة", "gross-profit":"مجمل الربح اليومي", "net-profit":"صافي الربح اليومي", "net-movement":"صافي حركة اليوم" })[key];
    content = `<div class="metric-strip">
      <div class="mini-metric"><span>صافي المبيعات</span><strong>${money(summary.netSales)}</strong></div>
      <div class="mini-metric"><span>تكلفة البضاعة</span><strong>${formatProfitValue(summary.cogs, summary.incompleteCostLines)}</strong></div>
      <div class="mini-metric"><span>مجمل الربح</span><strong>${formatProfitValue(summary.grossProfit, summary.incompleteCostLines)}</strong></div>
      <div class="mini-metric"><span>المصروفات</span><strong>${money(summary.expenses)}</strong></div>
      <div class="mini-metric"><span>المرتجعات النقدية</span><strong>${money(summary.cashReturns)}</strong></div>
      <div class="mini-metric"><span>صافي الربح اليومي</span><strong>${formatProfitValue(summary.netProfit, summary.incompleteCostLines)}</strong></div>
    </div>${simpleRowsTable("الفواتير الداخلة في حساب الربح", saleColumns, saleRows)}`;
  } else {
    content = simpleRowsTable(title, saleColumns, saleRows);
  }
  openModal(title, "مركز المبيعات", `${content}<div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
}

function renderSalesCenter() {
  const summary = salesDailySummary();
  const closed = salesDateFilter === "today" ? salesDayClosing(today()) : null;
  root.innerHTML = `
    <div class="section-title">
      <div><h2>مركز المبيعات</h2><p>ملخص اليوم، الفواتير، الفلاتر، الطباعة وقفل اليومية.</p></div>
      <div class="actions">
        <button class="btn" data-action="new-sale-invoice">＋ فاتورة جديدة</button>
        <button class="btn ghost" data-action="show-sales-list">الفواتير السابقة</button>
        <button class="btn ghost" data-view-jump="returns">المرتجعات</button>
        <button class="btn secondary" data-action="print-sales-day">طباعة تقرير اليوم</button>
        <button class="btn ghost" data-action="close-sales-day">قفل اليومية</button>
      </div>
    </div>
    ${closed ? `<div class="alert-item" style="margin-bottom:14px"><div class="alert-badge gold">✓</div><div><strong>اليومية مقفولة</strong><span>تم القفل بواسطة ${esc(closed.closedByName)} في ${esc(dateTimeLabel(closed.closedAt))}. التعديل يحتاج صلاحية مدير.</span></div></div>` : ""}
    <div class="sales-flow-layout">
      <section class="sales-flow-section in">
        <div class="card-header compact"><div><h3>الداخل / التحصيلات</h3><p>كل ما دخل فعليًا أو مستحق من المبيعات.</p></div><span class="badge blue">${money(summary.totalIn)}</span></div>
        <div class="stats-grid sales-summary-grid">
          ${statCard("إجمالي مبيعات اليوم", money(summary.salesTotal), "بعت بكام", "↗", "", "", "sales:sales-total")}
          ${statCard("عدد فواتير اليوم", summary.invoiceCount, summary.range.label, "▤", "blue", "", "sales:invoice-count")}
          ${statCard("إجمالي النقدية", money(summary.cashTotal), "حصلت نقدي", "↓", "", "", "sales:cash")}
          ${statCard("إجمالي التحويلات", money(summary.transferTotal), "بنك / محفظة / Visa", "◇", "blue", "", "sales:transfers")}
          ${statCard("الدفع عند الاستلام", money(summary.codTotal), "COD مستحق", "▣", "gold", "", "sales:cod")}
          ${statCard("صافي المبيعات", money(summary.netSales), "بعد المرتجعات", "≋", "blue", "", "sales:net-sales")}
        </div>
      </section>
      <section class="sales-flow-section out">
        <div class="card-header compact"><div><h3>الخارج / المدفوعات</h3><p>كل المصروفات والمدفوعات والمرتجعات النقدية.</p></div><span class="badge danger">${money(summary.totalOut)}</span></div>
        <div class="stats-grid sales-summary-grid">
          ${statCard("إجمالي الخصومات", money(summary.discounts), "خصومات أصناف وفاتورة", "%", "gold", "", "sales:discounts")}
          ${statCard("إجمالي المرتجعات", money(summary.returnsTotal), "مرتجعات الفترة", "↶", "red", "", "sales:returns")}
          ${statCard("المرتجعات النقدية", money(summary.cashReturns), "خارج فعلي للعميل", "↑", "red", "", "sales:cash-returns")}
          ${statCard("مشتريات اليوم", money(summary.purchasesTotal), "اشتريت بضاعة", "▦", "blue", "", "sales:purchases")}
          ${statCard("مدفوعات الموردين", money(summary.supplierPayments), "دفعت للموردين", "↑", "red", "", "sales:supplier-payments")}
          ${statCard("مصروفات اليوم", money(summary.expenses), "صرف غير مشتريات", "!", "red", "", "sales:expenses")}
        </div>
      </section>
      <section class="sales-flow-section profit">
        <div class="card-header compact"><div><h3>صافي اليوم والربح</h3><p>صافي الحركة النقدية وصافي الربح بعد تكلفة البضاعة.</p></div></div>
        <div class="stats-grid sales-summary-grid">
          ${statCard("تكلفة البضاعة المباعة", formatProfitValue(summary.cogs, summary.incompleteCostLines), `${summary.incompleteCostLines ? `${summary.incompleteCostLines} سطر تكلفة غير مكتملة` : "COGS من FIFO"}`, "▤", "blue", "", "sales:cogs")}
          ${statCard("مجمل الربح اليومي", formatProfitValue(summary.grossProfit, summary.incompleteCostLines), "صافي المبيعات - تكلفة البضاعة", "↗", "gold", "", "sales:gross-profit")}
          ${statCard("صافي الربح اليومي", formatProfitValue(summary.netProfit, summary.incompleteCostLines), "مجمل الربح - مصروفات - مرتجعات نقدية", "≋", "gold", "", "sales:net-profit")}
          ${statCard("صافي حركة اليوم", money(summary.netMovement), "الداخل - الخارج", "≋", "blue", "", "sales:net-movement")}
        </div>
      </section>
    </div>
    <article class="card">
      <div class="card-header"><div><h3>الفواتير المباعة</h3><p>فلترة حسب الفترة مع عرض البائع وطريقة الدفع وحالة الشحن.</p></div><span class="badge blue">${summary.sales.length} فاتورة</span></div>
      <div class="toolbar">
        <select id="sales-date-filter" class="filter-select">
          <option value="today" ${salesDateFilter === "today" ? "selected" : ""}>اليوم</option>
          <option value="yesterday" ${salesDateFilter === "yesterday" ? "selected" : ""}>أمس</option>
          <option value="last7" ${salesDateFilter === "last7" ? "selected" : ""}>آخر 7 أيام</option>
          <option value="month" ${salesDateFilter === "month" ? "selected" : ""}>هذا الشهر</option>
          <option value="custom" ${salesDateFilter === "custom" ? "selected" : ""}>فترة مخصصة</option>
        </select>
        <input id="sales-filter-from" type="date" value="${esc(salesFilterRange().from)}" ${salesDateFilter !== "custom" ? "disabled" : ""}>
        <input id="sales-filter-to" type="date" value="${esc(salesFilterRange().to)}" ${salesDateFilter !== "custom" ? "disabled" : ""}>
      </div>
      <div class="table-wrap" id="sales-main-table">${salesMainInvoicesTable(summary.sales)}</div>
    </article>
    ${salesMiniReports(summary)}
  `;
}

function renderSales() {
  if (salesScreenMode === "invoice") return renderSaleInvoice();
  if (salesScreenMode === "history") return renderSalesHistory();
  return renderSalesCenter();
}

function renderSaleInvoice() {
  const selectedCustomer = getCustomer(draftSale.customerId);
  const totals = saleTotals();
  const lines = draftSale.lines.map((line, index) => {
    const book = getBook(line.bookId);
    const computed = totals.lines[index] || {};
    const listId = `sale-book-options-${index}`;
    const availableStock = book ? productInventorySummary(book.id).currentStockQty : 0;
    const stockWarning = book && Number(line.qty || 0) > availableStock;
    return `<div class="invoice-line quick-sale-line ${stockWarning ? "stock-warning" : ""}" data-line="${index}">
      <input class="sale-book-picker" data-index="${index}" list="${listId}" value="${esc(bookPickerLabel(book))}" placeholder="ابحث باسم الصنف أو الباركود...">
      ${bookPickerDatalist(listId)}
      <input class="sale-qty" data-index="${index}" type="number" min="1" value="${line.qty}">
      <input class="sale-price" data-index="${index}" type="number" min="0" value="${line.price || productDefaultSellingPrice(book) || 0}">
      <input class="sale-discount discount-field" data-index="${index}" type="number" min="0" max="100" value="${line.discount || 0}">
      <span class="muted discount-field text-center sale-line-net">${money(computed.finalNet || 0)}</span>
      <button class="row-action sale-remove" data-index="${index}" title="حذف">×</button>
      ${book ? `<small class="sale-book-info"><b>الرصيد: ${availableStock}</b> · سعر البيع ${money(productDefaultSellingPrice(book))}${stockWarning ? `<span class="inline-stock-warning">الكمية أكبر من الرصيد المتاح</span>` : ""}</small>` : ""}
    </div>`;
  }).join("");

  root.innerHTML = `
    <div class="section-title">
      <div><h2>بيع سريع</h2><p>امسح الباركود، راجع الإجمالي، ثم احفظ.</p></div>
      <div class="actions"><button class="btn ghost" data-action="sales-main">مركز المبيعات</button><button class="btn ghost" data-action="show-sales-list">الفواتير السابقة</button><button class="btn secondary" data-action="reset-sale">تفريغ</button></div>
    </div>
    <div class="invoice-layout quick-sale-layout">
      <article class="card">
        <div class="invoice-lines">
          <label class="quick-search-label" for="sale-book-search">امسح الباركود أو اكتب اسم الصنف</label>
          <div class="sale-quick-add"><div class="search"><input id="sale-book-search" autocomplete="off" autofocus placeholder="امسح الباركود أو اكتب اسم الصنف"></div><input id="sale-quick-qty" type="number" min="1" value="1" aria-label="الكمية" title="الكمية"><div id="sale-book-suggestions"></div></div>
          <div class="line-head"><span>الصنف</span><span>الكمية</span><span>السعر</span><span class="discount-head">الخصم</span><span>الإجمالي</span><span></span></div>
          <div id="sale-lines">${lines}</div>
        </div>
      </article>
      <aside class="card invoice-summary">
        <span class="eyebrow">ملخص الفاتورة</span>
        <div class="quick-customer"><span>العميل</span><strong>${esc(selectedCustomer?.name || "عميل نقدي")}</strong><button class="row-action" type="button" data-action="toggle-sale-options">تغيير</button></div>
        <div class="summary-row"><span>المجموع الإجمالي قبل الخصم</span><strong id="sale-subtotal">${money(totals.subtotal)}</strong></div>
        <div class="summary-row"><span>خصومات الأصناف</span><strong id="sale-line-discount-total">${money(totals.lineDiscountTotal)}</strong></div>
        <div class="summary-row total"><span>صافي الفاتورة</span><strong id="sale-total">${money(totals.total)}</strong></div>
        <div class="form-field"><label>طريقة الدفع</label><select id="sale-payment">${["نقدي","Visa","تحويل بنكي","InstaPay","محفظة","آجل","مختلط"].map(value => `<option ${draftSale.payment === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
        <div class="form-field"><label>المبلغ المدفوع</label><input id="sale-paid" type="number" min="0" max="${totals.total}" value="${draftSale.paid || 0}"></div>
        <div class="summary-row"><span>المتبقي على العميل</span><strong id="sale-remaining" class="${totals.remaining > 0 ? "text-danger" : ""}">${money(totals.remaining)}</strong></div>
        <div id="sale-warning"></div>
        <button class="btn gold daily-action quick-save" data-action="save-sale" data-print-after="1">حفظ وطباعة</button>
        <button class="btn ghost quick-save" data-action="save-sale">حفظ بدون طباعة</button>
        <details class="sale-extra-options" id="sale-extra-options"><summary>خيارات إضافية</summary>
          <div class="sale-customer-picker"><label>تغيير العميل</label><div class="customer-search-row"><div class="search"><input id="sale-customer-search" autocomplete="off" value="${esc(selectedCustomer?.name || "")}" placeholder="ابحث باسم العميل أو رقم الهاتف"></div><button class="btn secondary" type="button" data-action="register-sale-customer">تسجيل عميل</button></div><div id="sale-customer-suggestions" class="customer-suggestions"></div><div id="sale-customer-details">${saleCustomerDetailsMarkup(selectedCustomer)}</div></div>
          <div class="form-grid"><div class="form-field"><label>قناة البيع</label><select id="sale-channel">${["تجزئة","جملة","متجر إلكتروني"].map(value => `<option ${draftSale.channel === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div class="form-field"><label>نوع البيع</label><select id="sale-operation-type">${["بيع مباشر","طلب أونلاين","حجز / Pre-order","بيع مدرسي / جملة","استبدال","مرتجع جزئي"].map(value => `<option ${draftSale.saleOperationType === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div class="form-field"><label>التاريخ</label><input id="sale-date" type="date" value="${draftSale.date || today()}"></div><div class="form-field"><label>خصم الفاتورة</label><div class="discount-input"><input id="sale-invoice-discount" type="number" min="0" value="${draftSale.invoiceDiscount || 0}"><select id="sale-invoice-discount-type"><option value="percent" ${draftSale.invoiceDiscountType !== "amount" ? "selected" : ""}>%</option><option value="amount" ${draftSale.invoiceDiscountType === "amount" ? "selected" : ""}>ج.م</option></select></div></div></div>
          <div class="summary-row"><span>إجمالي الخصم</span><strong id="sale-discount-total">${money(totals.discount)}</strong></div><div class="summary-row"><span>نقاط مكتسبة</span><strong id="sale-points">${Math.floor(totals.total / 10)} نقطة</strong></div>
        </details>
      </aside>
    </div>`;
  setTimeout(() => document.getElementById("sale-book-search")?.focus(), 30);
}

const ONLINE_ORDER_STATUSES = ["new","preparing","ready","shipped","delivered","cancelled"];
const INVOICE_READY_ORDER_STATUSES = ["قيد التجهيز","تم التجهيز"];
const SHIPMENT_READY_ORDER_STATUSES = ["تم إنشاء الفاتورة","لم يتم الشحن بعد","تم إنشاء الشحنة","خرج للتوصيل","تم التسليم","مرتجع"];

function onlineOrderQuickFilterLabel(filter = onlineOrderQuickFilter) {
  return ({
    new: "جديد",
    preparing: "قيد التجهيز",
    ready: "جاهز للشحن",
    shipped: "تم الشحن",
    delivered: "تم التسليم",
    cancelled: "ملغي / مرتجع"
  })[filter] || "";
}

function onlineOrderWorkflowStage(order={}) {
  if(order.workflowStage==="cancelled"||order.status==="ملغي")return "cancelled";
  if(order.workflowStage==="returned"||order.status==="مرتجع")return "cancelled";
  if(order.workflowStage==="delivered"||order.status==="تم التسليم")return "delivered";
  if(order.workflowStage==="shipped"||order.shipmentId||["تم الشحن","تم إنشاء الشحنة","خرج للتوصيل"].includes(order.status))return "shipped";
  if(order.workflowStage==="awaiting_shipping"||Boolean(order.preparedAt))return "ready";
  if(["preparing","needs_review"].includes(order.workflowStage))return "preparing";
  return "new";
}

function onlineOrderWorkflowLabel(order={}) {
  const stage=onlineOrderWorkflowStage(order);
  if(order.workflowStage==="needs_review")return "يحتاج مراجعة";
  if(stage==="cancelled")return order.status==="مرتجع"||order.workflowStage==="returned"?"مرتجع":"ملغي";
  return ({new:"طلب جديد",preparing:"جاري التجهيز",ready:"جاهز للشحن",shipped:"تم الشحن",delivered:"تم التسليم"})[stage]||"طلب جديد";
}

function onlineOrderWorkflowBadge(order={}) {
  const stage=onlineOrderWorkflowStage(order);
  return badge(onlineOrderWorkflowLabel(order),stage==="cancelled"||order.workflowStage==="needs_review"?"danger":stage==="new"||stage==="ready"?"warning":stage==="delivered"?"":"gray");
}

function onlineOrderMatchesQuickFilter(order, filter = onlineOrderQuickFilter) {
  if (!filter) return true;
  return onlineOrderWorkflowStage(order)===filter;
}

function applyOnlineOrderQuickFilter(stat) {
  const next = String(stat || "").replace("online-orders:", "");
  onlineOrderQuickFilter = next === "all" ? "" : next;
  renderOnlineOrders();
}

function quickOrderShipping(governorate="",lines=[]) {
  const rules=data.settings?.shippingRules||data.settings?.shippingRates||{};
  const goods=onlineOrderTotals(lines,0,"percent",0).goods;
  const freeAbove=Number(rules.freeShippingAbove||0);
  if(freeAbove>0&&goods>=freeAbove)return 0;
  const byGovernorate=rules.byGovernorate||{};
  return Math.max(0,Number(byGovernorate[governorate]??rules.defaultCost??0));
}

function bookReservedStock(book={}) {
  return Math.max(0,Number(book.reservedStock||0));
}

function bookAvailableStock(book={}) {
  return Math.max(0,Number(book.stock||0)-bookReservedStock(book));
}

function quickOrderCustomer() {
  const phone=normalizePhone(quickOrderDraft.phone);
  if(phone.length<11)return null;
  return (data.customers||[]).find(item=>!item.deletedAt&&normalizePhone(item.phone)===phone)||null;
}

function quickOrderCustomerInsight(customer=quickOrderCustomer()) {
  if(!customer)return null;
  const orders=(data.onlineOrders||[]).filter(order=>!order.deletedAt&&(order.customerId===customer.id||normalizePhone(order.phone)===normalizePhone(customer.phone))).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
  return {count:orders.length,last:orders[0]||null};
}

function quickOrderTotalsNow() {
  return onlineOrderTotals(quickOrderDraft.lines,quickOrderDraft.orderDiscount||0,quickOrderDraft.orderDiscountType||"percent",quickOrderDraft.shippingCost);
}

function quickOrderPaymentNow(totals=quickOrderTotalsNow()) {
  const saved=quickOrderDraft.savedOrderId?getOnlineOrder(quickOrderDraft.savedOrderId):null;
  const confirmed=Number(saved?.paidAmount??0);
  const intended=quickOrderDraft.paymentConfirmed?quickOrderDraft.paidAmount:confirmed;
  return OrderFinance.calculatePayment(totals.total,intended||0);
}

function quickOrderLinePriceMarkup(line) {
  const hasDiscount=line.discountAmount>0;
  return `<span><small>قبل الخصم</small>${hasDiscount?`<del>${money(line.unitOriginalPrice)}</del>`:`<strong>${money(line.unitOriginalPrice)}</strong>`}<em>للنسخة</em></span><span class="${hasDiscount?"discounted":""}"><small>بعد الخصم</small><strong>${money(line.unitFinalPrice)}</strong><em>للنسخة</em></span>`;
}

function refreshQuickOrderComputedUi() {
  let totals,payment;
  try{totals=quickOrderTotalsNow();payment=quickOrderPaymentNow(totals);}catch(error){return false;}
  totals.lines.forEach((line,index)=>{
    const price=document.querySelector(`[data-quick-line-price="${index}"]`);
    const discount=document.querySelector(`[data-quick-line-discount-derived="${index}"]`);
    const total=document.querySelector(`[data-quick-line-total="${index}"]`);
    if(price)price.innerHTML=quickOrderLinePriceMarkup(line);
    if(discount)discount.textContent=`خصم النسخة: ${money(line.unitDiscountAmount)} (${line.discountPercent}%) · إجمالي الخصم: ${money(line.lineDiscountTotal)}`;
    if(total)total.textContent=money(line.lineFinalAmount??line.finalNet);
  });
  const values={
    books:totals.lines.length,
    units:totals.lines.reduce((sum,line)=>sum+Number(line.qty||0),0),
    subtotal:money(totals.subtotal),
    productDiscount:money(totals.productDiscountTotal),
    orderDiscount:money(totals.orderDiscountAmount),
    discountTotal:`${money(totals.discountTotal)}${totals.subtotal?` (${OrderFinance.round(totals.discountTotal*100/totals.subtotal)}%)`:""}`,
    goods:money(totals.goods),
    shipping:totals.shipping?money(totals.shipping):"مجاني",
    total:money(totals.total),
    paymentPlan:paymentPlanLabel(),
    paid:money(payment.paidAmount),
    remaining:money(payment.remainingAmount),
    cod:money(payment.remainingAmount)
  };
  Object.entries(values).forEach(([key,value])=>document.querySelectorAll(`[data-quick-summary="${key}"]`).forEach(node=>node.textContent=value));
  const orderDiscountDerived=document.querySelector("[data-quick-order-discount-derived]");
  if(orderDiscountDerived)orderDiscountDerived.textContent=quickOrderDraft.orderDiscountType==="amount"?`${totals.orderDiscountPercent}%`:money(totals.orderDiscountAmount);
  const paymentBadge=document.getElementById("quick-order-payment-status");
  if(paymentBadge){paymentBadge.textContent=quickPaymentStatusLabel(payment.paymentStatus);paymentBadge.className=`badge ${payment.paymentStatus==="partially_paid"?"warning":payment.paymentStatus==="unpaid"?"gray":""}`.trim();}
  const message=document.getElementById("quick-order-message");
  if(message)message.textContent=quickOrderMessage(Boolean(quickOrderDraft.savedOrderId&&getOnlineOrder(quickOrderDraft.savedOrderId)?.confirmedAt));
  return true;
}

function paymentPlanLabel(value=quickOrderDraft.paymentPlan) {
  return ({cash_on_delivery:"الدفع عند الاستلام",advance_cod:"مقدم + الباقي عند الاستلام",prepaid_full:"مدفوع بالكامل مسبقًا",cash:"كاش"})[value]||"الدفع عند الاستلام";
}

function quickPaymentStatusLabel(value) {
  return ({unpaid:"غير مدفوع",partially_paid:"مدفوع جزئيًا",paid:"مدفوع بالكامل"})[value]||"غير مدفوع";
}

function quickOrderMessage(confirmed=false) {
  const totals=quickOrderTotalsNow(),payment=quickOrderPaymentNow(totals),order=quickOrderDraft.savedOrderId?getOnlineOrder(quickOrderDraft.savedOrderId):null;
  const rows=totals.lines.map((line,index)=>{
    const book=getBook(line.bookId),hasDiscount=line.lineDiscountTotal>0;
    const lines=[`${index+1}️⃣ ${book?.name||line.bookId}`,`الكمية: ${line.qty}`,`السعر قبل الخصم: ${line.unitOriginalPrice.toFixed(2)} ج.م للنسخة`,`السعر بعد الخصم: ${line.unitFinalPrice.toFixed(2)} ج.م للنسخة`,`إجمالي قبل الخصم: ${line.originalTotal.toFixed(2)} ج.م`];
    if(hasDiscount)lines.push(`خصم النسخة: ${line.unitDiscountAmount.toFixed(2)} ج.م (${line.discountPercent}%)`,`إجمالي الخصم: ${line.lineDiscountTotal.toFixed(2)} ج.م`);
    lines.push(`الإجمالي بعد الخصم: ${line.finalNet.toFixed(2)} ج.م`);
    return lines.join("\n");
  }).join("\n\n");
  return `${confirmed?"✅ تم تأكيد طلبك من مكتبة دوت كوم":"📚 ملخص طلبك من مكتبة دوت كوم"}\n${confirmed&&order?`\n🧾 رقم الطلب: ${order.id}\n`:""}\n👤 الاسم: ${quickOrderDraft.customerName||quickOrderCustomer()?.name||"—"}\n\n📖 الكتب:\n\n${rows}\n\n────────────────\n💰 إجمالي الكتب قبل الخصم: ${totals.subtotal.toFixed(2)} ج.م\n${totals.productDiscountTotal?`🏷️ خصومات الكتب: ${totals.productDiscountTotal.toFixed(2)} ج.م\n`:""}${totals.orderDiscountAmount?`🏷️ خصم إضافي على الطلب: ${totals.orderDiscountAmount.toFixed(2)} ج.م\n`:""}${totals.discountTotal?`🏷️ إجمالي الخصم: ${totals.discountTotal.toFixed(2)} ج.م\n`:""}📚 بعد الخصم: ${totals.goods.toFixed(2)} ج.م\n${totals.shipping?`🚚 الشحن: ${totals.shipping.toFixed(2)} ج.م`:"🚚 الشحن: مجاني"}\n\n✅ إجمالي الطلب: ${totals.total.toFixed(2)} ج.م\n\n💵 طريقة الدفع: ${paymentPlanLabel()}\n💳 المدفوع: ${payment.paidAmount.toFixed(2)} ج.م\n📌 المتبقي: ${payment.remainingAmount.toFixed(2)} ج.م`;
}

function quickOrderBookResults() {
  const term=normalizeSmartSearch(quickOrderSearch);
  if(!term)return "";
  const matches=(data.books||[]).filter(book=>!book.deletedAt&&normalizeSmartSearch([book.name,book.barcode,book.extraBarcode,book.sku,book.grade,book.category,book.publisher].join(" ")).includes(term)).slice(0,8);
  return `<div class="quick-book-results">${matches.map(book=>{const available=bookAvailableStock(book);return `<button type="button" class="quick-book-result" data-action="quick-order-add-book" data-id="${book.id}" ${available<=0?"disabled":""}><span><strong>${esc(book.name)}</strong><small>${esc(book.barcode||book.sku||book.id)} · ${esc(book.grade||book.category||"")}</small></span><span><b>${money(book.price)}</b><small>${available} متاح للبيع</small>${available<=Number(book.reorder||0)?badge(available?"كمية منخفضة":"غير متاح",available?"warning":"danger"):""}</span></button>`}).join("")||`<div class="empty-state compact">لا توجد نتائج مطابقة.</div>`}</div>`;
}

function quickGovernorateOptions() {
  return EGYPT_GOVERNORATES.map((value,index)=>`<button type="button" role="option" id="quick-governorate-option-${index}" data-action="quick-order-select-governorate" data-value="${esc(value)}" aria-selected="${quickOrderDraft.governorate===value}">${esc(value)}</button>`).join("");
}

function openQuickGovernorateList(open=true) {
  const input=document.getElementById("quick-order-governorate-search"),list=document.getElementById("quick-order-governorate-list");
  if(!input||!list)return;
  list.hidden=!open;input.setAttribute("aria-expanded",String(open));
  if(open)filterQuickGovernorates(input.value);
}

function filterQuickGovernorates(query="") {
  const term=normalizeSmartSearch(query),options=[...document.querySelectorAll("[data-action='quick-order-select-governorate']")];
  let first=null;
  options.forEach(option=>{const visible=!term||normalizeSmartSearch(option.dataset.value).includes(term);option.hidden=!visible;option.classList.remove("active");if(visible&&!first)first=option;});
  if(first){first.classList.add("active");document.getElementById("quick-order-governorate-search")?.setAttribute("aria-activedescendant",first.id);}
  else document.getElementById("quick-order-governorate-search")?.removeAttribute("aria-activedescendant");
}

function selectQuickGovernorate(value) {
  if(!EGYPT_GOVERNORATES.includes(value))return;
  quickOrderDraft.governorate=value;
  const input=document.getElementById("quick-order-governorate-search");
  if(input)input.value=value;
  clearQuickOrderFieldError("governorate");
  openQuickGovernorateList(false);
  if(!quickOrderDraft.shippingManual){
    quickOrderDraft.shippingCost=quickOrderShipping(value,quickOrderDraft.lines);
    const shipping=document.getElementById("quick-order-shipping-cost");
    if(shipping)shipping.value=quickOrderDraft.shippingCost||0;
  }
  refreshQuickOrderComputedUi();
}

function quickOrderFieldNode(field) {
  return field==="customerName"?document.getElementById("quick-order-name"):field==="governorate"?document.getElementById("quick-order-governorate-search"):document.getElementById("quick-order-address");
}

function clearQuickOrderFieldError(field) {
  const node=quickOrderFieldNode(field);if(!node)return;
  node.removeAttribute("aria-invalid");node.closest(".form-field")?.classList.remove("field-error");
}

function validateQuickOrderCustomerFields() {
  const fields=[
    ["customerName",String(quickOrderDraft.customerName||quickOrderCustomer()?.name||"").trim(),"أدخل اسم العميل"],
    ["governorate",String(quickOrderDraft.governorate||"").trim(),"اختر المحافظة"],
    ["address",String(quickOrderDraft.address||"").trim(),"أدخل عنوان العميل"]
  ];
  fields.forEach(([field,value])=>{if(value)clearQuickOrderFieldError(field);});
  const missing=fields.filter(([,value])=>!value);
  if(!missing.length)return true;
  missing.forEach(([field])=>{const node=quickOrderFieldNode(field);node?.setAttribute("aria-invalid","true");node?.closest(".form-field")?.classList.add("field-error");});
  const first=quickOrderFieldNode(missing[0][0]);first?.scrollIntoView({behavior:"smooth",block:"center"});setTimeout(()=>first?.focus({preventScroll:true}),180);
  toast(missing.length===1?missing[0][2]:`أكمل الحقول التالية: ${missing.map(item=>item[2].replace(/^(أدخل|اختر)\s/,"")).join("، ")}`,"error");
  return false;
}

function quickOrderFieldIdentity(element) {
  if(!(element instanceof HTMLElement)||!root.contains(element))return "";
  if(element.id)return `#${CSS.escape(element.id)}`;
  for(const name of ["quickOrderQty","quickOrderDiscount","quickOrderDiscountType"]){
    if(element.dataset[name]!==undefined)return `[data-${name.replace(/[A-Z]/g,letter=>`-${letter.toLowerCase()}`)}="${CSS.escape(element.dataset[name])}"]`;
  }
  return "";
}

function renderQuickOrderPreservingContext({focusSelector=""}={}) {
  const active=document.activeElement,selector=focusSelector||quickOrderFieldIdentity(active);
  const selection=active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement
    ? {start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection}
    : null;
  const scroll={x:window.scrollX,y:window.scrollY};
  quickOrderContextRender=true;
  renderOnlineOrders();
  quickOrderContextRender=false;
  const next=selector?document.querySelector(selector):null;
  if(next instanceof HTMLElement){
    next.focus({preventScroll:true});
    if(selection&&(next instanceof HTMLInputElement||next instanceof HTMLTextAreaElement)){
      const length=next.value.length;
      next.setSelectionRange(Math.min(selection.start??length,length),Math.min(selection.end??length,length),selection.direction||"none");
    }
  }
  window.scrollTo(scroll.x,scroll.y);
  requestAnimationFrame(()=>{
    window.scrollTo(scroll.x,scroll.y);
  });
}

function refreshQuickOrderBookResults() {
  const wrap=document.getElementById("quick-order-book-search")?.closest(".quick-book-search");
  if(!wrap)return;
  wrap.querySelector(".quick-book-results")?.remove();
  const markup=quickOrderBookResults();
  if(markup)wrap.insertAdjacentHTML("beforeend",markup);
}

function renderQuickOrderScreen() {
  const customer=quickOrderCustomer();
  if(customer&&!quickOrderDraft.customerId)Object.assign(quickOrderDraft,{customerId:customer.id,customerName:customer.name,governorate:customer.governorate||"",city:customer.city||"",address:customer.address||"",alternativePhone:customer.alternativePhone||""});
  if(!quickOrderDraft.shippingManual)quickOrderDraft.shippingCost=quickOrderShipping(quickOrderDraft.governorate,quickOrderDraft.lines);
  let totals,payment;
  try{totals=quickOrderTotalsNow();payment=quickOrderPaymentNow(totals);}catch(error){totals=OrderFinance.calculateOrder([]);payment=OrderFinance.calculatePayment(0,0);setTimeout(()=>toast(error.message,"error"),0);}
  const confirmed=Boolean(quickOrderDraft.savedOrderId&&getOnlineOrder(quickOrderDraft.savedOrderId)?.confirmedAt),canOverride=canAction("order.discount.override"),canReceive=canAction("order.payment.receive"),customerInsight=quickOrderCustomerInsight(customer);
  if(!quickOrderContextRender&&quickOrderAutofocusPending){
    quickOrderAutofocusPending=false;
    setTimeout(()=>document.getElementById(quickOrderDraft.phone?"quick-order-book-search":"quick-order-phone")?.focus({preventScroll:true}),0);
  }
  return `${workflowModeTabs("quick")}
  <div class="section-title"><div><span class="eyebrow">خدمة العملاء · واتساب</span><h2>طلب واتساب سريع</h2><p>سجل الطلب أثناء المحادثة ثم انسخ الملخص للعميل.</p></div>${confirmed?`<button class="btn" data-action="quick-order-new">طلب جديد</button>`:""}</div>
  <div class="quick-order-layout"><div class="quick-order-main">
    <article class="card quick-customer-card"><div class="card-header"><div><h3>1. بيانات العميل</h3><p>ابدأ برقم الموبايل لاسترجاع البيانات المسجلة.</p></div>${customer?badge("عميل مسجل",""):badge("عميل جديد","warning")}</div>
      ${customer?`<div class="quick-customer-insight"><span class="quick-customer-check">✓</span><div><strong>تم العثور على عميل سابق: ${esc(customer.name)}</strong><small>${esc([customer.governorate,customer.city,customer.address].filter(Boolean).join("، ")||"لا يوجد عنوان مسجل")}</small></div><div class="quick-customer-history"><b>${customerInsight?.count||0}</b><small>طلب سابق</small>${customerInsight?.last?`<span>آخر طلب ${arabicDateTimeLabel(customerInsight.last.createdAt)}</span>`:""}</div></div>`:`<div class="quick-customer-insight new"><span class="quick-customer-check">+</span><div><strong>عميل جديد</strong><small>ستُحفظ بياناته مع الطلب بعد التأكيد.</small></div></div>`}
      <div class="form-grid three"><div class="form-field"><label class="required">رقم الموبايل</label><input id="quick-order-phone" dir="ltr" inputmode="tel" value="${esc(quickOrderDraft.phone)}" placeholder="01xxxxxxxxx"></div><div class="form-field"><label class="required">الاسم</label><input id="quick-order-name" value="${esc(quickOrderDraft.customerName||customer?.name||"")}" ${customer?"readonly":""}></div><div class="form-field"><label>رقم بديل</label><input id="quick-order-alt-phone" dir="ltr" value="${esc(quickOrderDraft.alternativePhone||"")}"></div><div class="form-field"><label class="required" for="quick-order-governorate-search">المحافظة</label><div class="quick-governorate-combobox"><input id="quick-order-governorate-search" role="combobox" aria-autocomplete="list" aria-controls="quick-order-governorate-list" aria-expanded="false" autocomplete="off" value="${esc(quickOrderDraft.governorate||"")}" placeholder="اكتب للبحث عن المحافظة"><button type="button" data-action="quick-order-toggle-governorate" aria-label="فتح قائمة المحافظات">⌄</button><div id="quick-order-governorate-list" class="quick-governorate-list" role="listbox" hidden>${quickGovernorateOptions()}</div></div></div><div class="form-field"><label>المدينة / المنطقة</label><input id="quick-order-city" value="${esc(quickOrderDraft.city||"")}"></div><div class="form-field"><label class="required">العنوان</label><input id="quick-order-address" value="${esc(quickOrderDraft.address||"")}"></div><div class="form-field full"><label>علامة مميزة أو وصف إضافي</label><input id="quick-order-address-mark" value="${esc(quickOrderDraft.addressMark||"")}"></div></div>
    </article>
    <article class="card quick-products-card"><div class="card-header"><div><h3>2. الكتب</h3><p>ابحث ثم اضغط Enter لإضافة أول نتيجة.</p></div><span>${quickOrderDraft.lines.length} كتاب مختلف</span></div>
      <div class="quick-book-search"><input id="quick-order-book-search" value="${esc(quickOrderSearch)}" autocomplete="off" placeholder="ابحث باسم الكتاب أو الكود أو الصف أو المادة">${quickOrderBookResults()}</div>
      <div class="quick-order-lines">${totals.lines.map((line,index)=>{const book=getBook(line.bookId),ownReserved=quickOrderDraft.savedOrderId&&getOnlineOrder(quickOrderDraft.savedOrderId)?.inventoryReservation?.status==="active"?Number(getOnlineOrder(quickOrderDraft.savedOrderId).inventoryReservation.lines?.find(item=>item.bookId===line.bookId)?.qty||0):0,available=bookAvailableStock(book)+ownReserved;return `<article class="quick-order-line"><div class="quick-line-book"><strong>${esc(book?.name||line.bookId)}</strong><small>${esc(book?.barcode||book?.sku||"")} · ${available} متاح للبيع</small></div><label><span>الكمية</span><input data-quick-order-qty="${index}" inputmode="decimal" min="1" max="${available}" value="${line.qty}"></label><div class="quick-line-price" data-quick-line-price="${index}">${quickOrderLinePriceMarkup(line)}</div><div class="quick-line-discount"><label><span>خصم النسخة ${helpIcon("الخصم المدخل يطبق على كل نسخة، وإجمالي الخصم يتغير تلقائيًا مع الكمية.","شرح خصم النسخة")}</span><select data-quick-order-discount-type="${index}" ${canOverride?"":"disabled"}><option value="percent" ${line.discountType==="percent"?"selected":""}>نسبة % لكل نسخة</option><option value="amount" ${line.discountType==="amount"?"selected":""}>قيمة ج.م لكل نسخة</option></select></label><input data-quick-order-discount="${index}" inputmode="decimal" value="${line.discount||0}" ${canOverride?"":"disabled"} aria-label="خصم النسخة"><small data-quick-line-discount-derived="${index}">خصم النسخة: ${money(line.unitDiscountAmount)} (${line.discountPercent}%) · إجمالي الخصم: ${money(line.lineDiscountTotal)}</small></div><div class="quick-line-total"><small>إجمالي قبل الخصم</small><span>${money(line.originalTotal)}</span><small>إجمالي الصنف بعد الخصم</small><strong data-quick-line-total="${index}">${money(line.finalNet)}</strong></div><button class="row-action text-danger" data-action="quick-order-remove-book" data-index="${index}">حذف</button></article>`}).join("")||`<div class="empty-state compact">أضف الكتب من البحث السريع.</div>`}</div>
      <div class="quick-order-level-discount"><div><strong>خصم إضافي على الطلب</strong><small>مستقل عن خصومات الكتب ولا يُحتسب مرتين.</small></div><select id="quick-order-order-discount-type" ${canOverride?"":"disabled"}><option value="percent" ${quickOrderDraft.orderDiscountType==="percent"?"selected":""}>نسبة %</option><option value="amount" ${quickOrderDraft.orderDiscountType==="amount"?"selected":""}>قيمة ج.م</option></select><input id="quick-order-order-discount" inputmode="decimal" value="${quickOrderDraft.orderDiscount||0}" ${canOverride?"":"disabled"}><span data-quick-order-discount-derived>${quickOrderDraft.orderDiscountType==="amount"?`${totals.orderDiscountPercent}%`:`${money(totals.orderDiscountAmount)}`}</span></div>
    </article>
    <article class="card quick-shipping-card"><div class="card-header"><div><h3>3. الشحن للعميل</h3><p>القيمة التي ستظهر للعميل وتدخل في إجمالي الطلب والتحصيل.</p></div>${badge(quickOrderDraft.shippingManual?"قيمة يدوية":"حسب المحافظة",quickOrderDraft.shippingManual?"warning":"gray")}</div>
      <div class="quick-shipping-grid"><div class="form-field"><label>تكلفة الشحن على العميل ${helpIcon("هذه ليست تكلفة شركة الشحن الداخلية؛ إنها القيمة المضافة إلى فاتورة العميل.","شرح تكلفة الشحن")}</label><input id="quick-order-shipping-cost" inputmode="decimal" min="0" value="${quickOrderDraft.shippingCost||0}" aria-describedby="quick-order-shipping-help"></div><div class="quick-shipping-preview"><span>يضاف للطلب</span><strong data-quick-summary="shipping">${totals.shipping?money(totals.shipping):"مجاني"}</strong><small id="quick-order-shipping-help">تؤثر على الإجمالي والمتبقي والتحصيل عند الاستلام.</small></div><button class="btn ghost" type="button" data-action="quick-order-reset-shipping">استخدام سعر المحافظة</button></div>
    </article>
    <article class="card quick-payment-card"><div class="card-header"><div><h3>4. الدفع والتحصيل</h3><p>سجّل فقط المبلغ الذي استلمته المكتبة فعليًا.</p></div><span id="quick-order-payment-status" class="badge ${payment.paymentStatus==="partially_paid"?"warning":payment.paymentStatus==="unpaid"?"gray":""}">${quickPaymentStatusLabel(payment.paymentStatus)}</span></div>
      <div class="form-grid two"><div class="form-field"><label>طريقة الدفع</label><select id="quick-order-payment-plan"><option value="cash_on_delivery" ${quickOrderDraft.paymentPlan==="cash_on_delivery"?"selected":""}>الدفع عند الاستلام</option><option value="advance_cod" ${quickOrderDraft.paymentPlan==="advance_cod"?"selected":""}>دفع مقدم + الباقي عند الاستلام</option><option value="prepaid_full" ${quickOrderDraft.paymentPlan==="prepaid_full"?"selected":""}>مدفوع بالكامل مسبقًا</option><option value="cash" ${quickOrderDraft.paymentPlan==="cash"?"selected":""}>كاش</option></select></div>
      <div class="form-field"><label>المبلغ المستلم فعليًا ${helpIcon("اكتب فقط المبلغ الذي استلمته المكتبة بالفعل من العميل.","شرح المبلغ المدفوع")}</label><input id="quick-order-paid-amount" inputmode="decimal" value="${quickOrderDraft.paidAmount||0}" ${canReceive?"":"disabled"}></div>
      <label class="choice-card"><input id="quick-order-payment-confirmed" type="checkbox" ${quickOrderDraft.paymentConfirmed?"checked":""} ${canReceive?"":"disabled"}><span><strong>تأكيد استلام المال</strong><small>ينشئ إيصالًا وحركة خزنة واحدة فقط. اختيار الطريقة وحده لا يكفي.</small></span></label>
      <div class="form-field"><label>الخزنة / الحساب</label><select id="quick-order-cash-account" ${canReceive&&quickOrderDraft.paymentConfirmed?"":"disabled"}><option value="">اختر الحساب</option>${(data.cashAccounts||[]).filter(x=>x.active!==false).map(x=>`<option value="${x.id}" ${quickOrderDraft.cashAccountId===x.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select></div></div>
      ${quickOrderDraft.savedOrderId&&Number(getOnlineOrder(quickOrderDraft.savedOrderId)?.paidAmount||0)>0?`<div class="finance-callout warning"><strong>يوجد مبلغ مدفوع على الطلب</strong><span>أي تغيير في الكتب أو الخصومات أو الشحن يعيد حساب المتبقي، ولا يحذف الدفعة القديمة.</span></div>`:""}
    </article>
  </div><aside class="quick-order-summary card"><div class="card-header"><div><h3>ملخص الطلب للعميل</h3><p>${confirmed?"الطلب مؤكد وجاهز لنسخ رسالة التأكيد.":"يتحدث تلقائيًا من نفس بيانات الطلب."}</p></div>${badge(confirmed?"مؤكد":"مسودة",confirmed?"":"warning")}</div>
    <div class="quick-finance-summary"><span>عدد الكتب <b data-quick-summary="books">${totals.lines.length}</b></span><span>إجمالي القطع <b data-quick-summary="units">${totals.lines.reduce((sum,line)=>sum+Number(line.qty||0),0)}</b></span><span>السعر قبل الخصم <b data-quick-summary="subtotal">${money(totals.subtotal)}</b></span><span>خصومات الكتب <b data-quick-summary="productDiscount">${money(totals.productDiscountTotal)}</b></span><span>خصم الطلب <b data-quick-summary="orderDiscount">${money(totals.orderDiscountAmount)}</b></span><span class="discount">إجمالي الخصم <b data-quick-summary="discountTotal">${money(totals.discountTotal)}${totals.subtotal?` (${OrderFinance.round(totals.discountTotal*100/totals.subtotal)}%)`:""}</b></span><span class="after-discount">السعر بعد الخصم <b data-quick-summary="goods">${money(totals.goods)}</b></span><span>شحن العميل <b data-quick-summary="shipping">${totals.shipping?money(totals.shipping):"مجاني"}</b></span><span class="grand">إجمالي الطلب <b data-quick-summary="total">${money(totals.total)}</b></span><span>طريقة الدفع <b data-quick-summary="paymentPlan">${paymentPlanLabel()}</b></span><span>المدفوع <b data-quick-summary="paid">${money(payment.paidAmount)}</b></span><span class="remaining">المتبقي ${helpIcon("المبلغ المطلوب تحصيله لاحقًا من العميل أو شركة الشحن.","شرح المتبقي")} <b data-quick-summary="remaining">${money(payment.remainingAmount)}</b></span><span class="cod">تحصيل شركة الشحن <b data-quick-summary="cod">${money(payment.remainingAmount)}</b></span></div>
    <pre id="quick-order-message">${esc(quickOrderMessage(confirmed))}</pre>
    <div class="form-actions sticky-actions"><button class="btn secondary" data-action="quick-order-copy">${confirmed?"📋 نسخ تأكيد الطلب":"📋 نسخ ملخص الطلب"}</button>${!confirmed?`<button class="btn ghost" data-action="quick-order-save">${quickOrderDraft.savedOrderId?"تحديث المسودة":"حفظ المسودة"}</button><span class="primary-with-help"><button class="btn" data-action="quick-order-confirm">تأكيد الطلب</button>${helpIcon("بعد التأكيد ينتقل الطلب لمسؤول التجهيز ويتم تطبيق قواعد المخزون الحالية.","شرح تأكيد الطلب")}</span>`:`<button class="btn" data-action="quick-order-new">طلب جديد</button>`}</div>
  </aside></div>`;
}

function preparationOrders() {
  return (data.onlineOrders||[]).filter(order=>!order.deletedAt&&["awaiting_preparation","preparing","needs_review"].includes(order.workflowStage)&&!order.preparedAt);
}

function readyShippingOrders() {
  return (data.onlineOrders||[]).filter(order=>!order.deletedAt&&order.workflowStage==="awaiting_shipping"&&Boolean(order.preparedAt)&&!order.shipmentId);
}

function workflowModeTabs(active="orders") {
  const tabs=[
    ["orders","كل الطلبات",true],
    ["quick","طلب واتساب سريع",canAction("order.quick.create")],
    ["preparation","قائمة التجهيز",canAction("order.prepare")],
    ["ready-shipping","جاهز للشحن",canAction("order.prepare")||canAction("order.pack")||canAction("order.shipping")],
    ["quick-shipping","الشحن السريع",canAction("order.prepare")||canAction("order.pack")||canAction("order.shipping")]
  ];
  return `<div class="online-order-mode-tabs">${tabs.filter(([, ,visible])=>visible).map(([mode,label])=>`<button class="tab ${active===mode?"active":""}" data-action="online-orders-mode" data-mode="${mode}">${label}${mode==="ready-shipping"&&readyShippingOrders().length?` <b>${readyShippingOrders().length}</b>`:""}</button>`).join("")}</div>`;
}

function renderPreparationQueue() {
  const rows=preparationOrders();
  const awaiting=rows.filter(order=>["awaiting_preparation","needs_review"].includes(order.workflowStage)),active=rows.filter(order=>order.workflowStage==="preparing");
  const cards=list=>list.map(order=>{const units=(order.lines||[]).reduce((s,l)=>s+Number(l.qty||0),0),pay=OrderFinance.calculatePayment(Number(order.total||0),Number(order.paidAmount||0)),payText=pay.paymentStatus==="paid"?"💰 مدفوع بالكامل":pay.paidAmount>0?`💰 مقدم ${money(pay.paidAmount)} · متبقي ${money(pay.remainingAmount)}`:`💵 الدفع عند الاستلام · ${money(pay.remainingAmount)}`;return `<article class="card preparation-card"><div class="card-header"><div><span class="eyebrow">${order.source==="whatsapp"?"واتساب":"الموقع"}</span><h3>${esc(order.id)}</h3><p>${arabicDateTimeLabel(order.confirmedAt||order.createdAt)}</p></div>${badge(order.workflowStage==="needs_review"?"يحتاج مراجعة":order.workflowStage==="preparing"?"قيد التجهيز":"بانتظار التجهيز",order.workflowStage==="needs_review"?"danger":"warning")}</div><p><strong>${esc(order.customerName)}</strong> · ${order.lines?.length||0} كتاب · ${units} قطعة</p><div class="preparation-payment">${payText}</div><p class="muted">${order.workflowStage==="preparing"?`يجهزه: ${esc(order.preparingBy||"—")}`:`أنشأه: ${esc(order.createdBy||"—")}`}</p><div class="form-actions"><button class="btn" data-action="${order.workflowStage==="preparing"?"prepare-order-open":"prepare-order-start"}" data-id="${order.id}">${order.workflowStage==="preparing"?"فتح التجهيز":"بدء التجهيز"}</button></div></article>`}).join("")||`<div class="empty-state compact">لا توجد طلبات في هذه المرحلة.</div>`;
  return `${workflowModeTabs("preparation")}<div class="section-title"><div><h2>قائمة التجهيز</h2><p>كل طلب يظهر في Queue واحدة، والكتب تُقرأ مباشرة من الطلب الأصلي.</p></div></div><section class="workflow-queue"><div class="workflow-queue-title"><div><span class="queue-dot waiting"></span><h3>بانتظار التجهيز</h3></div><b>${awaiting.length}</b></div><div class="preparation-grid">${cards(awaiting)}</div></section><section class="workflow-queue"><div class="workflow-queue-title"><div><span class="queue-dot active"></span><h3>قيد التجهيز</h3></div><b>${active.length}</b></div><div class="preparation-grid">${cards(active)}</div></section>`;
}

async function orderWorkflowRequest(path,{method="POST",body}={}) {
  const requestKey=`${method}:${path}`;
  if(orderWorkflowRequests.has(requestKey))return orderWorkflowRequests.get(requestKey);
  const request=(async()=>{
    const response=await fetch(path,{method,credentials:"same-origin",headers:authHeaders({...(body?{"Content-Type":"application/json"}:{}),...(dbRevision?{"X-DB-Revision":dbRevision}:{})}),body:body?JSON.stringify(body):undefined});
    const result=await response.json().catch(()=>({}));
    const authError=orderAuthenticationError(response.status,result);
    if(authError)throw authError;
    if(!response.ok)throw Object.assign(new Error(result.message||"تعذر تنفيذ الإجراء."),{code:result.code||"ORDER_ACTION_FAILED",status:response.status});
    dbRevision=response.headers.get("X-DB-Revision")||result.revision||dbRevision;
    await reloadRemoteData();
    return result;
  })();
  orderWorkflowRequests.set(requestKey,request);
  try{return await request;}finally{orderWorkflowRequests.delete(requestKey);}
}

function quickOrderPayload() {
  const {shippingManual,...persistedDraft}=quickOrderDraft;
  return {...persistedDraft,phone:normalizePhone(quickOrderDraft.phone),alternativePhone:normalizeArabicDigits(quickOrderDraft.alternativePhone),customerName:quickOrderDraft.customerName||quickOrderCustomer()?.name||"",paymentMethod:paymentPlanLabel(),lines:quickOrderDraft.lines.map(line=>({bookId:line.bookId,qty:line.qty,discount:line.discount||0,discountType:line.discountType||"percent",discountScope:"unit"}))};
}

async function saveQuickOrderDraft({silent=false}={}) {
  const payload=quickOrderPayload();
  const result=quickOrderDraft.savedOrderId
    ? await orderWorkflowRequest(`/api/orders/${encodeURIComponent(quickOrderDraft.savedOrderId)}/quick`,{method:"PATCH",body:payload})
    : await orderWorkflowRequest("/api/orders/quick",{body:payload});
  quickOrderDraft.savedOrderId=result.order.id;
  if(!silent)toast(`تم حفظ المسودة ${result.order.id}.`);
  return result.order;
}

async function saveAndConfirmQuickOrder() {
  if(!validateQuickOrderCustomerFields())return;
  if(quickOrderDraft.savedOrderId){
    const existing=getOnlineOrder(quickOrderDraft.savedOrderId);
    if(existing?.confirmedAt)return toast("تم تأكيد هذا الطلب من قبل.");
  }
  try{
    await saveQuickOrderDraft({silent:true});
    await orderWorkflowRequest(`/api/orders/${encodeURIComponent(quickOrderDraft.savedOrderId)}/confirm`);
    renderOnlineOrders();toast(`تم تأكيد الطلب ${quickOrderDraft.savedOrderId} وانتقل للتجهيز.`);
  }catch(error){toast(error.message,"error");}
}

function editQuickOrder(id) {
  const order=getOnlineOrder(id);if(!order)return;
  if(order.saleId)return toast("تم إنشاء فاتورة لهذا الطلب؛ استخدم إجراءات التصحيح الحالية.","error");
  if(["awaiting_shipping","shipped"].includes(order.workflowStage)||order.preparedAt)return toast("تم تجهيز الطلب. استخدم «إعادة فتح للتجهيز» قبل تعديل الكتب أو الأسعار.","error");
  if(["preparing","needs_review"].includes(order.workflowStage)&&!confirm("بدأ تجهيز هذا الطلب. سيتم تحديث الطلب الأصلي وإعادة ضبط Checklist وإشعار موظف التجهيز. هل تريد المتابعة؟"))return;
  quickOrderDraft={...emptyQuickOrderDraft(),phone:order.phone||"",customerId:order.customerId||"",customerName:order.customerName||"",governorate:order.governorate||"",city:order.city||"",address:order.address||"",addressMark:order.addressMark||"",alternativePhone:order.alternativePhone||"",lines:(order.lines||[]).map(line=>({bookId:line.bookId,qty:Number(line.qty||1),price:Number(line.price||getBook(line.bookId)?.price||0),discount:Number(line.discount||0),discountType:line.discountType||"percent",discountScope:line.discountScope||"unit"})),shippingCost:Number(order.shippingCost||0),shippingManual:true,paymentPlan:order.paymentPlan||"cash_on_delivery",paymentMethod:order.paymentMethod||"الدفع عند الاستلام",paidAmount:Number(order.paidAmount||0),paymentConfirmed:false,cashAccountId:"",orderDiscount:Number(order.orderDiscount||0),orderDiscountType:order.orderDiscountType||"percent",notes:order.notes||"",chatwootConversationId:order.chatwootConversationId||"",savedOrderId:order.id};
  quickOrderSearch="";quickOrderAutofocusPending=true;onlineOrdersMode="quick";renderOnlineOrders();
}

async function copyQuickOrderMessage() {
  try{await navigator.clipboard.writeText(quickOrderMessage(Boolean(quickOrderDraft.savedOrderId&&getOnlineOrder(quickOrderDraft.savedOrderId)?.confirmedAt)));toast("تم نسخ ملخص الطلب");}
  catch{toast("تعذر النسخ تلقائيًا. حدد النص وانسخه.","error");}
}

async function cancelOnlineOrder(id) {
  const order=getOnlineOrder(id);if(!order)return;
  try{
    const result=await orderWorkflowRequest(`/api/orders/${encodeURIComponent(id)}/cancellation/preview`,{method:"GET"});
    if(result.financial.paid>0)return openCancellationSettlement("order",id,result.financial);
    if(!confirm(`هل تريد إلغاء الطلب ${id} وتحرير الكميات المحجوزة؟`))return;
    await orderWorkflowRequest(`/api/orders/${encodeURIComponent(id)}/cancel`,{body:{reason:"إلغاء يدوي من شاشة الطلبات"}});renderOnlineOrders();toast("تم إلغاء الطلب وتحرير المخزون المحجوز.");
  }catch(error){toast(error.message,"error");}
}

function cancellationEndpoint(kind,id,suffix){return `/api/${kind==="sale"?"sales":"orders"}/${encodeURIComponent(id)}/${suffix}`;}

function cancellationSettlementLabel(type){return({cash_refund:"رد نقدي للعميل",customer_credit:"تحويل المبلغ إلى رصيد دائن",linked_disbursement:"ربط إيصال صرف موجود",pending_credit:"إبقاء المبلغ كرصيد معلق — Advanced"}[type]||type);}

function openCancellationSettlement(kind,id,financial){
  const paymentOptions=(financial.payments||[]).map(item=>`<option value="${esc(item.id)}">${esc(item.id)} · ${money(item.amount)} · ${esc(item.cashAccountName||item.paymentMethod||"—")}</option>`).join("");
  const receiptOptions=(financial.candidates||[]).map(item=>`<option value="${esc(item.id)}">${esc(item.id)} · ${money(item.amount)} · ${fmtDate(item.date)}</option>`).join("");
  const finalButton=financial.canCancel?`<button class="btn danger" type="button" data-action="cancellation-finalize" data-kind="${kind}" data-id="${esc(id)}">${kind==="sale"?"إلغاء الفاتورة الآن":"إلغاء الطلب الآن"}</button>`:"";
  openModal("لا يمكن إلغاء الطلب قبل تسوية المبلغ المدفوع","تسوية المبلغ قبل الإلغاء",`
    <div class="metric-strip"><div class="mini-metric"><span>إجمالي المستند</span><strong>${money(financial.total)}</strong></div><div class="mini-metric"><span>المدفوع</span><strong>${money(financial.paid)}</strong></div><div class="mini-metric"><span>المسترد</span><strong>${money(financial.refunded)}</strong></div><div class="mini-metric"><span>الرصيد الدائن</span><strong>${money(financial.credited)}</strong></div><div class="mini-metric"><span>المطلوب تسويته</span><strong>${money(financial.outstanding)}</strong></div></div>
    <div class="finance-callout"><strong>${esc(financial.customerName)}</strong><span>${esc(financial.orderId||"—")} · ${esc(financial.invoiceId||"بدون فاتورة")}</span></div>
    ${(financial.refunds||[]).length?`<div class="table-wrap"><table><thead><tr><th>التسوية</th><th>النوع</th><th>المبلغ</th><th>المستخدم</th></tr></thead><tbody>${financial.refunds.map(row=>`<tr><td>${esc(row.refundId)}</td><td>${esc(cancellationSettlementLabel(row.settlementType))}</td><td>${money(row.amount)}</td><td>${esc(row.performedBy)}</td></tr>`).join("")}</tbody></table></div>`:""}
    ${financial.outstanding>0?`<form id="cancellation-settlement-form" data-kind="${kind}" data-id="${esc(id)}"><input type="hidden" name="orderId" value="${esc(financial.orderId||"")}"><input type="hidden" name="invoiceId" value="${esc(financial.invoiceId||"")}"><input type="hidden" name="customerId" value="${esc(financial.customerId||"")}"><div class="form-grid"><div class="form-field"><label>طريقة التسوية</label><select name="settlementType"><option value="cash_refund">رد نقدي للعميل</option><option value="customer_credit">تحويل لرصيد دائن</option><option value="linked_disbursement" ${receiptOptions?"":"disabled"}>ربط إيصال صرف موجود</option><option value="pending_credit">رصيد معلق — Advanced</option></select></div><div class="form-field"><label>المبلغ</label><input name="amount" type="number" min="0.01" max="${financial.outstanding}" step="0.01" value="${financial.outstanding}" required></div><div class="form-field"><label>الدفعة الأصلية</label><select name="paymentId">${paymentOptions}</select></div><div class="form-field"><label>الخزنة</label><select name="cashAccountId">${refundCashAccountOptions()}</select></div><div class="form-field"><label>إيصال الصرف</label><select name="receiptId"><option value="">اختر يدويًا...</option>${receiptOptions}</select></div><div class="form-field full"><label>السبب</label><textarea name="reason" required>تسوية المبلغ قبل الإلغاء</textarea></div></div><div class="form-actions"><button class="btn" type="submit">تأكيد التسوية</button><button class="btn ghost" type="button" data-action="cancellation-open-ledger" data-id="${esc(financial.customerId)}">عرض كشف حساب العميل</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء العملية</button></div></form>`:"<div class=\"success-note\">تمت تسوية كامل المبلغ. يمكن الآن إلغاء المستند.</div>"}
    <div class="form-actions">${finalButton}<button class="btn ghost" type="button" data-action="cancellation-open-ledger" data-id="${esc(financial.customerId)}">عرض كشف حساب العميل</button></div>`);
}

async function refreshCancellationSettlement(kind,id){const result=await orderWorkflowRequest(cancellationEndpoint(kind,id,"cancellation/preview"),{method:"GET"});openCancellationSettlement(kind,id,result.financial);}

async function confirmExistingOnlineOrder(id) {
  try{await orderWorkflowRequest(`/api/orders/${encodeURIComponent(id)}/confirm`);onlineOrdersMode="orders";renderOnlineOrders();toast(`تم تأكيد ${id} وحجز الكمية المتاحة.`);}
  catch(error){toast(error.message,"error");}
}

async function openPreparationOrder(id,start=false) {
  try{
    if(start)await orderWorkflowRequest(`/api/orders/${encodeURIComponent(id)}/prepare/start`);
    const order=getOnlineOrder(id);if(!order)return;
    const doneMap=new Map((order.preparationChecklist||[]).map(item=>[item.bookId,Boolean(item.done)])),checklist=(order.lines||[]).map(line=>({bookId:line.bookId,qty:line.qty,done:doneMap.get(line.bookId)||false}));
    openModal(`تجهيز ${order.id}`,"قائمة التجهيز",`<div class="preparation-owner"><strong>${esc(order.customerName)}</strong><span>${order.source==="whatsapp"?"واتساب":"الموقع"} · بدأ ${esc(order.preparingBy||currentUser?.name||"")}</span></div><div class="preparation-source-note">الكتب والكميات معروضة مباشرة من الطلب الأصلي · آخر تحديث ${arabicDateTimeLabel(order.updatedAt||order.createdAt)}</div><div class="preparation-checklist">${checklist.map(item=>{const book=getBook(item.bookId);return `<label class="choice-card"><input type="checkbox" data-preparation-book="${item.bookId}" ${item.done?"checked":""}><span><strong>${esc(book?.name||item.bookId)}</strong><small>${esc(book?.barcode||book?.sku||"")} · الكمية ${item.qty}</small></span></label>`}).join("")}</div>${order.preparationIssue?`<div class="alert-item danger"><div class="alert-badge red">!</div><div><strong>${esc(order.preparationIssue.reason)}</strong><span>${esc(order.preparationIssue.notes||"")}</span></div></div>`:""}<div class="form-actions"><button class="btn" data-action="prepare-order-finish-choice" data-id="${order.id}" ${(checklist.length&&!checklist.some(item=>!item.done))?"":"disabled"}>إنهاء التجهيز</button><button class="btn ghost text-danger" data-action="prepare-order-issue" data-id="${order.id}">مشكلة في التجهيز</button></div>`);
  }catch(error){toast(error.message,"error");}
}

function finishPreparationModal(id) {
  const order=getOnlineOrder(id);if(!order)return;
  const company=shippingSessionCompany||data.shippingCompanies?.find(item=>!item.deletedAt&&item.active!==false)?.name||"";
  openModal(`إنهاء تجهيز ${order.id}`,"اختر الخطوة التالية",`<div class="finish-preparation-options">
    <button type="button" class="finish-preparation-card preferred" data-action="prepare-order-complete" data-id="${order.id}"><span class="finish-option-icon">✓</span><span><strong>جاهز للشحن لاحقًا</strong><small>الخيار المعتاد: ينقل الطلب إلى قائمة «جاهز للشحن» دون إنشاء شحنة الآن.</small></span></button>
    <form id="prepare-and-ship-form" data-order-id="${order.id}" class="finish-preparation-card direct"><span class="finish-option-icon">↗</span><div><strong>تجهيز وشحن مباشر</strong><small>ينشئ الفاتورة تلقائيًا عند الحاجة ثم يسجل الشحنة مرة واحدة.</small><div class="form-grid two"><div class="form-field"><label class="required">شركة الشحن</label><select name="company" required>${shippingCompanyOptions(company)}</select></div><div class="form-field"><label class="required">كود التتبع</label><input name="trackingNumber" dir="ltr" required></div></div><button class="btn secondary" type="submit">تأكيد التجهيز والشحن</button></div></form>
  </div><div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">رجوع</button></div>`);
}

function preparationIssueModal(id) {
  openModal("مشكلة في التجهيز","إيقاف الطلب للمراجعة",`<form id="preparation-issue-form" data-id="${id}"><div class="form-grid"><div class="form-field"><label>سبب المشكلة</label><select name="reason">${["صنف غير متوفر","الكمية غير كافية","صنف مختلف","يحتاج مراجعة خدمة العملاء","مشكلة في الطلب","سبب آخر"].map(value=>`<option>${value}</option>`).join("")}</select></div><div class="form-field full"><label>ملاحظات</label><textarea name="notes"></textarea></div></div><div class="form-actions"><button class="btn danger" type="submit">تسجيل المشكلة</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div></form>`);
}

function shippingLookupOrder(value="") {
  const code=String(value).trim().toUpperCase();
  if(!code)return null;
  return (data.onlineOrders||[]).find(order=>!order.deletedAt&&(String(order.id).toUpperCase()===code||String(order.saleId||"").toUpperCase()===code))||null;
}

function readyShippingRow(order) {
  const payment=OrderFinance.calculatePayment(Number(order.total||0),Number(order.paidAmount||0)),units=(order.lines||[]).reduce((sum,line)=>sum+Number(line.qty||0),0);
  const shipment=data.shipments.find(item=>!item.deletedAt&&(item.id===order.shipmentId||item.onlineOrderId===order.id));
  return `<tr><td><strong>${esc(order.id)}</strong>${order.saleId?`<small>${esc(order.saleId)}</small>`:`<small class="text-danger">الفاتورة مطلوبة</small>`}</td><td><strong>${esc(order.customerName||"—")}</strong><small>${esc(order.governorate||"—")}</small></td><td>${units}</td><td>${money(order.total||0)}</td><td>${money(payment.paidAmount)}</td><td><strong>${money(payment.remainingAmount)}</strong><small>${payment.remainingAmount?"COD":"مدفوع بالكامل"}</small></td><td>${arabicDateTimeLabel(order.preparedAt)}</td><td>${shipment?`<strong>تم الشحن</strong><small dir="ltr">${esc(shipment.trackingNumber||shipment.tracking)}</small>`:`<div class="row-actions">${!order.saleId?`<button class="row-action" data-action="convert-order-sale" data-id="${order.id}">إنشاء الفاتورة</button>`:`<button class="btn compact" data-action="ship-ready-order" data-id="${order.id}">تم الشحن</button>`}<button class="row-action" data-action="reopen-order-preparation" data-id="${order.id}">إعادة فتح للتجهيز</button></div>`}</td></tr>`;
}

function renderReadyShippingQueue() {
  const rows=readyShippingOrders();
  return `${workflowModeTabs("ready-shipping")}<div class="section-title"><div><span class="eyebrow">التشغيل اليومي</span><h2>جاهز للشحن</h2><p>طلبات تم تجميعها ومراجعتها وتغليفها، ولا تظهر مرة أخرى في التجهيز.</p></div><button class="btn" data-action="online-orders-mode" data-mode="quick-shipping">فتح الشحن السريع</button></div><article class="card ready-shipping-table"><div class="table-wrap"><table><thead><tr><th>الطلب / الفاتورة</th><th>العميل / المحافظة</th><th>القطع</th><th>الإجمالي</th><th>المدفوع</th><th>المطلوب COD</th><th>انتهاء التجهيز</th><th>الإجراء</th></tr></thead><tbody>${rows.map(readyShippingRow).join("")||`<tr><td colspan="8" class="text-center muted">لا توجد طلبات جاهزة للشحن.</td></tr>`}</tbody></table></div></article>`;
}

function quickShippingOrderCard(order) {
  if(!order)return `<div class="empty-state compact">اكتب رقم الطلب أو الفاتورة ثم اضغط Enter.</div>`;
  const payment=OrderFinance.calculatePayment(Number(order.total||0),Number(order.paidAmount||0)),ready=order.workflowStage==="awaiting_shipping"&&order.preparedAt&&!order.shipmentId;
  return `<div class="quick-ship-order ${ready?"ready":"invalid"}"><div><span class="eyebrow">${ready?"جاهز للشحن":"غير مؤهل"}</span><h3>${esc(order.id)} · ${esc(order.customerName||"—")}</h3><p>${esc(order.governorate||"—")} · ${(order.lines||[]).reduce((sum,line)=>sum+Number(line.qty||0),0)} قطعة · ${money(order.total||0)}</p></div><div class="quick-ship-money"><span>المدفوع <b>${money(payment.paidAmount)}</b></span><span>COD <b>${money(payment.remainingAmount)}</b></span></div>${!ready?`<strong class="text-danger">${order.shipmentId?`تم الشحن بالفعل · ${esc(order.tracking||"")}`:!order.preparedAt?"لم يكتمل التجهيز":order.workflowStage!=="awaiting_shipping"?"ليس في جاهز للشحن":"غير مؤهل"}</strong>`:!order.saleId?`<strong class="text-danger">أنشئ الفاتورة أولًا من Queue جاهز للشحن.</strong>`:""}</div>`;
}

function parseBatchShippingText(value="") {
  const seenOrders=new Set(),seenTracking=new Set();
  return String(value).split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
    const [orderIdRaw,trackingRaw]=line.split(/\s*[|,\t]\s*/,2),orderId=String(orderIdRaw||"").trim().toUpperCase(),trackingNumber=normalizeTrackingNumber(trackingRaw||""),order=shippingLookupOrder(orderId);
    let message="",ok=true;
    if(!order){ok=false;message="الطلب غير موجود";}
    else if(order.shipmentId||order.workflowStage==="shipped"){ok=false;message="تم شحنه بالفعل";}
    else if(order.workflowStage!=="awaiting_shipping"||!order.preparedAt){ok=false;message="ليس جاهزًا للشحن";}
    else if(!order.saleId){ok=false;message="الفاتورة غير منشأة";}
    else if(!trackingNumber||!validTrackingNumber(trackingNumber)){ok=false;message="كود التتبع غير صالح";}
    else if(seenOrders.has(order.id)){ok=false;message="الطلب مكرر في القائمة";}
    else if(seenTracking.has(trackingNumber)||data.shipments.some(item=>!item.deletedAt&&normalizeTrackingNumber(item.trackingNumber||item.tracking)===trackingNumber)){ok=false;message="كود التتبع مستخدم";}
    if(order)seenOrders.add(order.id);if(trackingNumber)seenTracking.add(trackingNumber);
    return {orderId:order?.id||orderId,trackingNumber,ok,message};
  });
}

function renderQuickShippingScreen() {
  const order=shippingLookupOrder(quickShippingOrderId),company=shippingSessionCompany||data.shippingCompanies?.find(item=>!item.deletedAt&&item.active!==false)?.name||"";
  shippingSessionCompany=company;
  return `${workflowModeTabs("quick-shipping")}<div class="section-title"><div><span class="eyebrow">أقل عدد من الضغطات</span><h2>الشحن السريع</h2><p>رقم الطلب ← كود التتبع ← Enter ← الطلب التالي.</p></div></div><div class="quick-shipping-layout"><article class="card quick-shipping-station"><div class="quick-shipping-settings"><div class="form-field"><label>شركة الشحن الافتراضية للجلسة</label><select id="quick-shipping-company">${shippingCompanyOptions(company)}</select></div><span>يظل الاختيار محفوظًا حتى تغييره.</span></div><div class="quick-shipping-flow"><div class="form-field"><label class="required">1. رقم الطلب / الفاتورة</label><input id="quick-shipping-order-code" value="${esc(quickShippingOrderId)}" autocomplete="off" placeholder="ORD-1001 أو INV-1001"></div><div class="flow-arrow">←</div><div class="form-field"><label class="required">2. كود التتبع</label><input id="quick-shipping-tracking" dir="ltr" autocomplete="off" placeholder="ENO123456789EG" ${order&&order.workflowStage==="awaiting_shipping"&&order.preparedAt&&order.saleId&&!order.shipmentId?"":"disabled"}></div><button class="btn" id="quick-shipping-confirm" data-action="quick-shipping-confirm" ${order&&order.workflowStage==="awaiting_shipping"&&order.preparedAt&&order.saleId&&!order.shipmentId?"":"disabled"}>تأكيد الشحن</button></div><div id="quick-shipping-order-preview">${quickShippingOrderCard(order)}</div></article><article class="card batch-shipping-card"><div class="card-header"><div><h3>إدخال عدة شحنات</h3><p>سطر لكل طلب بالشكل: ORD-1001 | ENO123456EG</p></div></div><textarea id="batch-shipping-input" rows="7" dir="ltr" placeholder="ORD-1001 | ENO123456EG&#10;ORD-1002 | ENO123457EG"></textarea><div id="batch-shipping-preview">${batchShippingPreviewRows.length?batchShippingPreviewMarkup(batchShippingPreviewRows):""}</div><div class="form-actions"><button class="btn secondary" data-action="batch-shipping-preview">مراجعة البيانات</button><button class="btn" data-action="batch-shipping-confirm" ${batchShippingPreviewRows.some(row=>row.ok)?"":"disabled"}>تأكيد الشحنات الصحيحة</button></div></article></div>`;
}

function batchShippingPreviewMarkup(rows) {
  return `<div class="batch-preview-list">${rows.map(row=>`<div class="${row.ok?"valid":"invalid"}"><b>${row.ok?"✓":"✕"}</b><span><strong>${esc(row.orderId||"—")}</strong><small dir="ltr">${esc(row.trackingNumber||"—")}</small></span><em>${esc(row.ok?"جاهز للشحن":row.message)}</em></div>`).join("")}</div>`;
}

function shipReadyOrderModal(id) {
  const order=getOnlineOrder(id);if(!order)return;
  const payment=OrderFinance.calculatePayment(Number(order.total||0),Number(order.paidAmount||0)),company=shippingSessionCompany||data.shippingCompanies?.find(item=>!item.deletedAt&&item.active!==false)?.name||"";
  openModal(`شحن ${order.id}`,"جاهز للشحن",`<form id="ready-order-shipment-form" data-order-id="${order.id}"><div class="shipment-ready-summary"><strong>${esc(order.customerName)}</strong><span>${esc([order.governorate,order.city,order.address].filter(Boolean).join("، "))}</span><b>${payment.remainingAmount?`COD ${money(payment.remainingAmount)}`:"مدفوع بالكامل — COD ٠ ج.م"}</b></div><div class="form-grid two"><div class="form-field"><label class="required">شركة الشحن</label><select name="company" required>${shippingCompanyOptions(company)}</select></div><div class="form-field"><label class="required">كود التتبع</label><input name="trackingNumber" dir="ltr" required autofocus></div><div class="form-field"><label>تاريخ الشحن</label><input name="shippedAt" type="datetime-local" value="${new Date().toISOString().slice(0,16)}"></div><div class="form-field"><label>تكلفة شركة الشحن المتوقعة</label><input ${numericFieldAttributes({name:"cost",value:0})}></div></div><div class="form-actions"><button class="btn" type="submit">تأكيد الشحن</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div></form>`);
}

async function submitReadyOrderShipment(orderId,payload,{silent=false}={}) {
  const result=await orderWorkflowRequest(`/api/orders/${encodeURIComponent(normalizeArabicDigits(orderId))}/ship`,{body:{...payload,trackingNumber:normalizeArabicDigits(payload.trackingNumber||payload.tracking||"")}});
  if(!silent)toast(`تم شحن ${orderId} بنجاح`);
  return result;
}

function renderOnlineOrders() {
  if(onlineOrdersMode==="quick"&&canAction("order.quick.create")){root.innerHTML=renderQuickOrderScreen();return;}
  if(onlineOrdersMode==="preparation"&&canAction("order.prepare")){root.innerHTML=renderPreparationQueue();return;}
  if(onlineOrdersMode==="ready-shipping"){root.innerHTML=renderReadyShippingQueue();return;}
  if(onlineOrdersMode==="quick-shipping"){root.innerHTML=renderQuickShippingScreen();setTimeout(()=>document.getElementById("quick-shipping-order-code")?.focus(),0);return;}
  const active = data.onlineOrders.filter(order => !order.deletedAt);
  const visible = active.filter(order => onlineOrderMatchesQuickFilter(order));
  const quickLabel = onlineOrderQuickFilterLabel();
  const count=stage=>active.filter(order=>onlineOrderWorkflowStage(order)===stage).length;
  root.innerHTML = `
    ${workflowModeTabs("orders")}
    <div class="section-title"><div><span class="eyebrow">السجل الرئيسي</span><h2>كل طلبات الأونلاين</h2><p>كل طلب يظل هنا منذ إنشائه وحتى التسليم أو الإلغاء.</p></div><button class="btn" data-action="add-online-order">＋ طلب جديد</button></div>
    <div class="order-stage-filters" role="group" aria-label="فلترة الطلبات حسب المرحلة">
      ${[["","الكل",active.length],["new","جديد",count("new")],["preparing","قيد التجهيز",count("preparing")],["ready","جاهز للشحن",count("ready")],["shipped","تم الشحن",count("shipped")],["delivered","تم التسليم",count("delivered")],["cancelled","ملغي / مرتجع",count("cancelled")]].map(([value,label,total])=>`<button class="${onlineOrderQuickFilter===value?"active":""}" data-action="online-order-stat" data-stat="online-orders:${value||"all"}"><span>${label}</span><b>${total}</b></button>`).join("")}
    </div>
    <article class="card">
      ${quickLabel ? `<div class="alert-item" style="margin-bottom:12px"><div class="alert-badge blue">↥</div><div><strong>الفلتر الحالي: ${esc(quickLabel)}</strong><span>يمكنك فتح أي طلب أو تعديله من الجدول بالأسفل.</span></div><button class="row-action" data-action="online-order-stat" data-stat="online-orders:all">عرض كل الطلبات</button></div>` : ""}
      <div class="toolbar"><div class="search"><input id="online-order-search" placeholder="بحث برقم الطلب أو الفاتورة أو العميل أو الهاتف أو التتبع"></div><button class="btn ghost compact" data-action="online-order-stat" data-stat="online-orders:all">إعادة الضبط</button></div>
      <div class="table-wrap" id="online-orders-table">${onlineOrdersTable(visible)}</div>
    </article>`;
}

function onlineOrderPrimaryAction(order) {
  const stage=onlineOrderWorkflowStage(order);
  if(stage==="new"&&!order.confirmedAt)return `<button class="btn compact" data-action="confirm-online-order" data-id="${order.id}">تأكيد الطلب</button>`;
  if(stage==="new"&&canAction("order.prepare"))return `<button class="btn compact" data-action="prepare-order-start" data-id="${order.id}">بدء التجهيز</button>`;
  if(stage==="preparing"&&canAction("order.prepare"))return `<button class="btn compact" data-action="prepare-order-open" data-id="${order.id}">${order.workflowStage==="needs_review"?"مراجعة الطلب":"فتح التجهيز"}</button>`;
  if(stage==="ready")return order.saleId?`<button class="btn compact" data-action="ship-ready-order" data-id="${order.id}">تم الشحن</button>`:`<button class="btn compact" data-action="convert-order-sale" data-id="${order.id}">إنشاء الفاتورة</button>`;
  if(stage==="shipped"&&order.shipmentId)return `<button class="btn compact" data-action="create-order-shipment" data-id="${order.id}">فتح الشحنة</button>`;
  return `<button class="btn ghost compact" data-action="view-online-order" data-id="${order.id}">عرض الطلب</button>`;
}

function onlineOrderMoreActions(order) {
  const terminal=["delivered","cancelled"].includes(onlineOrderWorkflowStage(order));
  return `<details class="table-actions-menu order-actions-more"><summary class="row-action">⋯ المزيد</summary><div class="table-actions-popover">
    <button class="row-action" data-action="view-online-order" data-id="${order.id}">تفاصيل الطلب</button>
    ${order.source==="whatsapp"&&canAction("order.quick.edit")&&!order.saleId&&!terminal?`<button class="row-action" data-action="edit-quick-order" data-id="${order.id}">تعديل الطلب</button>`:""}
    ${order.saleId?`<button class="row-action" data-action="convert-order-sale" data-id="${order.id}">عرض الفاتورة</button>`:""}
    ${order.preparedAt&&!order.shipmentId?`<button class="row-action" data-action="reopen-order-preparation" data-id="${order.id}">إعادة فتح للتجهيز</button>`:""}
    ${!order.saleId&&!terminal&&canAction("order.quick.edit")?`<button class="row-action text-danger" data-action="cancel-online-order" data-id="${order.id}">إلغاء الطلب</button>`:""}
  </div></details>`;
}

function onlineOrdersTable(list) {
  return `<table class="online-orders-master-table"><thead><tr><th>الطلب</th><th>العميل</th><th>المحافظة</th><th>القطع</th><th>الإجمالي / الدفع</th><th>الحالة</th><th>وقت الإنشاء</th><th>الخطوة التالية</th></tr></thead><tbody>
    ${list.slice().reverse().map(order => `<tr data-record-type="online-order" data-record-id="${order.id}">
      <td><strong>${order.id}</strong>${order.saleId?`<br><span class="muted">${esc(order.saleId)}</span>`:""}</td>
      <td>${esc(order.customerName)}<br><span dir="ltr" class="muted">${esc(order.phone)}</span></td>
      <td>${esc(order.governorate||"—")}<br><span class="muted">${esc(order.city||"")}</span></td>
      <td><strong>${(order.lines||[]).reduce((sum,line)=>sum+Number(line.qty||0),0)}</strong></td>
      <td><strong class="money">${money(order.total||0)}</strong><br><span class="order-payment-mini">مدفوع ${money(order.paidAmount||0)} · متبقي ${money(Math.max(0,Number(order.total||0)-Number(order.paidAmount||0)))}</span></td>
      <td>${onlineOrderWorkflowBadge(order)}${order.tracking?`<small class="order-tracking" dir="ltr">${esc(order.tracking)}</small>`:""}</td>
      <td><span class="order-created-time">${arabicDateTimeLabel(order.createdAt||order.date)}</span></td>
      <td><div class="row-actions order-next-actions">${onlineOrderPrimaryAction(order)}${onlineOrderMoreActions(order)}</div></td>
    </tr>`).join("") || `<tr><td colspan="8" class="text-center muted">لا توجد طلبات أونلاين.</td></tr>`}
  </tbody></table>`;
}

// قيمة الخصم كمبلغ: نسبة % من الأساس أو مبلغ ثابت (لا يتجاوز الأساس). تُستخدم للصنف وللفاتورة.
function discountAmount(base, value, type) {
  const v = Math.max(0, Number(value || 0));
  if (type === "amount") return Math.min(v, base);
  return base * Math.min(100, v) / 100;
}

// حساب إجماليات طلب الأونلاين: مجموع، خصم أصناف، خصم فاتورة، إجمالي. مصدر واحد للعرض والحفظ والتحويل.
function onlineOrderTotals(lines, orderDiscount, orderDiscountType, shippingCost) {
  return OrderFinance.calculateOrder(lines,{orderDiscount,orderDiscountType,shippingCost});
}

function onlineOrderLineRow(index, line = { bookId: "", qty: 1, price: 0, discount: 0, discountType: "percent" }) {
  const options = data.books.filter(b => !b.deletedAt).map(book => `<option value="${book.id}" ${line.bookId === book.id ? "selected" : ""}>${esc(book.name)} — ${esc(itemTypeLabel(book))} — رصيد ${book.stock} ${esc(itemUnitLabel(book))}</option>`).join("");
  const price = line.price || getBook(line.bookId)?.price || 0;
  const base = Number(line.qty || 1) * Number(price);
  const net = base - discountAmount(base, line.discount, line.discountType);
  return `<div class="online-order-line">
    <select name="bookId-${index}" class="online-order-book"><option value="">اختر صنفًا</option>${options}</select>
    <input name="qty-${index}" class="ool-qty" type="number" min="1" value="${line.qty || 1}" aria-label="الكمية">
    <input name="price-${index}" class="ool-price" type="number" min="0" value="${price}" aria-label="السعر">
    <input name="discount-${index}" class="ool-discount" type="number" min="0" value="${line.discount || 0}" aria-label="الخصم">
    <select name="discType-${index}" class="ool-disc-type" aria-label="نوع الخصم"><option value="percent" ${line.discountType !== "amount" ? "selected" : ""}>%</option><option value="amount" ${line.discountType === "amount" ? "selected" : ""}>ج.م</option></select>
    <span class="ool-line-total" aria-label="إجمالي الصنف">${money(net)}</span>
    <button type="button" class="online-order-remove" data-action="remove-online-order-line" title="حذف الصنف" aria-label="حذف الصنف">?</button>
  </div>`;
}

function readOnlineOrderForm() {
  const rows = [...document.querySelectorAll("#online-order-line-list .online-order-line")];
  const lines = rows.map(row => ({
    qty: Number(row.querySelector(".ool-qty")?.value || 0),
    price: Number(row.querySelector(".ool-price")?.value || 0),
    discount: Number(row.querySelector(".ool-discount")?.value || 0),
    discountType: row.querySelector(".ool-disc-type")?.value || "percent"
  }));
  return {
    lines,
    orderDiscount: Number(document.getElementById("ool-order-discount")?.value || 0),
    orderDiscountType: document.getElementById("ool-order-discount-type")?.value || "percent",
    shippingCost: Number(document.querySelector('#online-order-form [name="shippingCost"]')?.value || 0)
  };
}

function collectOnlineOrderDraftFromForm() {
  const form = document.getElementById("online-order-form");
  if (!form) return null;
  const formData = Object.fromEntries(new FormData(form).entries());
  const lines = [];
  Object.keys(formData).filter(key => /^bookId-\d+$/.test(key)).forEach(key => {
    const idx = key.slice("bookId-".length);
    const bookId = formData[key];
    if (bookId) {
      lines.push({
        bookId,
        qty: Math.max(1, Number(formData[`qty-${idx}`] || 1)),
        price: Number(formData[`price-${idx}`] || getBook(bookId)?.price || 0),
        discount: Math.max(0, Number(formData[`discount-${idx}`] || 0)),
        discountType: formData[`discType-${idx}`] === "amount" ? "amount" : "percent"
      });
    }
  });
  return {
    id: form.dataset.editId || "",
    customerId: formData.customerId || "",
    customerName: formData.customerName || "",
    phone: formData.phone || "",
    governorate: formData.governorate || "",
    city: formData.city || "",
    address: formData.address || "",
    source: formData.source || "المتجر الإلكتروني",
    paymentMethod: formData.paymentMethod || "الدفع عند الاستلام",
    shippingCost: Number(formData.shippingCost || 0),
    tracking: formData.tracking || "",
    status: formData.status || "طلب جديد",
    notes: formData.notes || "",
    lines: lines.length ? lines : [{ bookId: "", qty: 1, price: 0 }],
    orderDiscount: Number(formData.orderDiscount || 0),
    orderDiscountType: formData.orderDiscountType === "amount" ? "amount" : "percent"
  };
}

function updateOnlineOrderSummary() {
  const list = document.getElementById("online-order-line-list");
  if (!list) return;
  const form = readOnlineOrderForm();
  const totals = onlineOrderTotals(form.lines, form.orderDiscount, form.orderDiscountType, form.shippingCost);
  [...list.querySelectorAll(".online-order-line")].forEach((row, i) => {
    const cell = row.querySelector(".ool-line-total");
    if (cell) cell.textContent = money(totals.lines[i]?.net || 0);
  });
  const summary = document.getElementById("online-order-summary");
  if (summary) summary.innerHTML = `
    <div class="ool-sum-row"><span>المجموع</span><strong>${money(totals.subtotal)}</strong></div>
    <div class="ool-sum-row"><span>إجمالي الخصم</span><strong class="text-danger">${money(totals.discountTotal)}</strong></div>
    <div class="ool-sum-row"><span>الشحن</span><strong>${money(totals.shipping)}</strong></div>
    <div class="ool-sum-row grand"><span>الإجمالي النهائي</span><strong>${money(totals.total)}</strong></div>`;
}

function editableOrderStatuses(order) {
  if (order?.shipmentId) return ["تم إنشاء الشحنة","خرج للتوصيل","تم التسليم","مرتجع","ملغي"];
  if (order?.saleId) return ["تم إنشاء الفاتورة","لم يتم الشحن بعد","ملغي"];
  return ["طلب جديد","قيد التجهيز","ملغي"];
}

function onlineOrderModal(order = null) {
  const isEdit = Boolean(order?.id);
  const lines = order?.lines?.length ? order.lines : [{ bookId:"", qty:1, price:0 }];
  const selectedCustomer = getCustomer(order?.customerId);
  openModal(isEdit ? `تعديل الطلب ${order.id}` : "إضافة طلب أونلاين", "طلبات الأونلاين", `
    <form id="online-order-form" data-edit-id="${isEdit ? order.id : ""}">
      <input type="hidden" name="customerId" id="online-order-customer-id" value="${esc(selectedCustomer?.id || order?.customerId || "")}">
      <div class="workflow-strip"><strong>مسار التشغيل:</strong><span>طلب أونلاين</span><b>→</b><span>فاتورة</span><b>→</b><span>شحنة</span></div>
      <div class="form-field full sale-customer-picker">
        <label class="required">العميل المسجل</label>
        <div class="customer-search-row">
          <div class="search"><input id="online-order-customer-search" autocomplete="off" value="${esc(selectedCustomer?.name || order?.customerName || "")}" placeholder="ابحث باسم العميل أو رقم الهاتف"></div>
          <button class="btn secondary" type="button" data-action="register-online-order-customer">＋ تسجيل عميل جديد</button>
        </div>
        <div id="online-order-customer-suggestions" class="customer-suggestions"></div>
        <div id="online-order-customer-details">${saleCustomerDetailsMarkup(selectedCustomer)}</div>
      </div>
      <div class="form-grid three">
        <div class="form-field"><label class="required">اسم العميل</label><input name="customerName" required value="${esc(selectedCustomer?.name || order?.customerName || "")}"></div>
        <div class="form-field"><label class="required">رقم الهاتف</label><input name="phone" required value="${esc(selectedCustomer?.phone || order?.phone || "")}"></div>
        <div class="form-field"><label class="required">المحافظة</label><select name="governorate" required>${governorateOptions(selectedCustomer?.governorate || order?.governorate)}</select></div>
        <div class="form-field"><label>المدينة / المنطقة</label><input name="city" value="${esc(selectedCustomer?.city || order?.city || "")}"></div>
        <div class="form-field full"><label>العنوان التفصيلي</label><input name="address" value="${esc(selectedCustomer?.address || order?.address || "")}"></div>
        <div class="form-field"><label>مصدر الطلب</label><select name="source">${["المتجر الإلكتروني","WhatsApp","Facebook","Instagram","هاتف","أخرى"].map(v => `<option ${order?.source === v ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="form-field"><label>طريقة الدفع</label><select name="paymentMethod">${["الدفع عند الاستلام","نقدي","Visa","تحويل بنكي","InstaPay","محفظة"].map(v => `<option ${order?.paymentMethod === v ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="form-field"><label>تكلفة الشحن</label><input name="shippingCost" type="number" min="0" value="${order?.shippingCost || 0}"></div>
        <div class="form-field"><label>كود التتبع</label><input name="tracking" value="${esc(order?.tracking || "")}"></div>
        <div class="form-field"><label>الحالة</label><select name="status">${editableOrderStatuses(order).map(v => `<option ${(order?.status || "طلب جديد") === v ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="form-field full"><label>ملاحظات</label><textarea name="notes">${esc(order?.notes || "")}</textarea></div>
      </div>
      <div class="online-order-lines"><h3>الأصناف</h3>
        <div class="online-order-line online-order-head"><span>الصنف</span><span>الكمية</span><span>السعر</span><span>الخصم</span><span>النوع</span><span>الإجمالي</span><span></span></div>
        <div id="online-order-line-list">${lines.map((line, index) => onlineOrderLineRow(index, line)).join("")}</div>
        <button type="button" class="btn ghost small add-online-order-line-btn" data-action="add-online-order-line">＋ إضافة صنف</button>
        <div class="online-order-foot">
          <div class="form-field ool-order-discount-field"><label>خصم إجمالي الفاتورة</label>
            <div class="ool-order-discount">
              <input name="orderDiscount" id="ool-order-discount" type="number" min="0" value="${order?.orderDiscount || 0}">
              <select name="orderDiscountType" id="ool-order-discount-type"><option value="percent" ${order?.orderDiscountType !== "amount" ? "selected" : ""}>%</option><option value="amount" ${order?.orderDiscountType === "amount" ? "selected" : ""}>ج.م</option></select>
            </div>
          </div>
          <div class="online-order-summary" id="online-order-summary"></div>
        </div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">حفظ الطلب</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
  updateOnlineOrderSummary();
}

function getOnlineOrder(id) { return data.onlineOrders.find(order => order.id === id && !order.deletedAt); }

function orderJourneyMarkup(order) {
  const sale=(data.sales||[]).find(item=>item.id===order.saleId||item.onlineOrderId===order.id),shipment=(data.shipments||[]).find(item=>item.id===order.shipmentId||item.onlineOrderId===order.id);
  const collection=(data.orderCollections||[]).find(item=>item.orderId===order.id||item.shipmentId===shipment?.id),settlement=(data.carrierSettlements||[]).find(item=>item.id===shipment?.settlementId||item.id===collection?.settlementId);
  const stages=[
    order.confirmedAt&&["تم تأكيد الطلب",`بواسطة ${order.confirmedBy||"—"}`],
    order.inventoryReservation?.status&&["تم حجز المخزون",order.inventoryReservation.status==="active"?"الحجز فعال":"تم استهلاك الحجز"],
    order.preparingAt&&["قيد التجهيز",order.preparedAt?`اكتمل بواسطة ${order.preparedBy||"—"}`:`بواسطة ${order.preparingBy||"—"}`],
    order.preparedAt&&["تم التجهيز",arabicDateTimeLabel(order.preparedAt)],
    order.workflowStage==="awaiting_shipping"&&["جاهز للشحن","بانتظار شركة الشحن"],
    shipment&&["تم الشحن",shipment.trackingNumber||shipment.tracking||shipment.id],
    shipment&&["قيد التوصيل",shipmentStatusMeta(shipment).label],
    shipmentStatusCode(shipment||{})==="delivered"&&["تم التسليم",arabicDateTimeLabel(shipment.deliveredAt||shipment.updatedAt)],
    collection&&["التحصيل",collection.status==="settled"?"تم الاستلام بالخزنة":"تم التحصيل لدى شركة الشحن"],
    settlement&&["التسوية",settlement.status||"بانتظار التحويل"]
  ].filter(Boolean);
  return `<section class="order-journey"><h3>رحلة الطلب</h3><div>${stages.map(([title,value])=>`<span><i>✓</i><small>${esc(title)}</small><strong>${esc(value)}</strong></span>`).join("")||`<p class="muted">تبدأ الرحلة بعد تأكيد الطلب.</p>`}</div></section>`;
}

function viewOnlineOrder(id) {
  const order = getOnlineOrder(id);
  if (!order) return toast("الطلب غير موجود.", "error");
  const totals = onlineOrderTotals(order.lines, order.orderDiscount, order.orderDiscountType, order.shippingCost);
  const lineDisc = line => Number(line.discount || 0) ? `${esc(String(line.discount))}${line.discountType === "amount" ? " ج.م" : "%"}` : "—";
  const invoiceButton = order.saleId
    ? `<button class="btn ghost" data-modal-action="view-sale" data-id="${order.saleId}">عرض الفاتورة</button>`
    : `<button class="btn" data-action="convert-order-sale" data-id="${order.id}">إنشاء فاتورة من الطلب</button>`;
  const shipmentButton = order.shipmentId
    ? `<button class="btn ghost" data-action="view-shipment" data-id="${order.shipmentId}">عرض الشحنة</button>`
    : `<button class="btn secondary" data-action="create-order-shipment" data-id="${order.id}">${order.saleId ? "إنشاء شحنة" : "إنشاء شحنة بعد الفاتورة"}</button>`;
  openModal(order.id, "تفاصيل طلب الأونلاين", `<div class="workflow-strip"><strong>مسار التشغيل:</strong><span>${order.source==="whatsapp"?"واتساب":"طلب أونلاين"}</span><b>→</b><span>فاتورة</span><b>→</b><span>شحنة</span></div>${orderJourneyMarkup(order)}<div class="metric-strip"><div class="mini-metric"><span>الحالة</span><strong>${order.status}</strong></div><div class="mini-metric"><span>الإجمالي</span><strong>${money(order.total)}</strong></div><div class="mini-metric"><span>التتبع</span><strong>${esc(order.tracking || "—")}</strong></div></div><p><strong>${esc(order.customerName)}</strong> — <span dir="ltr">${esc(order.phone)}</span></p><p>${esc(order.governorate)}، ${esc(order.city)}، ${esc(order.address)}</p><div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th>الإجمالي</th></tr></thead><tbody>${totals.lines.map(line => `<tr><td>${esc(getBook(line.bookId)?.name || "—")}</td><td>${line.qty}</td><td>${money(line.price)}</td><td>${lineDisc(line)}</td><td class="money">${money(line.finalNet)}</td></tr>`).join("")}</tbody></table></div><div class="metric-strip" style="margin-top:12px"><div class="mini-metric"><span>المجموع</span><strong>${money(totals.subtotal)}</strong></div><div class="mini-metric"><span>إجمالي الخصم</span><strong>${money(totals.discountTotal)}</strong></div><div class="mini-metric"><span>الشحن</span><strong>${money(totals.shipping)}</strong></div><div class="mini-metric"><span>الإجمالي النهائي</span><strong>${money(totals.total)}</strong></div></div><div class="form-actions"><button class="btn secondary" data-action="print-online-order" data-id="${order.id}">أمر تجهيز</button>${invoiceButton}${shipmentButton}</div>`);
}

function saleTotals() {
  let subtotal = 0, lineDiscountTotal = 0;
  const lineTotals = draftSale.lines.map(line => {
    const base = Math.max(0, Number(line.qty || 0)) * Math.max(0, Number(line.price || 0));
    const lineDiscount = discountAmount(base, line.discount, line.discountType);
    subtotal += base;
    lineDiscountTotal += lineDiscount;
    return { ...line, base, lineDiscount, net: base - lineDiscount };
  });
  const afterLine = Math.max(0, subtotal - lineDiscountTotal);
  const invoiceDiscount = discountAmount(afterLine, draftSale.invoiceDiscount, draftSale.invoiceDiscountType);
  let allocatedInvoiceDiscount = 0;
  const computed = lineTotals.map((line, index) => {
    const isLast = index === lineTotals.length - 1;
    const invoiceDiscountShare = afterLine > 0
      ? (isLast ? invoiceDiscount - allocatedInvoiceDiscount : invoiceDiscount * line.net / afterLine)
      : 0;
    allocatedInvoiceDiscount += invoiceDiscountShare;
    const totalDiscount = line.lineDiscount + invoiceDiscountShare;
    return { ...line, invoiceDiscountShare, totalDiscount, finalNet: Math.max(0, line.base - totalDiscount) };
  });
  const totals = { lines: computed, subtotal, lineDiscountTotal, invoiceDiscount, discount: lineDiscountTotal + invoiceDiscount, total: Math.max(0, afterLine - invoiceDiscount) };
  totals.paid = Math.max(0, Math.min(Number(draftSale.paid || 0), totals.total));
  totals.remaining = Math.max(0, totals.total - totals.paid);
  return totals;
}

function purchaseTotals() {
  let subtotal = 0, lineDiscountTotal = 0;
  const lineTotals = draftPurchase.lines.map(line => {
    const base = Math.max(0, Number(line.qty || 0)) * Math.max(0, Number(line.cost || 0));
    const lineDiscount = 0;
    subtotal += base;
    lineDiscountTotal += lineDiscount;
    return { ...line, base, lineDiscount, net: base - lineDiscount };
  });
  const afterLine = Math.max(0, subtotal - lineDiscountTotal);
  const invoiceDiscount = discountAmount(afterLine, draftPurchase.invoiceDiscount, draftPurchase.invoiceDiscountType);
  let allocatedInvoiceDiscount = 0;
  const computed = lineTotals.map((line, index) => {
    const isLast = index === lineTotals.length - 1;
    const invoiceDiscountShare = afterLine > 0
      ? (isLast ? invoiceDiscount - allocatedInvoiceDiscount : invoiceDiscount * line.net / afterLine)
      : 0;
    allocatedInvoiceDiscount += invoiceDiscountShare;
    const totalDiscount = line.lineDiscount + invoiceDiscountShare;
    return { ...line, invoiceDiscountShare, totalDiscount, finalNet: Math.max(0, line.base - totalDiscount) };
  });
  const shipping = Math.max(0, Number(draftPurchase.shipping || 0));
  const total = Math.max(0, afterLine - invoiceDiscount + shipping);
  const paid = Math.max(0, Math.min(Number(draftPurchase.paid || 0), total));
  return { lines: computed, subtotal, lineDiscountTotal, invoiceDiscount, discount: lineDiscountTotal + invoiceDiscount, shipping, goods: Math.max(0, afterLine - invoiceDiscount), total, paid, remaining: Math.max(0, total - paid) };
}

function updateSaleSummary() {
  const totals = saleTotals();
  const el = id => document.getElementById(id);
  if (!el("sale-total")) return;
  totals.lines.forEach((line, index) => {
    const row = document.querySelector(`.invoice-line[data-line="${index}"] .sale-line-net`);
    if (row) row.textContent = money(line.finalNet || 0);
  });
  el("sale-subtotal").textContent = money(totals.subtotal);
  if (el("sale-line-discount-total")) el("sale-line-discount-total").textContent = money(totals.lineDiscountTotal);
  el("sale-discount-total").textContent = money(totals.discount);
  el("sale-total").textContent = money(totals.total);
  el("sale-points").textContent = `${Math.floor(totals.total / 10)} نقطة`;
  el("sale-remaining").textContent = money(totals.remaining);
  el("sale-remaining").className = totals.remaining > 0 ? "text-danger" : "text-success";
  const maxDiscount = Math.max(...draftSale.lines.map(l => Number(l.discount || 0)));
  el("sale-warning").innerHTML = maxDiscount > data.settings.approvalDiscount
    ? `<div class="alert-item"><div class="alert-badge">!</div><div><strong>موافقة مدير مطلوبة</strong><span>يوجد خصم أكبر من ${data.settings.approvalDiscount}%.</span></div></div>`
    : "";
}

function renderPurchases() {
  const supplierOptions = data.suppliers.map(s => `<option value="${s.id}" ${draftPurchase.supplierId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const totals = purchaseTotals();
  const lines = draftPurchase.lines.map((line, index) => {
    const book = getBook(line.bookId);
    const computed = totals.lines[index] || {};
    const listId = `purchase-book-options-${index}`;
    const cover = Number(line.coverPriceAtPurchase ?? productCoverPrice(book) ?? 0);
    const supplierDiscount = Number(line.supplierDiscountPercent ?? line.discount ?? 0);
    return `<div class="invoice-line" data-line="${index}">
      <input class="purchase-book-picker" data-index="${index}" list="${listId}" value="${esc(bookPickerLabel(book))}" placeholder="ابحث باسم الصنف أو الباركود...">
      ${bookPickerDatalist(listId)}
      <input class="purchase-qty" data-index="${index}" type="number" min="1" value="${line.qty}">
      <input class="purchase-cover" data-index="${index}" type="number" min="0" step="0.01" value="${cover}" title="سعر الغلاف">
      <input class="purchase-supplier-discount" data-index="${index}" type="number" min="0" max="100" step="0.01" value="${supplierDiscount}" title="خصم المورد %">
      <input class="purchase-cost" data-index="${index}" type="number" min="0" step="0.01" value="${line.cost}" title="سعر شراء النسخة">
      <span class="muted discount-field text-center purchase-line-net">${money(computed.finalNet || 0)}</span>
      <button class="row-action purchase-remove" data-index="${index}">×</button>
    </div>`;
  }).join("");

  root.innerHTML = `
    <div class="section-title">
      <div><h2>المشتريات والاستلام</h2><p>تسجيل الشراء المملوك أو الأمانة مع تكلفة الشحن والفحص.</p></div>
      <div class="actions"><button class="btn" data-action="new-purchase-document">＋ تسجيل مشتريات جديدة</button><button class="btn secondary" data-action="new-purchase-return-supplier">مرتجع مشتريات مستقل</button><button class="btn ghost" data-action="open-purchase-return-list">مرتجع من مستند شراء</button><button class="btn ghost" data-action="show-purchases-list">السجل الكامل</button></div>
    </div>
    ${purchaseOtherTabDetected ? `<div class="notice warning"><strong>يوجد تبويب آخر مفتوح للنظام</strong><span>لتجنب تعارض الحفظ، استخدم تبويبًا واحدًا أثناء إدخال الفواتير.</span></div>` : ""}
    ${purchaseRetryState ? `<div class="notice danger purchase-stale-notice"><strong>تم تحديث بيانات النظام أثناء إدخال الفاتورة</strong><span>${purchaseRetryState.conflicts?.length ? "توجد تغييرات في المورد أو الأصناف وتحتاج مراجعة قبل الاعتماد." : "اضغط تحديث وإعادة المحاولة للاحتفاظ بالمسودة وإعادة الحفظ."}</span><div class="form-actions"><button class="btn" data-action="retry-stale-purchase" ${purchaseRetryState.conflicts?.length ? "disabled" : ""}>تحديث وإعادة المحاولة</button></div></div>` : `<div class="notice success purchase-revision-status"><strong>البيانات محدثة</strong><span>سيتم فحص أحدث نسخة من الخادم قبل اعتماد الفاتورة.</span></div>`}
    <div class="purchase-command-grid">
      <button class="purchase-command-card" type="button" data-action="new-purchase-document">
        <span class="stat-icon blue">＋</span>
        <strong>تسجيل مشتريات</strong>
        <small>افتح نموذج توريد جديد وسجل فاتورة المورد.</small>
      </button>
      <button class="purchase-command-card" type="button" data-action="new-purchase-return-supplier">
        <span class="stat-icon red">↩</span>
        <strong>مرتجع مشتريات مستقل</strong>
        <small>مرتجع مرتبط بحساب المورد حتى من أكثر من مستند.</small>
      </button>
      <button class="purchase-command-card" type="button" data-action="open-purchase-return-list">
        <span class="stat-icon gold">▤</span>
        <strong>مرتجع من مستند شراء</strong>
        <small>اختر مستند شراء محدد ثم حدد الأصناف المرتجعة.</small>
      </button>
      <button class="purchase-command-card" type="button" data-action="show-purchases-list">
        <span class="stat-icon">⌕</span>
        <strong>السجل الكامل</strong>
        <small>عرض كل مستندات الشراء والأمانة في نافذة منفصلة.</small>
      </button>
    </div>
    <div class="invoice-layout purchase-workspace">
      <article class="card">
        <div class="invoice-meta">
          <div class="form-grid three">
            <div class="form-field"><label>المورد</label><select id="purchase-supplier">${supplierOptions}</select></div>
            <div class="form-field"><label>رقم فاتورة المورد</label><input id="supplier-invoice-number" value="${esc(draftPurchase.supplierInvoiceNumber || "")}" placeholder="مثال: SUP-12345"></div>
            <div class="form-field"><label>نوع التوريد</label><select id="purchase-type">${["شراء","أمانة"].map(value => `<option ${draftPurchase.type === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
            <div class="form-field"><label>طريقة السداد</label><select id="purchase-payment">${["آجل","نقدي","تحويل بنكي","شيك مجدول"].map(value => `<option ${draftPurchase.payment === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
            <div class="form-field"><label>الشحن</label><input id="purchase-shipping" type="number" min="0" value="${draftPurchase.shipping || 0}"></div>
            <div class="form-field"><label>موعد المرتجع</label><input id="purchase-return" type="date" value="${draftPurchase.returnDeadline || ""}"></div>
            <div class="form-field"><label>حالة الاستلام</label><select id="purchase-status">${["تم الفحص والاستلام","في انتظار الفحص"].map(value => `<option ${draftPurchase.status === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
          </div>
        </div>
        <div class="invoice-lines">
          <div class="sale-quick-add purchase-quick-add"><div class="search"><input id="purchase-book-search" autocomplete="off" placeholder="بحث ذكي في الأصناف: اسم، باركود، ناشر، تصنيف أو صف"></div><input id="purchase-quick-qty" type="number" min="1" value="1" title="الكمية"><div id="purchase-book-suggestions"></div></div>
          <div class="line-head purchase-line-head"><span>الصنف</span><span>الكمية</span><span>سعر الغلاف</span><span>خصم المورد %</span><span>سعر شراء النسخة</span><span>إجمالي التكلفة</span><span></span></div>
          ${lines}
          <button class="btn secondary small" data-action="add-purchase-line">＋ إضافة بند</button>
        </div>
      </article>
      <aside class="card invoice-summary">
        <span class="eyebrow">ملخص التوريد</span>
        <div class="summary-row"><span>المجموع الإجمالي قبل الخصم</span><strong id="purchase-books-total">${money(totals.subtotal)}</strong></div>
        <div class="summary-row"><span>خصومات الأصناف</span><strong id="purchase-line-discount-total">${money(totals.lineDiscountTotal)}</strong></div>
        <div class="form-field" style="margin-top:12px"><label>خصم إجمالي فاتورة المشتريات</label><div class="discount-input"><input id="purchase-invoice-discount" type="number" min="0" value="${draftPurchase.invoiceDiscount || 0}"><select id="purchase-invoice-discount-type"><option value="percent" ${draftPurchase.invoiceDiscountType !== "amount" ? "selected" : ""}>%</option><option value="amount" ${draftPurchase.invoiceDiscountType === "amount" ? "selected" : ""}>ج.م</option></select></div></div>
        <div class="summary-row"><span>إجمالي الخصم</span><strong id="purchase-discount-total">${money(totals.discount)}</strong></div>
        <div class="summary-row"><span>قيمة الأصناف بعد الخصم</span><strong id="purchase-goods-total">${money(totals.goods)}</strong></div>
        <div class="summary-row"><span>توزيع الشحن</span><strong>حسب عدد الوحدات</strong></div>
        <div class="form-field" style="margin-top:12px"><label>المبلغ المدفوع للمورد</label><input id="purchase-paid" type="number" min="0" max="${totals.total}" value="${totals.paid}"></div>
        <div class="summary-row total"><span>الإجمالي</span><strong id="purchase-total">${money(totals.total)}</strong></div>
        <div class="summary-row"><span>المتبقي للمورد</span><strong id="purchase-remaining" class="${totals.remaining > 0 ? "text-danger" : ""}">${money(totals.remaining)}</strong></div>
        <button class="btn gold" data-action="save-purchase" style="width:100%;margin-top:12px">اعتماد إذن الاستلام</button>
        <p class="muted" style="font-size:8px;line-height:1.8">في الأمانة تظل ملكية الأصناف للمورد، ولا تتحول إلى مديونية إلا عند البيع.</p>
      </aside>
    </div>
    ${purchasesHistoryPanel()}`;
}

function updatePurchaseSummary() {
  const totals = purchaseTotals();
  totals.lines.forEach((line, index) => {
    const row = document.querySelector(`.invoice-line[data-line="${index}"] .purchase-line-net`);
    if (row) row.textContent = money(line.finalNet || 0);
  });
  const values = {
    "purchase-books-total": money(totals.subtotal),
    "purchase-line-discount-total": money(totals.lineDiscountTotal),
    "purchase-discount-total": money(totals.discount),
    "purchase-goods-total": money(totals.goods),
    "purchase-total": money(totals.total),
    "purchase-remaining": money(totals.remaining)
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
  const remaining = document.getElementById("purchase-remaining");
  if (remaining) remaining.className = totals.remaining > 0 ? "text-danger" : "text-success";
  const paidInput = document.getElementById("purchase-paid");
  if (paidInput) paidInput.max = totals.total;
}

function resetPurchaseDraft() {
  purchaseRetryState = null;
  draftPurchase = {
    supplierId: data.suppliers[0]?.id || "",
    supplierInvoiceNumber: "",
    type: "شراء",
    payment: "آجل",
    returnDeadline: "",
    status: "تم الفحص والاستلام",
    paid: 0,
    shipping: 0,
    invoiceDiscount: 0,
    invoiceDiscountType: "percent",
    lines: [{ bookId: "", qty: 1, cost: 0, discount: 0, discountType: "percent" }]
  };
  persistPurchaseDraft();
  renderPurchases();
  toast("تم تجهيز نموذج تسجيل مشتريات جديد.");
}

function sortedPurchases() {
  return data.purchases
    .filter(purchase => !purchase.deletedAt)
    .slice()
    .sort((a, b) => String(b.date || b.createdAt).localeCompare(String(a.date || a.createdAt)) || String(b.id).localeCompare(String(a.id)));
}

function purchaseStatusTone(status = "") {
  if (["ملغاة", "مرتجع"].includes(status)) return "danger";
  if (["بانتظار الفحص", "مرتجع جزئي"].includes(status)) return "warning";
  return "";
}

function purchaseHistoryTable(purchases = sortedPurchases(), actionAttribute = "data-action") {
  return `<table><thead><tr><th>المستند</th><th>فاتورة المورد</th><th>التاريخ</th><th>المورد</th><th>النوع</th><th>الأصناف</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody>${purchases.map(p => {
    const supplier = getSupplier(p.supplierId);
    const canReceive = p.status === "بانتظار الفحص";
    const canReturn = !["ملغاة", "مرتجع", "بانتظار الفحص"].includes(p.status);
    const cancelAction = p.status === "ملغاة" ? "delete-purchase" : "cancel-purchase";
    const cancelLabel = p.status === "ملغاة" ? "حذف" : "إلغاء";
    return `<tr data-record-type="purchase" data-record-id="${esc(p.id)}">
      <td><strong>${esc(p.id)}</strong><br><span class="muted">${esc(p.createdAt ? new Date(p.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "—")}</span></td>
      <td>${esc(p.supplierInvoiceNumber || "—")}</td>
      <td>${fmtDate(p.date)}</td>
      <td>${esc(supplier?.name || "—")}</td>
      <td>${badge(p.type || "شراء", p.type === "أمانة" ? "blue" : "")}</td>
      <td>${Number((p.lines || []).reduce((sum, line) => sum + Number(line.qty || 0), 0)).toLocaleString("ar-EG")}</td>
      <td class="money">${money(p.total || 0)}</td>
      <td class="money">${money(p.remaining || 0)}</td>
      <td>${badge(p.status || "مستلمة", purchaseStatusTone(p.status))}</td>
      <td><div class="row-actions"><button class="row-action" ${actionAttribute}="view-purchase" data-id="${esc(p.id)}">عرض</button>${canReceive ? `<button class="row-action" ${actionAttribute}="receive-purchase" data-id="${esc(p.id)}">استلام</button>` : ""}${canReturn ? `<button class="row-action" ${actionAttribute}="return-purchase" data-id="${esc(p.id)}">مرتجع</button>` : ""}<button class="row-action text-danger" ${actionAttribute}="${cancelAction}" data-id="${esc(p.id)}">${cancelLabel}</button></div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="10" class="text-center muted">لم يتم تسجيل مشتريات بعد. استخدم زر «تسجيل مشتريات جديدة» بالأعلى.</td></tr>`}</tbody></table>`;
}

function purchasesHistoryPanel() {
  const purchases = sortedPurchases();
  const activePurchases = purchases.filter(purchase => !["ملغاة"].includes(purchase.status));
  const totalValue = activePurchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);
  const pendingCount = purchases.filter(purchase => purchase.status === "بانتظار الفحص").length;
  const returnableCount = purchases.filter(purchase => !["ملغاة", "مرتجع", "بانتظار الفحص"].includes(purchase.status)).length;
  const recent = purchases.slice(0, 10);
  return `
    <article class="card purchase-history-card">
      <div class="card-header">
        <div>
          <span class="eyebrow">سجل المشتريات</span>
          <h3>آخر عمليات التوريد والمشتريات</h3>
          <p>السجل ظاهر داخل صفحة المشتريات مباشرة، ومع كل مستند إجراءات العرض والاستلام وتسجيل مرتجع مشتريات.</p>
        </div>
        <div class="actions">
          <button class="btn secondary" type="button" data-action="new-purchase-document">＋ تسجيل مشتريات جديدة</button>
          <button class="btn ghost" type="button" data-action="new-purchase-return-supplier">مرتجع مشتريات مستقل</button>
          <button class="btn ghost" type="button" data-action="open-purchase-return-list">مرتجع من مستند شراء</button>
          <button class="btn ghost" type="button" data-action="show-purchases-list">عرض السجل كامل</button>
        </div>
      </div>
      <div class="purchase-ledger-stats">
        <div><span>عدد المستندات</span><strong>${purchases.length.toLocaleString("ar-EG")}</strong></div>
        <div><span>إجمالي المشتريات</span><strong>${money(totalValue)}</strong></div>
        <div><span>بانتظار الفحص</span><strong>${pendingCount.toLocaleString("ar-EG")}</strong></div>
        <div><span>متاح للمرتجع</span><strong>${returnableCount.toLocaleString("ar-EG")}</strong></div>
      </div>
      <div class="table-wrap purchase-history-table">${purchaseHistoryTable(recent)}</div>
    </article>`;
}

function returnKind(type) {
  return type === "purchase" || type === "purchase_return" ? "purchase" : "sale";
}

function returnTypeLabel(type) {
  return returnKind(type) === "purchase" ? "مرتجع مشتريات" : "مرتجع مبيعات";
}

function returnSettlementLabel(item = {}) {
  const settlement = item.settlementType || item.settlement || "";
  const labels = {
    cash: returnKind(item.type) === "purchase" ? "رد نقدي من المورد للخزنة" : "رد نقدي من الخزنة",
    "account-credit": returnKind(item.type) === "purchase" ? "خصم من حساب المورد" : "خصم من حساب العميل",
    "customer-credit": "حفظ في حساب العميل / خصم مديونية",
    "debt-only": "خصم من المديونية",
    "no-settlement": "بدون تسوية حالية — رصيد مستحق"
  };
  return labels[settlement] || "غير محدد";
}

function returnNo(item = {}) {
  return item.returnNo || item.returnInvoiceId || item.id || "";
}

function returnAccountName(item = {}) {
  const kind = item.accountType || (returnKind(item.type) === "purchase" ? "supplier" : "customer");
  const id = item.accountId || item.partyId;
  return kind === "supplier" ? getSupplier(id)?.name : getCustomer(id)?.name;
}

function returnItems(item = {}) {
  return item.items || item.lines || [];
}

function renderReturns() {
  const saleDocs = data.sales
    .filter(sale => !sale.deletedAt && getCustomer(sale.customerId) && !["ملغاة","مرتجع"].includes(sale.status) && saleReturnableLines(sale).length)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
  const purchaseDocs = data.purchases
    .filter(purchase => !purchase.deletedAt && !["ملغاة","مرتجع"].includes(purchase.status) && purchaseReturnableLines(purchase).length)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
  const returnRows = (data.returns || [])
    .filter(item => !item.deletedAt)
    .slice()
    .sort((a, b) => String(b.date || b.createdAt).localeCompare(String(a.date || a.createdAt)) || String(b.id).localeCompare(String(a.id)));
  root.innerHTML = `
    <div class="section-title">
      <div><h2>المرتجعات</h2><p>فاتورة مرتجع مستقلة مرتبطة بحساب العميل أو المورد، مع تحديد الأصناف والكميات فقط.</p></div>
      <div class="actions"><button class="btn ghost" data-action="open-sale-return-list">مرتجع من فاتورة بيع</button><button class="btn" data-action="new-sale-return-customer">مرتجع مبيعات مستقل حسب العميل</button><button class="btn ghost" data-action="open-purchase-return-list">مرتجع من فاتورة مشتريات</button><button class="btn secondary" data-action="new-purchase-return-supplier">مرتجع مشتريات مستقل حسب المورد</button><button class="btn ghost" data-action="open-return-search">بحث في المرتجعات</button></div>
    </div>
    <div class="metric-strip">
      <div class="mini-metric"><span>فواتير بيع متاحة</span><strong>${saleDocs.length}</strong></div>
      <div class="mini-metric"><span>مستندات شراء متاحة</span><strong>${purchaseDocs.length}</strong></div>
      <div class="mini-metric"><span>عمليات مرتجع مسجلة</span><strong>${returnRows.length}</strong></div>
    </div>
    <div class="cards-grid two">
      <article class="card">
        <div class="card-header"><div><h3>فواتير عملاء متاحة للمرتجع</h3><p>يتم عرض فواتير العملاء المسجلين فقط، ثم تختار الأصناف والكميات من مشتريات هذا العميل.</p></div><button class="btn secondary small" data-action="open-sale-return-list">عرض الكل</button></div>
        <div class="table-wrap"><table><thead><tr><th>الفاتورة</th><th>العميل</th><th>المتاح</th><th>الحالة</th><th></th></tr></thead><tbody>
          ${saleDocs.slice(0, 8).map(sale => `<tr><td><strong>${esc(sale.id)}</strong><br><span class="muted">${fmtDate(sale.date)}</span></td><td>${esc(getCustomer(sale.customerId)?.name || "عميل")}</td><td>${saleReturnableLines(sale).reduce((sum, line) => sum + Number(line.remaining || 0), 0)}</td><td>${badge(sale.status || "معتمدة", sale.status === "مرتجع جزئي" ? "warning" : "")}</td><td><button class="row-action" data-action="start-sale-return" data-id="${sale.id}">تسجيل مرتجع</button></td></tr>`).join("") || `<tr><td colspan="5" class="text-center muted">لا توجد فواتير بيع متاحة للمرتجع.</td></tr>`}
        </tbody></table></div>
      </article>
      <article class="card">
        <div class="card-header"><div><h3>مشتريات متاحة للمرتجع</h3><p>اختر المستند ثم حدد الأصناف والكميات المرجعة للمورد.</p></div><button class="btn secondary small" data-action="open-purchase-return-list">عرض الكل</button></div>
        <div class="table-wrap"><table><thead><tr><th>المستند</th><th>فاتورة المورد</th><th>المورد</th><th>المتاح</th><th>الحالة</th><th></th></tr></thead><tbody>
          ${purchaseDocs.slice(0, 8).map(purchase => `<tr><td><strong>${esc(purchase.id)}</strong><br><span class="muted">${fmtDate(purchase.date)}</span></td><td>${esc(purchase.supplierInvoiceNumber || "—")}</td><td>${esc(getSupplier(purchase.supplierId)?.name || "مورد")}</td><td>${purchaseReturnableLines(purchase).reduce((sum, line) => sum + Number(line.remaining || 0), 0)}</td><td>${badge(purchase.status || "مستلمة", purchase.status === "مرتجع جزئي" ? "warning" : "")}</td><td><button class="row-action" data-action="start-purchase-return" data-id="${purchase.id}">تسجيل مرتجع</button></td></tr>`).join("") || `<tr><td colspan="6" class="text-center muted">لا توجد مستندات شراء متاحة للمرتجع.</td></tr>`}
        </tbody></table></div>
      </article>
    </div>
    <article class="card" style="margin-top:18px">
      <div class="card-header"><div><h3>سجل فواتير المرتجع</h3><p>كل عملية مرتجع لها رقم فاتورة مستقل وقيمة تسوية واضحة.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>رقم المرتجع</th><th>النوع</th><th>الحساب</th><th>عدد الأصناف</th><th>الإجمالي</th><th>طريقة التسوية</th><th>التاريخ</th><th>المستخدم</th><th>الحالة</th><th>عرض / طباعة</th></tr></thead><tbody>
        ${returnRows.map(item => `<tr data-record-type="return" data-record-id="${esc(item.id)}"><td><strong>${esc(returnNo(item))}</strong><br><span class="muted">${esc(item.id)}</span></td><td>${badge(returnTypeLabel(item.type), returnKind(item.type) === "purchase" ? "blue" : "")}</td><td>${esc(returnAccountName(item) || "—")}</td><td>${Number(returnItems(item).reduce((sum, line) => sum + Number(line.qty || 0), 0) || 0).toLocaleString("ar-EG")}</td><td class="money">${money(item.subtotal ?? item.amount ?? 0)}</td><td>${esc(returnSettlementLabel(item))}</td><td>${fmtDate(item.date)}</td><td>${esc(item.createdBy || "النظام")}</td><td>${badge(item.status || "معتمد")}</td><td><div class="row-actions"><button class="row-action" data-action="view-return" data-id="${esc(item.id)}">عرض</button><button class="row-action" data-action="print-return" data-id="${esc(item.id)}">طباعة</button></div></td></tr>`).join("") || `<tr><td colspan="10" class="text-center muted">لم يتم تسجيل مرتجعات بعد.</td></tr>`}
      </tbody></table></div>
    </article>`;
}

function renderParties() {
  const isCustomers = partyTab === "customers";
  const list = isCustomers ? data.customers : data.suppliers;
  const partyKind = isCustomers ? "customer" : "supplier";
  const partyLabel = isCustomers ? "عميل" : "مورد";
  root.innerHTML = `
    <div class="section-title">
      <div><h2>العملاء والموردون</h2><p>ملف موحد للطرف مع كشف الحساب والحد الائتماني.</p></div>
      <div class="actions">
        <button class="btn ghost" data-action="party-voucher" data-kind="${partyKind}" data-voucher-type="دفع">↑ إيصال دفع</button>
        <button class="btn secondary" data-action="party-voucher" data-kind="${partyKind}" data-voucher-type="استلام">↓ إيصال استلام</button>
        <button class="btn" data-action="${isCustomers ? "add-customer" : "add-supplier"}">＋ إضافة ${partyLabel}</button>
      </div>
    </div>
    <div class="tabs" style="margin-bottom:16px">
      <button class="tab ${isCustomers ? "active" : ""}" data-party-tab="customers">العملاء (${data.customers.length})</button>
      <button class="tab ${!isCustomers ? "active" : ""}" data-party-tab="suppliers">الموردون (${data.suppliers.length})</button>
    </div>
    <article class="card">
      <div class="metric-strip">
        <div class="mini-metric"><span>عدد ${isCustomers ? "العملاء" : "الموردين"}</span><strong>${list.length}</strong></div>
        <div class="mini-metric"><span>إجمالي المديونية</span><strong>${money(list.reduce((s, i) => s + i.balance, 0))}</strong></div>
        <div class="mini-metric"><span>حدود ائتمانية</span><strong>${list.filter(i => i.creditLimit > 0).length}</strong></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>الاسم</th><th>الهاتف</th><th>${isCustomers ? "الفئة" : "مدة السداد"}</th><th>الحد الائتماني</th><th>الرصيد</th>${isCustomers ? "<th>النقاط</th>" : ""}<th></th></tr></thead>
          <tbody>${list.map(item => `<tr>
            <td><strong>${esc(item.name)}</strong><br><span class="muted">${item.id}</span></td>
            <td>${esc(item.phone || "—")}</td>
            <td>${isCustomers ? badge(item.type, item.type === "جملة" ? "blue" : "") : `${item.terms || 0} يوم`}</td>
            <td class="money">${money(item.creditLimit)}</td>
            <td class="money ${item.balance > item.creditLimit && item.creditLimit ? "text-danger" : ""}">${money(item.balance)}</td>
            ${isCustomers ? `<td>${item.points || 0}</td>` : ""}
            <td><div class="row-actions"><button class="row-action" data-action="statement" data-id="${item.id}" data-kind="${partyKind}">كشف حساب</button><button class="row-action" data-action="party-voucher" data-id="${item.id}" data-kind="${partyKind}" data-voucher-type="استلام">استلام</button><button class="row-action" data-action="party-voucher" data-id="${item.id}" data-kind="${partyKind}" data-voucher-type="دفع">دفع</button><button class="row-action" data-action="edit-party" data-id="${item.id}" data-kind="${partyKind}">تعديل</button><button class="row-action text-danger" data-action="delete-party" data-id="${item.id}" data-kind="${partyKind}">حذف</button></div></td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </article>`;
}

function shippingQuickFilterLabel(filter = shippingQuickFilter) {
  return ({
    active: "الشحنات النشطة",
    delayed: "الشحنات المتأخرة",
    "no-movement": "الشحنات بدون حركة",
    call: "تحتاج اتصال عميل",
    complaint: "تحتاج شكوى",
    "return-risk": "خطر مرتجع",
    returned: "الشحنات المرتجعة",
    error: "أخطاء التتبع",
    manual: "تحتاج مراجعة يدوية"
  })[filter] || "";
}

function applyShippingStatFilter(stat) {
  const next = String(stat || "").replace("shipping:", "");
  shippingQuickFilter = next === "all" ? "" : next;
  const select = document.getElementById("shipment-tracking-filter");
  if (select) select.value = shippingQuickFilter;
  const statusSelect = document.getElementById("shipment-status");
  if (statusSelect && shippingQuickFilter) statusSelect.value = "";
  const summary = document.getElementById("shipping-filter-summary");
  const label = shippingQuickFilterLabel();
  if (summary) {
    summary.innerHTML = label ? `<div class="alert-item" style="margin:14px 0"><div class="alert-badge blue">i</div><div><strong>الفلتر الحالي: ${esc(label)}</strong><span>الجدول بالأسفل يعرض الشحنات المطابقة، ويمكنك فتح أو تعديل أي شحنة مباشرة.</span></div><button class="row-action" data-action="shipping-stat" data-stat="shipping:all">عرض كل الشحنات</button></div>` : "";
  }
  document.querySelectorAll('.stat-card.interactive[data-action="shipping-stat"]').forEach(card => {
    card.classList.toggle("active", Boolean(shippingQuickFilter) && card.dataset.stat === `shipping:${shippingQuickFilter}`);
  });
  filterShipments();
}

function resetShippingFilters() {
  shippingQuickFilter = "";
  const search = document.getElementById("shipment-search");
  const status = document.getElementById("shipment-status");
  const tracking = document.getElementById("shipment-tracking-filter");
  if (search) search.value = "";
  if (status) status.value = "";
  if (tracking) tracking.value = "";
  filterShipments();
}

function renderShipping() {
  const statuses = Object.entries(SHIPPING_STATUSES);
  const rows = data.shipments.filter(item => !item.deletedAt);
  const todayKey = new Date().toISOString().slice(0, 10);
  const active = rows.filter(item => !["تم التسليم", "مرتجع", "ملغاة"].includes(item.status));
  const noMovement = rows.filter(item => item.lastMovementAt && (Date.now() - new Date(item.lastMovementAt).getTime()) / 3600000 >= data.settings.tracking.noMovementHours && !["تم التسليم", "مرتجع"].includes(item.status));
  const quickLabel = shippingQuickFilterLabel();
  root.innerHTML = `
    <div class="section-title shipping-page-title">
      <div><h2>الشحن والتتبع</h2><p>تابع حالة الطلبات وحدّثها إلكترونيًا أو يدويًا من مكان واحد.</p></div>
      <div class="actions"><button class="btn" data-action="update-all-tracking">تحديث إلكتروني للكل</button><button class="btn secondary" data-action="shipping-companies">شركات الشحن</button></div>
    </div>
    <div class="stats-grid">
      ${statCard("شحنات نشطة", active.length, "قابلة للمتابعة", "▣", "", "", "shipping:active")}
      ${statCard("متأخرة", rows.filter(s => Number(s.delayHours || 0) > 0).length, "تجاوزت SLA", "!", "red", "", "shipping:delayed")}
      ${statCard("مرتجعة", rows.filter(s => s.status === "مرتجع").length, "رجعت للمرسل", "↩", "red", "", "shipping:returned")}
      ${statCard("تحتاج متابعة", rows.filter(s => s.trackingError || s.manualInterventionNeeded).length, "تحديث لم يكتمل", "!", "gold", "", "shipping:error")}
    </div>
    <div id="shipping-filter-summary">${quickLabel ? `<div class="alert-item" style="margin:14px 0"><div class="alert-badge blue">i</div><div><strong>الفلتر الحالي: ${esc(quickLabel)}</strong><span>الجدول بالأسفل يعرض الشحنات المطابقة، ويمكنك فتح أو تعديل أي شحنة مباشرة.</span></div><button class="row-action" data-action="shipping-stat" data-stat="shipping:all">عرض كل الشحنات</button></div>` : ""}</div>
    <article class="card shipping-card">
      <div class="toolbar shipping-toolbar"><div class="search shipping-search"><input id="shipment-search" placeholder="ابحث برقم الطلب، العميل، كود التتبع أو رقم الشكوى"></div><div class="shipping-filter-fields"><select class="filter-select" id="shipment-status" aria-label="فلتر حالة الشحنة"><option value="">كل الحالات</option>${statuses.map(([code, meta]) => `<option value="${code}">${meta.label}</option>`).join("")}</select><select class="filter-select" id="shipment-tracking-filter" aria-label="فلتر مجموعة الشحنات"><option value="">كل الشحنات</option><option value="active">نشطة</option><option value="delayed">متأخرة</option><option value="delivered">تم التسليم</option><option value="returned">مرتجع</option><option value="error">تحتاج متابعة</option></select><button class="btn ghost shipping-reset-filters" data-action="reset-shipping-filters" type="button"><span aria-hidden="true">↺</span> إعادة الضبط</button></div></div>
      <div class="table-wrap" id="shipments-table">${shipmentsTable(rows)}</div>
    </article>`;
}

function shipmentsTable(list) {
  return `<table class="shipping-table"><thead><tr><th>رقم الطلب</th><th>العميل</th><th>رقم التتبع</th><th>شركة الشحن</th><th>الحالة الحالية</th><th>آخر تحديث</th><th>الإجراءات</th></tr></thead>
  <tbody>${list.map(item => {
    const tracking = shipmentTrackingSummary(item);
    const debugButton = canAction("show-tracking-debug") && (item.trackingDebug?.screenshotFile || tracking.lastRun?.screenshotPath) ? `<button class="row-action" data-action="show-tracking-debug" data-id="${item.id}">بيانات التشخيص</button>` : "";
    const current = shipmentStatusCode(item);
    const lastUpdate = item.lastTrackedAt || item.lastTrackingAt || item.updatedAt || item.updated;
    const latestComplaint = shipmentComplaints(item.id)[0];
    const complaintSummary = latestComplaint ? `<div class="complaint-latest"><strong>آخر شكوى: ${esc(latestComplaint.complaintNumber || latestComplaint.complaintReference)}</strong><span>${complaintStatusLabel(latestComplaint.status || latestComplaint.complaintStatus)} · ${arabicDateTimeLabel(latestComplaint.createdAt)}</span></div>` : "";
    const trackingAction = isTerminalShipment(item)
      ? `<span class="shipping-tracking-complete">انتهى تتبع هذه الشحنة</span><button class="row-action primary action-update" type="button" disabled aria-disabled="true"><span aria-hidden="true">✓</span> تحديث إلكتروني</button>`
      : `<button class="row-action primary action-update" data-action="update-tracking-now" data-id="${item.id}"><span aria-hidden="true">↻</span> تحديث إلكتروني</button>`;
    return `<tr data-record-type="shipment" data-record-id="${item.id}"><td><strong>${esc(item.onlineOrderId || item.orderId || item.invoiceId || item.id)}</strong><br><span class="muted">${esc(item.invoiceId || item.id)}</span></td><td><strong>${esc(item.customerName || item.customer || "—")}</strong><br><span class="muted">${esc(item.customerPhone || item.phone || "")}</span></td><td><strong dir="ltr">${esc(item.trackingNumber || item.tracking || "—")}</strong></td><td>${esc(item.carrier || item.company || "—")}</td><td class="shipping-status-cell"><select class="shipment-status-select" data-shipment-status data-id="${item.id}" aria-label="تغيير حالة الشحنة ${item.id}">${shipmentStatusOptions(current)}</select><div class="shipment-status-preview">${shipmentStatusBadge(item)}</div></td><td class="shipping-update-cell"><span class="shipping-last-update">${lastUpdate ? dateTimeLabel(lastUpdate) : "—"}</span>${item.trackingError ? `<span class="shipment-update-hint error">تعذر آخر تحديث</span>` : ""}${complaintSummary}</td><td><div class="shipping-row-actions">${trackingAction}<button class="row-action action-status" data-action="edit-shipment-status" data-id="${item.id}"><span aria-hidden="true">✎</span> تعديل الحالة</button><button class="row-action complaint-action action-complaint" data-action="add-shipment-complaint" data-id="${item.id}"><span aria-hidden="true">＋</span> إضافة شكوى</button><button class="row-action action-history" data-action="shipment-history" data-id="${item.id}"><span aria-hidden="true">◷</span> سجل التتبع</button><button class="row-action action-history" data-action="shipment-complaints" data-id="${item.id}"><span aria-hidden="true">▤</span> سجل الشكاوى${shipmentComplaints(item.id).length ? ` (${shipmentComplaints(item.id).length})` : ""}</button><details class="shipping-more"><summary><span aria-hidden="true">•••</span> المزيد</summary><div><button class="row-action" data-action="update-shipment" data-id="${item.id}">تعديل بيانات الشحنة</button><button class="row-action" data-action="copy-tracking-code" data-id="${item.id}">نسخ رقم التتبع</button>${debugButton}<button class="row-action text-danger" data-action="delete-shipment" data-id="${item.id}">حذف</button></div></details></div></td></tr>`;
  }).join("") || `<tr><td colspan="7" class="text-center muted">لا توجد شحنات مطابقة.</td></tr>`}</tbody></table>`;
}

async function updateTrackingWorkerNotice() {
  const target = document.getElementById("tracking-worker-notice");
  if (!target) return;
  const status = await fetchTrackingStatus();
  if (!target.isConnected) return;
  const rpa = status?.localRpa || {};
  const pending = Number(status?.queue?.pending || 0);
  const rpaLine = rpa.enabled
    ? (rpa.connected ? `خدمة التتبع: متصلة${rpa.lastSuccessfulRunAt ? ` — آخر نجاح ${esc(dateTimeLabel(rpa.lastSuccessfulRunAt))}` : ""}` : `خدمة التتبع غير متصلة حاليًا، وسيتم إعادة المحاولة تلقائيًا. المهام المعلقة: ${pending}`)
    : `خدمة التتبع غير مفعّلة على السيرفر.`;
  if (!status?.worker?.running) {
    target.className = "alert-item warning";
    target.innerHTML = `<div class="alert-badge gold">!</div><div><strong>التتبع التلقائي غير مفعّل حاليًا</strong><span>${rpaLine}</span><span>استخدم زر تحديث التتبع الآن لتشغيل محاولة فورية على الشحنة المطلوبة.</span></div>`;
    return;
  }
  const nextRun = status.worker.nextRun ? dateTimeLabel(status.worker.nextRun) : "غير محدد";
  const inProgress = status.worker.inProgress ? "يوجد تحديث يعمل الآن" : `الدورة القادمة: ${nextRun}`;
  target.className = rpa.enabled && !rpa.connected ? "alert-item warning" : "alert-item";
  target.innerHTML = `<div class="alert-badge ${rpa.enabled && !rpa.connected ? "gold" : "blue"}">${rpa.connected ? "✓" : "i"}</div><div><strong>التتبع التلقائي مفعل عند تشغيل السيرفر</strong><span>${esc(inProgress)} — وللتحديث الفوري استخدم زر تحديث التتبع الآن.</span><span>${rpaLine}</span></div>`;
}

function cashRelatedReferences(item = {}) {
  const refs = new Set();
  [item.receiptId,item.returnId,item.saleId,item.purchaseId,item.shipmentId,item.onlineOrderId,item.orderId,item.invoiceId,item.collectionId,item.settlementId,item.expenseId,item.incomeId,item.transferId].filter(Boolean).forEach(ref=>refs.add(String(ref)));
  String(`${item.note || ""} ${item.reference || ""}`).match(/\b(-:INV|PUR|RCP|PAY|SR|PR|RET|SH|ORD|TR)-[\w-]+\b/g)?.forEach(ref => refs.add(ref));
  return [...refs];
}

function cashMovementRow(item) {
  const editableActions = isLockedCash(item)
    ? `<div class="muted" style="margin-top:5px;font-size:11px">↳ قيد تلقائي مرتبط بمستند</div>`
    : `<div class="row-actions" style="margin-top:5px"><button class="row-action" data-action="edit-cash" data-id="${item.id}">تعديل</button><button class="row-action text-danger" data-action="delete-cash" data-id="${item.id}">حذف</button></div>`;
  return `<tr>
    <td><strong>${esc(item.id)}</strong><br><span class="muted">${esc(item.category || "")}</span></td>
    <td>${dateTimeLabel(item.createdAt || item.date)}<br><span class="muted">${fmtDate(item.date)}</span></td>
    <td>${badge(item.type, item.type === "صرف" ? "danger" : "")}</td>
    <td>${esc(item.account)}</td>
    <td>${esc(item.party)}</td>
    <td class="money">${money(item.amount)}</td>
    <td>${esc(actorLabel(item))}</td>
    <td><span class="muted">${esc(item.note)}</span>${editableActions}</td>
    <td><button class="row-action" data-action="view-cash" data-id="${item.id}">تفاصيل</button></td>
  </tr>`;
}

function renderFinanceLedger() {
  const receipts = activeCash().filter(i => i.type === "قبض").reduce((s, i) => s + i.amount, 0);
  const payments = activeCash().filter(i => i.type === "صرف").reduce((s, i) => s + i.amount, 0);
  const activePartyReceipts = data.receipts.filter(item => item.status !== "ملغى");
  const cashAccounts = activeCashAccounts();
  root.innerHTML = `
    <div class="section-title">
      <div><h2>الحسابات والخزائن</h2><p>سندات القبض والصرف، الخزائن والبنوك والقيود التلقائية.</p></div>
      <div class="actions"><button class="btn ghost" data-action="cash-transfer">⇄ تحويل بين الخزن</button><button class="btn ghost" data-action="add-cash-account">＋ خزنة جديدة</button><button class="btn ghost" data-action="party-voucher" data-voucher-type="دفع">↑ إيصال دفع طرف</button><button class="btn secondary" data-action="party-voucher" data-voucher-type="استلام">↓ إيصال استلام طرف</button><button class="btn secondary" data-action="add-cash-out">− مصروف عام</button><button class="btn" data-action="add-cash-in">＋ قبض عام</button></div>
    </div>
    <div class="stats-grid">
      ${statCard("إجمالي المقبوضات", money(receipts), "خلال الحركات المسجلة", "↓")}
      ${statCard("إجمالي المدفوعات", money(payments), "مصروفات ومدفوعات", "↑", "red")}
      ${statCard("صافي الحركة", money(receipts - payments), "فرق القبض والصرف", "≋", "gold")}
      ${statCard("رصيد الخزن", money(totalCashBalance()), `${cashAccounts.length} خزنة / حساب`, "□", "blue")}
    </div>
    <article class="card" style="margin-bottom:18px">
      <div class="card-header"><div><h3>الخزن والحسابات</h3><p>أرصدة كل خزنة محسوبة من الرصيد الافتتاحي والحركات المالية المسجلة.</p></div><span class="badge blue">${activePartyReceipts.length} إيصال طرف</span></div>
      <div class="table-wrap"><table><thead><tr><th>الخزنة / الحساب</th><th>الرصيد الافتتاحي</th><th>قبض</th><th>صرف</th><th>الرصيد الحالي</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${cashAccounts.map(account => {
          const accountReceipts = activeCash().filter(item => item.account === account.name && item.type === "قبض").reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const accountPayments = activeCash().filter(item => item.account === account.name && item.type === "صرف").reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const balance = cashAccountBalance(account.name);
          return `<tr><td><strong>${esc(account.name)}</strong><br><span class="muted">${esc(account.id)}</span></td><td class="money">${money(account.openingBalance || 0)}</td><td class="money">${money(accountReceipts)}</td><td class="money">${money(accountPayments)}</td><td class="money ${balance < 0 ? "text-danger" : ""}">${money(balance)}</td><td>${badge(account.active !== false ? "نشطة" : "موقوفة", account.active !== false ? "" : "gray")}</td><td><div class="row-actions"><button class="row-action" data-action="edit-cash-account" data-id="${account.id}">تعديل</button></div></td></tr>`;
        }).join("") || `<tr><td colspan="7" class="text-center muted">لا توجد خزائن مسجلة.</td></tr>`}
      </tbody></table></div>
    </article>
    <article class="card" style="margin-bottom:18px">
      <div class="card-header"><div><h3>إيصالات العملاء والموردين</h3><p>إيصالات الدفع والاستلام المرتبطة بكشف الحساب.</p></div></div>
      <div class="table-wrap">${partyReceiptsTable(data.receipts)}</div>
    </article>
    <article class="card">
      <div class="card-header"><div><h3>دفتر الحركة المالية</h3><p>يُنشئ النظام القيود المحاسبية تلقائيًا عند اعتماد المستندات.</p></div><div class="actions"><button class="btn ghost small" data-action="print-cash-daily">يومية الخزنة</button><button class="btn ghost small" data-action="trial-balance">ميزان المراجعة</button><button class="btn ghost small" data-action="chart-accounts">دليل الحسابات</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>رقم الحركة</th><th>التاريخ والوقت</th><th>النوع</th><th>الحساب</th><th>الطرف / البيان</th><th>المبلغ</th><th>تمت بواسطة</th><th>ملاحظات</th><th></th></tr></thead><tbody>
        ${activeCash().slice().reverse().map(cashMovementRow).join("")}
      </tbody></table></div>
    </article>`;
}

function allowedFinanceTabs() {
  return [
    ["expenses","المصروفات",["add-expense","approve-expense"]],["income","الإيرادات الأخرى",["add-other-income","approve-other-income"]],["order-collections","تحصيل الأوردرات",["finance.collection.view","finance.collection.create"]],["settlements","تسويات التحصيل",["create-settlement","approve-settlement"]],
    ["accounts","الخزائن والحسابات",["add-cash-account","edit-cash-account"]],["movements","سجل الحركات",["view-cash"]],["finance-reports","التقارير المالية",["view-financial-reports"]]
  ].filter(([, , actions])=>actions.some(canAction));
}

const FINANCE_TAB_META = {
  expenses:["المصروفات","سجل وتابع كل ما تم صرفه من المكتبة."],
  income:["الإيرادات الأخرى","أي دخل خارج مبيعات الكتب والشحن والتحصيل."],
  "order-collections":["تحصيل الأوردرات","سجل المبالغ التي حصلتها شركة الشحن من العملاء."],
  settlements:["تسويات التحصيل","طابق تحويلات شركات الشحن وسجل ما وصل للمكتبة فعليًا."],
  accounts:["الخزائن والحسابات","تابع أرصدة الخزائن والبنوك والمحافظ."],
  movements:["سجل الحركات","كل عمليات الدخول والخروج المالي في مكان واحد."],
  "finance-reports":["التقارير المالية","ملخص الإيرادات والمصروفات والتحصيلات والنتيجة المالية."]
};

function helpIcon(text, label="معلومة توضيحية") {
  return `<button class="context-help" type="button" data-help="${esc(text)}" aria-label="${esc(label)}" aria-expanded="false">ⓘ</button>`;
}

function financeConceptTitle(title, help="") {
  return `<span class="concept-title">${esc(title)}${help ? helpIcon(help, `شرح ${title}`) : ""}</span>`;
}

function currentFinanceType(kind, id, fallbackName="") {
  const list=kind==="income"?(data.incomeTypes||[]):(data.expenseTypes||[]);
  return list.find(type=>type.id===id)||list.find(type=>type.name===fallbackName)||null;
}

function financeTypeLabel(kind, record={}) {
  const type=currentFinanceType(kind,record[`${kind}TypeId`],record[`${kind}Type`]);
  return type?.name||record[`${kind}Type`]||"—";
}

function financeTabsMarkup() {
  const tabs = allowedFinanceTabs();
  return `<div class="finance-tabs" role="tablist">${tabs.map(([id,label]) => `<button class="tab ${financeTab === id ? "active" : ""}" data-action="finance-tab" data-tab="${id}">${label}</button>`).join("")}</div>`;
}

function financeTabIntro() {
  const [title,description]=FINANCE_TAB_META[financeTab]||["المالية","المصروفات والإيرادات والتسويات والخزائن في مكان واحد."];
  const help={
    income:"استخدمها فقط لتسجيل دخل خارج مبيعات الكتب، مثل تعويض من شركة شحن أو عمولة من مورد. مبيعات الفواتير لا تُسجل هنا مرة أخرى.",
    "order-collections":"استخدم هذه الشاشة عندما ترسل شركة الشحن كود الشحنة وقيمة المبلغ الذي تم تحصيله من العميل.",
    settlements:"استخدمها عند تحويل شركة الشحن الأموال فعليًا للمكتبة لمطابقة التحصيلات وتسجيل المبلغ في الخزنة.",
    accounts:"تعرض الأماكن التي توجد بها أموال المكتبة، مثل الخزنة الرئيسية أو الحساب البنكي، والرصيد الحالي لكل منها.",
    movements:"يعرض كل المبالغ التي دخلت أو خرجت من الخزائن والحسابات ومصدر كل حركة."
  }[financeTab]||"";
  return `<div class="section-title finance-section-title"><div><span class="eyebrow">الإدارة المالية</span><h2>${financeConceptTitle(title,help)}</h2><p>${esc(description)}</p></div></div>`;
}

function expenseStatusBadge(status) {
  return badge(status || "مسجل", status === "ملغي" ? "gray" : status === "معتمد" ? "" : "warning");
}

function renderFinanceExpenses() {
  const rows = (data.expenses || []).filter(item => !item.deletedAt).slice().reverse();
  const approved = rows.filter(item => item.status === "معتمد").reduce((sum,item)=>sum+Number(item.amount||0),0);
  return `${financeTabsMarkup()}<div class="stats-grid finance-summary">
    ${statCard("المصروفات المعتمدة", money(approved), "تؤثر في رصيد الخزائن", "−", "red")}
    ${statCard("بانتظار الاعتماد", rows.filter(item=>item.status==="مسجل").length, "مسودات قابلة للمراجعة", "⌛", "gold")}
    ${statCard("مصروفات الشحن", money(rows.filter(item=>item.source==="تسوية شركة شحن"&&item.status==="معتمد").reduce((s,i)=>s+Number(i.amount||0),0)), "من التسويات المعتمدة", "▣", "blue")}
  </div><article class="card"><div class="card-header"><div><h3>قائمة المصروفات</h3><p>المصروف لا يؤثر على الخزنة إلا بعد اعتماده.</p></div><div class="actions">${canAction("manage-finance-types")?`<button class="btn ghost" data-action="manage-expense-types">إدارة أنواع المصروفات</button>`:""}${canAction("add-expense")?`<button class="btn" data-action="add-expense">＋ إضافة مصروف</button>`:""}</div></div>
  <div class="finance-filters"><input id="finance-expense-search" placeholder="بحث بالرقم أو المستفيد أو المرجع"><select id="finance-expense-status"><option value="">كل الحالات</option><option>مسجل</option><option>معتمد</option><option>ملغي</option></select></div>
  <div class="table-wrap"><table><thead><tr><th>رقم المصروف</th><th>التاريخ</th><th>النوع</th><th>المستفيد</th><th>الحساب</th><th>المبلغ</th><th>المصدر</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(item=>`<tr><td><strong>${esc(item.id)}</strong><br><span class="muted">${esc(item.reference||"")}</span></td><td>${fmtDate(item.date)}</td><td>${esc(financeTypeLabel("expense",item))}</td><td>${esc(item.beneficiary||"—")}</td><td>${esc(item.account)}</td><td class="money">${money(item.amount)}</td><td>${esc(item.source||"يدوي")}${item.settlementId?`<div class="source-trail">تم إنشاؤه تلقائيًا من تسوية <button class="inline-link" data-action="view-settlement" data-id="${esc(item.settlementId)}">${esc(item.settlementId)}</button></div>`:""}</td><td>${expenseStatusBadge(item.status)}</td><td><div class="row-actions">${item.status==="مسجل"&&canAction("add-expense")?`<button class="row-action" data-action="edit-expense" data-id="${item.id}">تعديل</button>`:""}${item.status==="مسجل"&&canAction("approve-expense")?`<button class="row-action" data-action="approve-expense" data-id="${item.id}">اعتماد</button>`:""}${item.status==="معتمد"&&canAction("reverse-financial-transaction")?`<button class="row-action text-danger" data-action="reverse-expense" data-id="${item.id}">إلغاء بقيد عكسي</button>`:""}</div></td></tr>`).join("")||`<tr><td colspan="9" class="text-center muted">لا توجد مصروفات مسجلة.</td></tr>`}</tbody></table></div></article>`;
}

function renderFinanceIncome() {
  const rows=(data.otherIncome||[]).filter(item=>!item.deletedAt).slice().reverse();
  const approved=sumMoney(rows.filter(item=>item.status==="معتمد"),item=>item.amount),pending=sumMoney(rows.filter(item=>item.status==="مسجل"),item=>item.amount);
  return `${financeTabsMarkup()}<div class="finance-callout"><strong>${financeConceptTitle("الإيرادات الأخرى","استخدمها فقط لتسجيل دخل خارج مبيعات الكتب، مثل تعويض من شركة شحن أو عمولة من مورد. مبيعات الفواتير لا تُسجل هنا مرة أخرى.")}</strong><span>المبيعات وقيمة الشحن المحصلة من العميل وتحويلات شركات الشحن لا تُسجل هنا مرة أخرى.</span></div><div class="stats-grid finance-summary">${statCard("إيرادات معتمدة",money(approved),"ظهرت في حركة الخزنة","＋")}${statCard("بانتظار الاعتماد",money(pending),`${rows.filter(item=>item.status==="مسجل").length} عملية`,"⌛","gold")}</div><article class="card"><div class="card-header"><div><h3>الإيرادات الأخرى</h3><p>أي دخل جديد خارج المبيعات والشحن والتحصيل.</p></div><div class="actions">${canAction("manage-finance-types")?`<button class="btn ghost" data-action="manage-income-types">إدارة أنواع الإيرادات</button>`:""}${canAction("add-other-income")?`<button class="btn" data-action="add-other-income">＋ إضافة إيراد</button>`:""}</div></div><div class="table-wrap"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>الجهة الدافعة</th><th>الحساب</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(item=>`<tr><td><strong>${esc(item.id)}</strong><br><span class="muted">${esc(item.reference||"")}</span></td><td>${fmtDate(item.date)}</td><td>${esc(financeTypeLabel("income",item))}</td><td>${esc(item.payer||"—")}</td><td>${esc(item.account)}</td><td class="money">${money(item.amount)}</td><td>${expenseStatusBadge(item.status)}</td><td>${item.status==="مسجل"&&canAction("approve-other-income")?`<button class="row-action" data-action="approve-other-income" data-id="${item.id}">اعتماد</button>`:item.status==="معتمد"&&canAction("reverse-financial-transaction")?`<button class="row-action text-danger" data-action="reverse-other-income" data-id="${item.id}">إلغاء بقيد عكسي</button>`:""}</td></tr>`).join("")||`<tr><td colspan="8" class="text-center muted">لا توجد إيرادات أخرى.</td></tr>`}</tbody></table></div></article>`;
}

function settlementSummary(settlement={}) {
  const lines=settlement.lines||[];
  return {
    count:lines.length,
    collection:sumMoney(lines,l=>l.collectionAmount||0),
    customerShipping:sumMoney(lines,l=>l.customerShippingCharge||0),
    expectedCost:sumMoney(lines,l=>l.carrierShippingCostExpected||0),
    actualCost:sumMoney(lines,l=>l.carrierShippingCostActual ?? l.carrierShippingCostExpected ?? 0),
    expectedCommission:sumMoney(lines,l=>l.collectionCommissionExpected||0),
    actualCommission:sumMoney(lines,l=>l.collectionCommissionActual ?? l.collectionCommissionExpected ?? 0)
  };
}

function findCollectionShipment(trackingNumber="") {
  const code=normalizeTrackingNumber(trackingNumber);
  return data.shipments.find(item=>!item.deletedAt&&normalizeTrackingNumber(item.trackingNumber||item.tracking)===code);
}

function orderCollectionPreview(trackingNumber,amount) {
  const code=normalizeTrackingNumber(trackingNumber);
  const shipment=findCollectionShipment(code);
  if(!shipment)return {code,status:"not_found",label:"غير موجود"};
  const previous=(data.orderCollections||[]).find(item=>item.shipmentId===shipment.id&&item.status!=="reversed");
  const values=shipmentFinanceValues(shipment),amountValue=centsMoney(moneyCents(normalizeArabicNumericText(amount)||0));
  const difference=centsMoney(moneyCents(amountValue)-moneyCents(values.collectionAmount));
  const sale=(data.sales||[]).find(item=>item.id===(shipment.invoiceId||shipment.orderId));
  const customer=(data.customers||[]).find(item=>item.id===(shipment.customerId||sale?.customerId));
  return {code,shipment,sale,customer,values,amount:amountValue,difference,previous,status:previous?"duplicate":difference===0?"matched":"difference",label:previous?"مسجل سابقًا":difference===0?"مطابق":"يوجد فرق"};
}

function orderCollectionStatusBadge(item={}) {
  const status=item.status||item.registrationType;
  if(status==="reversed")return badge("معكوس","gray");
  if(status==="settled")return badge("تم الاستلام بالخزنة","");
  return badge("لدى شركة الشحن","warning");
}

function collectionDifferenceReasons(selected="") {
  return ["","تحصيل جزئي","خصم من شركة الشحن","رسوم إضافية","خطأ في قيمة الأوردر","تعويض","فرق يحتاج مراجعة","سبب آخر"].map(value=>`<option value="${value}" ${selected===value?"selected":""}>${value||"اختر سبب الفرق..."}</option>`).join("");
}

function renderOrderCollectionCard(preview) {
  if(!preview?.shipment)return preview?.code?`<div class="collection-result error-state"><strong>لم يتم العثور على أوردر</strong><span>راجع كود الشحنة ثم حاول مرة أخرى.</span></div>`:"";
  if(preview.previous)return `<div class="collection-result duplicate-state"><div><strong>تم تسجيل تحصيل هذه الشحنة سابقًا</strong><span>${arabicDateTimeLabel(preview.previous.createdAt)} · ${esc(preview.previous.createdBy||"—")}</span></div><div class="collection-money"><span>المبلغ</span><b>${money(preview.previous.amount)}</b></div><div>${orderCollectionStatusBadge(preview.previous)}</div><button class="btn ghost small" data-action="open-previous-collection" data-id="${preview.previous.id}">فتح العملية السابقة</button></div>`;
  const v=preview.values,s=preview.shipment;
  return `<article class="card collection-order-card">
    <div class="card-header"><div><span class="eyebrow">تم العثور على الأوردر</span><h3>${esc(s.orderId||s.invoiceId||"—")}</h3><p>${esc(s.customer||s.customerName||preview.customer?.name||"—")} · <span dir="ltr">${esc(s.phone||s.customerPhone||preview.customer?.phone||"—")}</span></p></div>${preview.difference===0?badge("مطابق وجاهز للتسجيل",""):badge(preview.difference<0?"أقل من المتوقع":"أعلى من المتوقع","danger")}</div>
    <div class="collection-details">
      <span><small>الفاتورة</small><b>${esc(s.invoiceId||s.orderId||"—")}</b></span><span><small>كود الشحنة</small><b dir="ltr">${esc(preview.code)}</b></span>
      <span><small>شركة الشحن</small><b>${esc(s.company||s.carrier||"—")}</b></span><span><small>حالة الشحنة</small><b>${esc(shipmentStatusMeta(s).label)}</b></span>
      <span><small>قيمة المنتجات</small><b>${money(v.productsValue)}</b></span><span><small>شحن العميل</small><b>${money(v.customerShippingCharge)}</b></span>
      <span class="primary"><small>المطلوب تحصيله</small><b>${money(v.collectionAmount)}</b></span><span class="primary"><small>التحصيل المدخل</small><b>${money(preview.amount)}</b></span>
      <span class="${preview.difference?"danger":""}"><small>${financeConceptTitle("يوجد فرق","قيمة التحويل أو التحصيل تختلف عن القيمة المتوقعة. راجع السبب قبل اعتماد العملية.")}</small><b>${money(preview.difference)}</b></span><span><small>${financeConceptTitle("عمولة التحصيل","يحسبها النظام تلقائيًا حسب إعدادات شركة الشحن، وتتحول إلى مصروف عند التسوية الفعلية.")}</small><b>${money(v.collectionCommissionExpected)}</b></span>
      <span><small>صافي التحويل المتوقع</small><b>${money(centsMoney(moneyCents(preview.amount)-moneyCents(v.collectionCommissionExpected)-moneyCents(v.carrierShippingCostExpected)))}</b></span><span><small>الحالة المالية</small><b>${esc(s.financialCollectionStatus||"غير مسجل")}</b></span>
    </div>
    <form id="order-collection-confirm-form">
      <div class="form-grid three">
        <div class="form-field"><label>${financeConceptTitle("نوع التسجيل","إثبات التحصيل يعني أن العميل دفع لشركة الشحن، لكن المبلغ لم يصل إلى خزنة المكتبة بعد.")}</label><select name="registrationType" id="order-collection-type"><option value="collected_by_carrier">إثبات التحصيل لدى شركة الشحن فقط</option>${canAction("finance.collection.settle")?`<option value="settled">استلام التحويل في الخزنة أو الحساب</option>`:""}</select></div>
        <div class="form-field" id="order-collection-account-field" hidden><label>الخزنة أو الحساب</label><select name="account">${cashAccountOptions()}</select></div>
        <div class="form-field" ${preview.difference===0?"hidden":""}><label>${financeConceptTitle("سبب الفرق","قيمة التحويل أو التحصيل تختلف عن القيمة المتوقعة. راجع السبب قبل اعتماد العملية.")}</label><select name="differenceReason">${collectionDifferenceReasons(orderCollectionDraft.differenceReason)}</select></div>
        <div class="form-field full"><label>ملاحظة اختيارية</label><input name="notes" value="${esc(orderCollectionDraft.notes||"")}"></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">تأكيد التحصيل</button></div>
    </form>
  </article>`;
}

function parseOrderCollectionBatch(text="") {
  const seen=new Set();
  return String(text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
    const [rawCode,rawAmount,...extra]=line.split("|");
    const code=normalizeTrackingNumber(rawCode||""),amountText=normalizeArabicNumericText(rawAmount||"");
    if(!code||!amountText||extra.length||!Number.isFinite(Number(amountText))||Number(amountText)<0)return {code:code||rawCode||"—",amount:amountText,status:"invalid",label:"غير صالح"};
    if(seen.has(code))return {code,amount:Number(amountText),status:"invalid",label:"مكرر داخل المجموعة"};
    seen.add(code);
    return orderCollectionPreview(code,amountText);
  });
}

function renderOrderCollectionBatch() {
  return `<article class="card collection-batch"><div class="card-header"><div><h3>إدخال مجموعة تحصيلات</h3><p>الصق كل عملية في سطر: كود الشحنة | قيمة التحصيل</p></div></div>
    <textarea id="order-collection-batch-input" rows="7" dir="ltr" placeholder="ENO123456789EG | 1070"></textarea>
    <div class="form-actions"><button class="btn secondary" data-action="review-collection-batch">مراجعة المجموعة</button>${orderCollectionBatchRows.length?`<button class="btn" data-action="save-collection-batch">حفظ الصفوف السليمة</button>`:""}</div>
    ${orderCollectionBatchRows.length?`<div class="table-wrap"><table><thead><tr><th>الكود</th><th>الأوردر</th><th>العميل</th><th>المتوقع</th><th>المدخل</th><th>الفرق</th><th>العمولة</th><th>الحالة / المعالجة</th></tr></thead><tbody>${orderCollectionBatchRows.map((row,index)=>`<tr><td dir="ltr">${esc(row.code)}</td><td>${esc(row.shipment?.orderId||"—")}</td><td>${esc(row.shipment?.customer||row.customer?.name||"—")}</td><td>${row.values?money(row.values.collectionAmount):"—"}</td><td>${Number.isFinite(Number(row.amount))?money(row.amount):"—"}</td><td>${row.values?money(row.difference):"—"}</td><td>${row.values?money(row.values.collectionCommissionExpected):"—"}</td><td>${row.status==="difference"?`<select data-collection-batch-reason="${index}">${collectionDifferenceReasons(row.differenceReason||"")}</select>`:badge(row.label,row.status==="matched"?"":"danger")}</td></tr>`).join("")}</tbody></table></div>`:""}
  </article>`;
}

function renderOrderCollections() {
  const preview=orderCollectionDraft.shipmentId||orderCollectionDraft.trackingNumber?orderCollectionPreview(orderCollectionDraft.trackingNumber,orderCollectionDraft.amount):null;
  const query=normalizeSmartSearch(orderCollectionSearch);
  const rows=(data.orderCollections||[]).filter(item=>!query||normalizeSmartSearch([item.trackingNumber,item.orderId,item.customerName,item.customerPhone].join(" ")).includes(query)).slice().reverse();
  const content=orderCollectionMode==="batch"?renderOrderCollectionBatch():`<article class="card collection-entry-card"><div class="card-header"><div><h3>تسجيل تحصيل سريع</h3><p>أدخل كود الشحنة والقيمة الواردة من شركة الشحن.</p></div></div>
    <form id="order-collection-search-form"><div class="collection-entry-grid"><div class="form-field"><label>كود الشحنة</label><input id="order-collection-code" name="trackingNumber" dir="ltr" autocomplete="off" value="${esc(orderCollectionDraft.trackingNumber)}" placeholder="ENO123456789EG"></div><div class="form-field"><label>قيمة التحصيل</label><input ${numericFieldAttributes({id:"order-collection-amount",name:"amount",value:orderCollectionDraft.amount||""})}></div><div class="form-field"><label>تاريخ التحصيل</label><input name="collectionDate" type="date" value="${orderCollectionDraft.collectionDate||today()}"></div><div class="form-field"><label>شركة الشحن</label><input value="${esc(preview?.shipment?.company||preview?.shipment?.carrier||"تُحدد تلقائيًا")}" disabled></div><button class="btn" type="submit">بحث عن الأوردر</button></div></form>
  </article>${renderOrderCollectionCard(preview)}`;
  setTimeout(()=>document.getElementById("order-collection-code")?.focus(),0);
  return `${financeTabsMarkup()}<div class="collection-mode-tabs"><button class="tab ${orderCollectionMode==="single"?"active":""}" data-action="collection-mode" data-mode="single">تسجيل فردي</button><button class="tab ${orderCollectionMode==="batch"?"active":""}" data-action="collection-mode" data-mode="batch">إدخال مجموعة تحصيلات</button></div>${content}
    <article class="card collection-history"><div class="card-header"><div><h3>آخر التحصيلات المسجلة</h3><p>السجل اليومي للتحصيل من شركات الشحن.</p></div><input id="order-collection-history-search" value="${esc(orderCollectionSearch)}" placeholder="بحث بالكود أو الأوردر أو العميل أو الهاتف"></div><div class="table-wrap"><table><thead><tr><th>التاريخ والوقت</th><th>الكود</th><th>الأوردر</th><th>العميل</th><th>التحصيل</th><th>العمولة</th><th>الصافي المتوقع</th><th>النوع</th><th>الموظف</th><th>الحالة</th><th>الروابط</th></tr></thead><tbody>${rows.map(item=>`<tr id="collection-${esc(item.id)}"><td>${arabicDateTimeLabel(item.createdAt)}</td><td dir="ltr"><strong>${esc(item.trackingNumber)}</strong></td><td>${esc(item.orderId||"—")}</td><td>${esc(item.customerName||"—")}<br><span class="muted" dir="ltr">${esc(item.customerPhone||"")}</span></td><td class="money">${money(item.amount)}</td><td class="money">${money(item.expectedCommission)}</td><td class="money">${money(item.expectedNetTransfer)}</td><td>${item.registrationType==="settled"?"استلام بالخزنة":"إثبات لدى الشركة"}</td><td>${esc(item.createdBy||"—")}</td><td>${orderCollectionStatusBadge(item)}</td><td><div class="row-actions">${item.onlineOrderId?`<button class="row-action" data-action="view-online-order" data-id="${esc(item.onlineOrderId)}">${esc(item.onlineOrderId)}</button>`:""}${item.invoiceId?`<button class="row-action" data-action="view-sale" data-id="${esc(item.invoiceId)}">${esc(item.invoiceId)}</button>`:""}${item.shipmentId?`<button class="row-action" data-action="view-shipment" data-id="${esc(item.shipmentId)}">${esc(item.shipmentId)}</button>`:""}${item.settlementId?`<button class="row-action" data-action="view-settlement" data-id="${esc(item.settlementId)}">${esc(item.settlementId)}</button>`:""}${item.status!=="reversed"&&canAction("finance.collection.reverse")?`<button class="row-action text-danger" data-action="finance.collection.reverse" data-id="${item.id}">عكس</button>`:""}</div></td></tr>`).join("")||`<tr><td colspan="11" class="text-center muted">لا توجد تحصيلات مسجلة.</td></tr>`}</tbody></table></div></article>`;
}

function renderFinanceSettlements() {
  const rows=(data.carrierSettlements||[]).filter(item=>!item.deletedAt).slice().reverse();
  const deliveredUnsettled=(data.shipments||[]).filter(item=>!item.deletedAt&&shipmentStatusCode(item)==="delivered"&&!item.settlementId).length;
  return `${financeTabsMarkup()}<div class="stats-grid finance-summary">${statCard("تسويات معتمدة",rows.filter(i=>Boolean(i.approvedAt)).length,"تحويلات شركات الشحن","✓")}${statCard("مسودة / مراجعة",rows.filter(i=>["مسودة","بانتظار المراجعة"].includes(i.status)).length,"تحتاج استكمالًا","⌛","gold")}${statCard("مسلمة غير مسواة",deliveredUnsettled,"تحتاج تسوية تحصيل","!","red")}</div><article class="card"><div class="card-header"><div><h3>تسويات التحصيل</h3><p>طابق تحويل شركة الشحن مع أكواد التتبع ثم اعتمد مرة واحدة.</p></div>${canAction("create-settlement")?`<button class="btn" data-action="new-settlement">＋ تسوية جديدة</button>`:""}</div><div class="table-wrap"><table><thead><tr><th>رقم التسوية</th><th>الشركة</th><th>تاريخ التحويل</th><th>الشحنات</th><th>المتوقع</th><th>المستلم</th><th>الفرق</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(item=>{const totals=settlementSummary(item);const expected=Number(item.expectedNetSettlement??(totals.collection-totals.actualCost-totals.actualCommission-Number(item.otherDeductions||0)));const actual=Number(item.actualNetSettlement||0);return `<tr><td><strong>${esc(item.id)}</strong><br><span class="muted">${esc(item.transferReference||"")}</span></td><td>${esc(item.company)}</td><td>${fmtDate(item.transferDate)}</td><td>${totals.count}</td><td class="money">${money(expected)}</td><td class="money">${money(actual)}</td><td class="money ${Math.abs(actual-expected)>.01?"text-danger":""}">${money(actual-expected)}</td><td>${expenseStatusBadge(item.status)}</td><td><button class="row-action" data-action="view-settlement" data-id="${item.id}">فتح</button></td></tr>`}).join("")||`<tr><td colspan="9" class="text-center muted">لا توجد تسويات بعد.</td></tr>`}</tbody></table></div></article>`;
}

function renderFinancialReports() {
  const range=financeReportRange();
  const inRange=item=>{const date=String(item.date||item.transferDate||item.settledAt||item.createdAt||"").slice(0,10);return (!range.from||date>=range.from)&&(!range.to||date<=range.to);};
  const byAccount=item=>!financeReportFilters.account||item.account===financeReportFilters.account;
  const showExpenses=!financeReportFilters.movementType||["مصروف","تسوية شركة شحن"].includes(financeReportFilters.movementType);
  const showIncome=!financeReportFilters.movementType||["دخل","تسوية شركة شحن"].includes(financeReportFilters.movementType);
  const expenses=showExpenses?(data.expenses||[]).filter(i=>i.status==="معتمد"&&inRange(i)&&byAccount(i)&&(!financeReportFilters.expenseType||i.expenseType===financeReportFilters.expenseType)&&(!financeReportFilters.carrier||i.beneficiary===financeReportFilters.carrier)):[];
  const income=showIncome?(data.otherIncome||[]).filter(i=>i.status==="معتمد"&&inRange(i)&&byAccount(i)):[];
  const sales=(data.sales||[]).filter(i=>i.status!=="ملغاة"&&inRange(i));
  const shipments=(data.shipments||[]).filter(i=>!i.deletedAt&&inRange(i)&&(!financeReportFilters.carrier||[i.company,i.carrier].includes(financeReportFilters.carrier)));
  const settlements=(data.carrierSettlements||[]).filter(i=>i.approvedAt&&inRange(i)&&byAccount(i)&&(!financeReportFilters.carrier||i.company===financeReportFilters.carrier));
  const collections=(data.orderCollections||[]).filter(i=>i.status!=="reversed"&&inRange(i)&&(!financeReportFilters.carrier||i.carrier===financeReportFilters.carrier));
  const salesTotal=sumMoney(sales,i=>i.total||0);
  const shippingCharge=sumMoney(shipments,i=>shipmentFinanceValues(i).customerShippingCharge);
  const expenseTotal=sumMoney(expenses,i=>i.amount||0);
  const incomeTotal=sumMoney(income,i=>i.amount||0);
  const shippingCosts=sumMoney(expenses.filter(i=>/تكلفة شحن/.test(i.expenseType||"")),i=>i.amount);
  const commissions=sumMoney(expenses.filter(i=>/عمولة تحصيل/.test(i.expenseType||"")),i=>i.amount);
  const returnCosts=sumMoney(expenses.filter(i=>/مرتجع/.test(i.expenseType||"")),i=>i.amount);
  const shippingRelated=sumMoney(expenses.filter(i=>i.source==="تسوية شركة شحن"),i=>i.amount);
  const salesUncollected=sumMoney(sales,i=>i.remaining||0);
  const collectedByCarriers=sumMoney(collections.filter(i=>i.status==="collected_by_carrier"),i=>i.amount||0);
  const carrierDue=sumMoney(collections.filter(i=>i.status==="collected_by_carrier"&&!i.settlementId),i=>i.expectedNetTransfer||0);
  const directlySettled=sumMoney(collections.filter(i=>i.status==="settled"&&!i.settlementId),i=>i.amount||0);
  const settled=centsMoney(moneyCents(sumMoney(settlements,i=>i.actualNetSettlement||0))+moneyCents(directlySettled));
  const unresolvedDifference=sumMoney(settlements.filter(i=>Math.abs(Number(i.settlementDifference||0))>.009),i=>i.settlementDifference||0);
  const netResult=centsMoney(moneyCents(salesTotal)+moneyCents(incomeTotal)-moneyCents(expenseTotal));
  const shippingProfit=centsMoney(moneyCents(shippingCharge)-moneyCents(shippingCosts)-moneyCents(commissions)-moneyCents(returnCosts)-moneyCents(Math.max(0,shippingRelated-shippingCosts-commissions-returnCosts)));
  const movementOptions=["","دخل","مصروف","تسوية شركة شحن","تحويل بين الخزن","قيد عكسي"];
  return `${financeTabsMarkup()}<article class="card finance-report-filters"><div class="card-header"><div><h3>فترة التقرير والفلاتر</h3><p>الفترة شاملة تاريخ البداية والنهاية بالكامل.</p></div><div class="finance-range-presets">${[["today","اليوم"],["week","هذا الأسبوع"],["month","هذا الشهر"],["custom","فترة مخصصة"]].map(([v,l])=>`<button class="tab ${financeReportFilters.preset===v?"active":""}" data-action="finance-report-preset" data-preset="${v}">${l}</button>`).join("")}</div></div><div class="form-grid four"><div class="form-field"><label>من تاريخ</label><input id="finance-report-from" type="date" value="${range.from}"></div><div class="form-field"><label>إلى تاريخ</label><input id="finance-report-to" type="date" value="${range.to}"></div><div class="form-field"><label>نوع الحركة</label><select id="finance-report-movement">${movementOptions.map(v=>`<option value="${v}" ${financeReportFilters.movementType===v?"selected":""}>${v||"كل الحركات"}</option>`).join("")}</select></div><div class="form-field"><label>الخزنة أو الحساب</label><select id="finance-report-account"><option value="">كل الحسابات</option>${activeCashAccounts().map(a=>`<option ${financeReportFilters.account===a.name?"selected":""}>${esc(a.name)}</option>`).join("")}</select></div><div class="form-field"><label>نوع المصروف</label><select id="finance-report-expense-type"><option value="">كل الأنواع</option>${(data.expenseTypes||[]).map(t=>`<option ${financeReportFilters.expenseType===t.name?"selected":""}>${esc(t.name)}</option>`).join("")}</select></div><div class="form-field"><label>شركة الشحن</label><select id="finance-report-carrier"><option value="">كل الشركات</option>${activeShippingCompanies().map(c=>`<option ${financeReportFilters.carrier===c.name?"selected":""}>${esc(c.name)}</option>`).join("")}</select></div></div></article><div class="finance-callout"><strong>نتيجة الفترة ≠ التدفق النقدي</strong><span>كل مؤشر يُقرأ من مستنده الأصلي؛ لا تُكرر المبيعات أو الشحن داخل الإيرادات الأخرى.</span></div><div class="report-grid">${statCard("مبيعات المنتجات",money(centsMoney(moneyCents(salesTotal)-moneyCents(shippingCharge))),"من فواتير البيع","▤")}${statCard("مبيعات غير محصلة",money(salesUncollected),"الرصيد المتبقي بالفواتير","⌛","gold")}${statCard("تم تحصيله لدى الشركات",money(collectedByCarriers),"لم يدخل الخزنة بعد","▣","blue")}${statCard("مستحق لدى الشركات",money(carrierDue),"صافي التحويل المتوقع","⌛","blue")}${statCard("تم تحويله فعليًا",money(settled),"تسويات وتحويلات معتمدة","✓")}${statCard("شحن محصل من العملاء",money(shippingCharge),"من الشحنات والفواتير","▣","blue")}${statCard("إيرادات أخرى",money(incomeTotal),"خارج المبيعات والشحن","＋")}${statCard("تكلفة الشحن",money(shippingCosts),"مصروفات آلية معتمدة","−","red")}${statCard("عمولات التحصيل",money(commissions),"مصروفات آلية معتمدة","−","red")}${statCard("إجمالي المصروفات",money(expenseTotal),"المعتمد فقط","−","red")}${statCard("صافي النتيجة",money(netResult),"المبيعات + الإيرادات الأخرى − المصروفات","≋","gold")}${statCard("فروق غير معالجة",money(unresolvedDifference),"تسويات بفروق","!","red")}${statCard("صافي نتيجة الشحن",money(shippingProfit),"شحن العميل − تكاليف الشحن","≋","gold")}</div>`;
}

function financeReportRange() {
  const now=new Date(),iso=date=>{const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);return local.toISOString().slice(0,10);};
  if(financeReportFilters.preset==="today")return {from:iso(now),to:iso(now)};
  if(financeReportFilters.preset==="week"){const start=new Date(now);start.setDate(now.getDate()-((now.getDay()+6)%7));return {from:iso(start),to:iso(now)};}
  if(financeReportFilters.preset==="month")return {from:`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`,to:iso(now)};
  return {from:financeReportFilters.from||"",to:financeReportFilters.to||""};
}

function renderAccounting() {
  const allowedTabs=allowedFinanceTabs();
  if(!allowedTabs.some(([id])=>id===financeTab))financeTab=allowedTabs[0]?.[0]||"expenses";
  const heading=financeTabIntro();
  if(financeTab==="expenses") root.innerHTML=heading+renderFinanceExpenses();
  else if(financeTab==="income") root.innerHTML=heading+renderFinanceIncome();
  else if(financeTab==="order-collections") root.innerHTML=heading+renderOrderCollections();
  else if(financeTab==="settlements") root.innerHTML=heading+renderFinanceSettlements();
  else if(financeTab==="finance-reports") root.innerHTML=heading+renderFinancialReports();
  else { renderFinanceLedger(); root.insertAdjacentHTML("afterbegin",heading+financeTabsMarkup()); }
}

function saleMonthKey(dateValue) {
  const text = String(dateValue || "");
  const match = text.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return "—";
  return new Date(year, month - 1, 1).toLocaleDateString("ar-EG", { month: "long", year: "numeric" });
}

function monthlySalesOverviewMarkup(activeSales) {
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentDay = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthly = new Map();
  activeSales.forEach(sale => {
    const key = saleMonthKey(sale.date);
    if (!key) return;
    const record = monthly.get(key) || { key, total: 0, count: 0 };
    record.total += Number(sale.total || 0);
    record.count += 1;
    monthly.set(key, record);
  });
  const current = monthly.get(currentKey) || { key: currentKey, total: 0, count: 0 };
  const projected = currentDay ? (current.total / currentDay) * daysInMonth : 0;
  const dailyAverage = currentDay ? current.total / currentDay : 0;
  const pastMonths = [...monthly.values()].filter(item => item.key < currentKey).sort((a, b) => b.key.localeCompare(a.key));
  const lastMonth = pastMonths[0];
  const pastAverage = pastMonths.length ? pastMonths.reduce((sum, item) => sum + item.total, 0) / pastMonths.length : 0;
  const maxValue = Math.max(projected, current.total, pastAverage, ...pastMonths.map(item => item.total), 1);
  const projectedVsLast = lastMonth?.total ? Math.round(((projected - lastMonth.total) / lastMonth.total) * 100) : null;
  return `<article class="card monthly-sales-card" style="margin-bottom:18px">
    <div class="card-body">
      <div class="section-title" style="margin:0 0 14px">
        <div>
          <span class="eyebrow">تحليل المبيعات الشهرية</span>
          <h2>المتوقع لهذا الشهر: ${money(projected)}</h2>
          <p>بناءً على مبيعات ${currentDay} يوم من ${daysInMonth} يوم في ${monthLabel(currentKey)}.</p>
        </div>
        <strong style="font-size:30px;color:var(--green-700)">${projectedVsLast === null ? "—" : `${projectedVsLast > 0 ? "+" : ""}${projectedVsLast}%`}</strong>
      </div>
      <div class="monthly-sales-grid">
        <div class="mini-metric"><span>مبيعات الشهر الحالي حتى اليوم</span><strong>${money(current.total)}</strong><small>${current.count} فاتورة</small></div>
        <div class="mini-metric"><span>المتوقع لنهاية الشهر</span><strong>${money(projected)}</strong><small>متوسط يومي ${money(dailyAverage)}</small></div>
        <div class="mini-metric"><span>الشهر السابق</span><strong>${lastMonth ? money(lastMonth.total) : "—"}</strong><small>${lastMonth ? monthLabel(lastMonth.key) : "لا يوجد شهر سابق"}</small></div>
        <div class="mini-metric"><span>متوسط الشهور السابقة</span><strong>${pastMonths.length ? money(pastAverage) : "—"}</strong><small>${pastMonths.length} شهر مسجل</small></div>
      </div>
      <div class="monthly-projection">
        <div><span>مبيعات حالية</span><b style="width:${Math.max(2, current.total / maxValue * 100)}%"></b><strong>${money(current.total)}</strong></div>
        <div><span>توقع الشهر</span><b style="width:${Math.max(2, projected / maxValue * 100)}%"></b><strong>${money(projected)}</strong></div>
      </div>
      <div class="table-wrap monthly-history">
        <table><thead><tr><th>الشهر السابق</th><th>عدد الفواتير</th><th>إجمالي المبيعات</th><th>مقارنة بتوقع الشهر الحالي</th></tr></thead><tbody>
          ${pastMonths.map(item => {
            const diff = item.total ? Math.round(((projected - item.total) / item.total) * 100) : null;
            return `<tr><td>${monthLabel(item.key)}</td><td>${item.count}</td><td class="money">${money(item.total)}</td><td>${diff === null ? "—" : badge(`${diff > 0 ? "+" : ""}${diff}%`, diff < 0 ? "warning" : "blue")}</td></tr>`;
          }).join("") || `<tr><td colspan="4" class="text-center muted">لا توجد مبيعات في شهور سابقة للمقارنة.</td></tr>`}
        </tbody></table>
      </div>
    </div>
  </article>`;
}

const PRODUCT_MOVEMENT_PAGE_SIZE = 25;
let productMovementState = {
  bookId: "", from: "", to: "", quickRange: "all", type: "all", supplierId: "", customerId: "",
  employee: "", status: "", sort: "desc", page: 1, showPrices: true, scrollY: 0
};

function productMovementType(type = "") {
  const value = String(type);
  if (/^إلغاء/.test(value)) return "cancelled";
  if (/جرد/.test(value)) return "count";
  if (/تسوية|تالف|مفقود|مجاني|تصحيح/.test(value)) return "adjustment";
  if (/مرتجع مبيعات/.test(value)) return "sale-return";
  if (/مرتجع مشتريات|مرتجع أمانة/.test(value)) return "purchase-return";
  if (/بيع/.test(value)) return "sale";
  if (/شراء|توريد|استلام/.test(value)) return "purchase";
  if (/افتتاح/.test(value)) return "opening";
  return "other";
}

function productMovementTypeLabel(kind, fallback = "حركة مخزون") {
  return ({ purchase:"مشتريات", sale:"مبيعات", "sale-return":"مرتجع بيع", "purchase-return":"مرتجع شراء", adjustment:"تسوية", count:"جرد", opening:"مخزون افتتاحي", cancelled:"حركة ملغاة", other:fallback })[kind] || fallback;
}

function productMovementDocument(documentId = "") {
  const sale = (data.sales || []).find(item => item.id === documentId);
  if (sale) return { kind:"sale", record:sale, status:sale.status || "معتمدة", partyId:sale.customerId || "", partyName:getCustomer(sale.customerId)?.name || sale.customerSnapshot?.name || "", action:"view-sale" };
  const purchase = (data.purchases || []).find(item => item.id === documentId);
  if (purchase) return { kind:"purchase", record:purchase, status:purchase.status || "مستلمة", partyId:purchase.supplierId || "", partyName:getSupplier(purchase.supplierId)?.name || "", action:"view-purchase" };
  const ret = (data.returns || []).find(item => [item.id, item.returnNo, item.returnInvoiceId, item.documentId].includes(documentId));
  if (ret) return { kind:"return", record:ret, status:ret.status || "معتمد", partyId:ret.accountId || ret.partyId || "", partyName:returnAccountName(ret) || "", action:"view-return" };
  return null;
}

function productMovementLineValue(movement, document, bookId) {
  const qty = Math.abs(Number(movement.quantity || 0));
  if (document?.kind === "sale") {
    const line = (document.record.lines || []).find(item => (item.bookId || item.productId) === bookId);
    const lineQty = Number(line?.qty || line?.quantity || 0);
    const total = line ? saleLineRevenue(line) : null;
    return { unitPrice: lineQty ? total / lineQty : Number(movement.priceAtOperation || 0), totalValue: lineQty ? total / lineQty * qty : Number(movement.priceAtOperation || 0) * qty, unitCost: line ? saleLineCogs(line) == null ? null : saleLineCogs(line) / Math.max(1, lineQty) : Number(movement.costAtOperation || 0), cogs: line ? saleLineCogs(line) : null };
  }
  if (document?.kind === "purchase") {
    const line = (document.record.lines || []).find(item => (item.bookId || item.productId) === bookId);
    const lineQty = Number(line?.qty || line?.quantity || 0);
    const total = Number(line?.finalNet ?? line?.total ?? line?.totalCost ?? 0);
    const unit = lineQty ? total / lineQty : Number(line?.cost || movement.costAtOperation || 0);
    return { unitPrice: unit, totalValue: unit * qty, unitCost: unit, cogs:null };
  }
  if (document?.kind === "return") {
    const line = returnItems(document.record).find(item => (item.bookId || item.productId) === bookId);
    const lineQty = Number(line?.qty || line?.quantity || 0);
    const total = Number(line?.total ?? line?.amount ?? 0);
    const unit = lineQty ? total / lineQty : Number(line?.unitPrice || movement.priceAtOperation || movement.costAtOperation || 0);
    return { unitPrice: unit, totalValue: unit * qty, unitCost:Number(movement.costAtOperation || 0) || null, cogs:null };
  }
  const unit = Number(movement.quantity || 0) < 0 ? Number(movement.priceAtOperation || 0) : Number(movement.costAtOperation || 0);
  return { unitPrice: unit || null, totalValue: unit ? unit * qty : null, unitCost:Number(movement.costAtOperation || 0) || null, cogs:null };
}

function productMovementRows(bookId) {
  const rows = (data.stockMovements || []).filter(item => item.bookId === bookId).map(item => {
    const document = productMovementDocument(item.documentId || item.documentNo || "");
    const kind = productMovementType(item.type);
    const value = productMovementLineValue(item, document, bookId);
    const quantity = Number(item.quantity || 0);
    return {
      id:item.id, date:item.createdAt || item.date, type:item.type || "حركة مخزون", kind,
      documentId:item.documentNo || item.documentId || "", document, status:document?.status || (kind === "cancelled" ? "ملغاة" : "معتمد"),
      partyId:document?.partyId || item.customerId || item.supplierId || "", partyName:document?.partyName || item.partyName || item.note || "",
      supplierId:item.supplierId || (document?.kind === "purchase" ? document.partyId : ""), customerId:item.customerId || (document?.kind === "sale" ? document.partyId : ""),
      incoming:quantity > 0 ? quantity : 0, outgoing:quantity < 0 ? Math.abs(quantity) : 0,
      before:Number(item.before ?? item.calculatedBefore ?? 0), after:Number(item.after ?? item.calculatedAfter ?? 0), unitPrice:value.unitPrice, totalValue:value.totalValue, unitCost:value.unitCost, cogs:value.cogs,
      employee:item.employeeName || item.user || "النظام", username:item.username || "", note:item.note || ""
    };
  }).sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.id).localeCompare(String(b.id)));
  let balance = rows.length && rows[0].kind !== "opening" && Number.isFinite(rows[0].before) ? rows[0].before : 0;
  rows.forEach(row => { row.before = balance; balance += row.incoming - row.outgoing; row.after = balance; });
  return rows;
}

function productMovementRange(state = productMovementState) {
  const now = new Date();
  const day = date => date.toISOString().slice(0, 10);
  if (state.quickRange === "today") return { from:day(now), to:day(now) };
  if (state.quickRange === "7") return { from:day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), to:day(now) };
  if (state.quickRange === "30") return { from:day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), to:day(now) };
  if (state.quickRange === "month") return { from:day(new Date(now.getFullYear(), now.getMonth(), 1)), to:day(now) };
  if (state.quickRange === "year") return { from:`${now.getFullYear()}-01-01`, to:day(now) };
  return { from:state.from || "", to:state.to || "" };
}

function productMovementReportData(state = productMovementState) {
  const book = getBook(state.bookId);
  if (!book) return null;
  const allRows = productMovementRows(book.id);
  const range = productMovementRange(state);
  const beforeRows = allRows.filter(row => range.from && String(row.date).slice(0, 10) < range.from);
  const opening = range.from ? (beforeRows.length ? beforeRows[beforeRows.length - 1].after : allRows[0]?.before ?? Number(book.stock || 0)) : allRows[0]?.before ?? Number(book.stock || 0);
  let rows = allRows.filter(row => (!range.from || String(row.date).slice(0, 10) >= range.from) && (!range.to || String(row.date).slice(0, 10) <= range.to));
  if (state.type !== "all") rows = rows.filter(row => row.kind === state.type);
  if (state.supplierId) rows = rows.filter(row => row.supplierId === state.supplierId);
  if (state.customerId) rows = rows.filter(row => row.customerId === state.customerId);
  if (state.employee) rows = rows.filter(row => row.employee === state.employee);
  if (state.status) rows = rows.filter(row => row.status === state.status);
  const periodRows = allRows.filter(row => (!range.from || String(row.date).slice(0, 10) >= range.from) && (!range.to || String(row.date).slice(0, 10) <= range.to));
  const incoming = periodRows.reduce((sum, row) => sum + row.incoming, 0);
  const outgoing = periodRows.reduce((sum, row) => sum + row.outgoing, 0);
  const closing = opening + incoming - outgoing;
  const expected = range.to
    ? (periodRows.length ? periodRows[periodRows.length - 1].after : opening)
    : Number(book.stock || 0);
  const salesRows = periodRows.filter(row => row.kind === "sale");
  const canSeeCost = canAction("view-item-cost-profit");
  const cogsKnown = salesRows.every(row => row.cogs !== null && row.cogs !== undefined);
  const summary = {
    opening, closing, expected, mismatch:Math.abs(closing - expected) > 0.0001,
    purchaseQty:periodRows.filter(row => row.kind === "purchase").reduce((s,r)=>s+r.incoming,0),
    purchaseValue:periodRows.filter(row => row.kind === "purchase").reduce((s,r)=>s+Number(r.totalValue || 0),0),
    saleQty:salesRows.reduce((s,r)=>s+r.outgoing,0), saleValue:salesRows.reduce((s,r)=>s+Number(r.totalValue || 0),0),
    saleReturns:periodRows.filter(row=>row.kind === "sale-return").reduce((s,r)=>s+r.incoming,0),
    purchaseReturns:periodRows.filter(row=>row.kind === "purchase-return").reduce((s,r)=>s+r.outgoing,0),
    adjustmentIn:periodRows.filter(row=>["adjustment","count"].includes(row.kind)).reduce((s,r)=>s+r.incoming,0),
    adjustmentOut:periodRows.filter(row=>["adjustment","count"].includes(row.kind)).reduce((s,r)=>s+r.outgoing,0),
    cogs:canSeeCost && cogsKnown ? salesRows.reduce((s,r)=>s+Number(r.cogs || 0),0) : null
  };
  summary.grossProfit = summary.cogs === null ? null : summary.saleValue - summary.cogs;
  return { book, allRows, rows:state.sort === "asc" ? rows : rows.slice().reverse(), range, summary, canSeeCost };
}

function productMovementBookOptions() {
  return data.books.filter(book => !book.deletedAt).map(book => `<option value="${esc(book.id)}">${esc(book.name)} · ${esc(book.barcode || "بدون باركود")}</option>`).join("");
}

function productMovementOptionList(values, selected, emptyLabel) {
  return `<option value="">${emptyLabel}</option>${[...new Set(values.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b), "ar")).map(value => `<option value="${esc(value)}" ${selected === value ? "selected" : ""}>${esc(value)}</option>`).join("")}`;
}

function refreshProductMovementReport(patch = {}, keepScroll = true) {
  const scrollY = keepScroll ? window.scrollY : 0;
  productMovementState = { ...productMovementState, ...patch };
  renderProductMovementReport(productMovementState.bookId);
  requestAnimationFrame(() => window.scrollTo({ top:scrollY, behavior:"auto" }));
}

function selectProductMovementBook(field, rawValue) {
  const value = String(rawValue || "").trim();
  const normalized = value.toLocaleLowerCase("ar");
  const book = data.books.find(item => !item.deletedAt && (field === "id" ? item.id === value : field === "barcode" ? [item.barcode,item.extraBarcode].filter(Boolean).includes(value) : String(item.name || "").trim().toLocaleLowerCase("ar") === normalized));
  if (!book && value) return toast("لم يتم العثور على صنف مطابق.", "error");
  refreshProductMovementReport({ bookId:book?.id || "", page:1 }, false);
}

function productMovementMoney(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "غير متاح" : money(value);
}

function productMovementTone(kind) {
  return kind === "cancelled" ? "movement-cancelled" : ["adjustment","count"].includes(kind) ? "movement-adjustment" : "";
}

function productMovementTable(report) {
  const pageCount = Math.max(1, Math.ceil(report.rows.length / PRODUCT_MOVEMENT_PAGE_SIZE));
  productMovementState.page = Math.min(pageCount, Math.max(1, Number(productMovementState.page || 1)));
  const start = (productMovementState.page - 1) * PRODUCT_MOVEMENT_PAGE_SIZE;
  const rows = report.rows.slice(start, start + PRODUCT_MOVEMENT_PAGE_SIZE);
  const costHeads = report.canSeeCost ? `<th>تكلفة الوحدة</th>` : "";
  return `<div class="table-wrap product-movement-table"><table><thead><tr><th>التاريخ والوقت</th><th>نوع الحركة</th><th>المستند</th><th>الطرف / السبب</th><th>داخل</th><th>خارج</th><th>سعر الوحدة</th><th>القيمة</th>${costHeads}<th>قبل</th><th>بعد</th><th>الموظف</th><th>الحالة</th><th>ملاحظات</th><th>الإجراء</th></tr></thead><tbody>${rows.map(row => `<tr class="clickable-row ${productMovementTone(row.kind)}" data-action="product-movement-open-document" data-movement-id="${esc(row.id)}"><td>${esc(dateTimeLabel(row.date))}</td><td>${badge(productMovementTypeLabel(row.kind, row.type), ["adjustment","count"].includes(row.kind) ? "warning" : row.kind === "cancelled" ? "gray" : row.incoming ? "" : "danger")}</td><td dir="ltr"><strong>${esc(row.documentId || "—")}</strong></td><td>${esc(row.partyName || "—")}</td><td class="movement-in">${row.incoming ? `+${row.incoming}` : "—"}</td><td class="movement-out">${row.outgoing || "—"}</td><td class="money">${productMovementMoney(row.unitPrice)}</td><td class="money">${productMovementMoney(row.totalValue)}</td>${report.canSeeCost ? `<td class="money">${productMovementMoney(row.unitCost)}</td>` : ""}<td>${row.before}</td><td><strong>${row.after}</strong></td><td>${esc(row.employee)}</td><td>${badge(row.status || "—", row.status === "ملغاة" ? "gray" : "")}</td><td>${esc(row.note || "—")}</td><td>${row.document?.action ? `<button class="row-action" data-action="product-movement-open-document" data-movement-id="${esc(row.id)}">فتح المستند</button>` : `<button class="row-action" data-action="product-movement-open-document" data-movement-id="${esc(row.id)}">عرض التفاصيل</button>`}</td></tr>`).join("") || `<tr><td colspan="${report.canSeeCost ? 15 : 14}" class="text-center muted">لا توجد حركات مطابقة للفلاتر المختارة.</td></tr>`}</tbody></table></div><div class="product-movement-pagination"><button class="btn ghost small" data-action="product-movement-page" data-page="${productMovementState.page - 1}" ${productMovementState.page <= 1 ? "disabled" : ""}>السابق</button><span>صفحة ${productMovementState.page} من ${pageCount} · ${report.rows.length} حركة</span><button class="btn ghost small" data-action="product-movement-page" data-page="${productMovementState.page + 1}" ${productMovementState.page >= pageCount ? "disabled" : ""}>التالي</button></div>`;
}

function renderProductMovementReport(bookId = productMovementState.bookId) {
  if (bookId) productMovementState.bookId = bookId;
  const report = productMovementReportData(productMovementState);
  const quickRanges = [["today","اليوم"],["7","آخر 7 أيام"],["30","آخر 30 يومًا"],["month","الشهر الحالي"],["year","السنة الحالية"],["all","كل الحركات"]];
  root.innerHTML = `<div class="section-title"><div><h2>حركة صنف</h2><p>تتبع الشراء والبيع والمرتجعات والتسويات والجرد مع الرصيد بعد كل حركة.</p></div><div class="actions"><button class="btn ghost" data-action="reports-main">كل التقارير</button>${report ? `<label class="movement-print-option"><input id="movement-print-prices" type="checkbox" ${productMovementState.showPrices ? "checked" : ""}> إظهار الأسعار${report.canSeeCost ? " والتكلفة" : ""}</label><button class="btn secondary" data-action="print-product-movement">طباعة التقرير</button><button class="btn" data-action="export-product-movement">CSV</button>` : ""}</div></div>
    <article class="card product-movement-filters"><div class="form-grid three"><div class="form-field"><label>اسم الصنف</label><input id="movement-book-name" list="movement-book-names" value="${esc(report?.book.name || "")}" placeholder="اكتب اسم الصنف"><datalist id="movement-book-names">${data.books.filter(b=>!b.deletedAt).map(b=>`<option value="${esc(b.name)}">${esc(b.id)}</option>`).join("")}</datalist></div><div class="form-field"><label>الباركود</label><input id="movement-book-barcode" list="movement-book-barcodes" dir="ltr" value="${esc(report?.book.barcode || "")}" placeholder="امسح الباركود"><datalist id="movement-book-barcodes">${data.books.filter(b=>!b.deletedAt).map(b=>`<option value="${esc(b.barcode || "")}">${esc(b.name)}</option>`).join("")}</datalist></div><div class="form-field"><label>كود الصنف</label><select id="movement-book-id"><option value="">اختر الصنف أولًا</option>${productMovementBookOptions()}</select></div></div>
    ${!report ? `<div class="empty-state"><div class="empty-icon">⌕</div><h3>اختر صنفًا لعرض الحركة</h3><p>لن يتم تحميل أي حركات قبل تحديد الصنف بالاسم أو الباركود أو الكود.</p></div>` : `<div class="movement-range-presets">${quickRanges.map(([value,label])=>`<button class="tab ${productMovementState.quickRange===value?"active":""}" data-action="product-movement-range" data-range="${value}">${label}</button>`).join("")}</div><div class="form-grid three movement-filter-grid"><div class="form-field"><label>من تاريخ</label><input id="movement-from" type="date" value="${esc(report.range.from)}"></div><div class="form-field"><label>إلى تاريخ</label><input id="movement-to" type="date" value="${esc(report.range.to)}"></div><div class="form-field"><label>نوع الحركة</label><select id="movement-type">${[["all","الكل"],["purchase","مشتريات"],["sale","مبيعات"],["sale-return","مرتجعات بيع"],["purchase-return","مرتجعات شراء"],["adjustment","تسويات"],["count","جرد"],["opening","مخزون افتتاحي"],["cancelled","حركات ملغاة"]].map(([v,l])=>`<option value="${v}" ${productMovementState.type===v?"selected":""}>${l}</option>`).join("")}</select></div></div><details class="movement-advanced-filters" ${productMovementState.supplierId || productMovementState.customerId || productMovementState.employee || productMovementState.status ? "open" : ""}><summary>فلاتر إضافية</summary><div class="form-grid four"><div class="form-field"><label>المورد</label><select id="movement-supplier">${productMovementOptionList(report.allRows.filter(row=>row.supplierId).map(row=>getSupplier(row.supplierId)?.name || row.partyName), productMovementState.supplierId ? getSupplier(productMovementState.supplierId)?.name || productMovementState.supplierId : "", "كل الموردين")}</select></div><div class="form-field"><label>العميل</label><select id="movement-customer">${productMovementOptionList(report.allRows.filter(row=>row.customerId).map(row=>getCustomer(row.customerId)?.name || row.partyName), productMovementState.customerId ? getCustomer(productMovementState.customerId)?.name || productMovementState.customerId : "", "كل العملاء")}</select></div><div class="form-field"><label>الموظف</label><select id="movement-employee">${productMovementOptionList(report.allRows.map(row=>row.employee), productMovementState.employee, "كل الموظفين")}</select></div><div class="form-field"><label>الحالة</label><select id="movement-status">${productMovementOptionList(report.allRows.map(row=>row.status), productMovementState.status, "كل الحالات")}</select></div></div></details>`}</article>
    ${report ? productMovementReportMarkup(report) : ""}`;
  if (report) { const select = document.getElementById("movement-book-id"); if (select) select.value = report.book.id; }
}

function productMovementReportMarkup(report) {
  const book = report.book; const inventory = productInventorySummary(book.id); const s = report.summary;
  const image = book.image || book.imageUrl || book.coverImage || "";
  return `<article class="card product-movement-product"><div class="product-movement-identity">${image ? `<img src="${esc(image)}" alt="${esc(book.name)}">` : `<div class="book-cover">${esc(book.name.charAt(0))}</div>`}<div><h3>${esc(book.name)}</h3><p><span dir="ltr">${esc(book.id)}</span> · <span dir="ltr">${esc([book.barcode,book.extraBarcode].filter(Boolean).join("، ") || "غير متاح")}</span></p><span>${esc(book.category || "غير متاح")}</span></div></div><div class="product-movement-product-grid"><div><span>سعر الغلاف</span><strong>${productMovementMoney(productCoverPrice(book))}</strong></div><div><span>سعر البيع الحالي</span><strong>${productMovementMoney(productDefaultSellingPrice(book))}</strong></div><div><span>الرصيد الحالي</span><strong>${Number(book.stock || 0)}</strong></div><div><span>حد إعادة الطلب</span><strong>${Number(book.reorder || 0)}</strong></div>${report.canSeeCost ? `<div><span>آخر سعر شراء</span><strong>${inventory.lastPurchaseCost ? money(inventory.lastPurchaseCost) : "غير متاح"}</strong></div><div><span>متوسط التكلفة</span><strong>${inventory.hasIncompleteCost ? "غير متاح" : money(inventory.averageInventoryCost)}</strong></div><div><span>قيمة المخزون</span><strong>${inventory.hasIncompleteCost ? "غير متاح" : money(inventory.currentInventoryValue)}</strong></div>` : ""}</div></article>
  ${s.mismatch ? `<div class="alert-item warning"><div class="alert-badge gold">!</div><div><strong>يوجد اختلاف يحتاج مراجعة في سجل حركة الصنف</strong><span>المعادلة تعطي ${s.closing} بينما آخر رصيد مسجل ${s.expected}. لم يتم تعديل المخزون.</span></div></div>` : ""}
  <div class="stats-grid product-movement-summary">${statCard("رصيد أول المدة",s.opening,"قبل أول حركة في الفترة","↦")}${statCard("الكمية المشتراة",s.purchaseQty,productMovementMoney(s.purchaseValue),"+")}${statCard("الكمية المباعة",s.saleQty,productMovementMoney(s.saleValue),"−","blue")}${statCard("مرتجعات البيع",s.saleReturns,"كمية داخلة","↶")}${statCard("مرتجعات الشراء",s.purchaseReturns,"كمية خارجة","↶","red")}${statCard("تسويات بالزيادة",s.adjustmentIn,"تشمل فروق الجرد","+")}${statCard("تسويات بالنقص",s.adjustmentOut,"تشمل فروق الجرد","−","red")}${statCard("رصيد آخر المدة",s.closing,"أول المدة + الداخل - الخارج","=")}${report.canSeeCost ? statCard("تكلفة البضاعة المباعة",s.cogs===null?"غير متاح":money(s.cogs),"حسب تكلفة الفاتورة المسجلة","▤","blue")+statCard("مجمل ربح الصنف",s.grossProfit===null?"غير متاح":money(s.grossProfit),"المبيعات - التكلفة","↗","gold") : ""}</div>
  <article class="card"><div class="card-header"><div><h3>سجل حركة الصنف</h3><p>مرتب ${productMovementState.sort==="desc"?"من الأحدث إلى الأقدم":"من الأقدم إلى الأحدث"}.</p></div><select id="movement-sort" class="filter-select"><option value="desc" ${productMovementState.sort==="desc"?"selected":""}>الأحدث أولًا</option><option value="asc" ${productMovementState.sort==="asc"?"selected":""}>الأقدم أولًا</option></select></div>${productMovementTable(report)}</article>`;
}

function productMovementPrintMarkup(report) {
  const showPrices = productMovementState.showPrices;
  const priceHeads = showPrices ? `<th>سعر الوحدة</th><th>القيمة</th>${report.canSeeCost ? "<th>التكلفة</th>" : ""}` : "";
  const rows = report.rows.map(row => `<tr><td>${esc(dateTimeLabel(row.date))}</td><td>${esc(productMovementTypeLabel(row.kind, row.type))}</td><td dir="ltr">${esc(row.documentId || "—")}</td><td>${esc(row.partyName || "—")}</td><td>${row.incoming || "—"}</td><td>${row.outgoing || "—"}</td>${showPrices ? `<td>${productMovementMoney(row.unitPrice)}</td><td>${productMovementMoney(row.totalValue)}</td>${report.canSeeCost ? `<td>${productMovementMoney(row.unitCost)}</td>` : ""}` : ""}<td>${row.before}</td><td>${row.after}</td><td>${esc(row.employee)}</td><td>${esc(row.note || "—")}</td></tr>`).join("");
  const periodRows = report.allRows.filter(row=>(!report.range.from || String(row.date).slice(0,10)>=report.range.from)&&(!report.range.to || String(row.date).slice(0,10)<=report.range.to));
  return `<table><tbody><tr><th>التقرير</th><td>حركة صنف</td><th>الصنف</th><td>${esc(report.book.name)}</td></tr><tr><th>كود الصنف</th><td dir="ltr">${esc(report.book.id)}</td><th>الباركود</th><td dir="ltr">${esc(report.book.barcode || "—")}</td></tr><tr><th>الفترة</th><td>${esc(report.range.from || "البداية")} — ${esc(report.range.to || "الآن")}</td><th>طبع بواسطة</th><td>${esc(currentUser?.name || currentUser?.username || "النظام")} · ${esc(new Date().toLocaleString("ar-EG"))}</td></tr></tbody></table><table><tbody><tr><th>رصيد أول المدة</th><td>${report.summary.opening}</td><th>إجمالي الداخل</th><td>${periodRows.reduce((sum,row)=>sum+row.incoming,0)}</td><th>إجمالي الخارج</th><td>${periodRows.reduce((sum,row)=>sum+row.outgoing,0)}</td><th>رصيد آخر المدة</th><td>${report.summary.closing}</td></tr></tbody></table><table><thead><tr><th>التاريخ</th><th>الحركة</th><th>المستند</th><th>الطرف/السبب</th><th>داخل</th><th>خارج</th>${priceHeads}<th>قبل</th><th>بعد</th><th>الموظف</th><th>ملاحظات</th></tr></thead><tbody>${rows || `<tr><td colspan="12">لا توجد حركات مطابقة.</td></tr>`}</tbody></table>`;
}

function printProductMovementReport() {
  const report = productMovementReportData(productMovementState);
  if (!report) return toast("اختر صنفًا أولًا.", "error");
  printHtml(`حركة صنف — ${report.book.name}`, productMovementPrintMarkup(report), "a4");
}

function exportProductMovementCsv() {
  const report = productMovementReportData(productMovementState);
  if (!report) return toast("اختر صنفًا أولًا.", "error");
  const priceHeads = productMovementState.showPrices ? ["سعر الوحدة","القيمة", ...(report.canSeeCost ? ["تكلفة الوحدة"] : [])] : [];
  const rows = [["التقرير","حركة صنف"],["الصنف",report.book.name],["كود الصنف",report.book.id],["الباركود",report.book.barcode || ""],["من",report.range.from || "البداية"],["إلى",report.range.to || "الآن"],["رصيد أول المدة",report.summary.opening],["رصيد آخر المدة",report.summary.closing],[],["التاريخ والوقت","نوع الحركة","المستند","الطرف / السبب","داخل","خارج",...priceHeads,"قبل","بعد","الموظف","الحالة","ملاحظات"]];
  report.rows.forEach(row => rows.push([dateTimeLabel(row.date),productMovementTypeLabel(row.kind,row.type),row.documentId,row.partyName,row.incoming||"",row.outgoing||"",...(productMovementState.showPrices ? [row.unitPrice ?? "",row.totalValue ?? "",...(report.canSeeCost ? [row.unitCost ?? ""] : [])] : []),row.before,row.after,row.employee,row.status,row.note]));
  const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8" }));
  link.download = `product-movement-${report.book.id}-${today()}.csv`;
  link.click(); URL.revokeObjectURL(link.href);
}

function runProductMovementReportTests() {
  const originalUser = currentUser; const results = []; const check = (name, condition) => results.push({ name, ok:Boolean(condition) });
  data.books.filter(book=>!book.deletedAt).forEach(book => { const report = productMovementReportData({ ...productMovementState, bookId:book.id, quickRange:"all", from:"", to:"", type:"all", supplierId:"", customerId:"", employee:"", status:"", sort:"asc" }); check(`معادلة الرصيد: ${book.name}`, !report || report.summary.opening + report.allRows.reduce((sum,row)=>sum+row.incoming-row.outgoing,0) === report.summary.closing); });
  currentUser = { id:"QA-CASHIER", username:"qa-cashier", name:"كاشير اختبار", role:"كاشير" };
  const sampleBook = data.books.find(book=>!book.deletedAt);
  check("إخفاء التكلفة عن الكاشير", !sampleBook || productMovementReportData({ ...productMovementState, bookId:sampleBook.id })?.canSeeCost === false);
  currentUser = originalUser;
  check("حجم الصفحة 25 حركة", PRODUCT_MOVEMENT_PAGE_SIZE === 25);
  check("جميع الحركات مصنفة", !sampleBook || productMovementRows(sampleBook.id).every(row=>Boolean(row.kind && row.type)));
  return results;
}
window.runProductMovementReportTests = runProductMovementReportTests;

function renderReports() {
  const active = activeSalesList();
  const sales = active.reduce((s, i) => s + i.total, 0);
  const cogs = salesCogsSummary(active);
  const profit = sales - cogs.cost;
  const incompleteNote = cogs.incompleteLines ? ` · ${cogs.incompleteLines} سطر بتكلفة غير مكتملة` : "";
  const orderPaymentRows=(data.onlineOrders||[]).filter(order=>!order.deletedAt&&order.status!=="ملغي").map(order=>{const totals=onlineOrderTotals(order.lines||[],order.orderDiscount||0,order.orderDiscountType||"percent",order.shippingCost||0),payment=OrderFinance.calculatePayment(totals.total,Number(order.paidAmount||0));return {order,totals,payment};});
  const orderDiscounts=orderPaymentRows.reduce((sum,row)=>sum+row.totals.discountTotal,0),orderSubtotal=orderPaymentRows.reduce((sum,row)=>sum+row.totals.subtotal,0),advances=orderPaymentRows.reduce((sum,row)=>sum+row.payment.paidAmount,0),outstanding=orderPaymentRows.reduce((sum,row)=>sum+row.payment.remainingAmount,0);
  const reports = [
    ["المبيعات اليومية والشهرية", "↗", `إجمالي ${money(sales)} وربح FIFO ${money(profit)}${incompleteNote}.`],
    ["صافي الربح", "≋", `المبيعات ناقص تكلفة الأصناف والمصروفات.`],
    ["أكثر الأصناف مبيعًا", "•", "ترتيب الأصناف حسب الكميات المباعة."],
    ["المخزون وإعادة الطلب", "▤", `${data.books.filter(b => b.stock <= b.reorder).length} أصناف تحتاج قرار شراء.`],
    ["الأصناف الراكدة والمرتجعات", "↶", "تحليل آخر بيع وموعد الإرجاع لكل مورد."],
    ["مديونية العملاء", "👤", `إجمالي ${money(data.customers.reduce((s, i) => s + i.balance, 0))}.`],
    ["مديونية الموردين", "▦", `إجمالي ${money(data.suppliers.reduce((s, i) => s + i.balance, 0))}.`],
    ["أداء العروض والخصومات", "%", "قياس أثر الخصم على الكمية والربح الصافي."],
    ["الموسمية", "◇", "مقارنة موسم أغسطس–يوليو بالفترات السابقة."],
    ["الشحنات المتأخرة", "▣", `${data.shipments.filter(s => s.status !== "تم التسليم").length} شحنات غير مكتملة.`],
    ["المرتجعات", "↶", "الفواتير والشحنات والمشتريات الملغاة أو المرتجعة."],
    ["مرتجعات المبيعات حسب الفترة", "SR", "تحليل مرتجعات العملاء خلال الفترة الحالية."],
    ["مرتجعات المشتريات حسب الفترة", "PR", "تحليل مرتجعات الموردين خلال الفترة الحالية."],
    ["مرتجعات حسب العميل", "👤", "تجميع قيمة وعدد مرتجعات كل عميل."],
    ["مرتجعات حسب المورد", "▦", "تجميع قيمة وعدد مرتجعات كل مورد."],
    ["أكثر الأصناف المرتجعة", "↶", "ترتيب الأصناف حسب كميات المرتجع."],
    ["تأثير المرتجعات على الأرباح والمخزون", "≋", "قيمة المرتجعات وحركتها على المخزون والخزنة."],
    ["ربحية الصنف", "↗", "إيراد كل صنف مقابل تكلفة FIFO والربح الإجمالي."],
    ["ربحية المورد", "◆", "ربحية الأصناف حسب دفعات الموردين عند توفر batch allocations."],
    ["قيمة المخزون الحالية", "▤", "القيمة من remainingQty × unitCost لكل batch."],
    ["آخر سعر شراء", "₪", "آخر تكلفة شراء محسوبة لكل صنف."],
    ["متوسط تكلفة المخزون", "≋", "متوسط مرجح للدفعات المتبقية."],
    ["هامش الربح حسب سعر البيع الحالي", "%", "هامش متوقع من سعر البيع الافتراضي مقابل متوسط التكلفة."],
    ["العملاء المتوقفون", "◇", "قائمة العملاء الذين لم يشتروا خلال فترة محددة."],
    ["أفضل العملاء", "•", "أكثر العملاء شراءً وتعاملًا مع النظام، مع صافي التعاملات وآخر عملية."],
    ["أفضل الموردين", "◆", "أكثر الموردين توريدًا وتعاملًا مع النظام، مع المرتجعات والمتبقي."]
  ];
  root.innerHTML = `
    <div class="section-title">
      <div><h2>التقارير والتحليلات</h2><p>تقارير تساعدك على زيادة المبيعات وتقليل الراكد والمديونيات.</p></div>
      <div class="actions"><button class="btn ghost" onclick="window.print()">PDF / طباعة</button><button class="btn secondary" data-action="whatsapp-report">إرسال عبر WhatsApp</button></div>
    </div>
    <div class="metric-strip order-payment-report"><div class="mini-metric"><span>إجمالي خصومات الطلبات</span><strong>${money(orderDiscounts)}</strong></div><div class="mini-metric"><span>متوسط نسبة الخصم</span><strong>${orderSubtotal?OrderFinance.round(orderDiscounts*100/orderSubtotal):0}%</strong></div><div class="mini-metric"><span>مدفوع مقدمًا</span><strong>${money(advances)}</strong></div><div class="mini-metric"><span>متبقي للتحصيل</span><strong>${money(outstanding)}</strong></div><div class="mini-metric"><span>غير مدفوع</span><strong>${orderPaymentRows.filter(x=>x.payment.paymentStatus==="unpaid").length}</strong></div><div class="mini-metric"><span>جزئي / كامل</span><strong>${orderPaymentRows.filter(x=>x.payment.paymentStatus==="partially_paid").length} / ${orderPaymentRows.filter(x=>x.payment.paymentStatus==="paid").length}</strong></div></div>
    ${monthlySalesOverviewMarkup(active)}
    <div class="report-grid"><article class="card report-card featured-report"><div class="report-icon">↕</div><h3>حركة صنف</h3><p>عرض جميع عمليات الشراء والبيع والمرتجعات والتسويات والجرد لصنف محدد، مع الرصيد بعد كل حركة.</p><div class="row-actions"><button class="btn" data-action="open-product-movement">فتح التقرير</button></div></article>${reports.map((r, index) => `<article class="card report-card"><div class="report-icon">${r[1]}</div><h3>${r[0]}</h3><p>${r[2]}</p><div class="row-actions" style="margin-top:12px"><button class="btn ghost small" data-action="open-report" data-report="${index}">فتح</button><button class="btn ghost small" data-action="export-report" data-report="${index}">CSV</button></div></article>`).join("")}</div>`;
}

function renderHr() {
  root.innerHTML = `
    <div class="section-title">
      <div><h2>الموظفون والرواتب</h2><p>الوظائف والحضور والرواتب وصلاحية الوصول للنظام.</p></div>
      <button class="btn" data-action="add-employee">＋ إضافة موظف</button>
    </div>
    <div class="stats-grid">
      ${statCard("عدد الموظفين", data.employees.length, "قابل للزيادة", "▦")}
      ${statCard("الحاضرون اليوم", data.employees.filter(e => e.attendance === "حاضر").length, fmtDate(today()), "✓")}
      ${statCard("إجمالي الرواتب", money(data.employees.reduce((s, e) => s + e.salary, 0)), "القيمة الشهرية الحالية", "≋", "gold")}
      ${statCard("حسابات النظام", data.employees.length, "حسب الوظيفة والصلاحية", "⚙", "blue")}
    </div>
    <article class="card"><div class="table-wrap"><table><thead><tr><th>الموظف</th><th>الوظيفة</th><th>الحضور اليوم</th><th>الراتب</th><th>الصلاحيات</th><th></th></tr></thead><tbody>
      ${data.employees.filter(e => !e.deletedAt).map(e => `<tr><td><strong>${esc(e.name)}</strong><br><span class="muted">${e.id}</span></td><td>${badge(e.role, "blue")}</td><td>${badge(e.attendance, e.attendance !== "حاضر" ? "warning" : "")}</td><td class="money">${e.salary ? money(e.salary) : "—"}</td><td>${esc(e.permissions)}</td><td><div class="row-actions"><button class="row-action" data-action="view-employee" data-id="${e.id}">عرض</button><button class="row-action" data-action="edit-employee" data-id="${e.id}">تعديل</button><button class="row-action text-danger" data-action="delete-employee" data-id="${e.id}">حذف</button></div></td></tr>`).join("")}
    </tbody></table></div></article>`;
}

let seasonManagementState = { loading:true, error:"", seasons:[], activeSeason:null, openOperations:null, latestBackup:null, purgeEnabled:false, factoryResetEnabled:false };
let factoryResetState = { resetType:"business", preview:null, preparationId:"", backup:null, operationKey:"", countdown:10, timer:null };
let seasonWizardState = { step:1, name:"", academicYear:"", startsAt:today(), notes:"", preserve:{ customers:true, suppliers:true, users:true, permissions:true, shipping:true, governorates:true, financeTypes:true, cashAccounts:true, settings:true, templates:true, integrations:true, categories:false, grades:false, subjects:false, bookTemplates:false, oldPrices:false } };

function seasonStatusLabel(status) {
  return ({ active:"نشط", closed:"مغلق", archived:"مؤرشف", legacy:"بيانات سابقة" })[status] || status || "—";
}

function seasonManagementMarkup() {
  if (!canAction("manage_seasons")) return `<article class="card season-access-denied"><div class="card-body"><strong>إدارة الموسم والبيانات</strong><p>هذه الأدوات الحساسة متاحة لمالك النظام فقط.</p></div></article>`;
  if (seasonManagementState.loading) return `<article class="card season-management-card"><div class="card-body"><div class="loading-state">جارٍ تحميل حالة الموسم والنسخ الاحتياطية...</div></div></article>`;
  if (seasonManagementState.error) return `<article class="card season-management-card"><div class="card-body"><div class="notice danger">${esc(seasonManagementState.error)}</div><button class="btn ghost small" data-action="refresh-season-management">إعادة المحاولة</button></div></article>`;
  const activeSeason = seasonManagementState.activeSeason;
  const legacy = !activeSeason && seasonManagementState.seasons.find(item => item.runtimeOnly);
  const current = activeSeason || legacy;
  const open = seasonManagementState.openOperations || { total:0 };
  const backup = seasonManagementState.latestBackup;
  const inventoryMarker = data.meta?.inventoryBatchMigration;
  const markerCard = inventoryMarker
    ? `<article class="card inventory-marker-card marker-present"><div class="card-body"><div class="season-card-icon success">✓</div><span>Inventory Marker</span><h4>موجود</h4><p>تم تثبيت مؤشر المخزون بعد التنظيف. لا توجد تسوية مخزون مطلوبة.</p><div class="marker-details"><span>openingBatchesCreated</span><strong>${Number(inventoryMarker.openingBatchesCreated || 0)}</strong></div><div class="season-card-meta">${badge("موجود بالفعل · Idempotent", "gray")}<span>لن يتم اقتراح إنشاء Batches.</span></div></div></article>`
    : `<article class="card inventory-marker-card"><div class="card-body"><div class="season-card-icon blue">◇</div><span>Inventory Marker</span><h4>غير موجود</h4><p>تظهر المعاينة المعتادة فقط، ولا يتم تنفيذ أي Marker تلقائيًا.</p></div></article>`;
  return `<section class="season-management-section" aria-labelledby="season-management-title">
    <div class="season-section-heading"><div><span class="eyebrow">أدوات المالك</span><h3 id="season-management-title">إدارة الموسم والبيانات</h3><p>إغلاق موسمي دون حذف التاريخ، ومعاينة دقيقة للبيانات التجريبية قبل أي إجراء.</p></div><span class="safety-chip">الحذف المباشر غير متاح</span></div>
    <div class="season-management-grid">
      <article class="card season-current-card"><div class="card-body"><div class="season-card-icon blue">◷</div><span>الموسم الحالي</span><h4>${esc(current?.academicYear || "لم يبدأ موسم بعد")}</h4><p>${esc(current?.name || "البيانات الحالية تُقرأ كبيانات Legacy دون تعديلها")}</p><div class="season-card-meta">${badge(seasonStatusLabel(current?.status), current?.status === "active" ? "" : "gray")}<span>${open.total ? `${open.total} عملية مفتوحة` : "لا توجد عمليات مفتوحة"}</span></div><div class="season-card-actions"><button class="btn" data-action="start-season-wizard">بدء موسم جديد</button>${activeSeason ? `<button class="btn ghost" data-action="close-season" data-id="${esc(activeSeason.id)}">إغلاق الموسم</button>` : ""}<button class="row-action" data-action="view-seasons">عرض التفاصيل</button></div></div></article>
      <article class="card demo-cleanup-card"><div class="card-body"><div class="season-card-icon warning">⌁</div><span>تنظيف البيانات التجريبية</span><h4>معاينة مترابطة قبل الحذف</h4><p>يحدد الكتب المعتمدة وكل الطلبات والفواتير والشحنات والحركات التابعة، ويوقف العملية عند وجود سجل مختلط.</p><div class="season-card-actions"><button class="btn secondary" data-action="preview-demo-data">معاينة البيانات التجريبية</button><small>لا يتم الحذف من شاشة المعاينة.</small></div></div></article>
      ${markerCard}
      <article class="card backup-status-card"><div class="card-body"><div class="season-card-icon success">▣</div><span>النسخ الاحتياطي</span><h4>${backup ? "آخر نسخة متاحة" : "لا توجد نسخة معروفة"}</h4><p>${backup ? `${dateTimeLabel(backup.date)} · ${Math.ceil(backup.size / 1024)} KB` : "Backup Guard إلزامي قبل أي Purge أو Reset."}</p><div class="season-card-actions"><button class="btn ghost" data-action="backup-db">إنشاء نسخة الآن</button>${backup ? `<span class="backup-ok">صالحة للعرض</span>` : ""}</div></div></article>
    </div>
    ${canAction("factory_reset_system") ? `<section class="factory-reset-zone" aria-labelledby="factory-reset-title"><div class="factory-reset-warning"><div><span class="danger-badge">خطر جدًا</span><h4 id="factory-reset-title">إعادة ضبط النظام بالكامل</h4><p>هذا الإجراء يحذف جميع بيانات التشغيل نهائيًا ويجعل النظام يبدأ من جديد. لا يمكن التراجع إلا من خلال نسخة احتياطية.</p></div><button class="btn danger" data-action="open-factory-reset">فتح أداة إعادة الضبط</button></div></section>` : ""}
  </section>`;
}

async function loadSeasonManagementStatus() {
  if (!canAction("manage_seasons") || !serverConnected) return;
  try {
    const response = await fetch("/api/admin/season-data", { headers:authHeaders(), cache:"no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر تحميل إدارة الموسم.");
    seasonManagementState = { loading:false, error:"", ...result };
  } catch (error) { seasonManagementState = { ...seasonManagementState, loading:false, error:error.message }; }
  const slot = document.getElementById("season-management-slot");
  if (slot) slot.innerHTML = seasonManagementMarkup();
}

function demoPreviewRows(preview) {
  const labels = { books:"كتب", onlineOrders:"طلبات", sales:"فواتير بيع", purchases:"فواتير شراء", shipments:"شحنات", orderPayments:"مدفوعات", orderCollections:"تحصيلات", cash:"حركات مالية", stockMovements:"حركات مخزون", inventoryBatches:"دفعات مخزون", reservations:"حجوزات", complaints:"شكاوى", notifications:"إشعارات", trackingHistory:"سجل تتبع", trackingRuns:"عمليات تتبع", audit:"سجل تدقيق", returns:"مرتجعات" };
  return Object.entries(preview.counts || {}).filter(([,count]) => count > 0).map(([key,count]) => `<div class="preview-count"><strong>${count}</strong><span>${esc(labels[key] || key)}</span></div>`).join("");
}

function demoPreviewIsClean(preview) {
  const demoKeys = ["books","onlineOrders","sales","shipments","orderPayments","cash","stockMovements","inventoryBatches","reservations","complaints","notifications","trackingHistory","trackingRuns"];
  const noScopedRecords = demoKeys.every(key => Number(preview.counts?.[key] || 0) === 0);
  const b004Missing = preview.inventoryExceptions?.every(item => !item.fingerprint || item.fingerprint.stock === null) !== false;
  const seedMissing = preview.explicitSeedRecords?.every(item => !item.fingerprint) !== false;
  return noScopedRecords && (preview.detectedProductIds || []).length === 0 && b004Missing && seedMissing && !(preview.blockedRecords || []).length;
}

async function previewDemoData() {
  openModal("معاينة البيانات التجريبية", "Dry Run — بدون حذف", `<div class="loading-state">جارٍ تحليل العلاقات دون تغيير البيانات...</div>`);
  try {
    const response = await fetch("/api/admin/demo-data/preview", { headers:authHeaders(), cache:"no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر إنشاء المعاينة.");
    const preview = result.preview;
    const cleanState = demoPreviewIsClean(preview);
    if (cleanState) {
      modalBody.innerHTML = `<div class="preview-integrity ok"><strong>✓ لم تتغير قاعدة البيانات</strong><span>تم فحص قائمة IDs المعتمدة فقط: لا توجد</span></div><div class="notice success demo-clean-state"><strong>لا توجد بيانات تجريبية للحذف — تم تنظيف النظام</strong><span>لا توجد منتجات أو طلبات أو فواتير أو شحنات أو حركات Demo ضمن النطاق المعتمد.</span></div><div class="form-actions"><button class="btn ghost" data-action="close-modal">إغلاق المعاينة</button><button class="btn" disabled>لا توجد بيانات للحذف</button></div>`;
      return;
    }
    const inventoryExceptions = (preview.inventoryExceptions || []).map(item => item.accepted
      ? `<div class="notice warning"><strong>فرق مخزون محصور داخل Demo Scope</strong><span>يوجد فرق مخزون واحد داخل البيانات التجريبية المعتمدة: B004 — مخزون -1 دون Batch.<br>سيتم إزالة المنتج والحركة والطلب والفاتورة والشحنة المرتبطة ضمن عملية الحذف.<br>لن يتم إنشاء تسوية مخزون أو Batch لهذا الصنف.</span><small>${esc(item.code)} · ${esc(item.status)}</small></div>`
      : `<div class="notice danger"><strong>تم منع التنفيذ بسبب اختلاف Fingerprint</strong><span>${(item.reasons || []).map(esc).join(" — ")}</span></div>`).join("");
    const seedRecords = (preview.explicitSeedRecords || []).map(item => item.accepted
      ? `<div class="notice warning"><strong>سجلات Seed تجريبية مستقلة</strong><span><b>SH-207</b> — مرجع فاتورة غير موجود: INV-1043.<br>لا أثر مالي، لا تتبع فعلي، ولا عميل مسجل.<br>الحالة: سجل Seed تجريبي معتمد للحذف.</span><small>${esc(item.code)} · ${esc(item.status)}</small></div>`
      : `<div class="notice danger"><strong>SH-207 غير مطابقة للـFingerprint المعتمد</strong><span>${(item.reasons || []).map(esc).join(" — ")}</span></div>`).join("");
    modalBody.innerHTML = `<div class="preview-integrity ${result.dataUnchanged ? "ok" : "danger"}"><strong>${result.dataUnchanged ? "✓ لم تتغير قاعدة البيانات" : "! تغير غير متوقع"}</strong><span>تم فحص قائمة IDs المعتمدة فقط: ${preview.detectedProductIds.map(esc).join("، ") || "لا توجد"}</span></div><div class="preview-count-grid">${demoPreviewRows(preview)}</div>${inventoryExceptions}${seedRecords}${preview.blockedRecords.length ? `<div class="blocked-records"><h3>سجلات مختلطة تمنع التنفيذ</h3>${preview.blockedRecords.map(item => `<div><strong>${esc(item.collection)} · ${esc(item.id)}</strong><span>${esc(item.reason)}</span></div>`).join("")}</div>` : `<div class="notice success">لا توجد سجلات مختلطة في المعاينة الحالية. التنفيذ يظل معطلًا حتى اعتماد المستخدم ونجاح Backup Guard.</div>`}<div class="form-actions"><button class="btn ghost" data-action="close-modal">إغلاق المعاينة</button><button class="btn" disabled title="الحذف غير متاح في مرحلة التطوير">الحذف غير متاح محليًا</button></div>`;
  } catch (error) { modalBody.innerHTML = `<div class="notice danger">${esc(error.message)}</div><div class="form-actions"><button class="btn ghost" data-action="close-modal">إغلاق</button></div>`; }
}

const factoryResetLabels = {
  books:"الأصناف", customers:"العملاء", suppliers:"الموردون", onlineOrders:"طلبات الأونلاين", orders:"الطلبات",
  sales:"فواتير البيع", purchases:"فواتير الشراء", shipments:"الشحنات", orderPayments:"المدفوعات", cash:"حركات الخزنة",
  stockMovements:"حركات المخزون", inventoryBatches:"دفعات المخزون", notifications:"الإشعارات", trackingHistory:"سجل التتبع",
  trackingRuns:"عمليات التتبع", expenses:"المصروفات", otherIncome:"الإيرادات الأخرى", audit:"سجل التدقيق",
  users:"المستخدمون", settings:"الإعدادات", shippingCompanies:"شركات الشحن", governorates:"المحافظات وأسعار الشحن",
  cashAccounts:"الخزائن", expenseTypes:"أنواع المصروفات", incomeTypes:"أنواع الإيرادات", integrations:"التكاملات"
};

function resetTypeComparison(selected = "business") {
  return `<div class="reset-type-grid">
    <label class="reset-type-card recommended ${selected === "business" ? "selected" : ""}"><input type="radio" name="resetType" value="business" ${selected === "business" ? "checked" : ""}><span class="reset-type-title"><strong>بيانات التشغيل فقط</strong><em>موصى به</em></span><p>يمسح المبيعات والمشتريات والمخزون والشحن والمالية، ويحافظ على المستخدمين والعملاء والموردين وإعدادات التشغيل.</p></label>
    <label class="reset-type-card dangerous ${selected === "factory" ? "selected" : ""}"><input type="radio" name="resetType" value="factory" ${selected === "factory" ? "checked" : ""}><span class="reset-type-title"><strong>Factory Reset كامل</strong><em>متقدم وخطير</em></span><p>يمسح كل بيانات العمل تقريبًا، مع الحفاظ على مالك واحد وإعدادات وصلاحيات الدخول الأساسية فقط.</p></label>
  </div>`;
}

function openFactoryReset() {
  if (!canAction("factory_reset_system")) return toast("هذه الأداة متاحة للمالك فقط.", "danger");
  factoryResetState = { resetType:"business", preview:null, preparationId:"", backup:null, operationKey:`RESET-${Date.now()}-${cryptoRandomToken()}`, countdown:10, timer:null };
  openModal("إعادة ضبط النظام بالكامل", "إجراء إداري غير قابل للتراجع", `<div class="factory-reset-dialog"><div class="notice danger"><strong>تحذير نهائي قبل البدء</strong><span>لن يُسمح بالتنفيذ قبل Preview كامل وBackup مطابق وتأكيد الهوية والعبارة المطلوبة.</span></div>${resetTypeComparison()}<div class="form-actions"><button class="btn danger" data-action="factory-reset-preview">إنشاء Preview آمن</button><button class="btn ghost" data-action="close-modal">إلغاء</button></div></div>`);
}

function cryptoRandomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

function resetCountsMarkup(counts = {}) {
  const rows = Object.entries(counts).filter(([,value]) => Number(value) > 0);
  return rows.length ? `<div class="preview-count-grid">${rows.map(([key,value]) => `<div class="preview-count"><strong>${Number(value)}</strong><span>${esc(factoryResetLabels[key] || key)}</span></div>`).join("")}</div>` : `<div class="empty-state compact">لا توجد سجلات ضمن هذا البند.</div>`;
}

async function factoryResetPreview() {
  const selected = document.querySelector('input[name="resetType"]:checked')?.value || "business";
  factoryResetState.resetType = selected;
  modalBody.innerHTML = `<div class="loading-state">جارٍ إنشاء Preview دون أي تعديل للبيانات...</div>`;
  try {
    const response = await fetch("/api/admin/factory-reset/preview", { method:"POST", headers:authHeaders({ "Content-Type":"application/json" }), body:JSON.stringify({ resetType:selected }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر إنشاء Preview.");
    factoryResetState.preview = result.preview;
    const p = result.preview;
    modalBody.innerHTML = `<div class="factory-reset-dialog"><div class="preview-integrity ${result.dataUnchanged ? "ok" : "danger"}"><strong>${result.dataUnchanged ? "✓ Preview فقط — البيانات لم تتغير" : "تم رصد تغير غير متوقع"}</strong><span>${p.type === "business" ? "بيانات التشغيل فقط" : "Factory Reset كامل"}</span></div><h3>سيتم حذف</h3>${resetCountsMarkup(p.deletedCounts)}<details class="reset-details"><summary>القائمة الكاملة للحذف</summary><p>${p.deleteKeys.map(key => esc(factoryResetLabels[key] || key)).join("، ")}</p></details><h3>سيتم الاحتفاظ بـ</h3>${resetCountsMarkup(p.preservedCounts)}${p.executable ? `<div class="notice warning">الخطوة التالية تنشئ Backup إلزاميًا وتتحقق من SHA قبل إتاحة التأكيد.</div>` : `<div class="notice danger">${esc(p.blockedReason)}</div>`}<div class="form-actions"><button class="btn danger" data-action="factory-reset-prepare" ${p.executable ? "" : "disabled"}>إنشاء Backup والمتابعة</button><button class="btn ghost" data-action="open-factory-reset">رجوع</button></div></div>`;
  } catch (error) { modalBody.innerHTML = `<div class="notice danger">${esc(error.message)}</div><div class="form-actions"><button class="btn ghost" data-action="open-factory-reset">رجوع</button></div>`; }
}

async function factoryResetPrepare() {
  modalBody.innerHTML = `<div class="loading-state">جارٍ إنشاء Backup والتحقق من الحجم وSHA...</div>`;
  try {
    const response = await fetch("/api/admin/factory-reset/prepare", { method:"POST", headers:authHeaders({ "Content-Type":"application/json" }), body:JSON.stringify({ resetType:factoryResetState.resetType }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "فشل Backup Guard.");
    factoryResetState.preparationId = result.preparationId; factoryResetState.backup = result.backup;
    const enabled = Boolean(result.resetEnabled);
    modalBody.innerHTML = `<form id="factory-reset-confirm-form" class="factory-reset-dialog"><div class="notice success"><strong>✓ Backup جاهز ومطابق للمصدر</strong><span>${Math.ceil(Number(result.backup.backupSize || 0) / 1024)} KB · المرجع: ${esc(result.backup.reference)}</span></div><div class="form-grid"><div class="form-field full"><label class="required">اكتب عبارة التأكيد حرفيًا</label><input name="confirmationPhrase" autocomplete="off" placeholder="إعادة ضبط النظام بالكامل" required></div><div class="form-field full"><label class="required">اكتب اسم المستخدم الحالي للتأكيد</label><input name="currentUsername" autocomplete="off" placeholder="${esc(currentUser?.username || "")}" required></div></div><div class="notice warning"><strong>التأكيد الأول</strong><span>بعد المتابعة ستظهر نافذة تأكيد ثانية مع انتظار 10 ثوانٍ.</span></div>${enabled ? "" : `<div class="notice info">التنفيذ الحقيقي غير مفعّل حاليًا. يمكن إجراء Preview وBackup فقط.</div>`}<div class="form-actions"><button class="btn danger" type="submit" ${enabled ? "" : "disabled"}>المتابعة للتأكيد النهائي</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div></form>`;
  } catch (error) { modalBody.innerHTML = `<div class="notice danger"><strong>BLOCKED</strong><span>${esc(error.message)}</span></div><div class="form-actions"><button class="btn ghost" data-action="open-factory-reset">العودة</button></div>`; }
}

function openFactoryResetFinalConfirmation(values, executeAfter) {
  clearInterval(factoryResetState.timer);
  factoryResetState.countdown = Math.max(0, Math.ceil((Number(executeAfter) - Date.now()) / 1000));
  openModal("التأكيد الثاني والأخير", "سيتم تسجيل العملية في Audit Log", `<div class="factory-reset-final"><span class="danger-badge">خطر جدًا</span><h3>هل أنت متأكد تمامًا؟</h3><p>سيبدأ ${factoryResetState.resetType === "business" ? "Reset بيانات التشغيل" : "Factory Reset الكامل"} بعد التأكيد. الاستعادة لا تتم إلا من النسخة الاحتياطية.</p><div class="reset-countdown"><strong id="factory-reset-countdown">${factoryResetState.countdown}</strong><span>ثوانٍ قبل تفعيل التنفيذ</span></div><div class="form-actions"><button id="factory-reset-execute" class="btn danger" data-action="factory-reset-execute" disabled>تنفيذ إعادة الضبط</button><button class="btn ghost" data-action="close-modal">تراجع آمن</button></div></div>`);
  factoryResetState.confirmationPhrase = values.confirmationPhrase;
  factoryResetState.currentUsername = values.currentUsername;
  factoryResetState.timer = setInterval(() => {
    factoryResetState.countdown = Math.max(0, Math.ceil((Number(executeAfter) - Date.now()) / 1000));
    const label = document.getElementById("factory-reset-countdown"), button = document.getElementById("factory-reset-execute");
    if (label) label.textContent = String(Math.max(0, factoryResetState.countdown));
    if (factoryResetState.countdown <= 0) { clearInterval(factoryResetState.timer); if (button) button.disabled = false; }
  }, 1000);
}

async function executeFactoryReset(button) {
  button.disabled = true; button.textContent = "جارٍ التنفيذ والتحقق...";
  try {
    const response = await fetch("/api/admin/factory-reset/execute", { method:"POST", headers:authHeaders({ "Content-Type":"application/json" }), body:JSON.stringify({ resetType:factoryResetState.resetType, preparationId:factoryResetState.preparationId, confirmationPhrase:factoryResetState.confirmationPhrase, currentUsername:factoryResetState.currentUsername, operationKey:factoryResetState.operationKey }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر تنفيذ إعادة الضبط.");
    localStorage.removeItem("sessionToken");
    location.replace("/");
  } catch (error) { button.disabled = false; button.textContent = "إعادة المحاولة"; toast(error.message, "danger"); }
}

function openSeasonWizard(step = 1) {
  seasonWizardState.step = step;
  const preserveLabels = { customers:"العملاء", suppliers:"الموردون", users:"المستخدمون", permissions:"الصلاحيات", shipping:"شركات الشحن", governorates:"المحافظات وأسعار الشحن", financeTypes:"أنواع المصروفات والإيرادات", cashAccounts:"الخزائن والحسابات", settings:"إعدادات النظام", templates:"قوالب الرسائل", integrations:"التكاملات", categories:"التصنيفات", grades:"الصفوف الدراسية", subjects:"المواد", bookTemplates:"بيانات الكتب كقوالب دون مخزون", oldPrices:"الأسعار القديمة كمرجع" };
  let body = "";
  if (step === 1) body = `<form id="season-step-one"><div class="form-grid"><div class="form-field"><label class="required">اسم الموسم</label><input name="name" required value="${esc(seasonWizardState.name)}" placeholder="موسم المدارس 2026/2027"></div><div class="form-field"><label class="required">السنة الدراسية</label><input name="academicYear" required value="${esc(seasonWizardState.academicYear)}" placeholder="2026/2027"></div><div class="form-field"><label class="required">تاريخ البداية</label><input name="startsAt" type="date" required value="${esc(seasonWizardState.startsAt)}"></div><div class="form-field full"><label>ملاحظات</label><textarea name="notes">${esc(seasonWizardState.notes)}</textarea></div></div><div class="form-actions"><button class="btn" type="submit">التالي: ما نحتفظ به</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div></form>`;
  if (step === 2) body = `<form id="season-step-two"><div class="preserve-grid">${Object.entries(preserveLabels).map(([key,label],index) => `<label class="preserve-option ${index < 11 ? "recommended" : "optional"}"><input type="checkbox" name="${key}" ${seasonWizardState.preserve[key] ? "checked" : ""} ${index < 11 ? "disabled" : ""}><span><strong>${esc(label)}</strong><small>${index < 11 ? "سيتم الاحتفاظ به" : "اختياري"}</small></span></label>`).join("")}</div><div class="notice warning">لن ينتقل المخزون أو الحجوزات أو الطلبات أو الفواتير أو الشحنات أو حركات المخزون تلقائيًا.</div><div class="form-actions"><button class="btn" type="submit">التالي: المراجعة</button><button class="btn ghost" type="button" data-action="season-wizard-back" data-step="1">رجوع</button></div></form>`;
  if (step === 3) {
    const kept = Object.entries(seasonWizardState.preserve).filter(([,value]) => value).map(([key]) => preserveLabels[key]);
    const open = seasonManagementState.openOperations || { total:0 };
    body = `<div class="season-review"><div class="review-line"><span>الموسم</span><strong>${esc(seasonWizardState.name)}</strong></div><div class="review-line"><span>السنة</span><strong>${esc(seasonWizardState.academicYear)}</strong></div><div class="review-line"><span>البداية</span><strong>${esc(seasonWizardState.startsAt)}</strong></div><div class="review-block"><span>سيتم الاحتفاظ بـ</span><p>${kept.map(esc).join("، ")}</p></div><div class="review-block"><span>يبدأ من صفر</span><p>مخزون الكتب الجديدة، الحجوزات، والحركات الجديدة.</p></div>${open.total ? `<div class="notice danger">يوجد ${open.total} عمليات مفتوحة. لن يبدأ الموسم إلا بعد معالجتها أو إغلاق إداري بسبب إلزامي.</div><label class="preserve-option"><input id="season-admin-override" type="checkbox"><span><strong>إغلاق إداري بصلاحية المالك</strong><small>يتطلب سببًا واضحًا في سجل التدقيق</small></span></label><div class="form-field"><label>سبب الإغلاق الإداري</label><textarea id="season-override-reason"></textarea></div>` : `<div class="notice success">لا توجد عمليات مفتوحة تمنع البدء.</div>`}<div class="form-actions"><button class="btn" data-action="confirm-start-season">تأكيد وبدء الموسم</button><button class="btn ghost" data-action="season-wizard-back" data-step="2">رجوع</button></div></div>`;
  }
  openModal("بدء موسم دراسي جديد", `الخطوة ${step} من 3`, `<div class="wizard-progress"><span class="${step >= 1 ? "active" : ""}">1</span><i></i><span class="${step >= 2 ? "active" : ""}">2</span><i></i><span class="${step >= 3 ? "active" : ""}">3</span></div>${body}`);
}

async function confirmStartSeason(button) {
  const administrativeOverride = Boolean(document.getElementById("season-admin-override")?.checked);
  const reason = document.getElementById("season-override-reason")?.value.trim() || "";
  if (administrativeOverride && !reason) return toast("اكتب سبب الإغلاق الإداري.", "error");
  button.disabled = true;
  try {
    const response = await fetch("/api/admin/seasons/start", { method:"POST", headers:authHeaders({ "Content-Type":"application/json" }), body:JSON.stringify({ ...seasonWizardState, administrativeOverride, reason }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر بدء الموسم.");
    closeModal(); seasonManagementState.loading = true; await reloadRemoteData(); renderSettings(); toast(`تم بدء الموسم ${result.season.academicYear}.`);
  } catch (error) { button.disabled = false; toast(error.message, "error"); }
}

function closeSeasonModal(id) {
  const open = seasonManagementState.openOperations || { total:0 };
  openModal("إغلاق الموسم الحالي", "إجراء حساس قابل للتدقيق", `<form id="close-season-form" data-id="${esc(id)}">${open.total ? `<div class="notice danger">لا يمكن الإغلاق العادي: يوجد ${open.orders?.length || 0} طلبات، ${open.shipments?.length || 0} شحنات، ${open.collections?.length || 0} تحصيلات و${open.finance?.length || 0} تسويات مفتوحة.</div><label class="preserve-option"><input name="administrativeOverride" type="checkbox"><span><strong>إغلاق إداري بصلاحية المالك</strong><small>لا يحذف العمليات؛ يسجل السبب ويحفظ التاريخ.</small></span></label><div class="form-field"><label class="required">سبب الإغلاق الإداري</label><textarea name="reason"></textarea></div>` : `<div class="notice success">لا توجد عمليات مفتوحة تمنع إغلاق الموسم.</div><div class="form-field"><label>ملاحظة الإغلاق</label><textarea name="reason"></textarea></div>`}<label class="preserve-option"><input name="archive" type="checkbox"><span><strong>أرشفة الموسم بعد الإغلاق</strong><small>يبقى متاحًا للتقارير والقراءة.</small></span></label><div class="form-actions"><button class="btn danger" type="submit">تأكيد الإغلاق</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div></form>`);
}

async function submitCloseSeason(form) {
  const values = Object.fromEntries(new FormData(form));
  const payload = { reason:String(values.reason || "").trim(), administrativeOverride:values.administrativeOverride === "on", archive:values.archive === "on" };
  if (payload.administrativeOverride && !payload.reason) return toast("سبب الإغلاق الإداري إلزامي.", "error");
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const response = await fetch(`/api/admin/seasons/${encodeURIComponent(form.dataset.id)}/close`, { method:"POST", headers:authHeaders({ "Content-Type":"application/json" }), body:JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر إغلاق الموسم.");
    closeModal(); seasonManagementState.loading = true; await reloadRemoteData(); renderSettings(); toast("تم إغلاق الموسم مع الاحتفاظ بكامل تاريخه.");
  } catch (error) { button.disabled = false; toast(error.message, "error"); }
}

function showSeasons() {
  const seasons = seasonManagementState.seasons || [];
  openModal("المواسم", "السجل الموسمي", `<div class="season-timeline">${seasons.map(item => `<article><span></span><div><strong>${esc(item.name)}</strong><small>${esc(item.academicYear)} · ${seasonStatusLabel(item.status)}</small><p>${item.runtimeOnly ? "عرض Runtime فقط؛ لم تتم إضافة seasonId للسجلات القديمة." : `${fmtDate(item.startsAt)}${item.endsAt ? ` — ${fmtDate(item.endsAt)}` : ""}`}</p></div></article>`).join("")}</div><div class="form-actions"><button class="btn ghost" data-action="close-modal">إغلاق</button></div>`);
}

function renderSettings() {
  const permissions = permissionSettings();
  const users = (data.users || []).filter(user => user.active !== false);
  root.innerHTML = `
    <div class="section-title"><div><h2>الإعدادات والصلاحيات</h2><p>ضبط سياسات النظام والأدوار وحدود الموافقة.</p></div><div class="actions"><button class="btn ghost" data-action="backup-db">نسخة احتياطية</button><button class="btn ghost" data-action="restore-db">استعادة نسخة</button><button class="btn secondary" data-action="audit-log">سجل العمليات</button><button class="btn" data-action="save-settings">حفظ الإعدادات</button></div></div>
    <div id="season-management-slot">${seasonManagementMarkup()}</div>
    <div class="split-grid">
      <article class="card"><div class="card-header"><div><h3>إعدادات النشاط</h3><p>البيانات الأساسية وسياسات التشغيل</p></div></div><div class="card-body">
        <div class="form-grid">
          <div class="form-field"><label>اسم النشاط</label><input id="setting-name" value="${esc(data.settings.companyName)}"></div>
          <div class="form-field"><label>العملة</label><input id="setting-currency" value="${esc(data.settings.currency)}"></div>
          <div class="form-field"><label>بداية الموسم</label><select id="setting-season"><option value="8" selected>أغسطس</option><option value="1">يناير</option></select></div>
          <div class="form-field"><label>الصنف راكد بعد</label><select id="setting-stale"><option value="90" ${data.settings.staleDays === 90 ? "selected" : ""}>90 يوم</option><option value="120" ${data.settings.staleDays === 120 ? "selected" : ""}>120 يوم</option><option value="180" ${data.settings.staleDays === 180 ? "selected" : ""}>180 يوم</option></select></div>
          <div class="form-field"><label>موافقة خصم أكبر من</label><input id="setting-discount" type="number" value="${data.settings.approvalDiscount}"></div>
          <div class="form-field"><label>المخزون السالب</label><select id="setting-negative"><option value="true" ${data.settings.allowNegativeStock ? "selected" : ""}>مسموح بصلاحية</option><option value="false" ${!data.settings.allowNegativeStock ? "selected" : ""}>غير مسموح</option></select></div>
        </div>
      </div></article>
      <article class="card"><div class="card-header"><div><h3>التكاملات</h3><p>تُفعّل عند تجهيز حسابات الخدمات</p></div></div><div class="card-body alert-list">
        <div class="alert-item"><div class="alert-badge blue">●</div><div><strong>المتجر الإلكتروني</strong><span>مزامنة المنتجات والأسعار والمخزون والطلبات — يحتاج تحديد منصة المتجر وبيانات الربط.</span></div>${badge("بانتظار الربط","warning")}</div>
        <div class="alert-item"><div class="alert-badge">▣</div><div><strong>شركات الشحن</strong><span>جاهز لتسجيل الأكواد والحالات يدويًا، ويمكن ربط API لاحقًا.</span></div>${badge("جزئي","blue")}</div>
        <div class="alert-item"><div class="alert-badge red">▧</div><div><strong>الفاتورة الإلكترونية المصرية</strong><span>غير مفعلة لأن النشاط غير منضم حاليًا للمنظومة.</span></div>${badge("غير مفعلة","gray")}</div>
        <div class="alert-item"><div class="alert-badge blue">◎</div><div><strong>تقارير WhatsApp</strong><span>يحتاج رقم المستلم وحساب WhatsApp Business API.</span></div>${badge("بانتظار الربط","warning")}</div>
      </div></article>
    </div>
    <article class="card" style="margin-top:18px"><div class="card-header"><div><h3>حالة خدمة التتبع</h3><p>الاتصال، آخر تحديث، والمهام المعلقة.</p></div></div>
      <div class="metric-strip">
        <div class="mini-metric"><span>حالة الخدمة</span><strong id="settings-tracking-state">جارٍ التحقق...</strong></div>
        <div class="mini-metric"><span>آخر اتصال ناجح</span><strong id="settings-tracking-last-success">—</strong></div>
        <div class="mini-metric"><span>آخر عملية تتبع</span><strong>${esc(dateTimeLabel((data.trackingRuns || []).at(-1)?.finishedAt) || "—")}</strong></div>
        <div class="mini-metric"><span>المهام المعلقة</span><strong id="settings-tracking-pending">—</strong></div>
        <div class="mini-metric"><span>إجراءات</span><strong><button class="row-action" data-action="test-local-rpa">اختبار الاتصال</button> <button class="row-action" data-action="retry-pending-tracking">إعادة المحاولة</button></strong></div>
      </div>
      <div class="form-grid" style="margin-top:14px">
        <div class="form-field"><label>أقل فاصل لنفس الشحنة</label><select id="tracking-min-interval">${[1,3,6,12,24].map(h => `<option value="${h}" ${Number(data.settings.tracking.minIntervalHours) === h ? "selected" : ""}>${h} ساعة</option>`).join("")}</select></div>
        <div class="form-field"><label>التأخير بين الطلبات</label><input id="tracking-min-delay" type="number" min="5" value="${data.settings.tracking.minDelaySeconds || 15}"><small>بالثواني لحماية موقع البريد من الضغط.</small></div>
        <div class="form-field"><label>أقصى محاولات</label><input id="tracking-max-attempts" type="number" min="1" value="${data.settings.tracking.maxAttempts || 5}"></div>
        <div class="form-field"><label>فترة التحديث التلقائي</label><select id="tracking-interval">${[1,3,6,12,24].map(h => `<option value="${h}" ${Number(data.settings.tracking.intervalHours) === h ? "selected" : ""}>كل ${h} ساعة</option>`).join("")}</select></div>
        <div class="form-field"><label>بدون حركة بعد</label><input id="tracking-no-movement" type="number" min="1" value="${data.settings.tracking.noMovementHours}"></div>
        <div class="form-field"><label>مرشحة لشكوى بعد</label><input id="tracking-complaint-hours" type="number" min="1" value="${data.settings.tracking.complaintNoMovementHours}"></div>
        <div class="form-field"><label>نوع التكامل</label><select id="tracking-provider-type"><option ${data.settings.tracking.providerType === "Not Available" ? "selected" : ""}>Not Available</option><option ${data.settings.tracking.providerType === "Official API" ? "selected" : ""}>Official API</option><option ${data.settings.tracking.providerType === "Official Endpoint" ? "selected" : ""}>Official Endpoint</option><option ${data.settings.tracking.providerType === "Third-party API" ? "selected" : ""}>Third-party API</option></select></div>
        <div class="form-field full"><label>Provider Endpoint اختياري</label><input id="tracking-provider-endpoint" value="${esc(data.settings.tracking.providerEndpoint || "")}" placeholder="مثال: https://provider.example/track/{trackingNumber}"><small>اتركه فارغًا إذا لا يوجد API رسمي. لن يتم إنشاء تتبع وهمي.</small></div>
        <div class="form-field"><label>اختبار رقم تتبع</label><input id="tracking-test-number" value="ENO33289190EG"></div>
        <div class="form-field"><label>اختبار الاتصال</label><button class="btn secondary" type="button" data-action="test-tracking-connection">اختبار اتصال</button><small id="tracking-test-result">مصدر بيانات التتبع المستخدم فعليًا: ${esc(data.settings.tracking.providerEndpoint || "Not Available")}</small></div>
      </div>
    </article>
    <article class="card" style="margin-top:18px"><div class="card-header"><div><h3>صلاحيات المستخدمين</h3><p>تحكم مباشر في صلاحيات كل حساب: الشاشات المسموحة والإجراءات التفصيلية.</p></div><span class="badge blue">${users.length} مستخدم</span></div><div class="table-wrap"><table><thead><tr><th>المستخدم</th><th>الدور</th><th>الصلاحيات الحالية</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${users.map(user => {
        const perms = effectivePermissionsForUser(user);
        const isCustom = Boolean(permissions.users[user.username]);
        return `<tr><td><strong>${esc(user.name || user.username)}</strong><br><span class="muted">${esc(user.username)} · ${esc(user.id || "")}</span></td><td>${badge(user.role, "blue")}</td><td><strong>${permissionSummary(perms)}</strong><br><span class="muted">${isCustom ? "مخصص لهذا المستخدم" : "يرث صلاحيات الدور"}</span></td><td>${badge(user.active !== false ? "نشط" : "موقوف", user.active !== false ? "" : "gray")}</td><td><button class="row-action" data-action="customize-user" data-username="${esc(user.username)}">تخصيص المستخدم</button></td></tr>`;
      }).join("")}
    </tbody></table></div></article>
    <article class="card" style="margin-top:18px"><div class="card-header"><div><h3>الأدوار الوظيفية</h3><p>الصلاحيات الافتراضية التي يرثها المستخدم حسب دوره.</p></div></div><div class="table-wrap"><table><thead><tr><th>الدور</th><th>النطاق المقترح</th><th>الصلاحيات</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${ROLE_DEFINITIONS.map(role => {
        const perms = rolePermissions(role.id);
        const isCustom = Boolean(permissions.roles[role.id]);
        return `<tr><td><strong>${esc(role.label)}</strong><br><span class="muted">${esc(role.id)}</span></td><td>${esc(role.scope)}</td><td><strong>${permissionSummary(perms)}</strong><br><span class="muted">${isCustom ? "تم تخصيص الدور" : "إعداد افتراضي"}</span></td><td>${badge("مفعّل")}</td><td><button class="row-action" data-action="customize-role" data-role="${esc(role.id)}">تخصيص الدور</button></td></tr>`;
      }).join("")}
    </tbody></table></div></article>`;
  updateSettingsTrackingStatus();
  loadSeasonManagementStatus();
}

function omniHeaders(extra = {}) {
  return authHeaders({ "Content-Type": "application/json; charset=utf-8", ...extra });
}

async function omniApi(path, options = {}) {
  let response;
  try {
    response = await fetch(`${OMNICHANNEL_BASE}/api${path}`, {
      ...options,
      headers: omniHeaders(options.headers || {})
    });
  } catch (error) {
    const friendly = new Error("تعذر الاتصال بخدمة المحادثات. تأكد أن خدمة Omnichannel تعمل ثم أعد المحاولة.");
    friendly.code = "NETWORK_ERROR";
    friendly.cause = error;
    throw friendly;
  }
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok || payload.ok === false) {
    const rawMessage = payload.message || `Omnichannel HTTP ${response.status}`;
    const friendly = new Error(omniFriendlyError(response.status, rawMessage));
    friendly.status = response.status;
    friendly.rawMessage = rawMessage;
    throw friendly;
  }
  return payload;
}

function omniFriendlyError(status, message = "") {
  const text = String(message || "");
  if (status === 400 && /service window|WhatsApp/i.test(text)) return "انتهت نافذة خدمة واتساب. استخدم رسالة Template.";
  if (status === 400) return text || "البيانات غير مكتملة أو غير صحيحة.";
  if (status === 401) return "انتهت جلسة الدخول. سجل الدخول مرة أخرى ثم أعد المحاولة.";
  if (status === 403) return "ليس لديك صلاحية الرد على هذه المحادثة.";
  if (status === 409) return "تم تحديث المحادثة بواسطة موظف آخر. حدّث الصفحة ثم أعد المحاولة.";
  if (status === 429) return "تم إرسال طلبات كثيرة خلال وقت قصير. انتظر لحظات ثم أعد المحاولة.";
  if (status >= 500) return "حدث خطأ أثناء الإرسال. حاول مرة أخرى، وإذا تكرر الخطأ راجع مسؤول النظام.";
  return text || "تعذر تنفيذ العملية.";
}

async function omniHealth() {
  try {
    const response = await fetch(`${OMNICHANNEL_BASE}/health`);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function omniStatusLabel(status) {
  const labels = {
    unassigned: "غير مستلمة",
    waiting_agent: "تنتظر موظف",
    claimed: "مستلمة",
    assigned: "محوّلة",
    pending_customer: "بانتظار العميل",
    closed: "مغلقة",
    mock_connected: "تجريب متصل",
    connected: "متصل",
    not_connected: "غير متصل",
    disabled: "متوقف"
  };
  return labels[status] || status || "—";
}

function omniChannelLabel(account = {}) {
  const key = account.channel?.key || account.provider || "";
  if (key === "whatsapp") return "WhatsApp";
  if (key === "messenger") return "Messenger";
  if (key === "instagram") return "Instagram";
  if (key === "webchat") return "Website Chat";
  return account.channel?.name || key || "قناة";
}

function omniAccountOptions(accounts, provider) {
  const list = (accounts || []).filter(account => (account.channel?.key || account.provider) === provider);
  return list.map(account => `<option value="${esc(account.id)}">${esc(account.name)} — ${esc(omniStatusLabel(account.status))}</option>`).join("");
}

function omniAllAccountFilterOptions(accounts) {
  return `<option value="">كل الحسابات</option>${(accounts || []).map(account => `<option value="${esc(account.id)}" ${selectedOmniChannelAccountId === account.id ? "selected" : ""}>${esc(omniChannelLabel(account))} — ${esc(account.name)}</option>`).join("")}`;
}

function omniAccountIdentifier(account = {}) {
  return account.channel?.key === "messenger"
    ? (account.pageId || account.externalAccountId || "—")
    : (account.externalPhoneNumber || account.phoneNumberId || "—");
}

function omniConnectionLabel(account = {}) {
  return account.connectionStatus || account.status || "not_configured";
}

function omniManageChannelsTable(accounts = []) {
  return `
    <article class="card">
      <div class="card-header">
        <div><h3>إدارة القنوات</h3><p>إضافة وتعديل WhatsApp وMessenger بدون تعديل كود، مع فصل كل حساب عن الآخر.</p></div>
        <button class="btn secondary" data-action="omni-account-new">＋ إضافة حساب</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>الحساب</th><th>القناة</th><th>الهاتف / Page ID</th><th>الحالة</th><th>Connection</th><th>آخر اختبار</th><th>نشط؟</th><th>حساس؟</th><th>Credentials</th><th>الإجراءات</th></tr></thead><tbody>
        ${accounts.map(account => `<tr>
          <td><strong>${esc(account.name)}</strong><br><span class="muted">${esc(account.id)}</span></td>
          <td>${esc(omniChannelLabel(account))}</td>
          <td dir="ltr">${esc(omniAccountIdentifier(account))}</td>
          <td>${badge(omniStatusLabel(account.status), account.status === "connected" || account.status === "mock_connected" ? "blue" : "warning")}</td>
          <td>${badge(omniConnectionLabel(account), account.connectionStatus === "error" ? "danger" : "")}${account.lastError ? `<br><span class="muted">${esc(account.lastError)}</span>` : ""}</td>
          <td>${esc(dateTimeLabel(account.lastTestedAt) || "—")}</td>
          <td>${account.isActive === false ? badge("لا", "warning") : badge("نعم")}</td>
          <td>${account.isCritical ? badge("Critical", "danger") : "—"}</td>
          <td>${account.credentialsConfigured ? badge("Configured", "blue") : badge("Not set", "warning")}</td>
          <td><div class="row-actions">
            <button class="row-action" data-action="omni-account-edit" data-id="${esc(account.id)}">تعديل</button>
            <button class="row-action" data-action="omni-account-test" data-id="${esc(account.id)}">اختبار</button>
            <button class="row-action" data-action="${account.isActive === false ? "omni-account-activate" : "omni-account-deactivate"}" data-id="${esc(account.id)}">${account.isActive === false ? "تفعيل" : "تعطيل"}</button>
            <button class="row-action text-danger" data-action="omni-account-delete" data-id="${esc(account.id)}">حذف</button>
          </div></td>
        </tr>`).join("") || `<tr><td colspan="10" class="text-center muted">لا توجد حسابات قنوات بعد.</td></tr>`}
      </tbody></table></div>
    </article>`;
}

async function omniAccountModal(id = "") {
  const account = id ? (await omniApi(`/channel-accounts/${encodeURIComponent(id)}`)).account : {};
  const channelKey = account.channel?.key || account.channelKey || "whatsapp";
  openModal(id ? "تعديل حساب قناة" : "إضافة حساب قناة", "Omnichannel", `
    <form id="omni-account-form" data-id="${esc(id)}">
      <div class="form-grid">
        <div class="form-field"><label>نوع القناة</label><select name="channelKey" ${id ? "disabled" : ""}><option value="whatsapp" ${channelKey === "whatsapp" ? "selected" : ""}>WhatsApp</option><option value="messenger" ${channelKey === "messenger" ? "selected" : ""}>Messenger</option><option disabled>Instagram لاحقًا</option><option disabled>Website Chat لاحقًا</option></select></div>
        <div class="form-field"><label class="required">اسم الحساب</label><input name="name" required value="${esc(account.name || "")}"></div>
        <div class="form-field"><label>رقم الهاتف</label><input name="phoneNumber" value="${esc(account.externalPhoneNumber || "")}" dir="ltr"></div>
        <div class="form-field"><label>Phone Number ID</label><input name="phoneNumberId" value="${esc(account.phoneNumberId || "")}" dir="ltr"></div>
        <div class="form-field"><label>WABA ID</label><input name="wabaId" value="${esc(account.businessAccountId || "")}" dir="ltr"></div>
        <div class="form-field"><label>Page ID</label><input name="pageId" value="${esc(account.pageId || "")}" dir="ltr"></div>
        <div class="form-field"><label>External Account ID</label><input name="externalAccountId" value="${esc(account.externalAccountId || "")}" dir="ltr"></div>
        <div class="form-field"><label>Graph API Version</label><input name="graphApiVersion" value="${esc(account.configuration?.graphApiVersion || "v20.0")}" dir="ltr"></div>
        <div class="form-field"><label>Connection Mode</label><select name="connectionMode"><option value="mock" ${account.status === "mock_connected" ? "selected" : ""}>Mock</option><option value="configured" ${account.status === "configured" ? "selected" : ""}>Configured</option><option value="real_future" ${account.status === "connected" ? "selected" : ""}>Real Future</option></select></div>
        <div class="form-field"><label>Status</label><select name="status"><option value="not_connected" ${account.status === "not_connected" ? "selected" : ""}>Not Connected</option><option value="mock_connected" ${account.status === "mock_connected" ? "selected" : ""}>Mock Connected</option><option value="configured" ${account.status === "configured" ? "selected" : ""}>Configured</option><option value="connected" ${account.status === "connected" ? "selected" : ""}>Connected</option><option value="disabled" ${account.status === "disabled" ? "selected" : ""}>Disabled</option></select></div>
        <div class="form-field"><label>Credential Reference</label><input name="credentialsReference" value="${esc(account.credentialsReference || "")}" placeholder="env:NAME أو stored:access_token"></div>
        <div class="form-field"><label>Access Token إدخال مرة واحدة</label><input name="accessToken" type="password" autocomplete="new-password" placeholder="${account.credentialsConfigured ? "مخزن — اتركه فارغًا للإبقاء عليه" : "اختياري في التطوير"}"></div>
        <div class="form-field"><label>نشط</label><select name="isActive"><option value="true" ${account.isActive !== false ? "selected" : ""}>نعم</option><option value="false" ${account.isActive === false ? "selected" : ""}>لا</option></select></div>
        <div class="form-field"><label>حساس Critical</label><select name="isCritical"><option value="false" ${!account.isCritical ? "selected" : ""}>لا</option><option value="true" ${account.isCritical ? "selected" : ""}>نعم</option></select></div>
      </div>
      ${account.isCritical ? `<div class="alert-item danger" style="margin-top:12px"><div class="alert-badge red">!</div><div><strong>Critical Account</strong><span>أي تعديل حساس يتطلب تأكيد. لا يوجد ربط Meta فعلي في هذه المرحلة.</span></div></div>` : ""}
      <div class="form-actions"><button class="btn" type="submit">حفظ الحساب</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

async function omniAccountAction(action, id) {
  if (!id) return;
  const endpoint = action === "delete" ? `/channel-accounts/${encodeURIComponent(id)}` : `/channel-accounts/${encodeURIComponent(id)}/${action}`;
  const method = action === "delete" ? "DELETE" : "POST";
  await omniApi(endpoint, { method });
  toast(action === "test-connection" ? "تم اختبار الاتصال." : "تم تحديث حساب القناة.");
  renderOmnichannel();
}

function omniMessageMediaHtml(message = {}) {
  const type = message.messageType || "text";
  if (!message.mediaUrl && !message.mediaStorageKey && !["image", "document", "file", "audio"].includes(type)) return "";
  const name = message.mediaFilename || "attachment";
  const url = message.mediaUrl || `${OMNICHANNEL_BASE}/api/media/${encodeURIComponent(message.mediaStorageKey || "")}`;
  if (type === "image") return `<div class="omni-media"><img src="${esc(url)}" alt="${esc(name)}"><a href="${esc(url)}" target="_blank" rel="noopener">فتح / تحميل</a></div>`;
  if (type === "audio") return `<div class="omni-media"><audio controls src="${esc(url)}"></audio><a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a></div>`;
  return `<div class="omni-media file"><span>ًں“ژ</span><a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a><small>${esc(message.mediaMimeType || type)}</small></div>`;
}

function omniMessageHtml(message = {}) {
  const internal = message.messageType === "internal_note";
  const failed = message.status === "failed";
  return `<div class="omni-message ${message.direction === "outbound" ? "outbound" : "inbound"} ${internal ? "internal-note" : ""}">
    ${message.replyToMessageId ? `<small class="muted">رد على: ${esc(message.replyToMessageId)}</small>` : ""}
    <span>${esc(message.textContent || message.caption || "")}</span>
    ${omniMessageMediaHtml(message)}
    <small>${esc(message.messageType || message.senderType || message.direction)} · ${esc(message.status || "—")} · ${dateTimeLabel(message.createdAt)}${message.sentByUserId ? ` · ${esc(message.sentByUserId)}` : ""}${message.externalMessageId ? ` · ${esc(message.externalMessageId)}` : ""}</small>
    <div class="row-actions"><button class="row-action" data-action="omni-reply-to" data-id="${esc(message.id)}">Reply</button>${failed ? `<button class="row-action" data-action="omni-message-retry" data-id="${esc(message.id)}">Retry</button>` : ""}</div>
  </div>`;
}

function omniEmojiPickerHtml() {
  const emojis = ["\u{1F600}","\u{1F642}","\u{1F60A}","\u{1F602}","\u{1F64F}","\u{1F44D}","\u{1F44C}","\u{1F44F}","\u2764", "\u{1F499}","\u{1F49A}","\u{1F4DA}","\u2728", "\u{1F525}","\u{1F4E6}","\u2705", "\u274C", "\u26A0", "\u{1F4AC}","\u23F3", "\u{1F389}"];
  return `<div id="omni-emoji-picker" class="omni-emoji-picker" hidden>${emojis.map(emoji => `<button type="button" class="row-action omni-emoji-option" data-action="omni-insert-emoji" data-emoji="${esc(emoji)}">${esc(emoji)}</button>`).join("")}</div>`;
}

function omniInsertAtCursor(textarea, value) {
  if (!textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = `${textarea.value.slice(0, start)}${value}${textarea.value.slice(end)}`;
  const next = start + value.length;
  textarea.focus();
  textarea.setSelectionRange(next, next);
}

function omniUploadFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذر قراءة الملف."));
    reader.onload = async () => {
      try {
        const payload = { filename: file.name, mimeType: file.type || "application/octet-stream", dataBase64: String(reader.result || "") };
        const result = await omniApi("/media/upload", { method: "POST", body: JSON.stringify(payload) });
        resolve(result.media);
      } catch (error) { reject(error); }
    };
    reader.readAsDataURL(file);
  });
}

async function connectOmniSse() {
  if (!sessionToken || omniEventSource) return;
  try {
    const ticketPayload = await omniApi("/events/ticket", { method: "POST", body: JSON.stringify({}) });
    const ticket = ticketPayload.ticket;
    if (!ticket) return;
    omniEventSource = new EventSource(`${OMNICHANNEL_BASE}/api/events-ticket=${encodeURIComponent(ticket)}`);
    omniEventSource.addEventListener("message", () => {
      if (currentView === "omnichannel") renderOmnichannel();
    });
    omniEventSource.addEventListener("error", () => {
      omniEventSource?.close();
      omniEventSource = null;
    });
  } catch {
    omniEventSource = null;
  }
}

async function renderOmnichannel() {
  root.innerHTML = `
    <div class="section-title">
      <div><h2>مركز خدمة العملاء</h2><p>Inbox موحد لـ WhatsApp رقم 2 وMessenger، مع تجهيز الربط الرسمي لاحقًا بدون لمس الرقم الأساسي.</p></div>
      <div class="actions"><button class="btn ghost" data-action="omni-refresh">↻ تحديث</button></div>
    </div>
    <div class="card"><div class="loader-line"></div><p class="muted">جاري تحميل مركز خدمة العملاء من الخدمة المستقلة...</p></div>`;
  const health = await omniHealth();
  if (!health) {
    root.innerHTML = `
      <div class="section-title">
        <div><h2>مركز خدمة العملاء</h2><p>الخدمة مستقلة حتى لا تؤثر على النظام الحالي أو بياناته.</p></div>
        <div class="actions"><button class="btn ghost" data-action="omni-refresh">↻ إعادة المحاولة</button></div>
      </div>
      <article class="card">
        <div class="alert-item">
          <div class="alert-badge red">!</div>
          <div><strong>خدمة Omnichannel غير مشغلة الآن</strong><span>شغّل START-ALL.cmd من مجلد النظام لتشغيل التطبيق وخدمة المحادثات معًا، ثم اضغط تحديث.</span></div>
        </div>
        <pre class="code-block">START-ALL.cmd</pre>
      </article>`;
    return;
  }
  try {
    const [summaryPayload, accountsPayload, conversationsPayload] = await Promise.all([
      omniApi("/dashboard/summary"),
      omniApi("/channel-accounts"),
      omniApi(`/conversations-limit=50${selectedOmniChannelAccountId ? `&channelAccountId=${encodeURIComponent(selectedOmniChannelAccountId)}` : ""}`)
    ]);
    const summary = summaryPayload.summary || {};
    const accounts = accountsPayload.accounts || [];
    const conversations = conversationsPayload.conversations || [];
    const whatsappOptions = omniAccountOptions(accounts, "whatsapp");
    const messengerOptions = omniAccountOptions(accounts, "messenger");
    root.innerHTML = `
      <div class="section-title">
        <div><h2>مركز خدمة العملاء</h2><p>Inbox موحد للمحادثات، مع فصل كل Channel Account عن الآخر وربط المحادثة بالعميل عند تطابق الهاتف.</p></div>
        <div class="actions"><button class="btn ghost" data-action="omni-refresh">↻ تحديث</button></div>
      </div>
      <div class="stats-grid">
        <article class="stat-card"><span>كل المحادثات</span><strong>${summary.total || 0}</strong></article>
        <article class="stat-card"><span>المفتوحة</span><strong>${summary.open || 0}</strong></article>
        <article class="stat-card"><span>غير مستلمة</span><strong>${summary.unassigned || 0}</strong></article>
        <article class="stat-card"><span>غير مقروءة</span><strong>${summary.unread || 0}</strong></article>
      </div>
      <div class="omni-grid">
        <article class="card">
          <div class="card-header"><div><h3>القنوات والحسابات</h3><p>WhatsApp الأساسي محفوظ كحساب حساس وغير متصل للتجربة. الاختبار على رقم WhatsApp 2.</p></div>${badge("الخدمة تعمل", "blue")}</div>
          <div class="alert-list">
            ${accounts.map(account => `<div class="alert-item"><div class="alert-badge blue">${esc(omniChannelLabel(account).slice(0, 1))}</div><div><strong>${esc(account.name)}</strong><span>${esc(omniChannelLabel(account))} · ${esc(omniStatusLabel(account.status))}${account.isCritical ? " · حساس" : ""}</span></div>${badge(omniStatusLabel(account.status), account.status === "mock_connected" || account.status === "connected" ? "" : "warning")}</div>`).join("") || `<p class="muted">لا توجد حسابات قناة. شغل seed-dev للخدمة.</p>`}
          </div>
        </article>
        <article class="card">
          <div class="card-header"><div><h3>اختبار آمن بدون حسابات حقيقية</h3><p>محاكاة رسالة واردة فقط لاستخدام WhatsApp رقم 2 وMessenger أثناء التطوير.</p></div></div>
          <div class="form-grid">
            <div class="form-field"><label>WhatsApp رقم 2</label><select id="omni-account-whatsapp">${whatsappOptions}</select></div>
            <div class="form-field"><label>رقم المرسل</label><input id="omni-wa-phone" value="01000000001" dir="ltr"></div>
            <div class="form-field"><label>اسم المرسل</label><input id="omni-wa-name" value="عميل تجربة"></div>
            <div class="form-field full"><label>نص الرسالة</label><input id="omni-wa-text" value="محتاج أعرف حالة طلبي"></div>
            <div class="form-field full"><button class="btn secondary" data-action="omni-simulate-whatsapp" ${whatsappOptions ? "" : "disabled"}>إرسال رسالة واردة تجريبية WhatsApp</button></div>
            <div class="form-field"><label>Messenger Page</label><select id="omni-account-messenger">${messengerOptions}</select></div>
            <div class="form-field"><label>PSID تجريبي</label><input id="omni-msgr-psid" value="psid-test-001" dir="ltr"></div>
            <div class="form-field"><label>اسم المرسل</label><input id="omni-msgr-name" value="عميل Messenger"></div>
            <div class="form-field full"><label>نص الرسالة</label><input id="omni-msgr-text" value="هل يوجد توصيل للمحافظة؟"></div>
            <div class="form-field full"><button class="btn secondary" data-action="omni-simulate-messenger" ${messengerOptions ? "" : "disabled"}>إرسال رسالة واردة تجريبية Messenger</button></div>
          </div>
        </article>
      </div>
      ${omniManageChannelsTable(accounts)}
      <div class="omni-layout">
        <article class="card omni-inbox">
          <div class="toolbar"><select class="filter-select" id="omni-channel-filter">${omniAllAccountFilterOptions(accounts)}</select></div>
          <div class="card-header"><div><h3>المحادثات</h3><p>اضغط فتح لعرض الرسائل، أو استلام لمنع تضارب أكثر من موظف.</p></div></div>
          <div class="table-wrap"><table><thead><tr><th>القناة</th><th>العميل</th><th>آخر رسالة</th><th>الحالة</th><th>الموظف</th><th>إجراء</th></tr></thead><tbody>
            ${conversations.map(conversation => {
              const last = conversation.messages?.[0]?.textContent || conversation.subject || "—";
              const selected = selectedOmniConversationId === conversation.id;
              return `<tr class="${selected ? "omni-selected-row" : ""}" data-omni-conversation="${esc(conversation.id)}"><td>${esc(omniChannelLabel(conversation.channelAccount))}<br><span class="muted">${esc(conversation.channelAccount?.name || "")}</span></td><td><strong>${esc(conversation.contact?.displayName || "عميل")}</strong><br><span class="muted">${esc(conversation.contact?.primaryPhone || conversation.contact?.customerId || "—")}</span></td><td>${esc(last)}</td><td>${badge(omniStatusLabel(conversation.status), conversation.unreadCount ? "warning" : "")}<br><span class="muted">${conversation.unreadCount || 0} غير مقروء</span></td><td>${esc(conversation.assignedUserId || "—")}</td><td><div class="row-actions"><button class="row-action ${selected ? "primary-action" : ""}" data-action="omni-open" data-id="${esc(conversation.id)}">فتح</button><button class="row-action" data-action="omni-claim" data-id="${esc(conversation.id)}" data-version="${conversation.version || 0}">استلام</button></div></td></tr>`;
            }).join("") || `<tr><td colspan="6" class="text-center muted">لا توجد محادثات بعد. استخدم الاختبار الآمن بالأعلى.</td></tr>`}
          </tbody></table></div>
        </article>
        <article class="card omni-detail" id="omni-detail">
          <div class="empty-state"><h3>اختر محادثة</h3><p>ستظهر الرسائل وبيانات الربط مع العميل والطلب والفاتورة والشحنة هنا.</p></div>
        </article>
      </div>`;
    connectOmniSse();
    if (selectedOmniConversationId && conversations.some(item => item.id === selectedOmniConversationId)) {
      setTimeout(() => omniOpenConversation(selectedOmniConversationId, { scroll: false }), 0);
    }
  } catch (error) {
    root.innerHTML = `<div class="section-title"><div><h2>مركز خدمة العملاء</h2><p>تعذر تحميل البيانات.</p></div><button class="btn ghost" data-action="omni-refresh">إعادة المحاولة</button></div><article class="card"><div class="alert-item"><div class="alert-badge red">!</div><div><strong>تعذر الاتصال بخدمة Omnichannel</strong><span>${esc(error.message)}</span></div></div></article>`;
  }
}

async function omniSimulate(type) {
  try {
    const isWhatsapp = type === "whatsapp";
    const payload = isWhatsapp
      ? {
          channelAccountId: document.getElementById("omni-account-whatsapp")?.value,
          phone: document.getElementById("omni-wa-phone")?.value,
          name: document.getElementById("omni-wa-name")?.value,
          text: document.getElementById("omni-wa-text")?.value
        }
      : {
          channelAccountId: document.getElementById("omni-account-messenger")?.value,
          psid: document.getElementById("omni-msgr-psid")?.value,
          name: document.getElementById("omni-msgr-name")?.value,
          text: document.getElementById("omni-msgr-text")?.value
        };
    await omniApi(`/mock/${isWhatsapp ? "whatsapp" : "messenger"}/incoming`, { method: "POST", body: JSON.stringify(payload) });
    toast("تم استقبال رسالة تجريبية داخل Inbox.");
    renderOmnichannel();
  } catch (error) {
    toast(`تعذر تنفيذ الاختبار: ${error.message}`, "error");
  }
}

async function omniClaim(id, version) {
  try {
    await omniApi(`/conversations/${encodeURIComponent(id)}/claim`, { method: "POST", body: JSON.stringify({ version: Number(version || 0) }) });
    toast("تم استلام المحادثة.");
    renderOmnichannel();
  } catch (error) {
    toast(`تعذر استلام المحادثة: ${error.message}`, "error");
  }
}

async function omniOpenConversation(id, options = {}) {
  selectedOmniConversationId = id;
  document.querySelectorAll("[data-omni-conversation]").forEach(row => row.classList.toggle("omni-selected-row", row.dataset.omniConversation === id));
  const detail = document.getElementById("omni-detail");
  if (detail) detail.innerHTML = `<div class="loader-line"></div><p class="muted">جاري تحميل المحادثة...</p>`;
  try {
    const [conversationPayload, messagesPayload] = await Promise.all([
      omniApi(`/conversations/${encodeURIComponent(id)}`),
      omniApi(`/conversations/${encodeURIComponent(id)}/messages`)
    ]);
    const conversation = conversationPayload.conversation || {};
    const messages = messagesPayload.messages || [];
    const contact = conversation.contact || {};
    const linked = [
      conversation.customerId ? `عميل: ${conversation.customerId}` : "",
      conversation.onlineOrderId ? `طلب: ${conversation.onlineOrderId}` : "",
      conversation.saleId ? `فاتورة: ${conversation.saleId}` : "",
      conversation.shipmentId ? `شحنة: ${conversation.shipmentId}` : ""
    ].filter(Boolean).join(" · ") || "لا يوجد ربط تشغيلي بعد";
    document.getElementById("omni-detail").innerHTML = `
      <div class="card-header"><div><h3>${esc(contact.displayName || "محادثة")}</h3><p>${esc(omniChannelLabel(conversation.channelAccount))} · ${esc(conversation.channelAccount?.name || "")} · ${esc(linked)}</p></div>${badge(omniStatusLabel(conversation.status), "blue")}</div>
      <div class="metric-strip">
        <div class="mini-metric"><span>رقم المحادثة</span><strong dir="ltr">${esc(conversation.id || "—")}</strong></div>
        <div class="mini-metric"><span>الموظف المستلم</span><strong>${esc(conversation.assignedUserId || "غير مستلمة")}</strong></div>
        <div class="mini-metric"><span>العميل</span><strong>${esc(contact.customerId || contact.primaryPhone || "—")}</strong></div>
      </div>
      <div class="omni-messages">
        ${messages.map(message => `<div class="omni-message ${message.direction === "outbound" ? "outbound" : "inbound"}"><span>${esc(message.textContent || "")}</span><small>${esc(message.senderType || message.direction)} · ${esc(message.status || "—")} · ${dateTimeLabel(message.createdAt)}${message.sentByUserId ? ` · ${esc(message.sentByUserId)}` : ""}${message.externalMessageId ? ` · ${esc(message.externalMessageId)}` : ""}</small></div>`).join("") || `<p class="muted">لا توجد رسائل.</p>`}
      </div>
      <div class="form-field"><label>رد الموظف</label><textarea id="omni-reply-text" rows="3" placeholder="اكتب ردًا للعميل..."></textarea></div>
      <div class="form-actions"><button class="btn" data-action="omni-send" data-id="${esc(id)}">إرسال الرد</button><button class="btn ghost" data-action="omni-claim" data-id="${esc(id)}" data-version="${conversation.version || 0}">استلام المحادثة</button></div>`;
    const messagesBox = document.querySelector("#omni-detail .omni-messages");
    if (messagesBox) messagesBox.innerHTML = messages.map(omniMessageHtml).join("") || `<p class="muted">لا توجد رسائل.</p>`;
    const oldReplyField = document.querySelector("#omni-detail #omni-reply-text")?.closest(".form-field");
    const oldReplyActions = oldReplyField?.nextElementSibling;
    oldReplyField?.remove();
    if (oldReplyActions?.classList?.contains("form-actions")) oldReplyActions.remove();
    document.getElementById("omni-detail")?.insertAdjacentHTML("beforeend", `
      <div id="omni-reply-context" class="alert-item" ${selectedOmniReplyToMessageId ? "" : "hidden"}><div class="alert-badge blue">↩</div><div><strong>الرد على رسالة</strong><span dir="ltr">${esc(selectedOmniReplyToMessageId || "")}</span></div><button class="row-action" data-action="omni-cancel-reply">إلغاء</button></div>
      <div id="omni-attachment-preview" class="alert-item" ${selectedOmniAttachment ? "" : "hidden"}><div class="alert-badge blue">ًں“ژ</div><div><strong>${esc(selectedOmniAttachment?.mediaFilename || "مرفق")}</strong><span>${esc(selectedOmniAttachment?.mediaMimeType || "")}</span></div><button class="row-action" data-action="omni-clear-attachment">إزالة</button></div>
      <div class="form-grid">
        <div class="form-field"><label>نوع الإرسال</label><select id="omni-send-mode"><option value="reply">Reply للعميل</option><option value="internal_note">Internal Note داخلي</option></select></div>
        <div class="form-field"><label>إرفاق ملف</label><input id="omni-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.mp3,.m4a,.ogg,.webm"></div>
        <div class="form-field full"><label>رد الموظف</label><div class="omni-composer-tools"><button class="row-action" type="button" data-action="omni-toggle-emoji" title="Emoji">ًںک€</button><span class="muted">Ctrl+Enter للإرسال</span></div>${omniEmojiPickerHtml()}<textarea id="omni-reply-text" rows="3" placeholder="اكتب ردًا أو ملاحظة داخلية..."></textarea></div>
      </div>
      <div class="form-actions"><button class="btn" id="omni-send-button" data-action="omni-send" data-id="${esc(id)}">إرسال</button><button class="btn ghost" data-action="omni-claim" data-id="${esc(id)}" data-version="${conversation.version || 0}">استلام</button><button class="btn ghost" data-action="omni-close" data-id="${esc(id)}">إغلاق</button><button class="btn ghost" data-action="omni-release" data-id="${esc(id)}">Release</button></div>`);
    if (options.scroll !== false) document.getElementById("omni-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  } catch (error) {
    if (detail) detail.innerHTML = `<div class="alert-item"><div class="alert-badge red">!</div><div><strong>تعذر فتح المحادثة</strong><span>${esc(error.message)}</span></div></div>`;
  }
}

async function omniSend(id) {
  const text = document.getElementById("omni-reply-text")?.value?.trim();
  if (!text) return toast("اكتب نص الرد أولًا.", "error");
  try {
    await omniApi(`/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, clientMessageId: `web-${Date.now()}` })
    });
    toast("تم إرسال الرد عبر Provider الحالي.");
    await omniOpenConversation(id);
  } catch (error) {
    toast(`تعذر إرسال الرد: ${error.message}`, "error");
  }
}

async function omniSendAdvanced(id) {
  if (omniSendingConversations.has(id)) return;
  const textarea = document.getElementById("omni-reply-text");
  const sendButton = document.getElementById("omni-send-button");
  const text = textarea?.value?.trim();
  const mode = document.getElementById("omni-send-mode")?.value || "reply";
  const file = document.getElementById("omni-file-input")?.files?.[0];
  if (!text && !file && !selectedOmniAttachment) return toast("اكتب نصًا أو اختر مرفقًا أولًا.", "error");
  omniSendingConversations.add(id);
  if (sendButton) { sendButton.disabled = true; sendButton.textContent = "جاري الإرسال..."; }
  try {
    let media = selectedOmniAttachment;
    if (file && !media) {
      toast("جاري رفع المرفق...");
      media = await omniUploadFile(file);
      selectedOmniAttachment = media;
    }
    await omniApi(`/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({
        text,
        mode,
        messageType: media?.messageType || (mode === "internal_note" ? "internal_note" : "text"),
        media: media || undefined,
        caption: media ? text : undefined,
        replyToMessageId: selectedOmniReplyToMessageId || undefined,
        clientMessageId: `web-${id}-${Date.now()}`
      })
    });
    selectedOmniAttachment = null;
    selectedOmniReplyToMessageId = "";
    toast("تم إرسال الرسالة.");
    await omniOpenConversation(id);
  } catch (error) {
    toast(`تعذر إرسال الرسالة: ${error.message}`, "error");
  } finally {
    omniSendingConversations.delete(id);
    if (sendButton) { sendButton.disabled = false; sendButton.textContent = "إرسال"; }
  }
}

function render() {
  const meta = {
    dashboard: ["لوحة المتابعة", "نظرة عامة"],
    books: ["الأصناف والمخزون", "إدارة المخزون"],
    sales: ["المبيعات", "نقطة البيع"],
    onlineOrders: ["طلبات الأونلاين", "إدارة الطلبات"],
    purchases: ["المشتريات والأمانة", "التوريد"],
    returns: ["المرتجعات", "مبيعات ومشتريات"],
    parties: ["العملاء والموردون", "إدارة الأطراف"],
    shipping: ["الشحن والتوصيل", "تتبع الطلبات"],
    accounting: ["المالية", "الإدارة المالية"],
    reports: ["التقارير والتحليلات", "دعم القرار"],
    hr: ["الموظفون والرواتب", "الموارد البشرية"],
    omnichannel: ["مركز خدمة العملاء", "Inbox موحد للمحادثات والقنوات"],
    settings: ["الإعدادات والصلاحيات", "إدارة النظام"]
  };
  document.getElementById("page-title").textContent = meta[currentView][0];
  document.getElementById("page-kicker").textContent = meta[currentView][1];
  document.querySelectorAll(".nav-item").forEach(item => {
    const partyMatch = item.dataset.view !== "parties" || !item.dataset.partyTabTarget || item.dataset.partyTabTarget === partyTab;
    item.classList.toggle("active", item.dataset.view === currentView && partyMatch);
  });
  ({
    dashboard: renderDashboard,
    books: renderBooks,
    sales: renderSales,
    onlineOrders: renderOnlineOrders,
    purchases: renderPurchases,
    returns: renderReturns,
    parties: renderParties,
    shipping: renderShipping,
    accounting: renderAccounting,
    reports: renderReports,
    hr: renderHr,
    omnichannel: renderOmnichannel,
    settings: renderSettings
  })[currentView]();
  updateNotificationBadge();
  updateSidebarBadges();
  scheduleStickyTableScrollbar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateSidebarBadges() {
  const pendingOrders = (data.onlineOrders || []).filter(item => !item.deletedAt && !["تم التسليم", "ملغي"].includes(item.status)).length;
  const pendingShipping = (data.shipments || []).filter(item => !item.deletedAt && !["تم التسليم", "مرتجع", "ملغاة"].includes(item.status)).length;
  [["nav-orders-badge", pendingOrders], ["nav-shipping-badge", pendingShipping]].forEach(([id, count]) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = count;
    element.hidden = count === 0;
  });
}

function navigate(view) {
  if (!canView(view)) return toast("ليس لديك صلاحية للوصول إلى هذه الصفحة.", "error");
  if (view === "sales") salesScreenMode = "main";
  currentView = view;
  document.getElementById("sidebar").classList.remove("open");
  render();
}

function highlightRecord(selector, label = "السجل المطلوب") {
  if (recordFocusTimer) clearTimeout(recordFocusTimer);
  const element = document.querySelector(selector);
  if (!element) return false;
  document.querySelectorAll(".target-highlight").forEach(item => item.classList.remove("target-highlight"));
  document.querySelectorAll(".target-marker").forEach(item => item.remove());
  element.classList.add("target-highlight");
  const firstCell = element.querySelector("td") || element;
  const marker = document.createElement("span");
  marker.className = "target-marker";
  marker.textContent = label;
  firstCell.appendChild(marker);
  element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  recordFocusTimer = setTimeout(() => {
    element.classList.remove("target-highlight");
    marker.remove();
  }, 5000);
  return true;
}

function navigateToRecord(kind, id, mode = "view") {
  closeModal();
  if (kind === "book") {
    navigate("books");
    setTimeout(() => {
      highlightRecord(`[data-record-type="book"][data-record-id="${CSS.escape(id)}"]`, mode === "edit" ? "جاهز للتعديل" : mode === "adjust" ? "تسوية مطلوبة" : "الصنف المطلوب");
      setTimeout(() => {
        if (mode === "edit") addBookModal(getBook(id));
        else if (mode === "adjust") adjustStock(id);
        else if (mode === "view") viewBook(id);
      }, 650);
    }, 80);
    return;
  }
  if (kind === "shipment") {
    navigate("shipping");
    setTimeout(() => {
      highlightRecord(`[data-record-type="shipment"][data-record-id="${CSS.escape(id)}"]`, mode === "edit" ? "جاهزة للتعديل" : "الشحنة المطلوبة");
      setTimeout(() => {
        const shipment = data.shipments.find(item => item.id === id);
        if (mode === "edit") addShipmentModal(shipment);
        else viewShipment(id);
      }, 650);
    }, 80);
    return;
  }
  if (kind === "invoice") {
    navigate("sales");
    setTimeout(() => {
      showSalesList();
      setTimeout(() => {
        highlightRecord(`[data-record-type="invoice"][data-record-id="${CSS.escape(id)}"]`, mode === "edit" ? "فاتورة تحتاج إجراء" : "الفاتورة المطلوبة");
        setTimeout(() => {
          if (mode === "edit") salePaymentModal(id);
          else viewSale(id);
        }, 900);
      }, 120);
    }, 80);
  }
}

function addBookModal(book = null) {
  const summary = book ? productInventorySummary(book.id) : null;
  const coverPrice = Number(book?.coverPrice ?? book?.purchaseListPrice ?? book?.price ?? 0);
  const defaultSellingPrice = Number(book?.defaultSellingPrice ?? book?.price ?? 0);
  const lastPurchaseCost = summary?.lastPurchaseCost;
  const selectedType = itemTypeLabel(book);
  const selectedUnit = itemUnitLabel(book);
  openModal(book ? "تعديل بيانات الصنف" : "إضافة صنف جديد", "الأصناف والمخزون", `
    <form id="book-form" data-edit-id="${book?.id || ""}">
      <div class="form-grid three">
        <div class="form-field full"><label class="required">اسم الصنف / المنتج</label><input name="name" required value="${esc(book?.name || "")}" placeholder="مثال: كتاب الأضواء، كشكول سلك، قلم أزرق، سبلايز"></div>
        <div class="form-field"><label class="required">نوع الصنف</label><input name="itemType" list="item-type-list" required value="${esc(selectedType)}" placeholder="كتاب / كراسة / كشكول / سبلايز"><datalist id="item-type-list">${itemTypeOptions(selectedType)}</datalist><small>اكتب نوع جديد لو غير موجود.</small></div>
        <div class="form-field"><label>وحدة القياس</label><input name="unit" list="item-unit-list" value="${esc(selectedUnit)}" placeholder="قطعة"><datalist id="item-unit-list">${itemUnitOptions(selectedUnit)}</datalist></div>
        <div class="form-field"><label>المؤلف / البراند</label><input name="author" value="${esc(book?.author || "")}" placeholder="اختياري للكتب أو اسم البراند"></div>
        <div class="form-field"><label>الناشر / الشركة</label><input name="publisher" value="${esc(book?.publisher || "")}" placeholder="اختياري"></div>
        <div class="form-field"><label>التصنيف</label><input name="category" value="${esc(book?.category || "")}" placeholder="كتب دراسية / كراسات / أدوات مكتبية"></div>
        <div class="form-field"><label>الصف / المقاس / المواصفة</label><input name="grade" value="${esc(book?.grade || "")}" placeholder="اختياري"></div>
        <div class="form-field"><label>الرف / الموقع</label><input name="shelf" value="${esc(book?.shelf || "")}" placeholder="A-01"></div>
        <div class="form-field"><label>الباركود الداخلي</label><input name="barcode" value="${esc(book?.barcode || `DC${Date.now().toString().slice(-6)}`)}"></div>
        <div class="form-field"><label>باركود إضافي / ISBN / كود مورد</label><input name="extraBarcode" value="${esc(book?.extraBarcode || "")}"></div>
        <div class="form-field"><label class="required">المورد الأساسي</label><select name="supplierId" required>${data.suppliers.map(s => `<option value="${s.id}" ${book?.supplierId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
        <div class="form-field"><label class="required">سعر الغلاف</label><input name="coverPrice" type="number" min="0" step="0.01" required value="${coverPrice || ""}" placeholder="السعر المطبوع على المنتج"></div>
        <div class="form-field"><label class="required">سعر البيع الافتراضي</label><input name="defaultSellingPrice" type="number" min="0" step="0.01" required value="${defaultSellingPrice || ""}"></div>
        <div class="form-field calculated-field"><label>آخر سعر شراء / محسوب</label><input name="lastPurchasePrice" readonly value="${lastPurchaseCost === null || lastPurchaseCost === undefined ? "غير متاح" : lastPurchaseCost}"><small>مشتق من آخر فاتورة شراء أو استلام معتمدة، ولا يمكن تعديله يدويًا.</small></div>
        <div class="form-field"><label>الرصيد الافتتاحي</label><input name="stock" type="number" value="${book?.stock ?? 0}"></div>
        <div class="form-field"><label>حد إعادة الطلب</label><input name="reorder" type="number" min="0" value="${book?.reorder ?? 5}"></div>
        <div class="form-field"><label>نوع الملكية</label><select name="owned"><option value="true" ${book?.owned !== false ? "selected" : ""}>مملوك</option><option value="false" ${book?.owned === false ? "selected" : ""}>أمانة / تصريف</option></select></div>
        <div class="form-field"><label>آخر موعد للمرتجع</label><input name="returnDeadline" type="date" value="${book?.returnDeadline || ""}"></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">حفظ الصنف</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

function calculateDiscountedPurchaseCost(listPrice, discount) {
  const safePrice = Math.max(0, Number(listPrice || 0));
  const safeDiscount = Math.min(100, Math.max(0, Number(discount || 0)));
  return Number((safePrice * (1 - safeDiscount / 100)).toFixed(2));
}

function addPartyModal(kind, item = null, options = {}) {
  const isCustomer = kind === "customer";
  openModal(`${item ? "تعديل" : "إضافة"} ${isCustomer ? "عميل" : "مورد"}`, "ملف الأطراف", `
    <form id="party-form" data-kind="${kind}" data-edit-id="${item?.id || ""}" data-return-to-sale="${options.returnToSale ? "true" : "false"}" data-return-to-online-order="${options.returnToOnlineOrder ? "true" : "false"}">
      <div class="form-grid">
        <div class="form-field full"><label class="required">الاسم</label><input name="name" required value="${esc(item?.name || "")}"></div>
        <div class="form-field"><label class="${isCustomer ? "required" : ""}">رقم الهاتف</label><input name="phone" ${isCustomer ? "required" : ""} value="${esc(item?.phone || "")}"></div>
        ${isCustomer ? `<div class="form-field"><label>فئة العميل</label><select name="type">${["تجزئة","جملة","أونلاين"].map(type => `<option ${item?.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></div>` : `<div class="form-field"><label>مدة السداد</label><input name="terms" type="number" value="${item?.terms ?? 30}"></div>`}
        ${isCustomer ? `<div class="form-field"><label class="required">المحافظة</label><select name="governorate" required>${governorateOptions(item?.governorate)}</select></div>
        <div class="form-field"><label>المدينة / المنطقة</label><input name="city" value="${esc(item?.city || "")}"></div>
        <div class="form-field full"><label>العنوان التفصيلي</label><input name="address" value="${esc(item?.address || "")}"></div>` : ""}
        <div class="form-field"><label>الحد الائتماني</label><input name="creditLimit" type="number" min="0" value="${item?.creditLimit ?? 0}"></div>
        <div class="form-field"><label>${item ? "الرصيد الحالي (محسوب تلقائيًا)" : "رصيد افتتاحي"}</label><input name="balance" type="number" value="${item?.balance ?? 0}" ${item ? "readonly" : ""}></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">حفظ</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

function addShipmentModal(item = null) {
  const finance=shipmentFinanceValues(item||{});
  openModal(item ? "تعديل بيانات الشحنة" : "إنشاء شحنة جديدة", "الشحن والتوصيل", `
    <form id="shipment-form" data-edit-id="${item?.id || ""}">
      <div class="form-grid">
        <div class="form-field"><label class="required">رقم الفاتورة / الطلب</label><input name="orderId" required value="${esc(item?.orderId || "")}" placeholder="INV-1049"></div>
        <div class="form-field"><label class="required">شركة الشحن</label><select name="company" required>${shippingCompanyOptions(item?.company)}</select></div>
        <div class="form-field"><label class="required">كود التتبع</label><input name="tracking" required value="${esc(item?.tracking || "")}"></div>
        <div class="form-field"><label>المتابعة التلقائية</label><select name="trackingEnabled"><option value="true" ${item?.trackingEnabled !== false ? "selected" : ""}>مفعلة</option><option value="false" ${item?.trackingEnabled === false ? "selected" : ""}>غير مفعلة</option></select><small>تعمل تلقائيًا مع البريد المصري عند وجود رقم تتبع.</small></div>
        <div class="form-field"><label class="required">اسم العميل</label><input name="customer" required value="${esc(item?.customer || "")}"></div>
        <div class="form-field"><label>رقم الهاتف</label><input name="phone" value="${esc(item?.phone || "")}"></div>
        <div class="form-field"><label class="required">المحافظة</label><select name="governorate" required>${governorateOptions(item?.governorate)}</select></div>
        <div class="form-field"><label>المدينة</label><input name="city" value="${esc(item?.city || "")}"></div>
        <div class="form-field full"><label>العنوان التفصيلي</label><input name="address" value="${esc(item?.address || "")}"></div>
        <div class="form-field"><label for="shipment-extra-cost">${financeConceptTitle("تكلفة شركة الشحن المتوقعة","التكلفة المتوقع أن تتحملها المكتبة مقابل الشحنة. تصبح مصروفًا فعليًا عند التسوية.")}</label><input ${numericFieldAttributes({ id:"shipment-extra-cost", name:"cost", value:item?.carrierShippingCostExpected ?? item?.cost ?? 0 })}></div>
        <div class="form-field full"><label>الحالة</label><select name="status">${Object.values(SHIPPING_STATUSES).map(meta => `<option ${shipmentStatusMeta(item || {}).label === meta.label ? "selected" : ""}>${meta.label}</option>`).join("")}</select></div>
      </div>
      <div class="shipment-finance-preview"><strong>ملخص مالي داخلي — لا يظهر في فاتورة العميل</strong><div><span>قيمة المنتجات<b>${money(finance.productsValue)}</b></span><span>الشحن المحصل من العميل<b>${money(finance.customerShippingCharge)}</b></span><span>إجمالي التحصيل<b>${money(finance.collectionAmount)}</b></span><span>عمولة متوقعة<b>${money(finance.collectionCommissionExpected)}</b></span><span>صافي تحويل متوقع<b>${money(finance.expectedNetSettlement)}</b></span></div></div>
      <div class="form-actions"><button class="btn" type="submit">حفظ الشحنة</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

function cashModal(type, item = null) {
  openModal(`${item ? "تعديل" : "إضافة"} سند ${type}`, "الحسابات والخزائن", `
    <form id="cash-form" data-type="${type}" data-edit-id="${item?.id || ""}">
      <div class="form-grid">
        <div class="form-field"><label>الخزنة / الحساب</label><select name="account">${cashAccountOptions(item?.account)}</select></div>
        <div class="form-field"><label class="required">المبلغ</label><input name="amount" type="number" min="0.01" required value="${item?.amount || ""}"></div>
        <div class="form-field"><label>التصنيف</label><select name="category">${["مبيعات","مشتريات","إيجار","رواتب","شحن وتوصيل","مرافق","مصروفات أخرى","تحصيل مديونية"].map(category => `<option ${item?.category === category ? "selected" : ""}>${category}</option>`).join("")}</select></div>
        <div class="form-field"><label>التاريخ</label><input name="date" type="date" value="${item?.date || today()}"></div>
        <div class="form-field full"><label class="required">الطرف / البيان</label><input name="party" required value="${esc(item?.party || "")}"></div>
        <div class="form-field full"><label>ملاحظات</label><textarea name="note">${esc(item?.note || "")}</textarea></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">حفظ السند</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

function cashAccountModal(item = null) {
  openModal(item ? "تعديل خزنة / حساب" : "إضافة خزنة / حساب", "الحسابات والخزائن", `
    <form id="cash-account-form" data-edit-id="${item?.id || ""}">
      <div class="form-grid">
        <div class="form-field full"><label class="required">اسم الخزنة / الحساب</label><input name="name" required value="${esc(item?.name || "")}" placeholder="مثال: خزنة الفرع الثاني"></div>
        <div class="form-field"><label>نوع الحساب</label><select name="accountType">${["خزنة نقدية","حساب بنكي","محفظة إلكترونية","حساب آخر"].map(v=>`<option ${item?.accountType===v?"selected":""}>${v}</option>`).join("")}</select></div>
        <div class="form-field"><label>رصيد افتتاحي</label><input name="openingBalance" type="number" step="0.01" value="${item?.openingBalance ?? 0}" ${item?"readonly":""}><small>${item?"لا يُعدّل بعد الإنشاء؛ استخدم حركة موثقة.":"ينشئ أساس الرصيد عند فتح الحساب."}</small></div>
        <div class="form-field"><label>العملة</label><input name="currency" value="${esc(item?.currency||data.settings.currency||"ج.م")}"></div>
        <div class="form-field"><label>الحالة</label><select name="active"><option value="true" ${item?.active !== false ? "selected" : ""}>نشطة</option><option value="false" ${item?.active === false ? "selected" : ""}>موقوفة</option></select></div>
        <div class="form-field full"><label>ملاحظات</label><textarea name="notes">${esc(item?.notes||"")}</textarea></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">حفظ الخزنة</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

function cashTransferModal() {
  openModal("تحويل بين الخزن", "الحسابات والخزائن", `
    <form id="cash-transfer-form">
      <div class="form-grid">
        <div class="form-field"><label class="required">من خزنة</label><select name="fromAccount" required>${cashAccountOptions()}</select></div>
        <div class="form-field"><label class="required">إلى خزنة</label><select name="toAccount" required>${cashAccountOptions(activeCashAccounts()[1]?.name || "")}</select></div>
        <div class="form-field"><label class="required">المبلغ</label><input name="amount" type="number" min="0.01" step="0.01" required></div>
        <div class="form-field"><label>التاريخ</label><input name="date" type="date" value="${today()}"></div>
        <div class="form-field full"><label>ملاحظات</label><input name="note" value="تحويل بين الخزن"></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">تنفيذ التحويل</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

function financeExpenseModal(item=null) {
  const types=(data.expenseTypes||[]).filter(type=>type.active!==false&&!type.deletedAt);
  const draft=pendingFinanceFormDraft?.kind==="expense"?pendingFinanceFormDraft.values:null;
  pendingFinanceFormDraft=null;
  const selectedTypeId=draft?.expenseTypeId||item?.expenseTypeId||currentFinanceType("expense","",item?.expenseType)?.id||types[0]?.id||"";
  openModal(item?"تعديل المصروف":"إضافة مصروف","المالية",`<form id="finance-expense-form" data-edit-id="${item?.id||""}"><div class="form-grid">
    <div class="form-field"><label class="required">التاريخ</label><input name="date" type="date" required value="${draft?.date||item?.date||today()}"></div>
    <div class="form-field"><div class="field-label-row"><label class="required">نوع المصروف</label>${canAction("manage-finance-types")?`<button class="inline-link" type="button" data-action="quick-add-finance-type" data-kind="expense">＋ إضافة نوع جديد</button>`:""}</div><select name="expenseTypeId" required>${types.map(type=>`<option value="${esc(type.id)}" ${selectedTypeId===type.id?"selected":""}>${esc(type.name)}</option>`).join("")}</select></div>
    <div class="form-field"><label class="required">المبلغ</label><input ${numericFieldAttributes({name:"amount",value:draft?.amount||item?.amount||"",required:true})}></div>
    <div class="form-field"><label class="required">الخزنة أو الحساب</label><select name="account" required>${cashAccountOptions(draft?.account||item?.account)}</select></div>
    <div class="form-field"><label>طريقة الدفع</label><select name="paymentMethod">${["نقدي","تحويل بنكي","محفظة إلكترونية","أخرى"].map(v=>`<option ${item?.paymentMethod===v?"selected":""}>${v}</option>`).join("")}</select></div>
    <div class="form-field"><label>المستفيد / المورد</label><input name="beneficiary" value="${esc(draft?.beneficiary||item?.beneficiary||"")}"></div>
    <div class="form-field"><label>رقم المرجع</label><input name="reference" value="${esc(draft?.reference||item?.reference||"")}"></div>
    <div class="form-field"><label>المصدر</label><select name="source">${["يدوي","تسوية شركة شحن","مرتجع","مشتريات","قيد عكسي","مصدر آخر"].map(v=>`<option ${item?.source===v?"selected":""}>${v}</option>`).join("")}</select></div>
    <div class="form-field"><label>رقم الطلب</label><input name="orderId" value="${esc(item?.orderId||"")}"></div><div class="form-field"><label>رقم الفاتورة</label><input name="invoiceId" value="${esc(item?.invoiceId||"")}"></div>
    <div class="form-field"><label>رقم الشحنة</label><input name="shipmentId" value="${esc(item?.shipmentId||"")}"></div><div class="form-field"><label>رقم التسوية</label><input name="settlementId" value="${esc(item?.settlementId||"")}"></div>
    <div class="form-field full"><label>ملاحظات</label><textarea name="notes">${esc(draft?.notes||item?.notes||"")}</textarea></div></div><div class="form-actions"><button class="btn" type="submit">حفظ كمسجل</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div></form>`);
  setTimeout(()=>modalBody.querySelector('[name="date"]')?.focus(),0);
}

function financeIncomeModal(selectedTypeId="") {
  const draft=pendingFinanceFormDraft?.kind==="income"?pendingFinanceFormDraft.values:{};
  pendingFinanceFormDraft=null;
  const types=(data.incomeTypes||[]).filter(type=>type.active!==false&&!type.deletedAt);
  const selected=selectedTypeId||draft.incomeTypeId||types[0]?.id||"";
  openModal("إضافة إيراد آخر","المالية",`<div class="modal-context-note">${helpIcon("استخدمها فقط لتسجيل دخل خارج مبيعات الكتب، مثل تعويض من شركة شحن أو عمولة من مورد. مبيعات الفواتير لا تُسجل هنا مرة أخرى.","شرح الإيرادات الأخرى")}<span>هذا النموذج للدخل خارج المبيعات فقط.</span></div><form id="finance-income-form"><div class="form-grid"><div class="form-field"><label>التاريخ</label><input name="date" type="date" value="${draft.date||today()}"></div><div class="form-field"><div class="field-label-row"><label>نوع الإيراد</label>${canAction("manage-finance-types")?`<button class="inline-link" type="button" data-action="quick-add-finance-type" data-kind="income">＋ إضافة نوع جديد</button>`:""}</div><select name="incomeTypeId">${types.map(type=>`<option value="${esc(type.id)}" ${selected===type.id?"selected":""}>${esc(type.name)}</option>`).join("")}</select></div><div class="form-field"><label>المبلغ</label><input ${numericFieldAttributes({name:"amount",value:draft.amount||"",required:true})}></div><div class="form-field"><label>الحساب</label><select name="account">${cashAccountOptions(draft.account)}</select></div><div class="form-field"><label>طريقة الاستلام</label><select name="receiptMethod">${["نقدي","تحويل بنكي","محفظة إلكترونية"].map(value=>`<option ${draft.receiptMethod===value?"selected":""}>${value}</option>`).join("")}</select></div><div class="form-field"><label>الجهة الدافعة</label><input name="payer" value="${esc(draft.payer||"")}"></div><div class="form-field"><label>رقم المرجع</label><input name="reference" value="${esc(draft.reference||"")}"></div><div class="form-field full"><label>ملاحظات</label><textarea name="notes">${esc(draft.notes||"")}</textarea></div></div><div class="form-actions"><button class="btn" type="submit">حفظ كمسجل</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div></form>`);
  setTimeout(()=>modalBody.querySelector('[name="date"]')?.focus(),0);
}

function financeTypesModal(kind="expense", editId="", quick=false) {
  const income=kind==="income", list=income?(data.incomeTypes||[]):(data.expenseTypes||[]);
  const item=list.find(type=>type.id===editId);
  const title=quick?`إضافة نوع ${income?"إيراد":"مصروف"} جديد`:`إدارة أنواع ${income?"الإيرادات":"المصروفات"}`;
  openModal(title,"إعدادات المالية",`<form id="finance-type-form" data-kind="${kind}" data-edit-id="${esc(item?.id||"")}" data-quick="${quick?"1":"0"}"><div class="form-grid"><div class="form-field"><label class="required">اسم النوع</label><input name="name" required value="${esc(item?.name||"")}"></div>${income?`<div class="form-field full"><label>وصف مختصر</label><textarea name="description" rows="2">${esc(item?.description||"")}</textarea></div>`:`<div class="form-field"><label>التصنيف</label><select name="category">${["تشغيل","شحن","إدارة","تسويق"].map(value=>`<option ${item?.category===value?"selected":""}>${value}</option>`).join("")}</select></div><div class="form-field"><label>الاستخدام</label><select name="mode">${["يدوي","آلي ويدوي"].map(value=>`<option ${item?.mode===value?"selected":""}>${value}</option>`).join("")}</select></div><div class="form-field"><label>شركة الشحن</label><select name="carrier"><option value="">غير مرتبط</option>${activeShippingCompanies().map(c=>`<option ${item?.carrier===c.name?"selected":""}>${esc(c.name)}</option>`).join("")}</select></div>`}<div class="form-field"><label>الحالة</label><select name="active"><option value="true" ${item?.active!==false?"selected":""}>مفعل</option><option value="false" ${item?.active===false?"selected":""}>متوقف</option></select></div></div><div class="form-actions"><button class="btn" type="submit">${item?"حفظ التعديل":"إضافة النوع"}</button>${quick?`<button class="btn ghost" type="button" data-action="cancel-quick-finance-type">رجوع</button>`:""}</div></form>${quick?"":`<div class="type-list">${list.map(type=>`<div><div><strong>${esc(type.name)}</strong><span>${esc(income?(type.description||"بدون وصف"):(type.category||"تشغيل"))} · ${type.active===false?"متوقف":"مفعل"}</span></div><button class="row-action" data-action="edit-finance-type" data-kind="${kind}" data-id="${type.id}">تعديل</button><button class="row-action" data-action="toggle-finance-type" data-kind="${kind}" data-id="${type.id}">${type.active===false?"إعادة التفعيل":"تعطيل"}</button></div>`).join("")}</div>`}`);
  setTimeout(()=>modalBody.querySelector('[name="name"]')?.focus(),0);
}

function newSettlementModal(item=null) {
  const relatedExpenses=item?.id?(data.expenses||[]).filter(expense=>expense.settlementId===item.id):[];
  openModal(item?`التسوية ${item.id}`:"تسوية تحصيل جديدة","المالية",`<form id="finance-settlement-form" data-edit-id="${item?.id||""}"><div class="form-grid"><div class="form-field"><label>شركة الشحن</label><select name="company" required>${shippingCompanyOptions(item?.company)}</select></div><div class="form-field"><label>تاريخ التحويل</label><input name="transferDate" type="date" value="${item?.transferDate||today()}"></div><div class="form-field"><label>مرجع التحويل</label><input name="transferReference" value="${esc(item?.transferReference||"")}"></div><div class="form-field"><label>الحساب المستلم</label><select name="account">${cashAccountOptions(item?.account)}</select></div><div class="form-field full"><label>أكواد التتبع — كود في كل سطر</label><textarea name="trackingCodes" rows="6" dir="ltr" placeholder="EG123456789EG">${esc((item?.trackingCodes||[]).join("\n"))}</textarea><small>سيتم حذف المسافات والتكرارات تلقائيًا، مع توضيح الأكواد غير الموجودة وغير المؤهلة.</small></div><div class="form-field"><label>المبلغ المستلم فعليًا</label><input ${numericFieldAttributes({name:"actualNetSettlement",value:item?.actualNetSettlement||0})}></div><div class="form-field"><label>خصومات أخرى</label><input ${numericFieldAttributes({name:"otherDeductions",value:item?.otherDeductions||0})}></div><div class="form-field"><label>سبب الفرق</label><select name="differenceReason"><option value="">بدون فرق</option>${["رسوم شحن إضافية","رسوم مرتجع","خصم من شركة الشحن","عمولة مختلفة","تحصيل جزئي","خطأ في قيمة الطلب","تعويض","فرق غير معروف يحتاج مراجعة","سبب آخر"].map(v=>`<option ${item?.differenceReason===v?"selected":""}>${v}</option>`).join("")}</select></div><div class="form-field full"><label>ملاحظات</label><textarea name="notes">${esc(item?.notes||"")}</textarea></div></div><div class="form-actions">${item?.status&&item.status!=="مسودة"?`<span>${expenseStatusBadge(item.status)}</span>`:`<button class="btn secondary" type="submit">حفظ المسودة</button>`}${item?.id&&item.status!=="تمت التسوية"?`<button class="btn" type="button" data-action="approve-settlement" data-id="${item.id}">اعتماد التسوية</button>`:""}<button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div></form>${item?.lines?.length?`<div class="table-wrap"><table><thead><tr><th>التتبع</th><th>المستندات</th><th>العميل</th><th>الحالة</th><th>التحصيل</th><th>تكلفة الشحن</th><th>العمولة</th><th>الصافي</th></tr></thead><tbody>${item.lines.map(line=>`<tr><td><button class="row-action" data-modal-action="notification-view-shipment" data-id="${esc(line.shipmentId)}" dir="ltr">${esc(line.trackingNumber)}</button></td><td><div class="row-actions">${line.orderId?`<button class="row-action" data-modal-action="notification-view-invoice" data-id="${esc(line.orderId)}">${esc(line.orderId)}</button>`:""}${line.invoiceId&&line.invoiceId!==line.orderId?`<button class="row-action" data-modal-action="notification-view-invoice" data-id="${esc(line.invoiceId)}">${esc(line.invoiceId)}</button>`:""}</div></td><td>${esc(line.customer||"—")}</td><td>${shipmentStatusBadge(data.shipments.find(s=>s.id===line.shipmentId)||{})}</td><td>${money(line.collectionAmount)}</td><td>${money(line.carrierShippingCostExpected)}</td><td>${money(line.collectionCommissionExpected)}</td><td>${money(line.expectedNetSettlement)}</td></tr>`).join("")}</tbody></table></div>`:""}${relatedExpenses.length?`<div class="finance-callout"><strong>المصروفات المرتبطة</strong><span>${relatedExpenses.map(expense=>`${expense.id} — ${expense.expenseType} — ${money(expense.amount)}`).join(" · ")}</span></div>`:""}`);
  if (!canAction("approve-settlement")) modalBody.querySelector('[data-action="approve-settlement"]')?.remove();
  if (!canAction("create-settlement")) modalBody.querySelector('#finance-settlement-form button[type="submit"]')?.remove();
}

function partyReceiptsTable(list) {
  if (!list.length) return `<div class="empty-state"><div class="empty-icon">▧</div><h3>لا توجد إيصالات أطراف</h3><p>أنشئ إيصال دفع أو استلام لعميل أو مورد.</p></div>`;
  return `<table><thead><tr><th>رقم الإيصال</th><th>التاريخ</th><th>النوع</th><th>الطرف</th><th>المبلغ</th><th>الطريقة</th><th>تأثير الرصيد</th><th>الحالة</th><th></th></tr></thead><tbody>
    ${list.slice().reverse().map(item => `<tr>
      <td><strong>${esc(item.id)}</strong><br><span class="muted">${esc(item.reference || "")}</span></td>
      <td>${fmtDate(item.date)}</td>
      <td>${badge(`إيصال ${item.type}`, item.type === "دفع" ? "danger" : "")}</td>
      <td>${esc(item.partyName)}<br><span class="muted">${item.partyKind === "customer" ? "عميل" : "مورد"}</span></td>
      <td class="money">${money(item.amount)}</td>
      <td>${esc(item.method)}</td>
      <td>${item.balanceMode === "settle" ? `تسوية ${money(item.balanceApplied || 0)}` : item.balanceMode === "advance" ? `مقدم ${money(item.advanceApplied || 0)}` : "بدون تأثير"}</td>
      <td>${badge(item.status || "معتمد", item.status === "ملغى" ? "danger" : "")}</td>
      <td><div class="row-actions"><button class="row-action" data-action="view-party-voucher" data-id="${item.id}">عرض / طباعة</button>${item.status !== "ملغى" ? `<button class="row-action text-danger" data-action="cancel-party-voucher" data-id="${item.id}">إلغاء</button>` : ""}</div></td>
    </tr>`).join("")}
  </tbody></table>`;
}

function statementRecordAction(reference = "") {
  const ref = String(reference || "");
  if (ref.startsWith("INV-")) return "view-sale";
  if (ref.startsWith("PUR-")) return "view-purchase";
  if (ref.startsWith("RCP-") || ref.startsWith("PAY-")) return "view-party-voucher";
  if (ref.startsWith("SH-")) return "view-shipment";
  if (ref.startsWith("SR-") || ref.startsWith("PR-") || ref.startsWith("RET-")) return "view-return";
  return "";
}

function voucherPartyPanelMarkup(kind = "customer", partyId = "") {
  const list = kind === "customer" ? data.customers : data.suppliers;
  const party = list.find(item => item.id === partyId) || list[0];
  if (!party) {
    return `<div class="voucher-party-panel"><div class="empty-state"><div class="empty-icon">👤</div><h3>لا يوجد طرف محدد</h3><p>اختر عميلًا أو موردًا لعرض الرصيد والتعاملات.</p></div></div>`;
  }
  const rows = statementRows(party.id, kind);
  const debit = rows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const credit = rows.reduce((sum, row) => sum + Number(row.credit || 0), 0);
  return `<aside class="voucher-party-panel" id="voucher-party-panel">
    <div class="voucher-balance-card">
      <span>${kind === "customer" ? "رصيد العميل" : "رصيد المورد"}</span>
      <strong>${money(party.balance || 0)}</strong>
      <small>${esc(party.name)} — ${esc(party.id)}</small>
      ${party.phone ? `<small dir="ltr">${esc(party.phone)}</small>` : ""}
    </div>
    <div class="mini-ledger-summary">
      <div><span>إجمالي مدين</span><strong>${money(debit)}</strong></div>
      <div><span>إجمالي دائن / مسدد</span><strong>${money(credit)}</strong></div>
    </div>
    <div class="card-header compact"><div><h3>تعاملات الطرف</h3><p>كل حركة مرتبطة بالفاتورة أو الإجراء الخاص بها.</p></div><button class="row-action" type="button" data-action="statement" data-kind="${kind}" data-id="${party.id}">كشف كامل</button></div>
    <div class="table-wrap voucher-ledger-table"><table><thead><tr><th>التاريخ</th><th>المرجع</th><th>البيان</th><th>مدين</th><th>دائن</th><th></th></tr></thead><tbody>
      ${rows.slice(0, 12).map(row => {
        const action = statementRecordAction(row.reference);
        return `<tr><td>${fmtDate(row.date)}</td><td><strong>${esc(row.reference)}</strong><br><span class="muted">${esc(row.status || "معتمد")}</span></td><td>${esc(row.description)}</td><td class="money">${row.debit ? money(row.debit) : "—"}</td><td class="money">${row.credit ? money(row.credit) : "—"}</td><td>${action ? `<button class="row-action" type="button" data-action="open-statement-record" data-reference="${esc(row.reference)}" data-record-action="${action}">فتح</button>` : `<span class="muted">—</span>`}</td></tr>`;
      }).join("") || `<tr><td colspan="6" class="text-center muted">لا توجد تعاملات مسجلة لهذا الطرف.</td></tr>`}
    </tbody></table></div>
  </aside>`;
}

function updateVoucherPartyPanel() {
  const form = document.getElementById("party-voucher-form");
  if (!form) return;
  const kind = form.elements.partyKind?.value || document.getElementById("voucher-party-kind")?.value || "customer";
  const partyId = form.elements.partyId?.value || "";
  const panel = document.getElementById("voucher-party-panel");
  if (panel) panel.outerHTML = voucherPartyPanelMarkup(kind, partyId);
}

function openStatementRecord(reference = "") {
  const ref = String(reference || "");
  if (ref.startsWith("INV-")) return viewSale(ref);
  if (ref.startsWith("PUR-")) return viewPurchase(ref);
  if (ref.startsWith("RCP-") || ref.startsWith("PAY-")) return viewPartyVoucher(ref);
  if (ref.startsWith("SH-")) return viewShipment(ref);
  if(ref.startsWith("SET-"))return newSettlementModal((data.carrierSettlements||[]).find(item=>item.id===ref));
  if(ref.startsWith("COL-")){closeModal();financeTab="order-collections";navigate("accounting");return setTimeout(()=>document.getElementById(`collection-${CSS.escape(ref)}`)?.scrollIntoView({block:"center"}),80);}
  if(ref.startsWith("EXP-")){closeModal();financeTab="expenses";return navigate("accounting");}
  if(ref.startsWith("TX-"))return viewCashTransaction(ref);
  const returnDoc = (data.returns || []).find(item => item.id === ref || returnNo(item) === ref || item.returnInvoiceId === ref);
  if (returnDoc) return viewReturn(returnDoc.id);
  return toast("لم يتم العثور على المستند المرتبط بهذه الحركة.", "error");
}

function partyVoucherModal(type = "استلام", kind = "", partyId = "") {
  const kinds = kind ? [kind] : ["customer", "supplier"];
  const selectedKind = kind || "customer";
  const parties = selectedKind === "customer" ? data.customers : data.suppliers;
  const selectedParty = parties.find(item => item.id === partyId) || parties[0];
  openModal(`إيصال ${type}`, "إيصالات العملاء والموردين", `
    <form id="party-voucher-form" data-voucher-type="${type}">
      <div class="voucher-form-layout">
        <div class="voucher-form-main">
          <div class="form-grid">
            <div class="form-field"><label class="required">نوع الطرف</label><select name="partyKind" id="voucher-party-kind" ${kind ? "disabled" : ""}>${kinds.map(value => `<option value="${value}" ${value === selectedKind ? "selected" : ""}>${value === "customer" ? "عميل" : "مورد"}</option>`).join("")}</select>${kind ? `<input type="hidden" name="partyKind" value="${kind}">` : ""}</div>
            <div class="form-field"><label class="required">الطرف</label><select name="partyId" id="voucher-party-id" required>${parties.map(item => `<option value="${item.id}" ${item.id === selectedParty?.id ? "selected" : ""}>${esc(item.name)} — الرصيد ${money(item.balance || 0)}</option>`).join("")}</select></div>
            <div class="form-field"><label class="required">المبلغ</label><input name="amount" type="number" min="0.01" step="0.01" required></div>
            <div class="form-field"><label>التاريخ</label><input name="date" type="date" value="${today()}"></div>
            <div class="form-field"><label>الخزنة / الحساب</label><select name="account">${cashAccountOptions()}</select></div>
            <div class="form-field"><label>طريقة الدفع</label><select name="method"><option>نقدي</option><option>Visa</option><option>تحويل بنكي</option><option>InstaPay</option><option>محفظة إلكترونية</option><option>شيك</option></select></div>
            <div class="form-field full"><label>تأثير الإيصال على كشف الحساب</label><select name="balanceMode"><option value="settle">خصم من المديونية القائمة</option><option value="advance">تسجيل دفعة مقدمة للطرف</option><option value="none">بدون تأثير على الرصيد</option></select></div>
            <div class="form-field"><label>رقم مرجعي / رقم شيك</label><input name="reference"></div>
            <div class="form-field"><label>البيان</label><input name="note" value="${type === "استلام" ? "استلام مبلغ من الطرف" : "دفع مبلغ للطرف"}"></div>
          </div>
          <div class="alert-item" style="margin-top:15px"><div class="alert-badge ${type === "دفع" ? "red" : "blue"}">${type === "دفع" ? "↑" : "↓"}</div><div><strong>${type === "استلام" ? "سيُضاف المبلغ إلى الخزنة" : "سيُخصم المبلغ من الخزنة"}</strong><span>عند اختيار تسوية المديونية، سيُخصم المبلغ من رصيد الطرف المستحق.</span></div></div>
        </div>
        ${voucherPartyPanelMarkup(selectedKind, selectedParty?.id)}
      </div>
      <div class="form-actions"><button class="btn ${type === "دفع" ? "danger" : ""}" type="submit">اعتماد وحفظ الإيصال</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

function nextVoucherId(type) {
  const prefix = type === "استلام" ? "RCP-" : "PAY-";
  const max = data.receipts
    .filter(item => String(item.id).startsWith(prefix))
    .reduce((value, item) => Math.max(value, Number(String(item.id).replace(/\D/g, "")) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function createPartyVoucher(payload, options = {}) {
  const list = payload.partyKind === "customer" ? data.customers : data.suppliers;
  const party = list.find(item => item.id === payload.partyId);
  const amount = Number(payload.amount || 0);
  if (!party) throw new Error("اختر عميلًا أو موردًا صحيحًا.");
  if (amount <= 0) throw new Error("يجب إدخال مبلغ أكبر من صفر.");

  let balanceApplied = 0;
  let advanceApplied = 0;
  if (payload.balanceMode === "settle") {
    balanceApplied = Math.min(amount, Math.max(0, Number(party.balance || 0)));
    party.balance = Math.max(0, Number(party.balance || 0) - balanceApplied);
  } else if (payload.balanceMode === "advance") {
    advanceApplied = amount;
    party.advance = Number(party.advance || 0) + amount;
  }

  const receipt = {
    id: nextVoucherId(payload.type),
    date: payload.date || today(),
    type: payload.type,
    partyKind: payload.partyKind,
    partyId: party.id,
    partyName: party.name,
    amount,
    account: payload.account,
    method: payload.method,
    balanceMode: payload.balanceMode,
    balanceApplied,
    advanceApplied,
    reference: payload.reference || "",
    note: payload.note || "",
    status: "معتمد",
    createdAt: new Date().toISOString()
  };
  data.receipts.push(receipt);
  data.cash.push({
    id: nextId("TX-", data.cash),
    date: receipt.date,
    type: receipt.type === "استلام" ? "قبض" : "صرف",
    locked: true,
    account: receipt.account,
    party: receipt.partyName,
    amount: receipt.amount,
    category: receipt.partyKind === "customer"
      ? (receipt.type === "استلام" ? "تحصيل عميل" : "دفع / رد لعميل")
      : (receipt.type === "دفع" ? "سداد مورد" : "استرداد من مورد"),
    note: `${receipt.id} — ${receipt.note}`,
    receiptId: receipt.id
  });
  if (!options.skipSave) saveData(`إنشاء إيصال ${receipt.type}`, receipt.partyKind === "customer" ? "العملاء" : "الموردون", receipt.id);
  return receipt;
}

function employeeModal(item = null) {
  openModal(`${item ? "تعديل" : "إضافة"} موظف`, "الموارد البشرية", `
    <form id="employee-form" data-edit-id="${item?.id || ""}">
      <div class="form-grid">
        <div class="form-field full"><label class="required">اسم الموظف</label><input name="name" required value="${esc(item?.name || "")}"></div>
        <div class="form-field"><label>الوظيفة</label><select name="role">${["مدير","محاسب","بائع / كاشير","مدير مخزن","أمين مخزن","مسؤول مشتريات","مسؤول متجر إلكتروني","مسؤول شحن","موارد بشرية"].map(role => `<option ${item?.role === role ? "selected" : ""}>${role}</option>`).join("")}</select></div>
        <div class="form-field"><label>الراتب الشهري</label><input name="salary" type="number" min="0" value="${item?.salary ?? 0}"></div>
        <div class="form-field"><label>الحضور اليوم</label><select name="attendance">${["حاضر","غائب","إجازة","لم يسجل"].map(status => `<option ${item?.attendance === status ? "selected" : ""}>${status}</option>`).join("")}</select></div>
        <div class="form-field"><label>نطاق الصلاحيات</label><input name="permissions" value="${esc(item?.permissions || "")}" placeholder="مثال: المبيعات فقط"></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">حفظ الموظف</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

document.getElementById("main-nav").addEventListener("click", event => {
  const item = event.target.closest("[data-view]");
  if (item) {
    if (item.dataset.partyTabTarget) partyTab = item.dataset.partyTabTarget;
    navigate(item.dataset.view);
  }
});
document.getElementById("sidebar-new-sale").addEventListener("click", () => {
  if (!canView("sales") || !requireAction("new-sale-invoice")) return;
  resetSaleDraft();
  salesScreenMode = "invoice";
  currentView = "sales";
  render();
  setTimeout(() => document.getElementById("sale-book-search")?.focus(), 50);
});
document.getElementById("sidebar-collapse").addEventListener("click", () => {
  const shell = document.getElementById("app-shell");
  const collapsed = shell.classList.toggle("sidebar-collapsed");
  localStorage.setItem("dotcom-sidebar-collapsed", collapsed ? "1" : "0");
});
document.getElementById("login-form").addEventListener("submit", event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  login(String(form.get("username") || "").trim(), String(form.get("password") || ""));
});

function approveExpense(id) {
  const item=(data.expenses||[]).find(row=>row.id===id);
  if(!item||item.status!=="مسجل") return toast("المصروف غير متاح للاعتماد.","error");
  const sourceKey=`expense:${item.id}:cash-out`;
  if(data.cash.some(row=>row.sourceKey===sourceKey)) return toast("تم اعتماد هذا المصروف من قبل.","error");
  const actor=actorSnapshot(), now=new Date().toISOString();
  item.status="معتمد"; item.approvedAt=now; item.approvedBy=actor.name; item.updatedAt=now;
  data.cash.push({id:nextId("TX-",data.cash),date:item.date,type:"صرف",direction:"out",movementType:"مصروف",account:item.account,party:item.beneficiary||item.expenseType,amount:Number(item.amount),category:item.expenseType,note:item.notes||"",expenseId:item.id,shipmentId:item.shipmentId||"",settlementId:item.settlementId||"",source:item.source||"يدوي",sourceKey,locked:true,status:"معتمد",createdAt:now,...{createdBy:actor.name,createdByUsername:actor.username}});
  saveData("اعتماد مصروف","المالية",item.id); renderAccounting(); toast("تم اعتماد المصروف وتسجيل حركة الصرف.");
}

function reverseFinanceDocument(kind,id) {
  const list=kind==="expense"?data.expenses:data.otherIncome;
  const item=list.find(row=>row.id===id);
  if(!item||item.status!=="معتمد") return toast("المستند غير متاح للإلغاء.","error");
  const original=data.cash.find(row=>row.expenseId===id||row.incomeId===id);
  const key=`reversal:${kind}:${id}`;
  if(data.cash.some(row=>row.sourceKey===key)) return toast("تم إنشاء القيد العكسي من قبل.","error");
  const actor=actorSnapshot(),now=new Date().toISOString(),reverseType=original?.type==="قبض"?"صرف":"قبض";
  data.cash.push({id:nextId("TX-",data.cash),date:today(),type:reverseType,direction:reverseType==="قبض"?"in":"out",movementType:"قيد عكسي",account:item.account,party:`عكس ${item.id}`,amount:Number(item.amount),category:"قيد عكسي",note:`إلغاء المستند ${item.id}`,reversalOf:original?.id||"",sourceKey:key,locked:true,status:"معتمد",createdAt:now,createdBy:actor.name,createdByUsername:actor.username});
  item.status="ملغي";item.cancelledAt=now;item.cancelledBy=actor.name;
  saveData(kind==="expense"?"إلغاء مصروف بقيد عكسي":"إلغاء إيراد بقيد عكسي","المالية",id);renderAccounting();toast("تم الإلغاء بقيد عكسي موثق.");
}

function approveOtherIncome(id) {
  const item=(data.otherIncome||[]).find(row=>row.id===id);
  if(!item||item.status!=="مسجل") return toast("الإيراد غير متاح للاعتماد.","error");
  const sourceKey=`income:${item.id}:cash-in`;
  if(data.cash.some(row=>row.sourceKey===sourceKey)) return toast("تم اعتماد هذا الإيراد من قبل.","error");
  const actor=actorSnapshot(),now=new Date().toISOString();
  item.status="معتمد";item.approvedAt=now;item.approvedBy=actor.name;
  data.cash.push({id:nextId("TX-",data.cash),date:item.date,type:"قبض",direction:"in",movementType:"دخل",account:item.account,party:item.payer||item.incomeType,amount:Number(item.amount),category:item.incomeType,note:item.notes||"",incomeId:item.id,source:"إيراد آخر",sourceKey,locked:true,status:"معتمد",createdAt:now,createdBy:actor.name,createdByUsername:actor.username});
  saveData("اعتماد إيراد آخر","المالية",id);renderAccounting();toast("تم اعتماد الإيراد وتسجيل حركة القبض.");
}

async function approveCarrierSettlement(id) {
  if(serverConnected){
    try{
      const response=await fetch(`/api/finance/settlements/${encodeURIComponent(id)}/approve`,{method:"POST",headers:authHeaders({"Content-Type":"application/json"})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)return toast(result.message||"تعذر اعتماد التسوية.","error");
      closeModal();
      await initializeDatabase();
      financeTab="settlements";renderAccounting();toast("تم اعتماد التسوية ذريًا وتسجيل التحصيل والمصروفات.");return;
    }catch(error){return toast(error.message||"تعذر الاتصال بخدمة المالية.","error");}
  }
  const settlement=(data.carrierSettlements||[]).find(row=>row.id===id);
  if(!settlement||settlement.status==="تمت التسوية") return toast("تم اعتماد هذه التسوية من قبل.","error");
  const actor=actorSnapshot(),now=new Date().toISOString();
  const cashKey=`settlement:${id}:cash-in`;
  if(data.cash.some(row=>row.sourceKey===cashKey)) return toast("توجد حركة معتمدة لهذه التسوية.","error");
  const invalid=(settlement.lines||[]).find(line=>{const shipment=data.shipments.find(s=>s.id===line.shipmentId);return shipment?.settlementId&&shipment.settlementId!==id});
  if(invalid) return toast(`الشحنة ${invalid.trackingNumber} تمت تسويتها سابقًا.`,"error");
  const totals=settlementSummary(settlement);
  const expected=centsMoney(moneyCents(totals.collection)-moneyCents(totals.actualCost)-moneyCents(totals.actualCommission)-moneyCents(settlement.otherDeductions||0));
  const actual=centsMoney(moneyCents(settlement.actualNetSettlement||0)),difference=centsMoney(moneyCents(actual)-moneyCents(expected));
  if(Math.abs(difference)>.01&&!settlement.differenceReason) return toast("يجب تحديد سبب الفرق قبل الاعتماد.","error");
  const nextCash=[],nextExpenses=[];
  nextCash.push({id:nextId("TX-",data.cash),date:settlement.transferDate,type:"قبض",direction:"in",movementType:"تسوية شركة شحن",account:settlement.account,party:settlement.company,amount:actual,category:"تسوية شركة شحن",settlementId:id,sourceKey:cashKey,locked:true,status:"معتمد",createdAt:now,createdBy:actor.name});
  for(const line of settlement.lines||[]) {
    const shipment=data.shipments.find(s=>s.id===line.shipmentId);
    const shippingKey=`shipment:${line.shipmentId}:settlement:${id}:shipping-cost`,commissionKey=`shipment:${line.shipmentId}:settlement:${id}:commission`;
    const addExpense=(amount,type,key)=>{if(Number(amount)<=0||data.expenses.some(e=>e.sourceKey===key))return;const expenseType=currentFinanceType("expense","",type);const expense={id:nextId("EXP-",[...data.expenses,...nextExpenses]),date:settlement.transferDate,expenseTypeId:expenseType?.id||"",expenseType:type,amount:Number(amount),account:settlement.account,beneficiary:settlement.company,source:"تسوية شركة شحن",shipmentId:line.shipmentId,settlementId:id,status:"معتمد",sourceKey:key,createdAt:now,approvedAt:now,createdBy:actor.name,approvedBy:actor.name};nextExpenses.push(expense);nextCash.push({id:nextId("TX-",[...data.cash,...nextCash]),date:settlement.transferDate,type:"صرف",direction:"out",movementType:"مصروف",account:settlement.account,party:settlement.company,amount:Number(amount),category:type,expenseId:expense.id,shipmentId:line.shipmentId,settlementId:id,sourceKey:key,locked:true,status:"معتمد",createdAt:now,createdBy:actor.name});};
    addExpense(line.carrierShippingCostActual ?? line.carrierShippingCostExpected,carrierFinanceSettings(settlement.company).shippingExpenseType,shippingKey);
    addExpense(line.collectionCommissionActual ?? line.collectionCommissionExpected,carrierFinanceSettings(settlement.company).commissionExpenseType,commissionKey);
    if(shipment){shipment.settlementId=id;shipment.financialSettlementStatus=Math.abs(difference)>.01?"يوجد فرق":"تمت التسوية";shipment.settledAt=now;shipment.settledBy=actor.name;shipment.carrierShippingCostActual=Number(line.carrierShippingCostActual ?? line.carrierShippingCostExpected ?? 0);shipment.collectionCommissionActual=Number(line.collectionCommissionActual ?? line.collectionCommissionExpected ?? 0);}
  }
  data.cash.push(...nextCash);data.expenses.push(...nextExpenses);
  settlement.expectedNetSettlement=expected;settlement.settlementDifference=difference;settlement.status=Math.abs(difference)>.01?"يوجد فرق":"تمت التسوية";settlement.approvedAt=now;settlement.approvedBy=actor.name;
  saveData("اعتماد تسوية شركة شحن","المالية",id);closeModal();renderAccounting();toast("تم اعتماد التسوية وتسجيل التحصيل والمصروفات.");
}
document.getElementById("logout-btn").addEventListener("click", logout);

document.getElementById("menu-btn").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
document.getElementById("notification-btn").addEventListener("click", showNotificationCenter);
document.getElementById("close-modal").addEventListener("click", closeModal);
modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
document.addEventListener("click", event => {
  const help=event.target.closest?.("[data-help]");
  document.querySelectorAll(".context-help.open").forEach(button=>{if(button!==help){button.classList.remove("open");button.setAttribute("aria-expanded","false");}});
  if(help){
    event.preventDefault();
    const open=help.classList.toggle("open");
    help.setAttribute("aria-expanded",open?"true":"false");
    return;
  }
  const target=event.target.closest?.("#modal-backdrop [data-action]");
  if(!target)return;
  const action=target.dataset.action;
  if (["open-factory-reset","factory-reset-preview","factory-reset-prepare","factory-reset-execute"].includes(action) && !requireAction(action)) return;
  if (action === "open-factory-reset") openFactoryReset();
  if (action === "factory-reset-preview") factoryResetPreview();
  if (action === "factory-reset-prepare") factoryResetPrepare();
  if (action === "factory-reset-execute") executeFactoryReset(target);
  if(action === "season-wizard-back") openSeasonWizard(Number(target.dataset.step || 1));
  if(action === "confirm-start-season") confirmStartSeason(target);
  if(action==="quick-add-finance-type"){
    const form=target.closest("form");
    pendingFinanceFormDraft={kind:target.dataset.kind,values:Object.fromEntries(new FormData(form).entries()),editId:form?.dataset.editId||""};
    financeTypesModal(target.dataset.kind,"",true);
  }
  if(action==="cancel-quick-finance-type"){
    const draft=pendingFinanceFormDraft;
    if(draft?.kind==="income")financeIncomeModal();
    else financeExpenseModal(data.expenses.find(item=>item.id===draft?.editId));
  }
  if(action==="edit-finance-type")financeTypesModal(target.dataset.kind,target.dataset.id);
  if(action==="toggle-finance-type"){
    const list=target.dataset.kind==="income"?data.incomeTypes:data.expenseTypes;
    const type=list.find(item=>item.id===target.dataset.id);
    if(type){type.active=type.active===false;type.updatedAt=new Date().toISOString();saveData(`تغيير حالة نوع ${target.dataset.kind==="income"?"إيراد":"مصروف"}`,"المالية",type.id);financeTypesModal(target.dataset.kind);}
  }
  if(action==="confirm-finance-action"){
    const callback=pendingFinanceConfirmation;
    pendingFinanceConfirmation=null;
    closeModal();
    callback?.();
  }
  if(action==="approve-settlement")financeConfirmation({title:"اعتماد التسوية؟",description:"سيتم تسجيل المبلغ في الخزنة وإنشاء مصروفات الشحن وعمولة التحصيل تلقائيًا. تأكد من المبالغ قبل المتابعة.",confirmLabel:"اعتماد التسوية",onConfirm:()=>approveCarrierSettlement(target.dataset.id)});
  if(action==="prepare-order-issue")preparationIssueModal(target.dataset.id);
  if(action==="prepare-order-finish-choice")finishPreparationModal(target.dataset.id);
  if(action==="prepare-order-complete")(async()=>{try{await orderWorkflowRequest(`/api/orders/${encodeURIComponent(target.dataset.id)}/prepare/complete`);closeModal();onlineOrdersMode="ready-shipping";renderOnlineOrders();toast("تم التجهيز — الطلب جاهز للشحن.");}catch(error){toast(error.message,"error");}})();
  if(action==="pack-order-complete")(async()=>{try{await orderWorkflowRequest(`/api/orders/${encodeURIComponent(target.dataset.id)}/pack/complete`);closeModal();onlineOrdersMode="preparation";renderOnlineOrders();toast("تم التغليف والطلب جاهز للشحن.");}catch(error){toast(error.message,"error");}})();
});
document.addEventListener("submit", event => {
  if (event.target.id === "season-step-one") {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    seasonWizardState = { ...seasonWizardState, ...values };
    openSeasonWizard(2);
  }
  if (event.target.id === "season-step-two") {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    for (const key of Object.keys(seasonWizardState.preserve)) if (!["customers","suppliers","users","permissions","shipping","governorates","financeTypes","cashAccounts","settings","templates","integrations"].includes(key)) seasonWizardState.preserve[key] = values[key] === "on";
    openSeasonWizard(3);
  }
  if (event.target.id === "close-season-form") {
    event.preventDefault();
    submitCloseSeason(event.target);
  }
});
document.addEventListener("focusin", event => {
  configureNumericInput(event.target);
}, true);
document.addEventListener("input", event => {
  const input = event.target;
  if(input instanceof HTMLInputElement&&(
    input.dataset.normalizeDigits==="true"||
    ["numeric","decimal","tel"].includes(input.getAttribute("inputmode")||"")||
    ["quick-order-phone","quick-order-alt-phone","quick-shipping-order-code","quick-shipping-tracking"].includes(input.id)||
    ["tracking","trackingNumber","phone","alternativePhone"].includes(input.name)
  )){
    const before=input.value,normalized=normalizeArabicDigits(before);
    if(before!==normalized){
      const start=input.selectionStart,end=input.selectionEnd,direction=input.selectionDirection;
      input.value=normalized;
      if(start!==null&&end!==null)input.setSelectionRange(
        normalizeArabicDigits(before.slice(0,start)).length,
        normalizeArabicDigits(before.slice(0,end)).length,
        direction||"none"
      );
    }
  }
  if (!configureNumericInput(input)) return;
  const normalized = sanitizeNumericInputValue(input);
  if (input.value === normalized) return;
  const cursor = input.selectionStart;
  input.value = normalized;
  if (cursor !== null) input.setSelectionRange(Math.min(cursor, normalized.length), Math.min(cursor, normalized.length));
}, true);
document.addEventListener("change", event => {
  const input = event.target;
  if (!configureNumericInput(input)) return;
  input.value = sanitizeNumericInputValue(input, { commit:true });
}, true);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.querySelector(".context-help.open")) {
    document.querySelectorAll(".context-help.open").forEach(button=>{button.classList.remove("open");button.setAttribute("aria-expanded","false");});
    event.preventDefault();
    return;
  }
  if (event.key === "Escape" && !modal.hidden) {
    event.preventDefault();
    closeModal();
    return;
  }
  if (!(event.metaKey || event.ctrlKey) || currentView !== "sales" || salesScreenMode !== "invoice") return;
  if (event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.getElementById("sale-book-search")?.focus();
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (requireAction("save-sale")) saveSale({ printAfter: false });
  }
});

document.addEventListener("pointerover", event => {
  const wrap = event.target.closest?.(".table-wrap");
  if (wrap && tableWrapNeedsSticky(wrap)) {
    stickyTableScroll.wrap = wrap;
    scheduleStickyTableScrollbar();
  }
}, true);

document.addEventListener("click", event => {
  const wrap = event.target.closest?.(".table-wrap");
  if (wrap && tableWrapNeedsSticky(wrap)) {
    stickyTableScroll.wrap = wrap;
    scheduleStickyTableScrollbar();
  }
}, true);

document.addEventListener("scroll", event => {
  if (event.target?.classList?.contains("table-wrap")) {
    if (stickyTableScroll.syncing) return;
    stickyTableScroll.wrap = event.target;
    const bar = stickyTableScroll.bar;
    if (bar && !bar.hidden) {
      stickyTableScroll.syncing = true;
      bar.scrollLeft = event.target.scrollLeft;
      stickyTableScroll.syncing = false;
    }
  }
  scheduleStickyTableScrollbar();
}, true);

window.addEventListener("resize", scheduleStickyTableScrollbar);

new MutationObserver(scheduleStickyTableScrollbar).observe(root, { childList: true, subtree: true });
new MutationObserver(scheduleStickyTableScrollbar).observe(modalBody, { childList: true, subtree: true });

async function submitOrderCollection(payload,{silent=false}={}) {
  if(!serverConnected)throw new Error("تسجيل التحصيل يحتاج تشغيل الخادم المحلي.");
  const response=await fetch("/api/finance/order-collections",{method:"POST",headers:authHeaders({"Content-Type":"application/json"}),body:JSON.stringify(payload)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok){
    if(result.previous){
      await reloadRemoteData();
      orderCollectionDraft={trackingNumber:payload.trackingNumber,amount:payload.amount,collectionDate:payload.collectionDate||today(),shipmentId:result.previous.shipmentId};
      renderAccounting();
    }
    throw new Error(result.message||"تعذر تسجيل التحصيل.");
  }
  dbRevision=response.headers.get("X-DB-Revision")||result.revision||dbRevision;
  await reloadRemoteData();
  if(!silent)toast(`تم تسجيل تحصيل الأوردر ${result.collection.orderId} بمبلغ ${money(result.collection.amount)}.`);
  return result.collection;
}

async function reverseOrderCollection(id) {
  if(!confirm("سيتم عكس عملية التحصيل وقيودها المرتبطة. هل تريد المتابعة؟"))return;
  const reason=prompt("سبب التصحيح أو الإلغاء:","تصحيح عملية تحصيل")||"";
  try{
    const response=await fetch(`/api/finance/order-collections/${encodeURIComponent(id)}/reverse`,{method:"POST",headers:authHeaders({"Content-Type":"application/json"}),body:JSON.stringify({reason})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.message||"تعذر عكس عملية التحصيل.");
    await reloadRemoteData();renderAccounting();toast("تم عكس عملية التحصيل والقيود المرتبطة.");
  }catch(error){toast(error.message,"error");}
}

root.addEventListener("click", async event => {
  const target = event.target.closest("[data-action], [data-view-jump], [data-party-tab]");
  if (!target) return;
  if(target instanceof HTMLButtonElement&&target.type!=="submit")event.preventDefault();
  if(target instanceof HTMLButtonElement&&target.hasAttribute("data-action")&&!target.hasAttribute("type"))event.preventDefault();
  if (target.dataset.viewJump) return navigate(target.dataset.viewJump);
  if (target.dataset.partyTab) {
    partyTab = target.dataset.partyTab;
    return renderParties();
  }
  const action = target.dataset.action;
  if (action && !requireAction(action)) return;
  if (action === "dashboard-stat") showDashboardStatDetails(target.dataset.stat);
  if (action === "sales-stat") showSalesStatDetails(target.dataset.stat);
  if (action === "online-order-stat") applyOnlineOrderQuickFilter(target.dataset.stat);
  if (action === "online-orders-mode") { const nextMode=target.dataset.mode;quickOrderAutofocusPending=nextMode==="quick"&&onlineOrdersMode!=="quick";onlineOrdersMode=nextMode;renderOnlineOrders(); }
  if (action === "ship-ready-order") shipReadyOrderModal(target.dataset.id);
  if (action === "reopen-order-preparation") {
    if(confirm("تم تجهيز هذا الطلب بالفعل. إعادة فتحه ستعيده إلى مرحلة التجهيز لمراجعة محتويات الطرد."))orderWorkflowRequest(`/api/orders/${encodeURIComponent(target.dataset.id)}/prepare/reopen`).then(()=>{onlineOrdersMode="preparation";renderOnlineOrders();toast("تمت إعادة فتح الطلب للتجهيز.");}).catch(error=>toast(error.message,"error"));
  }
  if (action === "quick-shipping-confirm") {
    const order=shippingLookupOrder(quickShippingOrderId),trackingNumber=document.getElementById("quick-shipping-tracking")?.value||"";
    if(!order)return toast("ابحث عن طلب جاهز أولًا.","error");
    target.disabled=true;
    submitReadyOrderShipment(order.id,{company:shippingSessionCompany,trackingNumber}).then(()=>{quickShippingOrderId="";renderOnlineOrders();}).catch(error=>{target.disabled=false;toast(error.message,"error");});
  }
  if (action === "batch-shipping-preview") {
    batchShippingPreviewRows=parseBatchShippingText(document.getElementById("batch-shipping-input")?.value||"");renderOnlineOrders();
  }
  if (action === "batch-shipping-confirm") {
    const valid=batchShippingPreviewRows.filter(row=>row.ok);if(!valid.length)return toast("لا توجد شحنات صحيحة للحفظ.","error");
    target.disabled=true;
    fetch("/api/orders/shipping/batch",{method:"POST",headers:authHeaders({"Content-Type":"application/json"}),body:JSON.stringify({company:shippingSessionCompany,rows:valid})}).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.message||"تعذر حفظ الشحنات.");await reloadRemoteData();const saved=result.results.filter(row=>row.ok).length,failed=result.results.length-saved;batchShippingPreviewRows=[];renderOnlineOrders();toast(`تم شحن ${saved} طلب${failed?` · تعذر ${failed}`:""} بنجاح.`);}).catch(error=>{target.disabled=false;toast(error.message,"error");});
  }
  if (action === "quick-order-add-book") {
    const book=getBook(target.dataset.id);if(!book)return;
    const existing=quickOrderDraft.lines.find(line=>line.bookId===book.id);
    const ownReserved=quickOrderDraft.savedOrderId&&getOnlineOrder(quickOrderDraft.savedOrderId)?.inventoryReservation?.status==="active"?Number(getOnlineOrder(quickOrderDraft.savedOrderId).inventoryReservation.lines?.find(item=>item.bookId===book.id)?.qty||0):0;
    const available=bookAvailableStock(book)+ownReserved;
    if(existing){if(existing.qty>=available)return toast(`المتاح للبيع من ${book.name} هو ${available}.`,"error");existing.qty++;}
    else if(available<=0)return toast(`لا توجد كمية متاحة للبيع من ${book.name}.`,"error");
    else quickOrderDraft.lines.push({bookId:book.id,qty:1,price:Number(book.price||0),discount:Number(book.discount??book.saleDiscount??0),discountType:book.discountType==="amount"?"amount":"percent",discountScope:"unit"});
    quickOrderSearch="";if(!quickOrderDraft.shippingManual)quickOrderDraft.shippingCost=quickOrderShipping(quickOrderDraft.governorate,quickOrderDraft.lines);renderQuickOrderPreservingContext({focusSelector:"#quick-order-book-search"});
  }
  if (action === "quick-order-remove-book") { quickOrderDraft.lines.splice(Number(target.dataset.index),1);renderQuickOrderPreservingContext(); }
  if (action === "quick-order-reset-shipping") { quickOrderDraft.shippingManual=false;quickOrderDraft.shippingCost=quickOrderShipping(quickOrderDraft.governorate,quickOrderDraft.lines);renderQuickOrderPreservingContext(); }
  if (action === "quick-order-toggle-governorate") { const input=document.getElementById("quick-order-governorate-search");openQuickGovernorateList(input?.getAttribute("aria-expanded")!=="true");input?.focus(); }
  if (action === "quick-order-select-governorate") selectQuickGovernorate(target.dataset.value);
  if (action === "quick-order-copy") copyQuickOrderMessage();
  if (action === "quick-order-save") saveQuickOrderDraft().then(renderOnlineOrders).catch(error=>toast(error.message,"error"));
  if (action === "quick-order-confirm") saveAndConfirmQuickOrder();
  if (action === "quick-order-new") { quickOrderDraft=emptyQuickOrderDraft();quickOrderSearch="";quickOrderAutofocusPending=true;renderOnlineOrders(); }
  if (action === "prepare-order-start") openPreparationOrder(target.dataset.id,true);
  if (action === "prepare-order-open") openPreparationOrder(target.dataset.id);
  if (action === "edit-quick-order") editQuickOrder(target.dataset.id);
  if (action === "cancel-online-order") cancelOnlineOrder(target.dataset.id);
  if (action === "cancellation-open-ledger") { closeModal(); showStatement(target.dataset.id,"customer"); }
  if (action === "cancellation-finalize") {
    const kind=target.dataset.kind,id=target.dataset.id;
    if(confirm(`تمت التسوية المالية. هل تريد ${kind==="sale"?"إبطال الفاتورة":"إلغاء الطلب"} الآن؟`))orderWorkflowRequest(cancellationEndpoint(kind,id,"cancel"),{body:{reason:"إلغاء بعد اكتمال التسوية المالية"}}).then(()=>{closeModal();kind==="sale"?renderSales():renderOnlineOrders();toast("تم إلغاء المستند بعد التسوية المالية.");}).catch(error=>toast(error.message,"error"));
  }
  if (action === "confirm-online-order") confirmExistingOnlineOrder(target.dataset.id);
  if (action === "shipping-stat") applyShippingStatFilter(target.dataset.stat);
  if (action === "open-notifications") showNotificationCenter();
  if (action === "dashboard-alert-open") {
    if (target.dataset.kind === "online-order") viewOnlineOrder(target.dataset.id);
    else navigateToRecord(["shipment", "tracking-alert"].includes(target.dataset.kind) ? "shipment" : "book", target.dataset.id, "view");
  }
  if (action === "dashboard-alert-edit-book") navigateToRecord("book", target.dataset.id, "edit");
  if (action === "dashboard-alert-adjust-stock") navigateToRecord("book", target.dataset.id, "adjust");
  if (action === "dashboard-alert-buy-book") preparePurchaseForBook(target.dataset.id);
  if (action === "dashboard-alert-edit-shipment") navigateToRecord("shipment", target.dataset.id, "edit");
  if (action === "dashboard-alert-view-invoice") navigateToRecord("invoice", target.dataset.id, "view");
  if (action === "refresh-dashboard-shipments") refreshDashboardShipments();
  if (action === "dashboard-view-shipment") navigateToRecord("shipment", target.dataset.id, "view");
  if (action === "test-local-rpa") testLocalRpaService();
  if (action === "retry-pending-tracking") retryPendingTracking();
  if (action === "refresh-season-management") { seasonManagementState.loading = true; renderSettings(); }
  if (action === "preview-demo-data") previewDemoData();
  if (action === "open-factory-reset") openFactoryReset();
  if (action === "factory-reset-preview") factoryResetPreview();
  if (action === "factory-reset-prepare") factoryResetPrepare();
  if (action === "factory-reset-execute") executeFactoryReset(target);
  if (action === "start-season-wizard") { seasonWizardState = { ...seasonWizardState, step:1, name:"", academicYear:"", startsAt:today(), notes:"" }; openSeasonWizard(1); }
  if (action === "view-seasons") showSeasons();
  if (action === "close-season") closeSeasonModal(target.dataset.id);
  if (action === "add-book") addBookModal();
  if (action === "register-sale-customer") addPartyModal("customer", null, { returnToSale: true });
  if (action === "new-sale-invoice") {
    salesScreenMode = "invoice";
    resetSaleDraft();
    renderSales();
  }
  if (action === "sales-main") {
    salesScreenMode = "main";
    renderSales();
  }
  if (action === "choose-sale-customer") {
    draftSale.customerId = target.dataset.id;
    renderSales();
  }
  if (action === "add-online-order") onlineOrderModal();
  if (action === "view-online-order") viewOnlineOrder(target.dataset.id);
  if (action === "edit-online-order") onlineOrderModal(getOnlineOrder(target.dataset.id));
  if (action === "convert-order-sale") convertOnlineOrderToSale(target.dataset.id);
  if (action === "create-order-shipment") createShipmentFromOrder(target.dataset.id);
  if (action === "quick-add-sale-book") addBookToDraftSale(target.dataset.id, document.getElementById("sale-quick-qty")?.value || 1);
  if (action === "quick-add-purchase-book") addBookToDraftPurchase(target.dataset.id, document.getElementById("purchase-quick-qty")?.value || 1);
  if (action === "view-book") viewBook(target.dataset.id);
  if (action === "edit-book") addBookModal(getBook(target.dataset.id));
  if (action === "delete-book") deleteBook(target.dataset.id);
  if (action === "add-customer") addPartyModal("customer");
  if (action === "add-supplier") addPartyModal("supplier");
  if (action === "party-voucher") partyVoucherModal(target.dataset.voucherType, target.dataset.kind || "", target.dataset.id || "");
  if (action === "view-party-voucher") viewPartyVoucher(target.dataset.id);
  if (action === "cancel-party-voucher") cancelPartyVoucher(target.dataset.id);
  if (action === "edit-party") {
    const item = target.dataset.kind === "customer" ? getCustomer(target.dataset.id) : getSupplier(target.dataset.id);
    addPartyModal(target.dataset.kind, item);
  }
  if (action === "delete-party") await deleteParty(target.dataset.id, target.dataset.kind);
  if (action === "add-shipment") return toast("تم إلغاء إنشاء الشحنة اليدوي. أنشئ الشحنة من أمر بيع أو طلب أونلاين مؤكد حتى تكون مرتبطة بمستند حقيقي.", "error");
  if (action === "view-shipment") viewShipment(target.dataset.id);
  if (action === "delete-shipment") deleteShipment(target.dataset.id);
  if (action === "add-cash-in") cashModal("قبض");
  if (action === "add-cash-out") cashModal("صرف");
  if (action === "add-cash-account") cashAccountModal();
  if (action === "edit-cash-account") cashAccountModal(data.cashAccounts.find(item => item.id === target.dataset.id));
  if (action === "cash-transfer") cashTransferModal();
  if (action === "view-cash") viewCashTransaction(target.dataset.id);
  if (action === "edit-cash") {
    const item = data.cash.find(row => row.id === target.dataset.id);
    if (isLockedCash(item)) toast("هذه حركة تلقائية مرتبطة بمستند ولا يمكن تعديلها يدويًا. ألغِ المستند الأصلي بدل تعديل القيد.", "error");
    else cashModal(item.type, item);
  }
  if (action === "delete-cash") deleteCash(target.dataset.id);
  if (action === "finance-tab") { financeTab=target.dataset.tab; renderAccounting(); }
  if (action === "collection-mode") { orderCollectionMode=target.dataset.mode;orderCollectionBatchRows=[];renderAccounting(); }
  if (action === "open-previous-collection") document.getElementById(`collection-${CSS.escape(target.dataset.id)}`)?.scrollIntoView({behavior:"smooth",block:"center"});
  if (action === "finance.collection.reverse") reverseOrderCollection(target.dataset.id);
  if (action === "review-collection-batch") { orderCollectionBatchRows=parseOrderCollectionBatch(document.getElementById("order-collection-batch-input")?.value||"");renderAccounting(); }
  if (action === "save-collection-batch") {
    const valid=orderCollectionBatchRows.filter(row=>row.status==="matched"||(row.status==="difference"&&row.differenceReason));
    if(!valid.length)return toast("لا توجد صفوف مطابقة جاهزة للحفظ.","error");
    target.disabled=true;
    (async()=>{let saved=0;for(const row of valid){try{await submitOrderCollection({trackingNumber:row.code,amount:row.amount,collectionDate:today(),registrationType:"collected_by_carrier",differenceReason:row.differenceReason||""},{silent:true});saved++;}catch(error){toast(`${row.code}: ${error.message}`,"error");}}orderCollectionBatchRows=[];renderAccounting();toast(`تم حفظ ${saved} تحصيل بنجاح.`);})();
  }
  if (action === "finance-report-preset") { financeReportFilters.preset=target.dataset.preset; renderAccounting(); }
  if (action === "add-expense") financeExpenseModal();
  if (action === "edit-expense") financeExpenseModal(data.expenses.find(item=>item.id===target.dataset.id));
  if (action === "approve-expense") approveExpense(target.dataset.id);
  if (action === "reverse-expense") financeConfirmation({title:"إلغاء المصروف المعتمد؟",description:"سيتم إنشاء قيد عكسي يلغي أثر المصروف مع الاحتفاظ بالسجل الأصلي للمراجعة.",confirmLabel:"إنشاء القيد العكسي",tone:"danger",onConfirm:()=>reverseFinanceDocument("expense",target.dataset.id)});
  if (action === "add-other-income") financeIncomeModal();
  if (action === "approve-other-income") approveOtherIncome(target.dataset.id);
  if (action === "reverse-other-income") financeConfirmation({title:"إلغاء الإيراد المعتمد؟",description:"سيتم إنشاء قيد عكسي يلغي أثر الإيراد مع الاحتفاظ بالسجل الأصلي للمراجعة.",confirmLabel:"إنشاء القيد العكسي",tone:"danger",onConfirm:()=>reverseFinanceDocument("income",target.dataset.id)});
  if (action === "manage-expense-types") financeTypesModal("expense");
  if (action === "manage-income-types") financeTypesModal("income");
  if (action === "quick-add-finance-type") {
    const form=target.closest("form");
    pendingFinanceFormDraft={kind:target.dataset.kind,values:Object.fromEntries(new FormData(form).entries()),editId:form?.dataset.editId||""};
    financeTypesModal(target.dataset.kind,"",true);
  }
  if (action === "cancel-quick-finance-type") {
    const draft=pendingFinanceFormDraft;
    if(draft?.kind==="income")financeIncomeModal();
    else financeExpenseModal(data.expenses.find(item=>item.id===draft?.editId));
  }
  if (action === "edit-finance-type") financeTypesModal(target.dataset.kind,target.dataset.id);
  if (action === "toggle-finance-type") {
    const list=target.dataset.kind==="income"?data.incomeTypes:data.expenseTypes;
    const type=list.find(item=>item.id===target.dataset.id);
    if(type){type.active=type.active===false;type.updatedAt=new Date().toISOString();saveData(`تغيير حالة نوع ${target.dataset.kind==="income"?"إيراد":"مصروف"}`,"المالية",type.id);financeTypesModal(target.dataset.kind);}
  }
  if (action === "confirm-finance-action") {
    const callback=pendingFinanceConfirmation;
    pendingFinanceConfirmation=null;
    closeModal();
    callback?.();
  }
  if (action === "new-settlement") newSettlementModal();
  if (action === "view-settlement") newSettlementModal(data.carrierSettlements.find(item=>item.id===target.dataset.id));
  if (action === "approve-settlement") financeConfirmation({title:"اعتماد التسوية؟",description:"سيتم تسجيل المبلغ في الخزنة وإنشاء مصروفات الشحن وعمولة التحصيل تلقائيًا. تأكد من المبالغ قبل المتابعة.",confirmLabel:"اعتماد التسوية",onConfirm:()=>approveCarrierSettlement(target.dataset.id)});
  if (action === "add-employee") employeeModal();
  if (action === "view-employee") viewEmployee(target.dataset.id);
  if (action === "edit-employee") employeeModal(data.employees.find(item => item.id === target.dataset.id));
  if (action === "delete-employee") deleteEmployee(target.dataset.id);
  if (action === "add-sale-line") {
    draftSale.lines.push({ bookId: "", qty: 1, price: 0, discount: 0, discountType: "percent" });
    renderSales();
  }
  if (action === "reset-sale") {
    resetSaleDraft();
    salesScreenMode = "invoice";
    renderSales();
  }
  if (action === "add-purchase-line") {
    draftPurchase.lines.push({ bookId: "", qty: 1, cost: 0, discount: 0, discountType: "percent" });
    renderPurchases();
  }
  if (action === "new-purchase-document") resetPurchaseDraft();
  if (action === "save-sale") saveSale({ printAfter: target.dataset.printAfter === "1" });
  if (action === "toggle-sale-options") document.getElementById("sale-extra-options")?.setAttribute("open", "");
  if (action === "view-sale") viewSale(target.dataset.id);
  if (action === "return-sale") saleReturnModal(target.dataset.id);
  if (action === "close-sales-day") closeSalesDay();
  if (action === "print-sales-day") printSalesDay();
  if (action === "limited-edit-sale") limitedEditSale(target.dataset.id);
  if (action === "save-purchase") await savePurchase();
  if (action === "retry-stale-purchase") await retryStalePurchaseSave();
  if (action === "show-sales-list") showSalesList();
  if (action === "resume-sale-invoice") { salesScreenMode = "invoice"; renderSales(); }
  if (action === "clear-sales-search") {
    const search = document.getElementById("old-sales-search");
    const status = document.getElementById("old-sales-status");
    if (search) search.value = "";
    if (status) status.value = "";
    updateSalesHistorySearch();
    search?.focus();
  }
  if (action === "edit-sale-payment") salePaymentModal(target.dataset.id);
  if (action === "cancel-sale") cancelSale(target.dataset.id);
  if (action === "delete-sale") deleteSale(target.dataset.id);
  if (action === "show-purchases-list") showPurchasesList();
  if (action === "view-purchase") viewPurchase(target.dataset.id);
  if (action === "receive-purchase") receivePurchase(target.dataset.id);
  if (action === "return-purchase") purchaseReturnModal(target.dataset.id);
  if (action === "cancel-purchase") cancelPurchase(target.dataset.id);
  if (action === "delete-purchase") deletePurchase(target.dataset.id);
  if (action === "new-sale-return-customer") saleReturnByCustomerModal();
  if (action === "new-purchase-return-supplier") purchaseReturnBySupplierModal();
  if (action === "open-return-search") showReturnSearch();
  if (action === "open-sale-return-list") showReturnDocumentPicker("sale");
  if (action === "open-purchase-return-list") showReturnDocumentPicker("purchase");
  if (action === "start-sale-return") saleReturnModal(target.dataset.id);
  if (action === "start-purchase-return") purchaseReturnModal(target.dataset.id);
  if (action === "view-return") viewReturn(target.dataset.id);
  if (action === "print-return") printReturn(target.dataset.id);
  if (action === "adjust-stock") adjustStock(target.dataset.id);
  if (action === "stock-count") stockCountModal();
  if (action === "statement") showStatement(target.dataset.id, target.dataset.kind);
  if (action === "update-shipment") addShipmentModal(data.shipments.find(item => item.id === target.dataset.id));
  if (action === "edit-shipment-status") shipmentStatusQuickModal(target.dataset.id);
  if (action === "shipment-history") shipmentHistoryModal(target.dataset.id);
  if (action === "add-shipment-complaint") addShipmentComplaintModal(target.dataset.id);
  if (action === "shipment-complaints") shipmentComplaintsModal(target.dataset.id);
  if (action === "edit-shipment-complaint") editShipmentComplaintModal(target.dataset.id);
  if (action === "update-tracking-now") updateShipmentTrackingNow(target.dataset.id);
  if (action === "show-tracking-debug") showTrackingDebug(target.dataset.id);
  if (action === "copy-tracking-code") copyShipmentTrackingCode(target.dataset.id);
  if (action === "open-egypt-post") openEgyptPostTrackingSite();
  if (action === "open-egypt-post-with-code") openEgyptPostWithCode(target.dataset.id);
  if (action === "manual-tracking-result") manualTrackingResultModal(target.dataset.id);
  if (action === "quick-manual-tracking") quickManualTracking(target.dataset.id, target.dataset.status);
  if (action === "update-all-tracking") updateAllTrackingNow();
  if (action === "reset-shipping-filters") resetShippingFilters();
  if (action === "test-tracking-connection") testTrackingConnection();
  if (action === "prepare-complaint") prepareShipmentComplaint(target.dataset.id);
  if (action === "shipping-companies") showShippingCompanies();
  if (action === "edit-shipping-company") editShippingCompany(target.dataset.id);
  if (action === "delete-shipping-company") deleteShippingCompany(target.dataset.id);
  if (action === "whatsapp-report") toast("تم تجهيز التقرير؛ ربط WhatsApp Business مطلوب للإرسال الفعلي.");
  if (action === "save-settings") saveSettings();
  if (action === "backup-db") createBackup();
  if (action === "audit-log") showAuditLog();
  if (action === "customize-role") customizeRole(target.dataset.role);
  if (action === "customize-user") customizeUser(target.dataset.username);
  if (action === "open-report") openReport(Number(target.dataset.report));
  if (action === "open-product-movement") {
    productMovementState = { ...productMovementState, bookId:target.dataset.id || "", page:1 };
    currentView = "reports";
    renderProductMovementReport(productMovementState.bookId);
  }
  if (action === "product-movement-range") refreshProductMovementReport({ quickRange:target.dataset.range || "all", page:1 });
  if (action === "product-movement-page") refreshProductMovementReport({ page:Number(target.dataset.page || 1) });
  if (action === "print-product-movement") printProductMovementReport();
  if (action === "export-product-movement") exportProductMovementCsv();
  if (action === "product-movement-open-document") {
    const report = productMovementReportData(productMovementState);
    const row = report?.allRows.find(item => item.id === target.dataset.movementId);
    if (!row) toast("تعذر العثور على تفاصيل الحركة.", "error");
    else if (row.document?.kind === "sale") viewSale(row.document.record.id);
    else if (row.document?.kind === "purchase") viewPurchase(row.document.record.id);
    else if (row.document?.kind === "return") viewReturn(row.document.record.id || row.document.record.returnNo);
    else viewBook(productMovementState.bookId);
  }
  if (action === "reports-main") renderReports();
  if (action === "export-report") exportReportCsv(Number(target.dataset.report));
  if (action === "print-sale") printSale(target.dataset.id, target.dataset.format || "a4");
  if (action === "print-purchase") printPurchase(target.dataset.id, target.dataset.format || "a4");
  if (action === "print-voucher") printVoucher(target.dataset.id, target.dataset.format || "a4");
  if (action === "print-online-order") printOnlineOrder(target.dataset.id, target.dataset.format || "a4");
  if (action === "print-statement") printStatement(target.dataset.id, target.dataset.kind);
  if (action === "print-cash-daily") printCashDaily();
  if (action === "restore-db") showRestoreBackups();
  if (action === "restore-backup") restoreBackup(target.dataset.file);
  if (action === "trial-balance") showTrialBalance();
  if (action === "chart-accounts") showChartOfAccounts();
  if (action === "omni-refresh") renderOmnichannel();
  if (action === "omni-simulate-whatsapp") omniSimulate("whatsapp");
  if (action === "omni-simulate-messenger") omniSimulate("messenger");
  if (action === "omni-open") omniOpenConversation(target.dataset.id);
  if (action === "omni-claim") omniClaim(target.dataset.id, target.dataset.version);
  if (action === "omni-send") omniSendAdvanced(target.dataset.id);
  if (action === "omni-toggle-emoji") {
    const picker = document.getElementById("omni-emoji-picker");
    if (picker) picker.hidden = !picker.hidden;
  }
  if (action === "omni-insert-emoji") {
    omniInsertAtCursor(document.getElementById("omni-reply-text"), target.dataset.emoji || "");
  }
  if (action === "omni-reply-to") { selectedOmniReplyToMessageId = target.dataset.id; omniOpenConversation(selectedOmniConversationId, { scroll: false }); }
  if (action === "omni-cancel-reply") { selectedOmniReplyToMessageId = ""; omniOpenConversation(selectedOmniConversationId, { scroll: false }); }
  if (action === "omni-clear-attachment") { selectedOmniAttachment = null; omniOpenConversation(selectedOmniConversationId, { scroll: false }); }
  if (action === "omni-message-retry") omniApi(`/messages/${encodeURIComponent(target.dataset.id)}/retry`, { method: "POST" }).then(() => omniOpenConversation(selectedOmniConversationId)).catch(error => toast(`تعذر إعادة المحاولة: ${error.message}`, "error"));
  if (action === "omni-close") omniApi(`/conversations/${encodeURIComponent(target.dataset.id)}/close`, { method: "POST" }).then(() => renderOmnichannel()).catch(error => toast(`تعذر الإغلاق: ${error.message}`, "error"));
  if (action === "omni-release") omniApi(`/conversations/${encodeURIComponent(target.dataset.id)}/release`, { method: "POST" }).then(() => renderOmnichannel()).catch(error => toast(`تعذر release: ${error.message}`, "error"));
  if (action === "omni-account-new") omniAccountModal();
  if (action === "omni-account-edit") omniAccountModal(target.dataset.id);
  if (action === "omni-account-test") omniAccountAction("test-connection", target.dataset.id).catch(error => toast(`تعذر اختبار الاتصال: ${error.message}`, "error"));
  if (action === "omni-account-activate") omniAccountAction("activate", target.dataset.id).catch(error => toast(`تعذر التفعيل: ${error.message}`, "error"));
  if (action === "omni-account-deactivate" && confirm("تأكيد تعطيل حساب القناة؟")) omniAccountAction("deactivate", target.dataset.id).catch(error => toast(`تعذر التعطيل: ${error.message}`, "error"));
  if (action === "omni-account-delete" && confirm("حذف ناعم لحساب القناة؟ لن يتم حذف المحادثات القديمة.")) omniAccountAction("delete", target.dataset.id).catch(error => toast(`تعذر الحذف: ${error.message}`, "error"));
  if (target.classList.contains("sale-remove")) {
    draftSale.lines.splice(Number(target.dataset.index), 1);
    if (!draftSale.lines.length) draftSale.lines.push({ bookId: "", qty: 1, price: 0, discount: 0, discountType: "percent" });
    renderSales();
  }
  if (target.classList.contains("purchase-remove")) {
    draftPurchase.lines.splice(Number(target.dataset.index), 1);
    if (!draftPurchase.lines.length) draftPurchase.lines.push({ bookId: "", qty: 1, cost: 0, discount: 0, discountType: "percent" });
    renderPurchases();
  }
});

root.addEventListener("keydown", event => {
  if(onlineOrdersMode==="quick"&&event.key==="Tab"&&event.target.closest(".quick-order-layout")){
    const fields=[...root.querySelectorAll(".quick-order-layout input:not([disabled]), .quick-order-layout select:not([disabled]), .quick-order-layout textarea:not([disabled])")]
      .filter(node=>!node.hidden&&node.getClientRects().length&&node.tabIndex!==-1);
    const index=fields.indexOf(event.target),nextIndex=index+(event.shiftKey?-1:1);
    if(index!==-1&&fields[nextIndex]){
      event.preventDefault();
      fields[nextIndex].focus({preventScroll:true});
      return;
    }
  }
  if(event.target.id==="quick-shipping-order-code"&&event.key==="Enter"){
    event.preventDefault();const order=shippingLookupOrder(event.target.value);quickShippingOrderId=order?.id||String(event.target.value||"").trim().toUpperCase();renderOnlineOrders();setTimeout(()=>document.getElementById("quick-shipping-tracking")?.focus(),0);return;
  }
  if(event.target.id==="quick-shipping-tracking"&&event.key==="Enter"){
    event.preventDefault();document.getElementById("quick-shipping-confirm")?.click();return;
  }
  if(onlineOrdersMode==="quick"&&(event.ctrlKey||event.metaKey)&&event.key==="Enter"){
    event.preventDefault();if(canAction("order.quick.confirm"))saveAndConfirmQuickOrder();return;
  }
  if(event.target.id==="quick-order-book-search"&&event.key==="Enter"){
    event.preventDefault();const book=smartBookSearch(event.target.value,1)[0];if(book)root.querySelector(`[data-action="quick-order-add-book"][data-id="${CSS.escape(book.id)}"]`)?.click();return;
  }
  if(event.target.id==="quick-order-governorate-search"){
    const list=document.getElementById("quick-order-governorate-list"),visible=[...document.querySelectorAll("[data-action='quick-order-select-governorate']")].filter(option=>!option.hidden);
    if(event.key==="Escape"){event.preventDefault();openQuickGovernorateList(false);return;}
    if(["ArrowDown","ArrowUp"].includes(event.key)){
      event.preventDefault();openQuickGovernorateList(true);
      const active=visible.findIndex(option=>option.classList.contains("active")),next=event.key==="ArrowDown"?(active+1)%visible.length:(active<=0?visible.length-1:active-1);
      visible.forEach(option=>option.classList.remove("active"));if(visible[next]){visible[next].classList.add("active");event.target.setAttribute("aria-activedescendant",visible[next].id);visible[next].scrollIntoView({block:"nearest"});}return;
    }
    if(event.key==="Enter"){const active=visible.find(option=>option.classList.contains("active"))||visible[0];if(active){event.preventDefault();selectQuickGovernorate(active.dataset.value);}return;}
  }
  if (event.target.id === "omni-reply-text" && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    if (selectedOmniConversationId) omniSendAdvanced(selectedOmniConversationId);
    return;
  }
  const card = event.target.closest('.stat-card.interactive[data-action="dashboard-stat"], .stat-card.interactive[data-action="online-order-stat"], .stat-card.interactive[data-action="shipping-stat"], .stat-card.interactive[data-action="sales-stat"]');
  if (card && event.target === card && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    if (card.dataset.action === "online-order-stat") applyOnlineOrderQuickFilter(card.dataset.stat);
    else if (card.dataset.action === "shipping-stat") applyShippingStatFilter(card.dataset.stat);
    else if (card.dataset.action === "sales-stat") showSalesStatDetails(card.dataset.stat);
    else showDashboardStatDetails(card.dataset.stat);
    return;
  }
  const alertItem = event.target.closest('.dashboard-alert-item[data-action="dashboard-alert-open"]');
  if (alertItem && event.target === alertItem && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    navigateToRecord(alertItem.dataset.kind === "shipment" ? "shipment" : "book", alertItem.dataset.id, "view");
  }
  if (event.target.id === "sale-book-search" && event.key === "Enter") {
    event.preventDefault();
    const match = searchSaleBooks(event.target.value)[0];
    if (match) addBookToDraftSale(match.id, document.getElementById("sale-quick-qty")?.value || 1);
  }
  if (event.target.id === "purchase-book-search" && event.key === "Enter") {
    event.preventDefault();
    const match = smartBookSearch(event.target.value, 1)[0];
    if (match) addBookToDraftPurchase(match.id, document.getElementById("purchase-quick-qty")?.value || 1);
  }
  if (event.target.classList.contains("sale-book-picker") && event.key === "Enter") {
    event.preventDefault();
    selectSaleLineBook(Number(event.target.dataset.index), event.target.value);
  }
  if (event.target.classList.contains("purchase-book-picker") && event.key === "Enter") {
    event.preventDefault();
    selectPurchaseLineBook(Number(event.target.dataset.index), event.target.value);
  }
});

root.addEventListener("submit", async event => {
  if(event.target.id==="order-collection-search-form"){
    event.preventDefault();
    const formData=Object.fromEntries(new FormData(event.target));
    const code=normalizeTrackingNumber(formData.trackingNumber||""),amount=normalizeArabicNumericText(formData.amount||"");
    if(!code)return toast("أدخل كود الشحنة.","error");
    if(amount===""||!Number.isFinite(Number(amount))||Number(amount)<0)return toast("أدخل قيمة تحصيل صحيحة.","error");
    orderCollectionDraft={...orderCollectionDraft,trackingNumber:code,amount,collectionDate:formData.collectionDate||today(),shipmentId:findCollectionShipment(code)?.id||""};
    renderAccounting();
    return;
  }
  if(event.target.id==="order-collection-confirm-form"){
    event.preventDefault();
    const formData=Object.fromEntries(new FormData(event.target)),preview=orderCollectionPreview(orderCollectionDraft.trackingNumber,orderCollectionDraft.amount);
    if(!preview.shipment)return toast("لم يتم العثور على الشحنة.","error");
    if(preview.difference!==0&&!formData.differenceReason)return toast("اختر سبب الفرق قبل التأكيد.","error");
    const button=event.target.querySelector('button[type="submit"]');button.disabled=true;button.textContent="جارٍ الحفظ...";
    try{
      await submitOrderCollection({...orderCollectionDraft,...formData});
      orderCollectionDraft={trackingNumber:"",amount:"",collectionDate:today(),shipmentId:"",differenceReason:"",notes:"",registrationType:"collected_by_carrier",account:""};
      renderAccounting();
    }catch(error){button.disabled=false;button.textContent="تأكيد التحصيل";toast(error.message,"error");}
  }
});

root.addEventListener("input", event => {
  if(event.target.id==="quick-order-phone"){
    event.target.value=normalizeArabicDigits(event.target.value);
    const previousCustomerId=quickOrderDraft.customerId;
    quickOrderDraft.phone=event.target.value;
    const matchedCustomer=quickOrderCustomer();
    if(normalizePhone(event.target.value).length===11&&(matchedCustomer?.id||"")!==previousCustomerId){
      quickOrderDraft.customerId="";
      renderQuickOrderPreservingContext();
    }
    return;
  }
  if(event.target.id==="quick-order-book-search"){quickOrderSearch=event.target.value;refreshQuickOrderBookResults();return;}
  if(event.target.id==="quick-order-governorate-search"){clearQuickOrderFieldError("governorate");openQuickGovernorateList(true);filterQuickGovernorates(event.target.value);return;}
  if(event.target.id==="quick-order-name"){quickOrderDraft.customerName=event.target.value;clearQuickOrderFieldError("customerName");return;}
  if(event.target.id==="quick-order-address"){quickOrderDraft.address=event.target.value;clearQuickOrderFieldError("address");return;}
  if(event.target.matches("[data-quick-order-qty]")){
    event.target.value=normalizeArabicNumericText(event.target.value).replace(/[^0-9]/g,"");
    const index=Number(event.target.dataset.quickOrderQty),line=quickOrderDraft.lines[index],book=getBook(line?.bookId);if(!line)return;
    const order=quickOrderDraft.savedOrderId?getOnlineOrder(quickOrderDraft.savedOrderId):null,ownReserved=order?.inventoryReservation?.status==="active"?Number(order.inventoryReservation.lines?.find(item=>item.bookId===line.bookId)?.qty||0):0;
    const parsed=OrderFinance.normalizeNumber(event.target.value);if(Number.isFinite(parsed)&&parsed>=1){line.qty=Math.max(1,Math.min(bookAvailableStock(book)+ownReserved,Math.trunc(parsed)));refreshQuickOrderComputedUi();}return;
  }
  if(event.target.matches("[data-quick-order-discount]")){
    event.target.value=normalizeArabicNumericText(event.target.value);
    const line=quickOrderDraft.lines[Number(event.target.dataset.quickOrderDiscount)],parsed=OrderFinance.normalizeNumber(event.target.value);if(line&&Number.isFinite(parsed)&&parsed>=0){const previous=line.discount;line.discount=parsed;try{if(!refreshQuickOrderComputedUi())line.discount=previous;}catch(error){line.discount=previous;}}return;
  }
  if(event.target.id==="quick-order-paid-amount"){event.target.value=normalizeArabicNumericText(event.target.value);const parsed=OrderFinance.normalizeNumber(event.target.value);if(Number.isFinite(parsed)&&parsed>=0){const previous=quickOrderDraft.paidAmount;quickOrderDraft.paidAmount=parsed;if(!refreshQuickOrderComputedUi())quickOrderDraft.paidAmount=previous;}return;}
  if(event.target.id==="quick-order-order-discount"){event.target.value=normalizeArabicNumericText(event.target.value);const parsed=OrderFinance.normalizeNumber(event.target.value);if(Number.isFinite(parsed)&&parsed>=0){const previous=quickOrderDraft.orderDiscount;quickOrderDraft.orderDiscount=parsed;if(!refreshQuickOrderComputedUi())quickOrderDraft.orderDiscount=previous;}return;}
  if(event.target.id==="quick-order-shipping-cost"){event.target.value=normalizeArabicNumericText(event.target.value);const parsed=OrderFinance.normalizeNumber(event.target.value);if(Number.isFinite(parsed)&&parsed>=0){quickOrderDraft.shippingCost=parsed;quickOrderDraft.shippingManual=true;refreshQuickOrderComputedUi();}return;}
  if(event.target.id==="order-collection-history-search"){orderCollectionSearch=event.target.value;return renderAccounting();}
  if (event.target.id === "book-search" || event.target.id === "book-category" || event.target.id === "book-stock-filter") filterBooks();
  if (event.target.id === "shipment-search" || event.target.id === "shipment-status" || event.target.id === "shipment-tracking-filter") filterShipments();
  if (event.target.id === "online-order-search") filterOnlineOrders();
  if (event.target.id === "old-sales-search") updateSalesHistorySearch();
  if (event.target.id === "sale-book-search") {
    const suggestions = document.getElementById("sale-book-suggestions");
    const matches = searchSaleBooks(event.target.value);
    if (suggestions) suggestions.innerHTML = matches.map(book => bookSuggestionButton(book, "quick-add-sale-book")).join("");
  }
  if (event.target.id === "purchase-book-search") {
    const suggestions = document.getElementById("purchase-book-suggestions");
    const matches = smartBookSearch(event.target.value, 8);
    if (suggestions) suggestions.innerHTML = matches.map(book => bookSuggestionButton(book, "quick-add-purchase-book", ` · مورد ${esc(getSupplier(book.supplierId)?.name || "—")}`)).join("");
  }
  if (event.target.id === "sale-customer-search") {
    const suggestions = document.getElementById("sale-customer-suggestions");
    const matches = searchCustomers(event.target.value);
    if (suggestions) {
      suggestions.innerHTML = matches.map(customer => `<button type="button" data-action="choose-sale-customer" data-id="${customer.id}">
        <strong>${esc(customer.name)}</strong>
        <span><span dir="ltr">${esc(customer.phone || "بدون هاتف")}</span> · ${esc([customer.governorate, customer.city].filter(Boolean).join("، ") || customer.id)}</span>
      </button>`).join("") || (event.target.value.trim() ? `<div class="customer-no-results">لا يوجد عميل مطابق. استخدم «تسجيل عميل جديد».</div>` : "");
    }
    if (!matches.some(customer => customer.id === draftSale.customerId && customer.name === event.target.value)) {
      draftSale.customerId = "";
      const details = document.getElementById("sale-customer-details");
      if (details) details.innerHTML = saleCustomerDetailsMarkup(null);
    }
  }
  const index = Number(event.target.dataset.index);
  if (event.target.classList.contains("sale-qty")) draftSale.lines[index].qty = Math.max(1, Number(event.target.value));
  if (event.target.classList.contains("sale-price")) draftSale.lines[index].price = Number(event.target.value);
  if (event.target.classList.contains("sale-discount")) draftSale.lines[index].discount = Number(event.target.value);
  if (event.target.id === "sale-paid") draftSale.paid = Math.max(0, Number(event.target.value || 0));
  if (event.target.id === "sale-invoice-discount") draftSale.invoiceDiscount = Math.max(0, Number(event.target.value || 0));
  if (event.target.classList.contains("sale-qty") || event.target.classList.contains("sale-price") || event.target.classList.contains("sale-discount") || event.target.id === "sale-invoice-discount") updateSaleSummary();
  if (event.target.id === "sale-paid") updateSaleSummary();
  if (event.target.classList.contains("purchase-qty")) draftPurchase.lines[index].qty = Math.max(1, Number(event.target.value));
  if (event.target.classList.contains("purchase-cover")) {
    draftPurchase.lines[index].coverPriceAtPurchase = Number(event.target.value);
    syncPurchaseLineCost(index, "discount");
    const costInput = document.querySelector(`.purchase-cost[data-index="${index}"]`);
    if (costInput) costInput.value = draftPurchase.lines[index].cost;
    updatePurchaseSummary();
    persistPurchaseDraft();
    return;
  }
  if (event.target.classList.contains("purchase-supplier-discount")) {
    draftPurchase.lines[index].supplierDiscountPercent = Number(event.target.value);
    syncPurchaseLineCost(index, "discount");
    const costInput = document.querySelector(`.purchase-cost[data-index="${index}"]`);
    if (costInput) costInput.value = draftPurchase.lines[index].cost;
    updatePurchaseSummary();
    persistPurchaseDraft();
    return;
  }
  if (event.target.classList.contains("purchase-cost")) {
    draftPurchase.lines[index].cost = Number(event.target.value);
    syncPurchaseLineCost(index, "cost");
    updatePurchaseSummary();
    persistPurchaseDraft();
    return;
  }
  if (event.target.id === "purchase-paid") draftPurchase.paid = Math.max(0, Number(event.target.value || 0));
  if (event.target.id === "purchase-shipping") draftPurchase.shipping = Math.max(0, Number(event.target.value || 0));
  if (event.target.id === "purchase-invoice-discount") draftPurchase.invoiceDiscount = Math.max(0, Number(event.target.value || 0));
  if (event.target.id === "supplier-invoice-number") draftPurchase.supplierInvoiceNumber = event.target.value;
  if (event.target.classList.contains("purchase-qty") || event.target.classList.contains("purchase-cost") || event.target.classList.contains("purchase-cover") || event.target.classList.contains("purchase-supplier-discount") || event.target.id === "purchase-paid" || event.target.id === "purchase-shipping" || event.target.id === "purchase-invoice-discount") updatePurchaseSummary();
  if (event.target.closest(".purchase-workspace")) persistPurchaseDraft();
});

root.addEventListener("change", event => {
  if(event.target.id==="quick-shipping-company"){shippingSessionCompany=event.target.value;return;}
  const quickFieldMap={"quick-order-name":"customerName","quick-order-alt-phone":"alternativePhone","quick-order-city":"city","quick-order-address":"address","quick-order-address-mark":"addressMark"};
  if(quickFieldMap[event.target.id]){quickOrderDraft[quickFieldMap[event.target.id]]=event.target.value;clearQuickOrderFieldError(quickFieldMap[event.target.id]);return;}
  if(event.target.matches("[data-quick-order-discount-type]")){const line=quickOrderDraft.lines[Number(event.target.dataset.quickOrderDiscountType)];if(line){line.discountType=event.target.value==="amount"?"amount":"percent";line.discount=0;renderQuickOrderPreservingContext();}return;}
  if(event.target.id==="quick-order-order-discount-type"){quickOrderDraft.orderDiscountType=event.target.value==="amount"?"amount":"percent";quickOrderDraft.orderDiscount=0;renderQuickOrderPreservingContext();return;}
  if(event.target.id==="quick-order-payment-plan"){quickOrderDraft.paymentPlan=event.target.value;quickOrderDraft.paymentMethod=paymentPlanLabel(event.target.value);if(event.target.value==="cash_on_delivery"){quickOrderDraft.paidAmount=0;quickOrderDraft.paymentConfirmed=false;}if(event.target.value==="prepaid_full")quickOrderDraft.paidAmount=quickOrderTotalsNow().total;renderQuickOrderPreservingContext();return;}
  if(event.target.id==="quick-order-payment-confirmed"){quickOrderDraft.paymentConfirmed=event.target.checked;renderQuickOrderPreservingContext();return;}
  if(event.target.id==="quick-order-cash-account"){quickOrderDraft.cashAccountId=event.target.value;return;}
  const index = Number(event.target.dataset.index);
  if(event.target.id==="order-collection-type"){
    const field=document.getElementById("order-collection-account-field");
    if(field)field.hidden=event.target.value!=="settled";
    return;
  }
  if(event.target.matches("[data-collection-batch-reason]")){
    const row=orderCollectionBatchRows[Number(event.target.dataset.collectionBatchReason)];
    if(row)row.differenceReason=event.target.value;
    return;
  }
  if (event.target.id === "finance-report-from") { financeReportFilters={...financeReportFilters,preset:"custom",from:event.target.value}; return renderAccounting(); }
  if (event.target.id === "finance-report-to") { financeReportFilters={...financeReportFilters,preset:"custom",to:event.target.value}; return renderAccounting(); }
  if (event.target.id === "finance-report-movement") { financeReportFilters.movementType=event.target.value; return renderAccounting(); }
  if (event.target.id === "finance-report-account") { financeReportFilters.account=event.target.value; return renderAccounting(); }
  if (event.target.id === "finance-report-expense-type") { financeReportFilters.expenseType=event.target.value; return renderAccounting(); }
  if (event.target.id === "finance-report-carrier") { financeReportFilters.carrier=event.target.value; return renderAccounting(); }
  if (event.target.matches("[data-shipment-status]")) {
    const shipment = data.shipments.find(item => item.id === event.target.dataset.id);
    const previous = shipmentStatusCode(shipment);
    const next = event.target.value;
    event.target.value = previous;
    if (["delivery_attempt_1", "delivery_attempt_2", "delivery_attempt_3", "returned"].includes(next)) {
      shipmentStatusQuickModal(shipment?.id, next);
    } else {
      applyManualShipmentStatus(shipment?.id, next);
    }
    return;
  }
  if (event.target.id === "movement-book-id") return selectProductMovementBook("id", event.target.value);
  if (event.target.id === "movement-book-name") return selectProductMovementBook("name", event.target.value);
  if (event.target.id === "movement-book-barcode") return selectProductMovementBook("barcode", event.target.value);
  if (event.target.id === "movement-from") return refreshProductMovementReport({ from:event.target.value, quickRange:"custom", page:1 });
  if (event.target.id === "movement-to") return refreshProductMovementReport({ to:event.target.value, quickRange:"custom", page:1 });
  if (event.target.id === "movement-type") return refreshProductMovementReport({ type:event.target.value, page:1 });
  if (event.target.id === "movement-employee") return refreshProductMovementReport({ employee:event.target.value, page:1 });
  if (event.target.id === "movement-status") return refreshProductMovementReport({ status:event.target.value, page:1 });
  if (event.target.id === "movement-sort") return refreshProductMovementReport({ sort:event.target.value, page:1 });
  if (event.target.id === "movement-print-prices") { productMovementState.showPrices = event.target.checked; return; }
  if (event.target.id === "movement-supplier") {
    const supplier = data.suppliers.find(item => item.name === event.target.value);
    return refreshProductMovementReport({ supplierId:supplier?.id || "", page:1 });
  }
  if (event.target.id === "movement-customer") {
    const customer = data.customers.find(item => item.name === event.target.value);
    return refreshProductMovementReport({ customerId:customer?.id || "", page:1 });
  }
  if (event.target.classList.contains("sale-book")) {
    const book = getBook(event.target.value);
    const duplicateIndex = draftSale.lines.findIndex((line, lineIndex) => lineIndex !== index && line.bookId === event.target.value);
    if (duplicateIndex >= 0) {
      draftSale.lines[duplicateIndex].qty += Number(draftSale.lines[index].qty || 1);
      draftSale.lines.splice(index, 1);
    } else {
      draftSale.lines[index].bookId = event.target.value;
      draftSale.lines[index].price = productDefaultSellingPrice(book);
    }
    renderSales();
  }
  if (event.target.classList.contains("sale-book-picker")) selectSaleLineBook(index, event.target.value);
  if (event.target.id === "sale-channel") draftSale.channel = event.target.value;
  if (event.target.id === "sale-operation-type") draftSale.saleOperationType = event.target.value;
  if (event.target.id === "sale-date") draftSale.date = event.target.value;
  if (event.target.id === "sales-date-filter") {
    salesDateFilter = event.target.value || "today";
    const range = salesFilterRange();
    salesFilterFrom = range.from;
    salesFilterTo = range.to;
    renderSales();
  }
  if (event.target.id === "sales-filter-from") {
    salesDateFilter = "custom";
    salesFilterFrom = event.target.value || today();
    renderSales();
  }
  if (event.target.id === "sales-filter-to") {
    salesDateFilter = "custom";
    salesFilterTo = event.target.value || today();
    renderSales();
  }
  if (event.target.id === "sale-payment") {
    draftSale.payment = event.target.value;
    const totals = saleTotals();
    draftSale.paid = event.target.value === "آجل" ? 0 : totals.total;
    renderSales();
  }
  if (event.target.id === "sale-invoice-discount-type") {
    draftSale.invoiceDiscountType = event.target.value === "amount" ? "amount" : "percent";
    updateSaleSummary();
  }
  if (event.target.id === "purchase-supplier") draftPurchase.supplierId = event.target.value;
  if (event.target.id === "purchase-type") draftPurchase.type = event.target.value;
  if (event.target.id === "purchase-return") draftPurchase.returnDeadline = event.target.value;
  if (event.target.id === "purchase-status") draftPurchase.status = event.target.value;
  if (event.target.id === "purchase-payment") {
    draftPurchase.payment = event.target.value;
    const totals = purchaseTotals();
    draftPurchase.paid = ["آجل", "شيك مجدول"].includes(event.target.value) ? 0 : totals.total;
    renderPurchases();
  }
  if (event.target.id === "purchase-invoice-discount-type") {
    draftPurchase.invoiceDiscountType = event.target.value === "amount" ? "amount" : "percent";
    updatePurchaseSummary();
  }
  if (event.target.classList.contains("purchase-book")) {
    const book = getBook(event.target.value);
    draftPurchase.lines[index].bookId = event.target.value;
    draftPurchase.lines[index].cost = book?.cost || 0;
    draftPurchase.lines[index].discountType = draftPurchase.lines[index].discountType || "percent";
    renderPurchases();
  }
  if (event.target.closest(".purchase-workspace")) persistPurchaseDraft();
  if (event.target.classList.contains("purchase-book-picker")) selectPurchaseLineBook(index, event.target.value);
  if (event.target.id === "book-category" || event.target.id === "book-stock-filter") filterBooks();
  if (event.target.id === "shipment-status" || event.target.id === "shipment-tracking-filter") filterShipments();
  if (event.target.id === "online-order-status") filterOnlineOrders();
  if (event.target.id === "old-sales-status") updateSalesHistorySearch();
  if (event.target.id === "omni-channel-filter") {
    selectedOmniChannelAccountId = event.target.value;
    selectedOmniConversationId = "";
    renderOmnichannel();
  }
});

modalBody.addEventListener("click", event => {
  if (event.target.closest('[data-action="close-modal"]')) closeModal();
  const appAction = event.target.closest("[data-action]");
  if (appAction?.dataset.action === "cancellation-open-ledger") {
    const customerId=String(appAction.dataset.id||"");
    if(!customerId||!getCustomer(customerId))return toast("لا يمكن فتح كشف الحساب لأن العميل غير مرتبط بالسجل","error");
    try{showStatement(customerId,"customer");}catch(error){toast("تعذر فتح كشف حساب العميل، برجاء تحديث الصفحة والمحاولة مرة أخرى","error");}
    return;
  }
  if (appAction?.dataset.action === "cancellation-finalize") {
    const kind=appAction.dataset.kind,id=appAction.dataset.id;
    if(confirm(`تمت التسوية المالية. هل تريد ${kind==="sale"?"إبطال الفاتورة":"إلغاء الطلب"} الآن؟`))orderWorkflowRequest(cancellationEndpoint(kind,id,"cancel"),{body:{reason:"إلغاء بعد اكتمال التسوية المالية"}}).then(()=>{closeModal();kind==="sale"?renderSales():renderOnlineOrders();toast("تم إلغاء المستند بعد التسوية المالية.");}).catch(error=>toast(error.message,"error"));
    return;
  }
  if(appAction?.dataset.action==="statement-filter"){
    modalBody.querySelectorAll('[data-action="statement-filter"]').forEach(button=>button.classList.toggle("active",button===appAction));applyStatementFilters(appAction.dataset.filter);return;
  }
  if (appAction?.dataset.action === "print-sale") {
    printSale(appAction.dataset.id, appAction.dataset.format || "a4");
    return;
  }
  if (appAction?.dataset.action === "print-voucher") {
    printVoucher(appAction.dataset.id, appAction.dataset.format || "a4");
    return;
  }
  if (appAction?.dataset.action === "print-statement") {
    printStatement(appAction.dataset.id, appAction.dataset.kind);
    return;
  }
  if (appAction?.dataset.action === "party-voucher") {
    partyVoucherModal(appAction.dataset.voucherType, appAction.dataset.kind || "", appAction.dataset.id || "");
    return;
  }
  if (appAction?.dataset.action === "open-statement-record") {
    openStatementRecord(appAction.dataset.reference || "");
    return;
  }
  if (appAction?.dataset.action === "statement") {
    showStatement(appAction.dataset.id, appAction.dataset.kind);
    return;
  }
  if (appAction?.dataset.action === "choose-return-customer") {
    saleReturnByCustomerModal(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "choose-return-supplier") {
    purchaseReturnBySupplierModal(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "print-return") {
    printReturn(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "view-return") {
    viewReturn(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "export-audit-log") {
    exportAuditLogCsv();
    return;
  }
  if (appAction?.dataset.action === "view-shipment-from-sale") {
    viewShipment(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "show-tracking-debug") {
    showTrackingDebug(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "copy-tracking-code") {
    copyShipmentTrackingCode(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "open-egypt-post") {
    openEgyptPostTrackingSite();
    return;
  }
  if (appAction?.dataset.action === "open-egypt-post-with-code") {
    openEgyptPostWithCode(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "manual-tracking-result") {
    manualTrackingResultModal(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "quick-manual-tracking") {
    quickManualTracking(appAction.dataset.id, appAction.dataset.status);
    return;
  }
  if (appAction?.dataset.action === "print-online-order") {
    printOnlineOrder(appAction.dataset.id, appAction.dataset.format || "a4");
    return;
  }
  if (appAction?.dataset.action === "convert-order-sale") {
    convertOnlineOrderToSale(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "create-order-shipment") {
    createShipmentFromOrder(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "view-shipment") {
    viewShipment(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "update-tracking-now") {
    updateShipmentTrackingNow(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "prepare-complaint") {
    prepareShipmentComplaint(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "add-shipment-complaint") {
    addShipmentComplaintModal(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "shipment-complaints") {
    shipmentComplaintsModal(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "edit-shipment-complaint") {
    editShipmentComplaintModal(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "return-sale") {
    saleReturnModal(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "return-purchase") {
    purchaseReturnModal(appAction.dataset.id);
    return;
  }
  if (appAction?.dataset.action === "choose-online-order-customer") {
    const customer = getCustomer(appAction.dataset.id);
    if (customer) {
      const customerIdInput = document.getElementById("online-order-customer-id");
      const searchInput = document.getElementById("online-order-customer-search");
      const details = document.getElementById("online-order-customer-details");
      const suggestions = document.getElementById("online-order-customer-suggestions");
      const form = document.getElementById("online-order-form");
      if (customerIdInput) customerIdInput.value = customer.id;
      if (searchInput) searchInput.value = customer.name || "";
      if (form?.elements.customerName) form.elements.customerName.value = customer.name || "";
      if (form?.elements.phone) form.elements.phone.value = customer.phone || "";
      if (form?.elements.governorate) form.elements.governorate.value = normalizeGovernorate(customer.governorate);
      if (form?.elements.city) form.elements.city.value = customer.city || "";
      if (form?.elements.address) form.elements.address.value = customer.address || "";
      if (details) details.innerHTML = saleCustomerDetailsMarkup(customer);
      if (suggestions) suggestions.innerHTML = "";
    }
    return;
  }
  if (appAction?.dataset.action === "register-online-order-customer") {
    pendingOnlineOrderDraft = collectOnlineOrderDraftFromForm();
    addPartyModal("customer", null, { returnToOnlineOrder: true });
    return;
  }
  if (appAction?.dataset.action === "add-online-order-line") {
    const list = document.getElementById("online-order-line-list");
    if (list) {
      let maxIdx = -1;
      list.querySelectorAll(".online-order-book").forEach(sel => { const match = String(sel.name).match(/bookId-(\d+)/); if (match) maxIdx = Math.max(maxIdx, Number(match[1])); });
      const wrap = document.createElement("div");
      wrap.innerHTML = onlineOrderLineRow(maxIdx + 1);
      list.appendChild(wrap.firstElementChild);
      updateOnlineOrderSummary();
    }
    return;
  }
  if (appAction?.dataset.action === "remove-online-order-line") {
    const list = document.getElementById("online-order-line-list");
    const row = event.target.closest(".online-order-line");
    if (list && row && list.querySelectorAll(".online-order-line").length > 1) { row.remove(); updateOnlineOrderSummary(); }
    else toast("يجب أن يحتوي الطلب على صنف واحد على الأقل.", "error");
    return;
  }
  const target = event.target.closest("[data-modal-action]");
  if (!target) return;
  const action = target.dataset.modalAction;
  if (action && !requireAction(action)) return;
  const notificationKey=target.dataset.notificationKey||target.closest("[data-notification-key]")?.dataset.notificationKey;
  if(notificationKey&&!["notification-mark-read","notification-filter","notification-read-all"].includes(action))markNotificationRead(notificationKey);
  if (action === "dashboard-view-sale") viewSale(target.dataset.id);
  if (action === "dashboard-collect-sale") salePaymentModal(target.dataset.id);
  if (action === "dashboard-sales-search") showSalesList();
  if (action === "dashboard-view-book") viewBook(target.dataset.id);
  if (action === "dashboard-edit-book") addBookModal(getBook(target.dataset.id));
  if (action === "dashboard-adjust-book") adjustStock(target.dataset.id);
  if (action === "dashboard-add-book") addBookModal();
  if (action === "dashboard-statement") showStatement(target.dataset.id, "customer");
  if (action === "dashboard-receipt") partyVoucherModal("استلام", "customer", target.dataset.id);
  if (action === "dashboard-go") {
    closeModal();
    navigate(target.dataset.view);
  }
  if (action === "dashboard-go-parties") {
    closeModal();
    partyTab = "customers";
    navigate("parties");
  }
  if (action === "notification-view-book") navigateToRecord("book", target.dataset.id, "view");
  if (action === "notification-view-order") viewOnlineOrder(target.dataset.id);
  if (action === "notification-edit-order") onlineOrderModal(getOnlineOrder(target.dataset.id));
  if (action === "notification-orders-page") { closeModal(); navigate("onlineOrders"); }
  if (action === "notification-edit-book") navigateToRecord("book", target.dataset.id, "edit");
  if (action === "notification-adjust-stock") navigateToRecord("book", target.dataset.id, "adjust");
  if (action === "notification-buy-book") preparePurchaseForBook(target.dataset.id);
  if (action === "notification-view-shipment") navigateToRecord("shipment", target.dataset.id, "view");
  if (action === "notification-view-invoice") navigateToRecord("invoice", target.dataset.id, "view");
  if (action === "notification-edit-shipment") navigateToRecord("shipment", target.dataset.id, "edit");
  if (action === "notification-shipping-page") {
    closeModal();
    navigate("shipping");
  }
  if (action === "notification-books-page") {
    closeModal();
    navigate("books");
  }
  if (action === "notification-reports") {
    closeModal();
    navigate("reports");
  }
  if(action==="notification-filter"){notificationFilter=target.dataset.filter;showNotificationCenter();}
  if(action==="notification-mark-read"){markNotificationRead(target.dataset.key);showNotificationCenter();}
  if(action==="notification-read-all"){
    getNotificationItems().filter(item=>item.status==="unread").forEach(item=>markNotificationRead(item.key,{save:false}));
    saveData("تحديد كل الإشعارات كمقروء","الإشعارات","all");showNotificationCenter();
  }
  if(action==="notification-open-collection"){closeModal();financeTab="order-collections";navigate("accounting");setTimeout(()=>document.getElementById(`collection-${CSS.escape(target.dataset.id)}`)?.scrollIntoView({block:"center"}),80);}
  if(action==="notification-open-settlement"){closeModal();financeTab="settlements";navigate("accounting");setTimeout(()=>newSettlementModal(data.carrierSettlements.find(item=>item.id===target.dataset.id)),80);}
  if (action === "notification-refresh") showNotificationCenter();
  if (action === "start-partial-count") partialStockCountModal();
  if (action === "start-full-count") openInventoryCountForm(data.books, "كلي");
  if (action === "back-to-count-types") stockCountModal();
  if (action === "best-customer-detail") bestCustomerDetail(target.dataset.id);
  if (action === "best-supplier-detail") bestSupplierDetail(target.dataset.id);
  if (action === "view-sale") viewSale(target.dataset.id);
  if (action === "view-linked-shipment") viewShipment(target.dataset.id);
  if (action === "clear-sales-search") {
    const search = document.getElementById("old-sales-search");
    const status = document.getElementById("old-sales-status");
    if (search) search.value = "";
    if (status) status.value = "";
    updateSalesHistorySearch();
    search?.focus();
  }
  if (action === "edit-sale-payment") salePaymentModal(target.dataset.id);
  if (action === "return-sale") saleReturnModal(target.dataset.id);
  if (action === "cancel-sale") cancelSale(target.dataset.id);
  if (action === "delete-sale") deleteSale(target.dataset.id);
  if (action === "view-purchase") viewPurchase(target.dataset.id);
  if (action === "receive-purchase") receivePurchase(target.dataset.id);
  if (action === "return-purchase") purchaseReturnModal(target.dataset.id);
  if (action === "cancel-purchase") cancelPurchase(target.dataset.id);
  if (action === "delete-purchase") deletePurchase(target.dataset.id);
});

modalBody.addEventListener("change", event => {
  if(event.target.matches("[data-statement-date]")){applyStatementFilters();return;}
  if(event.target.matches("[data-preparation-book]")){
    const orderId=modalTitle.textContent.replace(/^تجهيز\s+/,""),doneBookIds=[...modalBody.querySelectorAll("[data-preparation-book]:checked")].map(input=>input.dataset.preparationBook);
    orderWorkflowRequest(`/api/orders/${encodeURIComponent(orderId)}/prepare/checklist`,{method:"PATCH",body:{doneBookIds}}).then(()=>openPreparationOrder(orderId)).catch(error=>toast(error.message,"error"));
    return;
  }
  if (event.target.closest("#sale-customer-return-form") && event.target.matches("[name='settlement']")) {
    updateCustomerSaleReturnSummary();
    return;
  }
  if (event.target.closest("#purchase-supplier-return-form") && event.target.matches("[name='settlement']")) {
    updateSupplierPurchaseReturnSummary();
    return;
  }
  if (event.target.closest("#sale-return-form") && event.target.matches("[name='settlement']")) {
    updateSaleReturnSummary();
    return;
  }
  if (event.target.classList.contains("online-order-book")) {
    const row = event.target.closest(".online-order-line");
    const priceInput = row?.querySelector('input[name^="price-"]');
    const book = getBook(event.target.value);
    if (priceInput && book && !Number(priceInput.value)) priceInput.value = productDefaultSellingPrice(book);
    updateOnlineOrderSummary();
    return;
  }
  if (event.target.matches(".ool-disc-type, #ool-order-discount-type")) {
    updateOnlineOrderSummary();
    return;
  }
  if (event.target.id === "count-filter-type") {
    const type = event.target.value;
    const valueSelect = document.getElementById("count-filter-value");
    const manualList = document.getElementById("manual-count-books");
    if (type === "manual") {
      if (valueSelect) valueSelect.closest(".form-field").hidden = true;
      if (manualList) manualList.hidden = false;
    } else {
      if (valueSelect) {
        valueSelect.closest(".form-field").hidden = false;
        const sourceId = type === "shelf" ? "count-shelves-data" : "count-categories-data";
        const values = JSON.parse(document.getElementById(sourceId)?.textContent || "[]");
        valueSelect.innerHTML = values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join("");
      }
      if (manualList) manualList.hidden = true;
    }
    return;
  }
  if (event.target.id === "old-sales-status") {
    updateSalesHistorySearch();
    return;
  }
  if (["audit-employee", "audit-module"].includes(event.target.id)) {
    updateAuditLogResults();
    return;
  }
  if (event.target.id === "voucher-party-kind") {
    const list = event.target.value === "customer" ? data.customers : data.suppliers;
    const partySelect = document.getElementById("voucher-party-id");
    if (partySelect) partySelect.innerHTML = list.map(item => `<option value="${item.id}">${esc(item.name)} — الرصيد ${money(item.balance || 0)}</option>`).join("");
    updateVoucherPartyPanel();
    return;
  }
  if (event.target.id === "voucher-party-id") {
    updateVoucherPartyPanel();
    return;
  }
});

modalBody.addEventListener("input", event => {
  if (event.target.id === "return-customer-search") {
    const suggestions = document.getElementById("return-customer-suggestions");
    const matches = searchCustomers(event.target.value).filter(customer => customerReturnableSaleLines(customer.id).length);
    if (suggestions) {
      suggestions.innerHTML = matches.map(customer => `<button type="button" data-action="choose-return-customer" data-id="${customer.id}">
        <strong>${esc(customer.name)}</strong>
        <span><span dir="ltr">${esc(customer.phone || "بدون هاتف")}</span> · ${customerReturnableSaleLines(customer.id).length} صنف متاح للمرتجع</span>
      </button>`).join("") || (event.target.value.trim() ? `<div class="customer-no-results">لا يوجد عميل لديه أصناف متاحة للمرتجع.</div>` : "");
    }
    return;
  }
  if (event.target.id === "return-supplier-search") {
    const suggestions = document.getElementById("return-supplier-suggestions");
    const term = String(event.target.value || "").toLowerCase();
    const matches = data.suppliers
      .filter(supplier => !supplier.deletedAt && supplierReturnablePurchaseLines(supplier.id).length)
      .filter(supplier => !term || `${supplier.name} ${supplier.phone || ""} ${supplier.id}`.toLowerCase().includes(term));
    if (suggestions) {
      suggestions.innerHTML = matches.map(supplier => `<button type="button" data-action="choose-return-supplier" data-id="${supplier.id}">
        <strong>${esc(supplier.name)}</strong>
        <span>${supplierReturnablePurchaseLines(supplier.id).length} صنف متاح للمرتجع · الرصيد ${money(supplier.balance || 0)}</span>
      </button>`).join("") || (event.target.value.trim() ? `<div class="customer-no-results">لا يوجد مورد لديه أصناف متاحة للمرتجع.</div>` : "");
    }
    return;
  }
  if (event.target.id === "return-doc-search") {
    const term = normalizeReturnSearch(event.target.value);
    modalBody.querySelectorAll("[data-return-doc-row]").forEach(row => {
      row.hidden = term && !String(row.dataset.search || "").includes(term);
    });
    return;
  }
  if (event.target.id === "customer-return-line-search") {
    const term = normalizeReturnSearch(event.target.value);
    modalBody.querySelectorAll("[data-customer-return-row]").forEach(row => {
      row.hidden = term && !String(row.dataset.search || "").includes(term);
    });
    return;
  }
  if (event.target.id === "supplier-return-line-search") {
    const term = normalizeReturnSearch(event.target.value);
    modalBody.querySelectorAll("[data-supplier-return-row]").forEach(row => {
      row.hidden = term && !String(row.dataset.search || "").includes(term);
    });
    return;
  }
  if (event.target.id === "return-search-box") {
    const term = normalizeReturnSearch(event.target.value);
    modalBody.querySelectorAll("[data-return-search-row]").forEach(row => {
      row.hidden = term && !String(row.dataset.search || "").includes(term);
    });
    return;
  }
  if (["audit-search", "audit-from", "audit-to"].includes(event.target.id)) {
    updateAuditLogResults();
    return;
  }
  if (event.target.closest("#sale-customer-return-form") && event.target.matches(".customer-return-qty, [name='replacementDeduction']")) {
    updateCustomerSaleReturnSummary();
    return;
  }
  if (event.target.closest("#purchase-supplier-return-form") && event.target.matches(".supplier-return-qty")) {
    updateSupplierPurchaseReturnSummary();
    return;
  }
  if (event.target.closest("#sale-return-form") && event.target.matches(".sale-return-qty, [name='replacementDeduction']")) {
    updateSaleReturnSummary();
    return;
  }
  if (event.target.id === "online-order-customer-search") {
    const suggestions = document.getElementById("online-order-customer-suggestions");
    const matches = searchCustomers(event.target.value);
    if (suggestions) {
      suggestions.innerHTML = matches.map(customer => `<button type="button" data-action="choose-online-order-customer" data-id="${customer.id}">
        <strong>${esc(customer.name)}</strong>
        <span><span dir="ltr">${esc(customer.phone || "بدون هاتف")}</span> · ${esc([customer.governorate, customer.city].filter(Boolean).join("، ") || customer.id)}</span>
      </button>`).join("") || (event.target.value.trim() ? `<div class="customer-no-results">لا يوجد عميل مطابق. استخدم «تسجيل عميل جديد».</div>` : "");
    }
    const selectedInput = document.getElementById("online-order-customer-id");
    if (!matches.some(customer => customer.id === selectedInput?.value && customer.name === event.target.value)) {
      if (selectedInput) selectedInput.value = "";
      const details = document.getElementById("online-order-customer-details");
      if (details) details.innerHTML = saleCustomerDetailsMarkup(null);
    }
    return;
  }
  if (event.target.closest("#online-order-form") && event.target.matches(".ool-qty, .ool-price, .ool-discount, [name='shippingCost'], #ool-order-discount")) {
    updateOnlineOrderSummary();
    return;
  }
  if (event.target.classList.contains("count-actual-stock")) {
    updateInventoryCountSummary();
    return;
  }
  if (event.target.id === "old-sales-search") updateSalesHistorySearch();
});

modalBody.addEventListener("change", event => {
  if (event.target.name === "shippingStatus" && event.target.closest("#quick-shipment-status-form")) {
    const note = event.target.closest("form").querySelector(".shipment-status-note");
    const needsNote = ["delivery_attempt_1", "delivery_attempt_2", "delivery_attempt_3", "returned"].includes(event.target.value);
    note?.classList.toggle("is-hidden", !needsNote);
    return;
  }
  if (event.target.name === "normalizedStatus" && event.target.closest("#manual-tracking-form")) {
    const form = event.target.closest("#manual-tracking-form");
    const labelInput = form.querySelector("[name='statusText']");
    if (labelInput) labelInput.value = MANUAL_TRACKING_STATUSES[event.target.value]?.label || "";
  }
});

modalBody.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const formData = Object.fromEntries(new FormData(form).entries());
  if(form.id==="cancellation-settlement-form"){
    const payment=(data.orderPayments||[]).find(item=>item.id===formData.paymentId),originalCashMovement=(data.cash||[]).find(item=>item.paymentId===formData.paymentId||item.receiptId===formData.paymentId);
    const payload={...formData,refundMethod:formData.settlementType==="cash_refund"?"cash":formData.settlementType,amount:Number(formData.amount),orderId:String(formData.orderId||""),invoiceId:String(formData.invoiceId||""),paymentId:String(formData.paymentId||""),originalCashMovementId:String(originalCashMovement?.id||payment?.originalCashMovementId||""),customerId:String(formData.customerId||""),cashAccountId:String(formData.cashAccountId||""),reason:String(formData.reason||"").trim(),operationKey:`cancel-settlement:${form.dataset.kind}:${form.dataset.id}:${crypto.randomUUID?.()||Date.now()}`};
    if(payload.settlementType==="cash_refund"&&!payload.cashAccountId)return toast("اختر الخزنة التي سيتم رد المبلغ منها","error");
    if(!payload.paymentId)return toast("اختر الدفعة الأصلية المرتبطة بالرد","error");
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try{await orderWorkflowRequest(cancellationEndpoint(form.dataset.kind,form.dataset.id,"refunds"),{body:payload});await refreshCancellationSettlement(form.dataset.kind,form.dataset.id);toast("تم تسجيل التسوية وربطها بالمستند وكشف حساب العميل.");}catch(error){button.disabled=false;toast(error.message,"error");}
    return;
  }
  if (form.id === "factory-reset-confirm-form") {
    if (formData.confirmationPhrase !== "إعادة ضبط النظام بالكامل") return toast("عبارة التأكيد غير مطابقة.", "danger");
    if (formData.currentUsername !== currentUser?.username) return toast("اسم المستخدم الحالي غير مطابق.", "danger");
    try {
      const response = await fetch("/api/admin/factory-reset/confirm", { method:"POST", headers:authHeaders({ "Content-Type":"application/json" }), body:JSON.stringify({ resetType:factoryResetState.resetType, preparationId:factoryResetState.preparationId, confirmationPhrase:formData.confirmationPhrase, currentUsername:formData.currentUsername, operationKey:factoryResetState.operationKey }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "فشل التأكيد الأول.");
      openFactoryResetFinalConfirmation(formData, result.executeAfter);
    } catch (error) { toast(error.message, "danger"); }
    return;
  }
  if(form.id==="preparation-issue-form"){
    try{await orderWorkflowRequest(`/api/orders/${encodeURIComponent(form.dataset.id)}/prepare/issue`,{body:formData});closeModal();onlineOrdersMode="preparation";renderOnlineOrders();toast("تم إيقاف الطلب وإرساله لخدمة العملاء للمراجعة.");}catch(error){toast(error.message,"error");}
    return;
  }
  if(form.id==="prepare-and-ship-form"){
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try{
      const orderId=form.dataset.orderId;
      await orderWorkflowRequest(`/api/orders/${encodeURIComponent(orderId)}/prepare/complete`);
      let order=getOnlineOrder(orderId);
      if(!order.saleId){
        const sale=convertOnlineOrderToSale(orderId,{print:false,askShipping:false,keepModal:true});
        if(!sale)throw new Error("تعذر إنشاء فاتورة الطلب تلقائيًا.");
        await saveQueue;
        await reloadRemoteData();
        order=getOnlineOrder(orderId);
      }
      if(!order?.saleId)throw new Error("وصل الطلب إلى جاهز للشحن، لكن تعذر ربط الفاتورة.");
      shippingSessionCompany=formData.company;
      await submitReadyOrderShipment(orderId,{company:formData.company,trackingNumber:formData.trackingNumber});
      closeModal();onlineOrdersMode="orders";renderOnlineOrders();toast(`تم تجهيز وشحن ${orderId} بنجاح.`);
    }catch(error){button.disabled=false;toast(error.message,"error");}
    return;
  }
  if (form.id === "omni-account-form") {
    const payload = {
      channelKey: formData.channelKey || form.querySelector("[name='channelKey']")?.value,
      name: formData.name,
      phoneNumber: formData.phoneNumber,
      phoneNumberId: formData.phoneNumberId,
      wabaId: formData.wabaId,
      pageId: formData.pageId,
      externalAccountId: formData.externalAccountId,
      graphApiVersion: formData.graphApiVersion,
      connectionMode: formData.connectionMode,
      status: formData.status,
      credentialsReference: formData.credentialsReference,
      accessToken: formData.accessToken,
      isActive: formData.isActive === "true",
      isCritical: formData.isCritical === "true"
    };
    try {
      if (form.dataset.id) await omniApi(`/channel-accounts/${encodeURIComponent(form.dataset.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await omniApi("/channel-accounts", { method: "POST", body: JSON.stringify(payload) });
      closeModal();
      toast("تم حفظ حساب القناة.");
      renderOmnichannel();
    } catch (error) {
      toast(`تعذر حفظ حساب القناة: ${error.message}`, "error");
    }
    return;
  }
  if (form.id === "permission-form") {
    const values = new FormData(form);
    const views = values.getAll("views");
    const actions = values.getAll("actions");
    const settings = permissionSettings();
    if (form.dataset.scope === "role") {
      settings.roles[form.dataset.role] = { views, actions, updatedAt: new Date().toISOString(), updatedBy: currentUser?.name || currentUser?.username || "النظام" };
      saveData("تحديث صلاحيات دور", "الصلاحيات", form.dataset.role);
      closeModal();
      renderSettings();
      toast("تم حفظ صلاحيات الدور.");
      return;
    }
    if (form.dataset.scope === "user") {
      if (formData.resetUserPermissions === "yes") {
        delete settings.users[form.dataset.username];
        saveData("إلغاء تخصيص صلاحيات مستخدم", "الصلاحيات", form.dataset.username);
        closeModal();
        renderSettings();
        toast("تم إرجاع المستخدم لصلاحيات الدور.");
        return;
      }
      settings.users[form.dataset.username] = { views, actions, updatedAt: new Date().toISOString(), updatedBy: currentUser?.name || currentUser?.username || "النظام" };
      saveData("تحديث صلاحيات مستخدم", "الصلاحيات", form.dataset.username);
      closeModal();
      renderSettings();
      toast("تم حفظ صلاحيات المستخدم.");
      return;
    }
  }
  if (form.id === "partial-count-filter-form") {
    const values = new FormData(form);
    const filterType = values.get("filterType");
    const filterValue = values.get("filterValue");
    const selectedIds = values.getAll("bookIds");
    const books = filterType === "manual"
      ? data.books.filter(book => selectedIds.includes(book.id))
      : data.books.filter(book => String(book[filterType] || "") === String(filterValue || ""));
    openInventoryCountForm(books, "جزئي");
    return;
  }
  if (form.id === "online-order-form") {
    const existing = getOnlineOrder(form.dataset.editId);
    const lines = [];
    Object.keys(formData).filter(key => /^bookId-\d+$/.test(key)).forEach(key => {
      const idx = key.slice("bookId-".length);
      const bookId = formData[key];
      if (bookId) lines.push({ bookId, qty: Math.max(1, Number(formData[`qty-${idx}`] || 1)), price: Number(formData[`price-${idx}`] || getBook(bookId)?.price || 0), discount: Math.max(0, Number(formData[`discount-${idx}`] || 0)), discountType: formData[`discType-${idx}`] === "amount" ? "amount" : "percent" });
    });
    const orderDiscount = Math.max(0, Number(formData.orderDiscount || 0));
    const orderDiscountType = formData.orderDiscountType === "amount" ? "amount" : "percent";
    const totals = onlineOrderTotals(lines, orderDiscount, orderDiscountType, Number(formData.shippingCost || 0));
    const now = new Date().toISOString();
    const requestedStatus = formData.status || "طلب جديد";
    const protectedStatus = existing?.shipmentId
      ? existing.status
      : existing?.saleId && ["طلب جديد","قيد التجهيز"].includes(requestedStatus)
        ? "تم إنشاء الفاتورة"
        : requestedStatus;
    const linkedCustomer = getCustomer(formData.customerId);
    if (!linkedCustomer) return toast("يجب اختيار عميل مسجل أو تسجيل عميل جديد قبل حفظ طلب الأونلاين.", "error");
    const customerSnapshotData = customerSnapshot(linkedCustomer);
    const orderCustomerName = customerSnapshotData.name || formData.customerName;
    const orderPhone = customerSnapshotData.phone || formData.phone;
    const orderGovernorate = customerSnapshotData.governorate || normalizeGovernorate(formData.governorate);
    const orderCity = customerSnapshotData.city || formData.city;
    const orderAddress = customerSnapshotData.address || formData.address;
    findOrCreateOrderCustomer({
      customerId: linkedCustomer.id,
      customerName: formData.customerName,
      phone: formData.phone,
      governorate: formData.governorate,
      city: formData.city,
      address: formData.address
    });
    const order = {
      ...(existing || {}),
      id: existing?.id || nextId("ORD-", data.onlineOrders),
      date: existing?.date || today(),
      customerId: linkedCustomer.id,
      customerName: orderCustomerName, phone: orderPhone, governorate: orderGovernorate,
      city: orderCity, address: orderAddress, source: formData.source,
      paymentMethod: formData.paymentMethod, shippingCost: Number(formData.shippingCost || 0),
      tracking: formData.tracking, status: protectedStatus, notes: formData.notes, lines,
      orderDiscount, orderDiscountType, subtotal: totals.subtotal, discountTotal: totals.discountTotal,
      total: totals.total,
      createdAt: existing?.createdAt || now, updatedAt: now, deletedAt: null
    };
    if (existing) Object.assign(existing, order); else data.onlineOrders.push(order);
    saveData(existing ? "تعديل طلب أونلاين" : "إنشاء طلب أونلاين", "طلبات الأونلاين", order.id);
    closeModal(); renderOnlineOrders(); toast(`تم حفظ الطلب ${order.id}.`);
    return;
  }
  if (form.id === "inventory-count-form") {
    const rows = [...form.querySelectorAll("[data-count-row]")];
    const changes = [];
    const countId = `COUNT-${Date.now()}`;
    rows.forEach(row => {
      const book = getBook(row.dataset.bookId);
      if (!book) return;
      const before = Number(book.stock || 0);
      const after = Number(row.querySelector(".count-actual-stock").value || 0);
      if (before !== after) {
        changes.push({ id: book.id, name: book.name, before, after, difference: after - before });
        book.stock = after;
        recordStockMovement(book, `جرد ${form.dataset.countType}`, after - before, before, after, countId, formData.note || "");
      }
    });
    const auditUser = currentUser?.name || currentUser?.username || "النظام";
    const auditStamp = new Date().toISOString();
    AuditIds.appendAuditRecord(data.audit, { date: auditStamp, action: `اعتماد جرد ${form.dataset.countType} (${changes.length} فروق)`, entity: "المخزون", entityId: countId, user: auditUser });
    AuditIds.appendAuditRecord(data.audit, { date: auditStamp, action: `تفاصيل الجرد: ${changes.map(item => `${item.name} ${item.before}→${item.after}`).join("، ") || "بدون فروقات"}`, entity: "المخزون", entityId: countId, user: auditUser });
    saveData();
    closeModal();
    renderBooks();
    toast(changes.length ? `تم اعتماد الجرد وتحديث ${changes.length} صنف.` : "تم اعتماد الجرد بدون فروقات.");
    return;
  }
  if (form.id === "book-form") {
    const now = new Date().toISOString();
    const item = {
      id: form.dataset.editId || nextId("B", data.books),
      name: formData.name,
      itemType: String(formData.itemType || "صنف عام").trim() || "صنف عام",
      unit: String(formData.unit || "قطعة").trim() || "قطعة",
      author: formData.author,
      publisher: formData.publisher,
      category: formData.category,
      grade: formData.grade,
      shelf: formData.shelf,
      barcode: formData.barcode,
      extraBarcode: formData.extraBarcode,
      supplierId: formData.supplierId,
      coverPrice: Number(formData.coverPrice || 0),
      defaultSellingPrice: Number(formData.defaultSellingPrice || 0),
      purchaseListPrice: Number(formData.coverPrice || 0),
      purchaseDiscount: 0,
      lastPurchasePrice: latestApprovedPurchaseCost(form.dataset.editId) ?? null,
      cost: Number(getBook(form.dataset.editId)?.cost || 0),
      price: Number(formData.defaultSellingPrice || 0),
      stock: Number(formData.stock),
      reorder: Number(formData.reorder),
      owned: formData.owned === "true",
      returnDeadline: formData.returnDeadline,
      lastSale: getBook(form.dataset.editId)?.lastSale || null,
      createdAt: getBook(form.dataset.editId)?.createdAt || now, updatedAt: now, deletedAt: null
    };
    const identityConflicts = PurchaseInventoryIntegrity.productIdentityConflicts(data.books, item, form.dataset.editId || "");
    if (identityConflicts.length) return toast(`يوجد صنف مطابق بالفعل: ${identityConflicts.map(book => `${book.name} (${book.barcode || book.id})`).join("، ")}. عدّل السجل الموجود بدل إنشاء نسخة مكررة.`, "error");
    const index = data.books.findIndex(b => b.id === item.id);
    if (index >= 0) data.books[index] = { ...data.books[index], ...item };
    else data.books.push(item);
    saveData(index >= 0 ? "تعديل صنف" : "إضافة صنف", "الأصناف", item.id);
    closeModal();
    renderBooks();
    toast(index >= 0 ? "تم تحديث بيانات الصنف." : "تمت إضافة الصنف وتوليد ملف المخزون.");
  }
  if (form.id === "party-form") {
    const dataBeforePartySave = structuredClone(data);
    const now = new Date().toISOString();
    const isCustomer = form.dataset.kind === "customer";
    const list = isCustomer ? data.customers : data.suppliers;
    const existingParty = list.find(row => row.id === form.dataset.editId);
    const phone = String(formData.phone || "").trim();
    const normalizedPhone = normalizePhone(phone);
    if (isCustomer && !normalizedPhone) return toast("يجب تسجيل رقم هاتف للعميل.", "error");
    if (isCustomer && !normalizeGovernorate(formData.governorate)) return toast("يجب اختيار محافظة من القائمة.", "error");
    if (isCustomer && list.some(row => !row.deletedAt && row.id !== existingParty?.id && normalizePhone(row.phone) === normalizedPhone)) {
      return toast("يوجد عميل مسجل بنفس رقم الهاتف.", "error");
    }
    const item = {
      id: form.dataset.editId || nextId(isCustomer ? "C" : "S", list),
      name: formData.name,
      phone,
      ...(isCustomer ? {
        governorate: normalizeGovernorate(formData.governorate),
        city: formData.city || "",
        address: formData.address || ""
      } : {}),
      creditLimit: Number(formData.creditLimit),
      balance: existingParty ? Number(existingParty.balance || 0) : Number(formData.balance || 0),
      createdAt: existingParty?.createdAt || now,
      updatedAt: now,
      deletedAt: null,
      ...(isCustomer ? { type: formData.type, points: 0 } : { terms: Number(formData.terms) })
    };
    const index = list.findIndex(row => row.id === item.id);
    if (index >= 0) item.points = list[index].points || 0;
    if (index >= 0) list[index] = { ...list[index], ...item };
    else list.push(item);
    const partyOperation = isCustomer ? (index >= 0 ? "CUSTOMER_UPDATED" : "CUSTOMER_CREATED") : (index >= 0 ? "SUPPLIER_UPDATED" : "SUPPLIER_CREATED");
    const saved = await saveData(partyOperation, isCustomer ? "العملاء" : "الموردون", item.id);
    if (!saved) {
      data = dataBeforePartySave;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return toast(`فشل حفظ ${isCustomer ? "العميل" : "المورد"} على الخادم. لم تُعتمد التغييرات.`, "error");
    }
    closeModal();
    if (isCustomer && form.dataset.returnToSale === "true") {
      draftSale.customerId = item.id;
      renderSales();
    } else if (isCustomer && form.dataset.returnToOnlineOrder === "true") {
      const draft = {
        ...(pendingOnlineOrderDraft || {}),
        customerId: item.id,
        customerName: item.name,
        phone: item.phone,
        governorate: item.governorate,
        city: item.city,
        address: item.address
      };
      pendingOnlineOrderDraft = null;
      onlineOrderModal(draft);
    } else {
      renderParties();
    }
    toast(`تم ${index >= 0 ? "تحديث" : "إضافة"} ${isCustomer ? "العميل" : "المورد"} بنجاح.`);
  }
  if (form.id === "order-shipment-form") {
    createShipmentFromOrder(form.dataset.orderId, {
      company: formData.company,
      tracking: formData.tracking,
      status: formData.status,
      cost: Math.max(0, Number(normalizeArabicNumericText(formData.cost)) || 0)
    });
    return;
  }
  if (form.id === "ready-order-shipment-form") {
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    shippingSessionCompany=formData.company;
    submitReadyOrderShipment(form.dataset.orderId,{company:formData.company,trackingNumber:formData.trackingNumber,shippedAt:formData.shippedAt,cost:Math.max(0,Number(normalizeArabicNumericText(formData.cost))||0)}).then(()=>{closeModal();onlineOrdersMode="ready-shipping";renderOnlineOrders();}).catch(error=>{button.disabled=false;toast(error.message,"error");});
    return;
  }
  if (form.id === "post-invoice-shipping-choice") {
    const order = getOnlineOrder(form.dataset.orderId);
    if (!order) return toast("الطلب غير موجود.", "error");
    if (formData.shippingChoice === "yes") return createShipmentFromOrder(order.id);
    order.status = "لم يتم الشحن بعد";
    order.updatedAt = new Date().toISOString();
    saveData("تأجيل إنشاء الشحنة", "طلبات الأونلاين", order.id);
    closeModal();
    renderOnlineOrders();
    toast("تم حفظ الفاتورة، ولم يتم إنشاء شحنة بعد.");
    return;
  }
  if (form.id === "shipping-company-form") {
    const name = String(formData.name || "").trim();
    if (!name) return toast("اكتب اسم شركة الشحن.", "error");
    const current = data.shippingCompanies.find(company => company.id === form.dataset.editId);
    const duplicate = data.shippingCompanies.find(company => !company.deletedAt && company.id !== current?.id && company.name === name);
    if (duplicate) return toast("شركة الشحن مسجلة من قبل.", "error");
    const now = new Date().toISOString();
    if (current) {
      current.name = name;
      current.active = Boolean(form.elements.active?.checked);
      current.finance = {
        ...carrierFinanceSettings(current),
        commissionRate:Math.max(0,Number(normalizeArabicNumericText(formData.commissionRate))||0),
        minimumCommission:Math.max(0,Number(normalizeArabicNumericText(formData.minimumCommission))||0),
        commissionBasis:formData.commissionBasis||"total_collection",
        customCommissionBase:Math.max(0,Number(normalizeArabicNumericText(formData.customCommissionBase))||0),
        deductShippingCost:Boolean(form.elements.deductShippingCost?.checked),
        deductReturnFees:Boolean(form.elements.deductReturnFees?.checked),
        autoCreateExpenses:Boolean(form.elements.autoCreateExpenses?.checked),
        active:Boolean(form.elements.active?.checked)
      };
      current.updatedAt = now;
    } else {
      data.shippingCompanies.push({ id: nextId("SC-", data.shippingCompanies), name, active: true, createdAt: now, updatedAt: now, deletedAt: null });
    }
    saveData(current ? "تعديل شركة شحن" : "إضافة شركة شحن", "الشحن", current?.id || name);
    showShippingCompanies();
    toast("تم حفظ شركة الشحن.");
    return;
  }
  if (form.id === "shipment-form") {
    const index = data.shipments.findIndex(row => row.id === form.dataset.editId);
    const existing = index >= 0 ? data.shipments[index] : null;
    const linkedSale = data.sales.find(sale => sale.id === formData.orderId);
    if (!existing && !linkedSale) return toast("يجب إدخال رقم فاتورة مسجلة لإنشاء الشحنة.", "error");
    const duplicate = !existing && data.shipments.find(shipment => !shipment.deletedAt && (shipment.invoiceId === linkedSale.id || shipment.orderId === linkedSale.id));
    if (duplicate) return toast("تم إنشاء شحنة لهذه الفاتورة من قبل.", "error");
    const company = normalizeShippingCompanyName(formData.company);
    if (!company) return toast("يجب اختيار شركة شحن مسجلة من القائمة.", "error");
    const trackingNumber = normalizeTrackingNumber(formData.tracking);
    if (trackingNumber && !validTrackingNumber(trackingNumber)) return toast("رقم التتبع غير صالح. تأكد من إزالة المسافات والرموز غير المسموحة.", "error");
    const governorate = normalizeGovernorate(formData.governorate);
    if (!governorate && !linkedSale) return toast("يجب اختيار محافظة من القائمة.", "error");
    const linkedCustomer = getCustomer(linkedSale?.customerId);
    const snapshot = linkedSale?.customerSnapshot || customerSnapshot(linkedCustomer);
    const now = new Date().toISOString();
    const item = {
      ...(existing || {}), id: form.dataset.editId || nextId("SH-", data.shipments), ...formData,
      orderId: linkedSale?.id || existing?.orderId || formData.orderId,
      invoiceId: linkedSale?.id || existing?.invoiceId || "",
      onlineOrderId: linkedSale?.onlineOrderId || existing?.onlineOrderId || "",
      customerId: linkedSale?.customerId || existing?.customerId || "",
      customer: snapshot.name || formData.customer,
      phone: snapshot.phone || formData.phone || existing?.phone || "",
      customerName: snapshot.name || formData.customer,
      customerPhone: snapshot.phone || formData.phone || existing?.phone || "",
      company,
      carrier: company,
      carrierCode: isEgyptPostCarrier(company) ? "EGYPT_POST" : existing?.carrierCode || "",
      tracking: trackingNumber,
      trackingNumber,
      trackingEnabled: formData.trackingEnabled === "true" && Boolean(trackingNumber) && isEgyptPostCarrier(company),
      trackingProvider: isEgyptPostCarrier(company) ? data.settings.tracking.providerName : "",
      currentStatus: formData.status || existing?.currentStatus || "",
      normalizedStatus: normalizeTrackingStatusText(formData.status || existing?.currentStatus || ""),
      shippingStatus: normalizeTrackingStatusText(formData.status || existing?.currentStatus || "") || existing?.shippingStatus || "shipped",
      governorate: snapshot.governorate || governorate || existing?.governorate || "",
      city: snapshot.city || formData.city,
      address: snapshot.address || formData.address || existing?.address || "",
      cost: Math.max(0, Number(normalizeArabicNumericText(formData.cost)) || 0), updated: now, updatedAt: now, createdAt: existing?.createdAt || now, deletedAt: existing?.deletedAt ?? null
    };
    const financeSnapshot=shipmentFinanceValues({...item,carrierShippingCostExpected:item.cost});
    item.customerShippingCharge=financeSnapshot.customerShippingCharge;
    item.carrierShippingCostExpected=item.cost;
    item.collectionCommissionExpected=financeSnapshot.collectionCommissionExpected;
    item.expectedNetSettlement=financeSnapshot.expectedNetSettlement;
    item.productsValue=financeSnapshot.productsValue;
    item.collectionAmount=financeSnapshot.collectionAmount;
    item.carrierFinanceSnapshot=existing?.carrierFinanceSnapshot||carrierFinanceSettings(company);
    if (index >= 0) data.shipments[index] = item;
    else {
      data.shipments.unshift(item);
      if (linkedSale) linkedSale.shipmentId = item.id;
    }
    const invoice = linkedSale || data.sales.find(sale => sale.id === item.invoiceId || sale.id === item.orderId);
    if (invoice) {
      invoice.shipmentId = item.id;
      invoice.shippingCost = item.cost;
      invoice.updatedAt = now;
    }
    saveData(index >= 0 ? "تعديل شحنة" : "إنشاء شحنة", "الشحن", item.id);
    closeModal();
    renderShipping();
    toast(index >= 0 ? "تم تحديث بيانات الشحنة." : "تم إنشاء الشحنة وحفظ كود التتبع.");
  }
  if (form.id === "cash-account-form") {
    const name = String(formData.name || "").trim();
    if (!name) return toast("اكتب اسم الخزنة.", "error");
    const existing = data.cashAccounts.find(row => row.id === form.dataset.editId);
    const duplicate = data.cashAccounts.find(row => !row.deletedAt && row.id !== existing?.id && row.name === name);
    if (duplicate) return toast("يوجد خزنة أو حساب بنفس الاسم.", "error");
    const now = new Date().toISOString();
    const item = {
      ...(existing || {}),
      id: existing?.id || nextId("CA-", data.cashAccounts),
      name,
      openingBalance: Number(formData.openingBalance || 0),
      accountType: formData.accountType || existing?.accountType || "خزنة نقدية",
      currency: formData.currency || existing?.currency || data.settings.currency || "ج.م",
      notes: formData.notes || "",
      active: formData.active !== "false",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      deletedAt: existing?.deletedAt || null
    };
    const index = data.cashAccounts.findIndex(row => row.id === item.id);
    if (index >= 0) data.cashAccounts[index] = item;
    else data.cashAccounts.push(item);
    saveData(index >= 0 ? "تعديل خزنة" : "إضافة خزنة", "الحسابات", item.id);
    closeModal();
    renderAccounting();
    toast("تم حفظ بيانات الخزنة.");
    return;
  }
  if (form.id === "manual-tracking-form") {
    saveManualTrackingResult(form.dataset.id, {
      normalizedStatus: formData.normalizedStatus || "unknown",
      statusText: formData.statusText || "",
      location: formData.location || "",
      eventAt: formData.eventAt || "",
      notes: formData.notes || "",
      updateOperationalStatus: form.elements.updateOperationalStatus?.checked,
      clearManualReview: form.elements.clearManualReview?.checked
    });
    return;
  }
  if (form.id === "quick-shipment-status-form") {
    await applyManualShipmentStatus(form.dataset.id, formData.shippingStatus, formData.notes || "");
    return;
  }
  if (form.id === "add-shipment-complaint-form") {
    await createShipmentComplaint(form.dataset.shipmentId, formData);
    return;
  }
  if (form.id === "edit-shipment-complaint-form") {
    await updateShipmentComplaint(form.dataset.id, formData);
    return;
  }
  if (form.id === "shipment-complaint-form") {
    const complaint = data.complaints.find(item => item.id === form.dataset.id);
    if (!complaint) return toast("لم يتم العثور على الشكوى.", "error");
    Object.assign(complaint, {
      complaintStatus: formData.complaintStatus,
      complaintReference: formData.complaintReference || "",
      reason: formData.reason || "",
      followUpAt: formData.followUpAt || "",
      notes: formData.notes || "",
      resolvedAt: ["resolved", "closed"].includes(formData.complaintStatus) ? (complaint.resolvedAt || new Date().toISOString()) : "",
      updatedAt: new Date().toISOString()
    });
    saveData("تحديث شكوى شحنة", "الشحن", complaint.shipmentId);
    closeModal();
    renderShipping();
    toast("تم حفظ بيانات الشكوى.");
    return;
  }
  if (form.id === "finance-expense-form") {
    const amount=Math.max(0,Number(normalizeArabicNumericText(formData.amount))||0);
    if(!amount) return toast("أدخل مبلغًا صحيحًا أكبر من صفر.","error");
    const existing=data.expenses.find(item=>item.id===form.dataset.editId);
    if(existing?.status==="معتمد") return toast("لا يمكن تعديل مصروف معتمد.","error");
    const actor=actorSnapshot(),now=new Date().toISOString();
    const type=currentFinanceType("expense",formData.expenseTypeId);
    if(!type||type.active===false)return toast("اختر نوع مصروف مفعلًا.","error");
    const item={...(existing||{}),id:existing?.id||nextId("EXP-",data.expenses),date:formData.date||today(),expenseTypeId:type.id,expenseType:type.name,amount,account:formData.account,paymentMethod:formData.paymentMethod,beneficiary:formData.beneficiary||"",reference:String(formData.reference||"").trim(),notes:formData.notes||"",source:formData.source||"يدوي",orderId:formData.orderId||"",invoiceId:formData.invoiceId||"",shipmentId:formData.shipmentId||"",settlementId:formData.settlementId||"",status:"مسجل",createdAt:existing?.createdAt||now,createdBy:existing?.createdBy||actor.name,updatedAt:now,updatedBy:actor.name};
    const index=data.expenses.findIndex(row=>row.id===item.id);if(index>=0)data.expenses[index]=item;else data.expenses.push(item);
    saveData(existing?"تعديل مصروف":"إضافة مصروف","المالية",item.id);closeModal();renderAccounting();toast("تم حفظ المصروف بانتظار الاعتماد.");return;
  }
  if (form.id === "finance-income-form") {
    const amount=Math.max(0,Number(normalizeArabicNumericText(formData.amount))||0),reference=String(formData.reference||"").trim();
    if(!amount)return toast("أدخل مبلغًا صحيحًا أكبر من صفر.","error");
    if(reference&&data.otherIncome.some(item=>item.reference===reference&&item.status!=="ملغي"))return toast("رقم المرجع مستخدم في إيراد آخر.","error");
    const type=currentFinanceType("income",formData.incomeTypeId);
    if(!type||type.active===false)return toast("اختر نوع إيراد مفعلًا.","error");
    const actor=actorSnapshot(),now=new Date().toISOString();
    const item={id:nextId("INC-",data.otherIncome),date:formData.date||today(),incomeTypeId:type.id,incomeType:type.name,amount,account:formData.account,receiptMethod:formData.receiptMethod,payer:formData.payer||"",reference,notes:formData.notes||"",status:"مسجل",createdAt:now,createdBy:actor.name};
    data.otherIncome.push(item);saveData("إضافة إيراد آخر","المالية",item.id);closeModal();renderAccounting();toast("تم حفظ الإيراد بانتظار الاعتماد.");return;
  }
  if (form.id === "finance-type-form") {
    const kind=form.dataset.kind==="income"?"income":"expense",list=kind==="income"?data.incomeTypes:data.expenseTypes;
    const name=String(formData.name||"").trim();if(!name)return toast("أدخل اسم النوع.","error");
    const existing=list.find(item=>item.id===form.dataset.editId);
    if(list.some(item=>item.name.trim().toLowerCase()===name.toLowerCase()&&item.id!==existing?.id&&!item.deletedAt))return toast(`نوع ${kind==="income"?"الإيراد":"المصروف"} موجود بالفعل.`,"error");
    const actor=actorSnapshot(),now=new Date().toISOString();
    const type=existing||{id:nextId(kind==="income"?"IT-":"ET-",list),createdAt:now,createdBy:actor.name};
    Object.assign(type,{name,description:kind==="income"?String(formData.description||"").trim():(type.description||""),category:kind==="expense"?formData.category:(type.category||""),mode:kind==="expense"?formData.mode:(type.mode||""),carrier:kind==="expense"?(formData.carrier||""):(type.carrier||""),active:formData.active!=="false",updatedAt:now,updatedBy:actor.name});
    if(!existing)list.push(type);
    saveData(existing?`تعديل نوع ${kind==="income"?"إيراد":"مصروف"}`:`إضافة نوع ${kind==="income"?"إيراد":"مصروف"}`,"المالية",type.id);
    if(form.dataset.quick==="1"){
      if(pendingFinanceFormDraft)pendingFinanceFormDraft.values[`${kind}TypeId`]=type.id;
      if(kind==="income")financeIncomeModal(type.id);else financeExpenseModal(data.expenses.find(item=>item.id===pendingFinanceFormDraft?.editId));
      toast(`تمت إضافة النوع واختياره تلقائيًا.`);return;
    }
    financeTypesModal(kind);toast(existing?"تم حفظ تعديل النوع.":"تمت إضافة النوع.");return;
  }
  if (form.id === "finance-settlement-form") {
    const codes=[...new Set(String(formData.trackingCodes||"").split(/\r?\n|,/).map(normalizeTrackingNumber).filter(Boolean))];
    if(!codes.length)return toast("أدخل كود تتبع واحدًا على الأقل.","error");
    const company=formData.company,missing=[],duplicate=[],ineligible=[],lines=[];
    codes.forEach(code=>{const shipment=data.shipments.find(item=>normalizeTrackingNumber(item.trackingNumber||item.tracking)===code&&(!company||[item.company,item.carrier].includes(company)));if(!shipment){missing.push(code);return;}if(shipment.settlementId&&shipment.settlementId!==form.dataset.editId){duplicate.push(code);return;}if(!["delivered","returned"].includes(shipmentStatusCode(shipment)))ineligible.push(code);const values=shipmentFinanceValues(shipment);lines.push({shipmentId:shipment.id,trackingNumber:code,orderId:shipment.orderId||"",invoiceId:shipment.invoiceId||shipment.orderId||"",customer:shipment.customer||shipment.customerName||"",phone:shipment.phone||shipment.customerPhone||"",status:shipmentStatusMeta(shipment).label,...values,carrierShippingCostActual:values.carrierShippingCostExpected,collectionCommissionActual:values.collectionCommissionExpected,actualNetSettlement:values.expectedNetSettlement});});
    if(missing.length)return toast(`أكواد غير موجودة: ${missing.join("، ")}`,"error");
    if(duplicate.length)return toast(`شحنات تمت تسويتها: ${duplicate.join("، ")}`,"error");
    if(ineligible.length&&!canAction("approve-settlement-difference"))return toast(`شحنات غير مسلمة: ${ineligible.join("، ")}`,"error");
    const existing=data.carrierSettlements.find(item=>item.id===form.dataset.editId),actor=actorSnapshot(),now=new Date().toISOString(),totals=settlementSummary({lines});
    const expected=centsMoney(moneyCents(totals.collection)-moneyCents(totals.actualCost)-moneyCents(totals.actualCommission)-moneyCents(formData.otherDeductions||0));
    const actualSettlement=centsMoney(moneyCents(formData.actualNetSettlement||0));
    if(actualSettlement<0)return toast("لا يمكن إدخال مبلغ تسوية سالب.","error");
    const item={...(existing||{}),id:existing?.id||nextId("SET-",data.carrierSettlements),company,transferDate:formData.transferDate||today(),transferReference:String(formData.transferReference||"").trim(),account:formData.account,trackingCodes:codes,lines,otherDeductions:centsMoney(moneyCents(formData.otherDeductions||0)),expectedNetSettlement:expected,actualNetSettlement:actualSettlement,settlementDifference:centsMoney(moneyCents(actualSettlement)-moneyCents(expected)),differenceReason:formData.differenceReason||"",notes:formData.notes||"",status:"مسودة",createdAt:existing?.createdAt||now,createdBy:existing?.createdBy||actor.name,updatedAt:now};
    const index=data.carrierSettlements.findIndex(row=>row.id===item.id);if(index>=0)data.carrierSettlements[index]=item;else data.carrierSettlements.push(item);
    saveData(existing?"تعديل تسوية":"إنشاء تسوية","المالية",item.id);newSettlementModal(item);toast("تم حفظ مسودة التسوية.");return;
  }
  if (form.id === "cash-transfer-form") {
    const fromAccount = normalizeCashAccountName(formData.fromAccount);
    const toAccount = normalizeCashAccountName(formData.toAccount);
    const amount = Number(formData.amount || 0);
    if (!fromAccount || !toAccount || fromAccount === toAccount) return toast("اختر خزنتين مختلفتين للتحويل.", "error");
    if (amount <= 0) return toast("يجب إدخال مبلغ أكبر من صفر.", "error");
    if (cashAccountBalance(fromAccount) < amount) return toast("رصيد الخزنة المحول منها غير كافٍ.", "error");
    const transferId = `TR-${Date.now()}`;
    const date = formData.date || today();
    const note = formData.note || `تحويل من ${fromAccount} إلى ${toAccount}`;
    const now = new Date().toISOString();
    const outId = nextId("TX-", data.cash);
    const inId = `TX-${String(Number(outId.replace(/\D/g, "")) + 1).padStart(3, "0")}`;
    data.cash.push(
      { id: outId, date, type: "صرف", locked: true, account: fromAccount, party: toAccount, amount, category: "تحويل بين الخزن", note, transferId, createdAt: now, updatedAt: now, deletedAt: null },
      { id: inId, date, type: "قبض", locked: true, account: toAccount, party: fromAccount, amount, category: "تحويل بين الخزن", note, transferId, createdAt: now, updatedAt: now, deletedAt: null }
    );
    saveData("تحويل بين الخزن", "الحسابات", transferId);
    closeModal();
    renderAccounting();
    toast("تم تنفيذ التحويل بين الخزن.");
    return;
  }
  if (form.id === "sale-return-form") {
    processSaleReturn(form.dataset.id, { account: formData.account, date: formData.date, reason: formData.reason });
    return;
  }
  if (form.id === "sale-customer-return-form") {
    processCustomerSaleReturn(form.dataset.customerId, {
      account: formData.account,
      date: formData.date,
      reason: formData.reason,
      settlement: formData.settlement || "cash",
      replacementDeduction: formData.replacementDeduction
    });
    return;
  }
  if (form.id === "purchase-return-form") {
    processPurchaseReturn(form.dataset.id, {
      account: formData.account,
      date: formData.date,
      reason: formData.reason,
      supplierInvoiceNumber: formData.supplierInvoiceNumber,
      supplierReturnInvoiceNumber: formData.supplierReturnInvoiceNumber
    });
    return;
  }
  if (form.id === "purchase-supplier-return-form") {
    processSupplierPurchaseReturn(form.dataset.supplierId, {
      account: formData.account,
      date: formData.date,
      reason: formData.reason,
      settlement: formData.settlement || "cash",
      notes: formData.notes
    });
    return;
  }
  if (form.id === "cash-form") {
    const existingCash = data.cash.find(row => row.id === form.dataset.editId);
    if (existingCash && isLockedCash(existingCash)) { toast("لا يمكن تعديل قيد تلقائي مرتبط بمستند.", "error"); return; }
    const actor = actorSnapshot();
    const now = new Date().toISOString();
    const item = {
      ...(existingCash || {}),
      id: form.dataset.editId || nextId("TX-", data.cash),
      date: formData.date || today(),
      type: form.dataset.type,
      account: formData.account,
      party: formData.party,
      amount: Number(formData.amount),
      category: formData.category,
      note: formData.note,
      createdAt: existingCash?.createdAt || now,
      createdBy: existingCash?.createdBy || actor.name,
      createdByUsername: existingCash?.createdByUsername || actor.username,
      createdByRole: existingCash?.createdByRole || actor.role,
      createdById: existingCash?.createdById || actor.userId,
      updatedAt: now,
      updatedBy: actor.name,
      updatedByUsername: actor.username,
      updatedByRole: actor.role,
      updatedById: actor.userId
    };
    const index = data.cash.findIndex(row => row.id === item.id);
    if (index >= 0) data.cash[index] = item;
    else data.cash.push(item);
    saveData(index >= 0 ? "تعديل حركة مالية" : `إضافة سند ${form.dataset.type}`, "الحسابات", item.id);
    closeModal();
    renderAccounting();
    toast(index >= 0 ? "تم تحديث الحركة المالية." : `تم حفظ سند ${form.dataset.type}.`);
  }
  if (form.id === "employee-form") {
    const item = { id: form.dataset.editId || nextId("E", data.employees), name: formData.name, role: formData.role, salary: Number(formData.salary), attendance: formData.attendance, permissions: formData.permissions || "حسب الدور" };
    const index = data.employees.findIndex(row => row.id === item.id);
    if (index >= 0) data.employees[index] = item;
    else data.employees.push(item);
    saveData(index >= 0 ? "تعديل موظف" : "إضافة موظف", "الموظفون", item.id);
    closeModal();
    renderHr();
    toast(index >= 0 ? "تم تحديث بيانات الموظف." : "تم إنشاء ملف الموظف وحساب النظام.");
  }
  if (form.id === "stock-form") {
    const book = getBook(form.dataset.id);
    const before = Number(book.stock || 0);
    book.stock = Number(formData.stock);
    recordStockMovement(book, formData.reason || "تسوية مخزون", book.stock - before, before, book.stock, `ADJ-${Date.now()}`, formData.note || "");
    saveData("تسوية مخزون", "المخزون", book.id);
    closeModal();
    renderBooks();
    toast("تم تسجيل تسوية المخزون مع سبب الحركة.");
  }
  if (form.id === "shipment-status-form") {
    const shipment = data.shipments.find(s => s.id === form.dataset.id);
    shipment.status = formData.status;
    shipment.updated = new Date().toISOString();
    shipment.updatedAt = new Date().toISOString();
    const onlineOrder = data.onlineOrders.find(item => item.id === shipment.onlineOrderId);
    if (onlineOrder) {
      const statusMap = { "جديدة":"تم إنشاء الشحنة", "تم التجهيز":"تم إنشاء الشحنة", "تم التسليم للشركة":"خرج للتوصيل", "في الطريق":"خرج للتوصيل", "خرج للتوصيل":"خرج للتوصيل", "تم التسليم":"تم التسليم", "مرتجع":"مرتجع" };
      onlineOrder.status = statusMap[shipment.status] || onlineOrder.status;
      onlineOrder.updatedAt = new Date().toISOString();
    }
    saveData("تحديث حالة شحنة", "الشحن", shipment.id);
    closeModal();
    renderShipping();
    toast("تم تحديث حالة الشحنة.");
  }
  if (form.id === "sale-payment-form") {
    const sale = data.sales.find(item => item.id === form.dataset.id);
    const amount = Number(formData.amount || 0);
    if (!sale || amount <= 0 || amount > (sale.remaining || 0)) {
      return toast("قيمة التحصيل غير صحيحة أو أكبر من المتبقي.", "error");
    }
    sale.paid = Number(sale.paid || 0) + amount;
    sale.remaining = Math.max(0, Number(sale.total) - sale.paid);
    const customer = getCustomer(sale.customerId);
    if (customer) customer.balance = Math.max(0, Number(customer.balance || 0) - amount);
    data.cash.push({
      id: nextId("TX-", data.cash),
      date: formData.date || today(),
      type: "قبض",
      locked: true,
      account: formData.account,
      party: customer?.name || "عميل",
      amount,
      category: "تحصيل مديونية",
      note: `تحصيل فاتورة ${sale.id}`
    });
    saveData("تحصيل فاتورة", "المبيعات", sale.id);
    closeModal();
    toast("تم تسجيل التحصيل وتحديث المتبقي والخزينة.");
  }
  if (form.id === "limited-sale-edit-form") {
    const sale = data.sales.find(item => item.id === form.dataset.id);
    if (!sale) return toast("لم يتم العثور على الفاتورة.", "error");
    if (!saleCanBeModified(sale)) return toast("هذه اليومية مقفولة. التعديل يحتاج صلاحية مدير.", "error");
    const actor = actorSnapshot();
    sale.channel = formData.channel || sale.channel;
    sale.saleOperationType = formData.saleOperationType || sale.saleOperationType || "بيع مباشر";
    sale.notes = formData.notes || "";
    sale.updatedByUserId = actor.userId;
    sale.updatedByName = actor.name;
    sale.updatedAt = new Date().toISOString();
    saveData("تعديل محدود لفاتورة بيع", "المبيعات", sale.id);
    closeModal();
    renderSales();
    toast("تم حفظ التعديل المحدود.");
  }
  if (form.id === "party-voucher-form") {
    try {
      const receipt = createPartyVoucher({
        type: form.dataset.voucherType,
        partyKind: formData.partyKind,
        partyId: formData.partyId,
        amount: formData.amount,
        date: formData.date,
        account: formData.account,
        method: formData.method,
        balanceMode: formData.balanceMode,
        reference: formData.reference,
        note: formData.note
      });
      closeModal();
      if (currentView === "parties") renderParties();
      else renderAccounting();
      toast(`تم حفظ إيصال ${receipt.type} رقم ${receipt.id} وتحديث الخزنة وكشف الحساب.`);
    } catch (error) {
      toast(error.message || "تعذر حفظ الإيصال.", "error");
    }
  }
});

function filterBooks() {
  const term = document.getElementById("book-search")?.value.trim().toLowerCase() || "";
  const category = document.getElementById("book-category")?.value || "";
  const stock = document.getElementById("book-stock-filter")?.value || "";
  const filtered = data.books.filter(book => !book.deletedAt && (() => {
    const haystack = `${book.name} ${book.barcode} ${book.extraBarcode} ${book.publisher} ${book.author} ${book.category} ${itemTypeLabel(book)} ${itemUnitLabel(book)}`.toLowerCase();
    const termMatch = haystack.includes(term);
    const categoryMatch = !category || book.category === category;
    const stockMatch = !stock || (stock === "low" && book.stock > 0 && book.stock <= book.reorder) || (stock === "zero" && book.stock <= 0) || (stock === "consignment" && !book.owned);
    return termMatch && categoryMatch && stockMatch;
  })());
  document.getElementById("books-table").innerHTML = booksTable(filtered);
  scheduleStickyTableScrollbar();
}

function filterShipments() {
  const term = document.getElementById("shipment-search")?.value.trim().toLowerCase() || "";
  const status = document.getElementById("shipment-status")?.value || "";
  const trackingFilter = document.getElementById("shipment-tracking-filter")?.value || "";
  shippingQuickFilter = trackingFilter;
  const summary = document.getElementById("shipping-filter-summary");
  const quickLabel = shippingQuickFilterLabel();
  if (summary) {
    summary.innerHTML = quickLabel ? `<div class="alert-item" style="margin:14px 0"><div class="alert-badge blue">i</div><div><strong>الفلتر الحالي: ${esc(quickLabel)}</strong><span>الجدول بالأسفل يعرض الشحنات المطابقة، ويمكنك فتح أو تعديل أي شحنة مباشرة.</span></div><button class="row-action" data-action="shipping-stat" data-stat="shipping:all">عرض كل الشحنات</button></div>` : "";
  }
  document.querySelectorAll('.stat-card.interactive[data-action="shipping-stat"]').forEach(card => {
    card.classList.toggle("active", Boolean(shippingQuickFilter) && card.dataset.stat === `shipping:${shippingQuickFilter}`);
  });
  const list = data.shipments.filter(s => {
    const complaintNumbers = shipmentComplaints(s.id).map(item => item.complaintNumber || item.complaintReference || "").join(" ");
    const haystack = `${s.id} ${s.orderId} ${s.invoiceId || ""} ${s.onlineOrderId || ""} ${s.tracking} ${s.trackingNumber || ""} ${s.customer} ${s.customerName || ""} ${complaintNumbers}`.toLowerCase();
    const byFilter =
      !trackingFilter ||
      (trackingFilter === "active" && !["تم التسليم","مرتجع","ملغاة"].includes(s.status)) ||
      (trackingFilter === "delayed" && Number(s.delayHours || 0) > 0) ||
      (trackingFilter === "no-movement" && s.lastMovementAt && (Date.now() - new Date(s.lastMovementAt).getTime()) / 3600000 >= data.settings.tracking.noMovementHours) ||
      (trackingFilter === "complaint" && s.requiresComplaint) ||
      (trackingFilter === "call" && s.requiresCustomerCall) ||
      (trackingFilter === "return-risk" && s.returnRisk) ||
      (trackingFilter === "delivered" && s.status === "تم التسليم") ||
      (trackingFilter === "returned" && s.status === "مرتجع") ||
      (trackingFilter === "manual" && (s.manualInterventionNeeded || s.manual_review_required)) ||
      (trackingFilter === "auto-failed" && Boolean(s.trackingError)) ||
      (trackingFilter === "site-blocked" && (s.trackingDiagnostics?.failureCode === "SITE_BLOCKED" || s.trackingDebug?.failureCode === "SITE_BLOCKED")) ||
      (trackingFilter === "error" && s.trackingError);
    return !s.deletedAt && haystack.includes(term) && (!status || shipmentStatusCode(s) === status) && byFilter;
  });
  document.getElementById("shipments-table").innerHTML = shipmentsTable(list);
  scheduleStickyTableScrollbar();
}

function filterOnlineOrders() {
  const term = document.getElementById("online-order-search")?.value.trim().toLowerCase() || "";
  const list = data.onlineOrders.filter(order => {
    const sale=(data.sales||[]).find(item=>item.id===order.saleId||item.onlineOrderId===order.id);
    const shipment=(data.shipments||[]).find(item=>item.id===order.shipmentId||item.onlineOrderId===order.id);
    const haystack=`${order.id} ${order.saleId||sale?.id||""} ${order.customerName||""} ${order.phone||""} ${order.tracking||order.trackingNumber||shipment?.trackingNumber||shipment?.tracking||""}`.toLowerCase();
    return !order.deletedAt&&onlineOrderMatchesQuickFilter(order)&&haystack.includes(term);
  });
  const table = document.getElementById("online-orders-table");
  if (table) table.innerHTML = onlineOrdersTable(list);
  scheduleStickyTableScrollbar();
}

function searchSaleBooks(term) {
  return smartBookSearch(term, 8);
}

function addBookToDraftSale(bookId, qty = 1) {
  const book = getBook(bookId);
  if (!book) return;
  const existing = draftSale.lines.find(line => line.bookId === bookId);
  if (existing) existing.qty += Math.max(1, Number(qty || 1));
  else {
    const empty = draftSale.lines.find(line => !line.bookId);
    const line = { bookId, qty: Math.max(1, Number(qty || 1)), price: productDefaultSellingPrice(book), discount: 0, discountType: "percent" };
    if (empty) Object.assign(empty, line); else draftSale.lines.push(line);
  }
  renderSales();
  setTimeout(() => document.getElementById("sale-book-search")?.focus(), 50);
}

function addBookToDraftPurchase(bookId, qty = 1) {
  const book = getBook(bookId);
  if (!book) return;
  const existing = draftPurchase.lines.find(line => line.bookId === bookId);
  if (existing) existing.qty += Math.max(1, Number(qty || 1));
  else {
    const empty = draftPurchase.lines.find(line => !line.bookId);
    const line = { bookId, qty: Math.max(1, Number(qty || 1)), cost: productInventorySummary(book.id).lastPurchaseCost || book.cost || 0, coverPriceAtPurchase: productCoverPrice(book), supplierDiscountPercent: 0, discount: 0, discountType: "percent" };
    if (empty) Object.assign(empty, line); else draftPurchase.lines.push(line);
  }
  renderPurchases();
  setTimeout(() => document.getElementById("purchase-book-search")?.focus(), 50);
}

function findOrCreateOrderCustomer(order) {
  let customer = getCustomer(order.customerId) || data.customers.find(item => !item.deletedAt && normalizePhone(item.phone) && normalizePhone(item.phone) === normalizePhone(order.phone));
  if (!customer) {
    const now = new Date().toISOString();
    customer = {
      id: nextId("C", data.customers), name: order.customerName, phone: order.phone,
      governorate: normalizeGovernorate(order.governorate), city: order.city || "", address: order.address || "",
      type: "أونلاين", creditLimit: 0, balance: 0, points: 0,
      createdAt: now, updatedAt: now, deletedAt: null
    };
    data.customers.push(customer);
  } else {
    customer.name = order.customerName || customer.name;
    customer.phone = order.phone || customer.phone;
    customer.governorate = normalizeGovernorate(order.governorate || customer.governorate);
    customer.city = order.city || customer.city || "";
    customer.address = order.address || customer.address || "";
    customer.updatedAt = new Date().toISOString();
  }
  return customer;
}

function movementDocumentContext(documentId = "") {
  const sale = data.sales.find(item => item.id === documentId);
  if (sale) return { documentType: "فاتورة بيع", partyName: getCustomer(sale.customerId)?.name || "", customerId: sale.customerId || "" };
  const purchase = data.purchases.find(item => item.id === documentId);
  if (purchase) return { documentType: "فاتورة شراء", partyName: getSupplier(purchase.supplierId)?.name || "", supplierId: purchase.supplierId || "" };
  const order = data.onlineOrders.find(item => item.id === documentId || item.saleId === documentId);
  if (order) return { documentType: "طلب أونلاين", partyName: order.customerName || "", customerId: order.customerId || "" };
  const ret = (data.returns || []).find(item => item.id === documentId || item.returnNo === documentId || item.returnInvoiceId === documentId);
  if (ret) return { documentType: returnTypeLabel(ret.type), partyName: returnAccountName(ret) || "", customerId: returnKind(ret.type) === "sale" ? ret.accountId || ret.partyId || "" : "", supplierId: returnKind(ret.type) === "purchase" ? ret.accountId || ret.partyId || "" : "" };
  return { documentType: "", partyName: "" };
}

function recordStockMovement(book, type, quantity, before, after, documentId, note = "") {
  const actor = actorSnapshot();
  const now = new Date().toISOString();
  const parts = operationDateParts(now);
  const context = movementDocumentContext(documentId);
  data.stockMovements.push({
    id: nextId("MOV-", data.stockMovements), bookId: book.id, date: now, createdAt: now,
    type, quantity: Number(quantity), before: Number(before), after: Number(after),
    documentId: documentId || "", documentNo: documentId || "", documentType: context.documentType,
    customerId: context.customerId || "", supplierId: context.supplierId || "", partyName: context.partyName || "",
    costAtOperation: Number(productInventorySummary(book.id).averageInventoryCost || book.cost || 0), priceAtOperation: Number(productDefaultSellingPrice(book) || 0),
    financialImpact: Number(quantity || 0) * (String(type).includes("بيع") ? Number(productDefaultSellingPrice(book) || 0) : Number(productInventorySummary(book.id).averageInventoryCost || book.cost || 0)),
    user: actor.name, username: actor.username, role: actor.role, userId: actor.userId,
    employeeName: actor.name, employeeRole: actor.role, dayName: parts.dayName, time: parts.time, note
  });
}

function consumeOrderReservation(order, sale) {
  const reservation=order?.inventoryReservation;
  if(!reservation||reservation.status!=="active")return;
  const reservedByBook=new Map((reservation.lines||[]).map(line=>[line.bookId,Number(line.qty||0)]));
  for(const line of sale.lines||[]){
    const book=getBook(line.bookId),reserved=reservedByBook.get(line.bookId)||0;
    if(book&&reserved>0)book.reservedStock=Math.max(0,bookReservedStock(book)-Math.min(reserved,Number(line.qty||0)));
  }
  const now=new Date().toISOString();
  Object.assign(reservation,{status:"consumed",consumedAt:now,updatedAt:now,consumedBy:currentUser?.name||currentUser?.username||"—",invoiceId:sale.id});
}

const orderInvoiceConversions = new Set();

function convertOnlineOrderToSale(id, options = {}) {
  const order = getOnlineOrder(id);
  if (!order) return toast("الطلب غير موجود.", "error");
  const invoiceOperationKey=`order-invoice:${order.id}`;
  const existingSale = data.sales.find(sale => sale.id === order.saleId || sale.onlineOrderId === order.id || sale.operationKey===invoiceOperationKey);
  if (existingSale) {
    order.saleId = existingSale.id;
    toast("تم إنشاء فاتورة لهذا الطلب من قبل.");
    return viewSale(existingSale.id);
  }
  if (!INVOICE_READY_ORDER_STATUSES.includes(order.status)) return toast("يجب تجهيز الطلب أولًا قبل إنشاء الفاتورة.", "error");
  if (!order.lines.length) return toast("أضف أصنافًا إلى الطلب أولًا.", "error");
  if(orderInvoiceConversions.has(order.id))return toast("جاري إنشاء فاتورة هذا الطلب بالفعل.");
  const totals = onlineOrderTotals(order.lines, order.orderDiscount, order.orderDiscountType, order.shippingCost);
  for (const computed of totals.lines) {
    const book = getBook(computed.bookId);
    if (!book) return toast("أحد أصناف الطلب غير موجود.", "error");
    const ownReserved=order.inventoryReservation?.status==="active"?Number(order.inventoryReservation.lines?.find(item=>item.bookId===computed.bookId)?.qty||0):0;
    const stockError = negativeStockError(book, computed.qty,ownReserved);
    if (stockError) return toast(stockError, "error");
    const netUnit = computed.qty > 0 ? computed.finalNet / computed.qty : 0;
    const summary = productInventorySummary(book.id);
    if (summary.averageInventoryCost > 0 && netUnit < summary.averageInventoryCost) return toast(`لا يمكن تحويل الطلب: صافي سعر «${book.name}» (${money(netUnit)}) أقل من متوسط التكلفة (${money(summary.averageInventoryCost)}).`, "error");
  }
  const customer = findOrCreateOrderCustomer(order);
  order.customerId = customer.id;
  const grandTotal = totals.total;
  const paymentSummary=OrderFinance.calculatePayment(grandTotal,Number(order.paidAmount||0));
  const paid = paymentSummary.paidAmount;
  const actor = actorSnapshot();
  orderInvoiceConversions.add(order.id);
  const sale = {
    id: nextId("INV-", data.sales), date: today(), customerId: customer.id, channel: "متجر إلكتروني",
    saleOperationType: "طلب أونلاين",
    payment: order.paymentMethod, paymentStatus:paymentSummary.paymentStatus, subtotal: totals.subtotal, subtotalBeforeDiscount:totals.subtotalBeforeDiscount, productDiscountTotal:totals.productDiscountTotal, orderDiscount:totals.orderDiscountAmount, discount: totals.discountTotal, subtotalAfterDiscount:totals.goods, shipping: totals.shipping, total: grandTotal,
    paid, paidAmount:paid, remaining: paymentSummary.remainingAmount, remainingAmount:paymentSummary.remainingAmount, status: "معتمدة", pointsAwarded: 0,
    lines: totals.lines.map(line => ({ bookId: line.bookId, productId: line.bookId, qty: line.qty, quantity: line.qty, price: line.price, originalPrice:line.price, originalTotal:line.originalTotal, unitOriginalPrice:line.unitOriginalPrice, unitSellingPrice: line.finalUnitPrice, unitFinalPrice:line.unitFinalPrice, finalUnitPrice:line.finalUnitPrice, totalSellingPrice: line.finalNet, finalNet:line.finalNet, discount:line.discountPercent, discountPercent:line.discountPercent, discountAmount:line.discountAmount, unitDiscountAmount:line.unitDiscountAmount, lineDiscountTotal:line.lineDiscountTotal, discountType:line.discountType, discountScope:line.discountScope })),
    onlineOrderId: order.id,
    operationKey:invoiceOperationKey,
    customerSnapshot: customerSnapshot(customer, order),
    createdByUserId: actor.userId, createdByName: actor.name, createdByUsername: actor.username, createdByRole: actor.role,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null
  };
  consumeOrderReservation(order,sale);
  sale.lines.forEach(line => recordNegativeStockOverride(getBook(line.bookId), line.qty, sale.id));
  sale.lines.forEach(line => {
    const book = getBook(line.bookId);
    const costing = allocateInventoryFIFO(book.id, line.qty);
    line.costMethod = "FIFO";
    line.costOfGoodsSold = costing.costIncomplete ? null : costing.costOfGoodsSold;
    line.grossProfit = costing.costIncomplete ? null : Number((Number(line.totalSellingPrice || 0) - costing.costOfGoodsSold).toFixed(2));
    line.batchAllocations = costing.allocations;
    line.costIncomplete = costing.costIncomplete;
    const before = book.stock; book.stock -= line.qty; book.lastSale = sale.date; book.updatedAt = new Date().toISOString();
    recordStockMovement(book, "بيع أونلاين", -line.qty, before, book.stock, sale.id, `طلب ${order.id}`);
  });
  if (sale.remaining > 0) customer.balance += sale.remaining;
  (data.orderPayments||[]).filter(item=>item.orderId===order.id&&item.status!=="reversed").forEach(item=>{item.invoiceId=sale.id;item.updatedAt=new Date().toISOString();});
  data.sales.push(sale);
  order.saleId = sale.id; order.status = "تم إنشاء الفاتورة"; order.updatedAt = new Date().toISOString();
  saveData("تحويل طلب أونلاين إلى فاتورة", "طلبات الأونلاين", order.id);
  saveQueue.finally(()=>orderInvoiceConversions.delete(order.id));
  if(!options.keepModal){closeModal();renderOnlineOrders();}
  toast(`تم إنشاء الفاتورة ${sale.id} وربطها بالطلب.`);
  if (options.askShipping !== false) setTimeout(() => postInvoiceShippingChoice(order.id, sale.id), 100);
  if (options.print !== false) setTimeout(() => printSale(sale.id), 150);
  return sale;
}

function postInvoiceShippingChoice(orderId, saleId) {
  const order = getOnlineOrder(orderId);
  const sale = data.sales.find(item => item.id === saleId);
  if (!order || !sale || order.shipmentId) return;
  openModal("هل تم الشحن؟", "ما بعد تسجيل الفاتورة", `
    <form id="post-invoice-shipping-choice" data-order-id="${order.id}" data-sale-id="${sale.id}">
      <div class="workflow-strip"><strong>الربط:</strong><span>${esc(order.id)}</span><b>→</b><span>${esc(sale.id)}</span><b>→</b><span>قرار الشحن</span></div>
      <div class="shipping-choice-grid" dir="rtl">
        <label class="choice-card shipping-choice-card"><input type="radio" name="shippingChoice" value="no" checked><span><strong>لا، لم يتم الشحن بعد</strong><small>تبقى الفاتورة موجودة ويظهر زر إنشاء شحنة لاحقًا.</small></span></label>
        <label class="choice-card shipping-choice-card"><input type="radio" name="shippingChoice" value="yes"><span><strong>نعم، تم إنشاء الشحنة</strong><small>سيتم فتح نموذج الشحنة لاختيار شركة الشحن ورقم التتبع.</small></span></label>
      </div>
      <div class="form-actions"><button class="btn" type="submit">متابعة</button><button class="btn ghost" type="button" data-action="close-modal">لاحقًا</button></div>
    </form>`);
}

function createShipmentFromOrder(id, details = null) {
  const order = getOnlineOrder(id);
  if (!order) return toast("الطلب غير موجود.", "error");
  const sale = data.sales.find(invoice => invoice.id === order.saleId || invoice.onlineOrderId === order.id);
  if (!sale) return toast("يجب إنشاء فاتورة للطلب أولًا قبل إنشاء الشحنة.", "error");
  order.saleId = sale.id;
  const existingShipment = data.shipments.find(shipment => !shipment.deletedAt && (shipment.id === order.shipmentId || shipment.onlineOrderId === order.id || shipment.invoiceId === sale.id));
  if (existingShipment) {
    order.shipmentId = existingShipment.id;
    sale.shipmentId = existingShipment.id;
    toast("تم إنشاء شحنة لهذا الطلب من قبل.");
    return viewShipment(existingShipment.id);
  }
  if (order.workflowStage && order.workflowStage !== "awaiting_shipping") return toast("يجب إكمال تجهيز الطلب وتغليفه قبل إنشاء الشحنة.", "error");
  if (!SHIPMENT_READY_ORDER_STATUSES.includes(order.status)) return toast("يجب إنشاء فاتورة للطلب أولًا قبل إنشاء الشحنة.", "error");
  if (!details) return shipmentFromOrderModal(order, sale);
  const company = normalizeShippingCompanyName(details.company);
  if (!company) return toast("يجب اختيار شركة شحن مسجلة من القائمة.", "error");
  const customer = getCustomer(sale.customerId) || getCustomer(order.customerId);
  const snapshot = sale.customerSnapshot || customerSnapshot(customer, order);
  const now = new Date().toISOString();
  const trackingNumber = normalizeTrackingNumber(details.tracking || order.tracking || `DC-${Date.now().toString().slice(-8)}`);
  const shipment = {
    id: nextId("SH-", data.shipments), orderId: sale.id, invoiceId: sale.id, onlineOrderId: order.id,
    company, carrier: company, carrierCode: isEgyptPostCarrier(company) ? "EGYPT_POST" : "", tracking: trackingNumber, trackingNumber,
    trackingEnabled: isEgyptPostCarrier(company) && validTrackingNumber(trackingNumber),
    trackingProvider: isEgyptPostCarrier(company) ? data.settings.tracking.providerName : "",
    customerId: sale.customerId, customer: snapshot.name, customerName: snapshot.name, phone: snapshot.phone, customerPhone: snapshot.phone,
    governorate: snapshot.governorate, city: snapshot.city, address: snapshot.address,
    cost: Number(details.cost ?? order.shippingCost ?? sale.shipping ?? 0), productsValue:Math.max(0,Number(sale.total||0)-Number(sale.shipping||0)),customerShippingCharge:Number(sale.shipping||0),collectionAmount:Number(sale.remainingAmount??sale.remaining??order.amountDueAtDelivery??order.total??0),amountDueAtDelivery:Number(sale.remainingAmount??sale.remaining??0), status: details.status || "تم الشحن", currentStatus: details.status || "تم الشحن", normalizedStatus: normalizeTrackingStatusText(details.status || "تم الشحن"), shippingStatus: normalizeTrackingStatusText(details.status || "تم الشحن"), updated: now,
    createdAt: now, updatedAt: now, deletedAt: null
  };
  data.shipments.unshift(shipment);
  sale.shipmentId = shipment.id;
  sale.shippingCost = shipment.cost;
  sale.updatedAt = now;
  const orderShipmentStatus = { "جديدة":"تم إنشاء الشحنة", "تم التجهيز":"تم إنشاء الشحنة", "خرج للتوصيل":"خرج للتوصيل", "تم التسليم":"تم التسليم", "مرتجع":"مرتجع" };
  order.shipmentId = shipment.id; order.tracking = shipment.tracking; order.status = orderShipmentStatus[shipment.status] || "تم إنشاء الشحنة"; order.updatedAt = now;
  saveData("إنشاء شحنة من طلب أونلاين", "طلبات الأونلاين", order.id);
  closeModal(); renderOnlineOrders(); toast(`تم إنشاء الشحنة ${shipment.id}.`);
  return shipment;
}

function shipmentFromOrderModal(order, sale) {
  const customer = getCustomer(sale.customerId) || getCustomer(order.customerId);
  const snapshot = sale.customerSnapshot || customerSnapshot(customer, order);
  openModal(`إنشاء شحنة للفاتورة ${sale.id}`, "الشحن بعد الفاتورة", `
    <form id="order-shipment-form" data-order-id="${order.id}">
      <div class="workflow-strip"><strong>الربط:</strong><span>${esc(order.id)}</span><b>→</b><span>${esc(sale.id)}</span><b>→</b><span>الشحنة الجديدة</span></div>
      <div class="form-grid">
        <div class="form-field"><label>رقم الفاتورة</label><input value="${esc(sale.id)}" readonly></div>
        <div class="form-field"><label>رقم الطلب</label><input value="${esc(order.id)}" readonly></div>
        <div class="form-field"><label class="required">شركة الشحن</label><select name="company" required>${shippingCompanyOptions()}</select></div>
        <div class="form-field"><label>رقم التتبع</label><input name="tracking" value="${esc(order.tracking || "")}" placeholder="يُنشأ تلقائيًا إذا تُرك فارغًا"></div>
        <div class="form-field"><label>الحالة</label><select name="status">${Object.values(SHIPPING_STATUSES).map(meta => `<option>${meta.label}</option>`).join("")}</select></div>
        <div class="form-field"><label for="order-shipment-extra-cost">تكلفة الشحن الإضافية</label><input ${numericFieldAttributes({ id:"order-shipment-extra-cost", name:"cost", value:Number(order.shippingCost || sale.shippingCost || sale.shipping || 0) })}></div>
      </div>
      <div class="customer-summary" style="margin-top:14px"><strong>${esc(snapshot.name)}</strong><span><span dir="ltr">${esc(snapshot.phone || "—")}</span></span><span>${esc([snapshot.governorate, snapshot.city, snapshot.address].filter(Boolean).join("، "))}</span></div>
      <div class="form-actions"><button class="btn" type="submit">إنشاء الشحنة وربطها بالفاتورة</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

function saveSale({ printAfter = false } = {}) {
  const totals = saleTotals();
  const validEntries = draftSale.lines
    .map((line, index) => ({ line, computed: totals.lines[index] || {} }))
    .filter(entry => entry.line.bookId && entry.line.qty > 0);
  const validLines = validEntries.map(entry => entry.line);
  if (!validLines.length) return toast("أضف صنفًا واحدًا على الأقل إلى الفاتورة.", "error");
  const customerId = draftSale.customerId;
  const customer = getCustomer(customerId);
  if (!customerId || !customer) return toast("يجب اختيار عميل مسجل وربط الفاتورة برقم Customer ID.", "error");
  for (const { line, computed } of validEntries) {
    const book = getBook(line.bookId);
    const netUnit = Number(line.qty || 0) > 0 ? Number(computed.finalNet ?? (Number(line.price) * Number(line.qty || 0))) / Number(line.qty || 1) : 0;
    const summary = productInventorySummary(book.id);
    if (summary.averageInventoryCost > 0 && netUnit < summary.averageInventoryCost) return toast(`لا يمكن بيع «${book.name}» بأقل من متوسط التكلفة.`, "error");
    const stockError = negativeStockError(book, line.qty);
    if (stockError) return toast(stockError, "error");
  }
  const payment = document.getElementById("sale-payment").value;
  const paid = Math.max(0, Math.min(Number(draftSale.paid || 0), totals.total));
  const remaining = Math.max(0, totals.total - paid);
  if (remaining > 0 && customer.creditLimit && customer.balance + remaining > customer.creditLimit) {
    const confirmed = confirm("سيتم تجاوز الحد الائتماني للعميل. هل تعتمد العملية بصلاحية المدير؟");
    if (!confirmed) return;
  }
  const sale = {
    id: nextId("INV-", data.sales),
    date: document.getElementById("sale-date").value,
    customerId,
    channel: document.getElementById("sale-channel").value,
    saleOperationType: document.getElementById("sale-operation-type")?.value || draftSale.saleOperationType || "بيع مباشر",
    payment,
    subtotal: totals.subtotal,
    lineDiscountTotal: totals.lineDiscountTotal,
    invoiceDiscount: Number(draftSale.invoiceDiscount || 0),
    invoiceDiscountType: draftSale.invoiceDiscountType || "percent",
    invoiceDiscountAmount: totals.invoiceDiscount,
    discount: totals.discount,
    total: totals.total,
    paid,
    remaining,
    status: "معتمدة",
    customerSnapshot: customerSnapshot(customer),
    lines: validEntries.map(({ line, computed }) => {
      const finalNet = computed.finalNet ?? (Number(line.qty || 0) * Number(line.price || 0));
      return { ...line, productId: line.bookId, quantity: Number(line.qty || 0), unitSellingPrice: Number(line.price || 0), totalSellingPrice: finalNet, discountType: line.discountType || "percent", base: computed.base || 0, lineDiscount: computed.lineDiscount || 0, invoiceDiscountShare: computed.invoiceDiscountShare || 0, totalDiscount: computed.totalDiscount || 0, finalNet };
    }),
    createdByUserId: actorSnapshot().userId,
    createdByName: actorSnapshot().name,
    createdByUsername: actorSnapshot().username,
    createdByRole: actorSnapshot().role,
    createdAt: new Date().toISOString(),
    updatedByUserId: "",
    updatedAt: new Date().toISOString(),
    deletedAt: null
  };
  sale.lines.forEach(line => recordNegativeStockOverride(getBook(line.bookId), line.qty, sale.id));
  validEntries.forEach(({ line }, index) => {
    const book = getBook(line.bookId);
    const costing = allocateInventoryFIFO(book.id, line.qty);
    sale.lines[index].costMethod = "FIFO";
    sale.lines[index].costOfGoodsSold = costing.costIncomplete ? null : costing.costOfGoodsSold;
    sale.lines[index].grossProfit = costing.costIncomplete ? null : Number((Number(sale.lines[index].totalSellingPrice || 0) - costing.costOfGoodsSold).toFixed(2));
    sale.lines[index].batchAllocations = costing.allocations;
    sale.lines[index].costIncomplete = costing.costIncomplete;
    const before = book.stock;
    book.stock -= Number(line.qty);
    book.lastSale = sale.date;
    book.updatedAt = new Date().toISOString();
    recordStockMovement(book, "بيع", -Number(line.qty), before, book.stock, sale.id, customer.name);
  });
  if (remaining > 0) customer.balance += remaining;
  if (paid > 0) data.cash.push({ id: nextId("TX-", data.cash), date: sale.date, type: "قبض", locked: true, account: payment === "نقدي" || payment === "آجل" ? "الخزينة الرئيسية" : payment, party: customer.name, amount: paid, category: "مبيعات", note: `فاتورة ${sale.id}` });
  if (customer.type === "تجزئة") { sale.pointsAwarded = Math.floor(totals.total / 10); customer.points = (customer.points || 0) + sale.pointsAwarded; }
  data.sales.push(sale);
  saveData("إنشاء فاتورة بيع", "المبيعات", sale.id);
  resetSaleDraft();
  salesScreenMode = "main";
  renderSales();
  toast(`تم اعتماد الفاتورة ${sale.id} وتحديث المخزون والحسابات.`);
  if (printAfter) setTimeout(() => printSale(sale.id, "thermal"), 80);
  return sale;
}

async function fetchLatestDatabaseForPurchase() {
  const response = await fetch(`/api/db?purchase-preflight=${Date.now()}`, { headers:authHeaders(), cache:"no-store" });
  if (!response.ok) throw new Error("تعذر جلب أحدث بيانات النظام قبل اعتماد الفاتورة.");
  return { data:normalizeData(await response.json()), revision:response.headers.get("X-DB-Revision") || "" };
}

function rememberPurchaseRetry(baseData, conflicts = []) {
  persistPurchaseDraft();
  purchaseRetryState = { baseData:structuredClone(baseData), draft:structuredClone(draftPurchase), conflicts, detectedAt:new Date().toISOString() };
}

async function preparePurchaseRevision({ baseData = data } = {}) {
  const latest = await fetchLatestDatabaseForPurchase();
  if (!latest.revision || latest.revision === dbRevision) return { ok:true };
  const analysis = PurchaseStaleRetry.analyze({ base:baseData, latest:latest.data, draft:draftPurchase });
  if (analysis.existingOperation) {
    data = latest.data;
    dbRevision = latest.revision;
    draftPurchase = emptyPurchaseDraft();
    clearPurchaseDraft();
    purchaseRetryState = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    renderPurchases();
    toast(`الفاتورة ${analysis.existingOperation.id} محفوظة بالفعل؛ لم يتم إنشاء نسخة مكررة.`);
    return { ok:false, alreadySaved:true };
  }
  if (!analysis.safe) {
    rememberPurchaseRetry(baseData, analysis.conflicts);
    renderPurchases();
    toast("تغير المورد أو أحد الأصناف. راجع التغييرات قبل إعادة الاعتماد.", "error");
    return { ok:false, conflicts:analysis.conflicts };
  }
  const merged = PurchaseStaleRetry.mergeLatestWithDraft(latest.data, draftPurchase);
  data = merged.data;
  draftPurchase = merged.draft;
  dbRevision = latest.revision;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  setStorageStatus("البيانات محدثة", true);
  return { ok:true, refreshed:true };
}

async function retryStalePurchaseSave() {
  if (!purchaseRetryState || purchaseRetryState.conflicts?.length) return false;
  draftPurchase = structuredClone(purchaseRetryState.draft);
  persistPurchaseDraft();
  const baseData = purchaseRetryState.baseData;
  purchaseRetryState = null;
  const prepared = await preparePurchaseRevision({ baseData });
  if (!prepared.ok) return false;
  return savePurchase({ skipRevisionPreflight:true });
}

async function savePurchase({ skipRevisionPreflight = false } = {}) {
  draftPurchase.operationKey = draftPurchase.operationKey || (globalThis.crypto?.randomUUID?.() || `purchase-${Date.now()}-${Math.random()}`);
  persistPurchaseDraft();
  const initialBaseData = structuredClone(data);
  if (!skipRevisionPreflight) {
    try {
      const prepared = await preparePurchaseRevision({ baseData:initialBaseData });
      if (!prepared.ok) return false;
    } catch (error) {
      rememberPurchaseRetry(initialBaseData, []);
      renderPurchases();
      toast(error.message || "تعذر تحديث البيانات. بقيت المسودة محفوظة.", "error");
      return false;
    }
  }
  const dataBeforePurchase = structuredClone(data);
  try {
    draftPurchase.lines = PurchaseInventoryIntegrity.resolvePurchaseLines(data.books, draftPurchase.lines);
  } catch (error) {
    rememberPurchaseRetry(dataBeforePurchase, [{ code:error.code, lineIndex:error.lineIndex, reference:error.reference || "" }]);
    renderPurchases();
    toast("تعذر اعتماد الفاتورة: يوجد بند غير مربوط بصنف واحد واضح. راجع الصنف أو الباركود.", "error");
    return false;
  }
  const totals = purchaseTotals();
  const lineEntries = draftPurchase.lines
    .map((line, index) => ({ line, computed: totals.lines[index] || {} }))
    .filter(entry => entry.line.bookId && entry.line.qty > 0);
  const lines = lineEntries.map(entry => entry.line);
  if (!lines.length) return toast("أضف صنفًا واحدًا على الأقل إلى التوريد.", "error");
  const supplierId = document.getElementById("purchase-supplier").value;
  const type = document.getElementById("purchase-type").value;
  const receivingStatus = document.getElementById("purchase-status").value;
  const shipping = totals.shipping;
  const qtyTotal = lines.reduce((sum, line) => sum + Number(line.qty), 0);
  const total = totals.total;
  const paid = totals.paid;
  const remaining = totals.remaining;
  const supplierInvoiceNumber = String(document.getElementById("supplier-invoice-number")?.value || "").trim();
  const purchase = {
    id: nextId("PUR-", data.purchases),
    operationKey:draftPurchase.operationKey,
    date: today(),
    supplierInvoiceNumber,
    supplierId,
    type,
    payment: document.getElementById("purchase-payment").value,
    subtotal: totals.subtotal,
    lineDiscountTotal: totals.lineDiscountTotal,
    invoiceDiscount: Number(draftPurchase.invoiceDiscount || 0),
    invoiceDiscountType: draftPurchase.invoiceDiscountType || "percent",
    invoiceDiscountAmount: totals.invoiceDiscount,
    discount: totals.discount,
    total,
    paid,
    remaining,
    status: receivingStatus === "في انتظار الفحص" ? "بانتظار الفحص" : "مستلمة",
    lines: lineEntries.map(({ line, computed }) => ({
      productId: line.bookId,
      bookId: line.bookId,
      supplierId,
      qty: Number(line.qty || 0),
      quantity: Number(line.qty || 0),
      coverPriceAtPurchase: Number(line.coverPriceAtPurchase ?? productCoverPrice(getBook(line.bookId)) ?? 0),
      supplierDiscountPercent: Number(line.supplierDiscountPercent ?? line.discount ?? 0),
      unitPurchaseCost: Number(line.cost || 0),
      cost: Number(line.cost || 0),
      totalCost: Number(computed.finalNet ?? (Number(line.qty || 0) * Number(line.cost || 0))),
      purchaseDate: today(),
      batchId: "",
      discountType: "percent",
      base: computed.base || 0,
      lineDiscount: 0,
      invoiceDiscountShare: computed.invoiceDiscountShare || 0,
      totalDiscount: computed.invoiceDiscountShare || 0,
      finalNet: computed.finalNet ?? (Number(line.qty || 0) * Number(line.cost || 0))
    })),
    shipping,
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    deletedAt:null
  };
  lineEntries.forEach(({ line, computed }, index) => {
    const book = getBook(line.bookId);
    const shippingUnit = qtyTotal ? shipping / qtyTotal : 0;
    const netCostUnit = Number(line.qty || 0) > 0 ? Number(computed.finalNet ?? (Number(line.cost) * Number(line.qty || 0))) / Number(line.qty || 1) : Number(line.cost || 0);
    const unitCost = type === "شراء" ? netCostUnit + shippingUnit : netCostUnit;
    book.lastPurchasePrice = unitCost;
    book.cost = unitCost;
    book.coverPrice = Number(line.coverPriceAtPurchase ?? productCoverPrice(book) ?? 0);
    book.purchaseListPrice = book.coverPrice;
    if (receivingStatus !== "في انتظار الفحص") {
      const before = book.stock;
      book.stock += Number(line.qty);
      const batch = createInventoryBatch({
        productId: book.id,
        purchaseInvoiceId: purchase.id,
        supplierId,
        qty: Number(line.qty || 0),
        unitCost,
        coverPrice: book.coverPrice,
        purchaseDate: purchase.date
      });
      purchase.lines[index].batchId = batch.batchId;
      recordStockMovement(book, type === "أمانة" ? "توريد أمانة" : "شراء", Number(line.qty), before, book.stock, purchase.id, getSupplier(supplierId)?.name || "");
    }
    book.owned = type === "شراء";
    if (type === "أمانة") book.returnDeadline = document.getElementById("purchase-return").value;
    book.supplierId = supplierId;
  });
  try {
    PurchaseInventoryIntegrity.validatePurchaseEffects(dataBeforePurchase, data, purchase, { inventoryAffecting:receivingStatus !== "في انتظار الفحص" });
  } catch (error) {
    data = dataBeforePurchase;
    rememberPurchaseRetry(dataBeforePurchase, error.failures || [{ code:error.code }]);
    renderPurchases();
    toast("تم منع اعتماد الفاتورة لأن أحد البنود لم يُنشئ حركة ودفعة مخزون مكتملتين.", "error");
    return false;
  }
  data.purchases.push(purchase);
  if (type === "شراء" && remaining > 0) getSupplier(supplierId).balance += remaining;
  if (paid > 0) {
    data.cash.push({ id: nextId("TX-", data.cash), date: today(), type: "صرف", locked: true, account: "الخزينة الرئيسية", party: getSupplier(supplierId).name, amount: paid, category: type === "أمانة" ? "دفعة توريد أمانة" : "مشتريات", note: `فاتورة ${purchase.id}` });
  }
  const saved = await saveData("PURCHASE_CREATED", "المشتريات", purchase.id);
  if (!saved) {
    data = dataBeforePurchase;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (lastSaveError?.code === "DATABASE_WRITE_BLOCKED_STALE_REVISION") rememberPurchaseRetry(dataBeforePurchase, []);
    renderPurchases();
    toast(lastSaveError?.code === "DATABASE_WRITE_BLOCKED_STALE_REVISION" ? "تم تحديث بيانات النظام أثناء إدخال الفاتورة. اضغط تحديث وإعادة المحاولة للاحتفاظ بالمسودة وإعادة الحفظ." : "فشل حفظ فاتورة الشراء على الخادم. بقيت المسودة محفوظة ولم تُعتمد الفاتورة.", "error");
    return false;
  }
  purchaseRetryState = null;
  draftPurchase = emptyPurchaseDraft();
  clearPurchaseDraft();
  renderPurchases();
  toast(`تم الحفظ: ${type === "أمانة" ? "توريد الأمانة" : "فاتورة الشراء"} ${purchase.id}.`);
  return true;
}

function showSalesList() {
  const hasUnsavedInvoice = salesScreenMode === "invoice" && draftSale.lines.some(line => line.bookId);
  if (hasUnsavedInvoice && !confirm("توجد فاتورة غير محفوظة. سيتم الاحتفاظ بها عند فتح الفواتير السابقة. هل تستمر؟")) return;
  salesScreenMode = "history";
  renderSales();
}

function renderSalesHistory() {
  root.innerHTML = `
    <div class="section-title"><div><h2>الفواتير السابقة</h2><p>بحث موحد برقم الفاتورة أو العميل أو الهاتف أو التتبع.</p></div><div class="actions"><button class="btn" data-action="resume-sale-invoice">${draftSale.lines.some(line => line.bookId) ? "متابعة الفاتورة الحالية" : "فاتورة جديدة"}</button><button class="btn ghost" data-action="sales-main">مركز المبيعات</button></div></div>
    <div class="sales-tabs" role="tablist"><button class="tab" data-action="sales-main">ملخص اليوم</button><button class="tab" data-action="resume-sale-invoice">فاتورة جديدة</button><button class="tab active" aria-selected="true">الفواتير السابقة</button></div>
    <article class="card sales-history-card">
    <div class="toolbar" style="padding:0 0 15px;border-bottom:0">
      <div class="search"><input id="old-sales-search" autocomplete="off" placeholder="ابحث برقم الفاتورة، كود تتبع الشحنة، رقم الموبايل أو اسم العميل..."></div>
      <select id="old-sales-status" class="filter-select"><option value="">كل الحالات</option><option>معتمدة</option><option>مرتجع جزئي</option><option>مرتجع</option><option>ملغاة</option></select>
      <button class="btn ghost" type="button" data-action="clear-sales-search">مسح البحث</button>
    </div>
    <div class="sales-history-count"><strong id="old-sales-count">${data.sales.length} فاتورة</strong><span>يمكن كتابة جزء من الاسم أو الرقم.</span></div>
    <div class="table-wrap" id="old-sales-results">${salesHistoryTable(data.sales.slice().reverse())}</div>
    </article>`;
}

function normalizeInvoiceSearch(value) {
  return String(value || "")
    .toLocaleLowerCase("ar")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ظٹ")
    .replace(/[٠-٩]/g, digit => "٠١٢٣٤٥٦٧٨٩".indexOf(digit))
    .replace(/[\s\-_/().+]/g, "");
}

function normalizeReturnSearch(value) {
  return normalizeInvoiceSearch(value)
    .replace(/[^0-9a-z\u0600-\u06ff]/gi, "");
}

function shipmentForSale(saleId) {
  return data.shipments.find(item => !item.deletedAt && normalizeInvoiceSearch(item.invoiceId || item.orderId) === normalizeInvoiceSearch(saleId));
}

function findSalesInvoices(query = "", status = "") {
  const term = normalizeInvoiceSearch(query);
  return data.sales
    .filter(sale => {
      if (status && sale.status !== status) return false;
      if (!term) return true;
      const customer = getCustomer(sale.customerId);
      const shipment = shipmentForSale(sale.id);
      const searchable = [
        sale.id,
        customer?.name,
        customer?.phone,
        shipment?.tracking,
        shipment?.id,
        shipment?.customer
      ].map(normalizeInvoiceSearch);
      return searchable.some(value => value.includes(term));
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
}

function salesHistoryTable(list) {
  if (!list.length) {
    return `<div class="empty-state"><div class="empty-icon">⌕</div><h3>لا توجد فواتير مطابقة</h3><p>راجع رقم الفاتورة أو كود التتبع أو اسم العميل أو رقم الموبايل.</p></div>`;
  }
  return `<table><thead><tr><th>الفاتورة</th><th>العميل</th><th>الموبايل</th><th>الشحنة / التتبع</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody>
    ${list.map(sale => {
      const customer = getCustomer(sale.customerId);
      const shipment = shipmentForSale(sale.id);
      return `<tr data-record-type="invoice" data-record-id="${sale.id}">
        <td><strong>${esc(sale.id)}</strong><br><span class="muted">${fmtDate(sale.date)}</span>${sale.onlineOrderId ? `<br><span class="muted">طلب أونلاين ${esc(sale.onlineOrderId)}</span>` : ""}</td>
        <td>${esc(customer?.name || "عميل غير مسجل")}</td>
        <td><span dir="ltr">${esc(customer?.phone || "—")}</span></td>
        <td>${shipment ? `<strong>${esc(shipment.tracking)}</strong><br><span class="muted">${esc(shipment.company)} · ${esc(shipment.status)}</span>` : `<span class="muted">بدون شحنة</span>`}</td>
        <td class="money">${money(sale.total)}</td>
        <td class="money">${money(sale.paid ?? (sale.remaining ? sale.total - sale.remaining : sale.total))}</td>
        <td class="money">${money(sale.remaining || 0)}</td>
        <td>${badge(sale.status, ["ملغاة","مرتجع"].includes(sale.status) ? "danger" : sale.status === "مرتجع جزئي" ? "warning" : "")}</td>
        <td><div class="row-actions invoice-row-actions"><button class="row-action" data-action="view-sale" data-id="${sale.id}">عرض</button><button class="row-action" data-action="print-sale" data-id="${sale.id}">طباعة</button><details class="table-actions-menu"><summary class="row-action">المزيد <svg class="ui-icon"><use href="assets/icons/ui-icons.svg#more"></use></svg></summary><div class="table-actions-popover"><button class="row-action" data-action="edit-sale-payment" data-id="${sale.id}">تحصيل</button>${!["ملغاة","مرتجع"].includes(sale.status) ? `<button class="row-action" data-action="return-sale" data-id="${sale.id}">مرتجع</button>` : ""}${shipment ? `<button class="row-action" data-action="view-shipment" data-id="${shipment.id}">فتح الشحنة</button>` : sale.onlineOrderId ? `<button class="row-action" data-action="create-order-shipment" data-id="${sale.onlineOrderId}">إنشاء شحنة</button>` : ""}<button class="row-action text-danger" data-action="${sale.status === "ملغاة" ? "delete-sale" : "cancel-sale"}" data-id="${sale.id}">${sale.status === "ملغاة" ? "حذف" : "إلغاء"}</button></div></details></div></td>
      </tr>`;
    }).join("")}
  </tbody></table>`;
}

function updateSalesHistorySearch() {
  const query = document.getElementById("old-sales-search")?.value || "";
  const status = document.getElementById("old-sales-status")?.value || "";
  const matches = findSalesInvoices(query, status);
  const results = document.getElementById("old-sales-results");
  const count = document.getElementById("old-sales-count");
  if (results) results.innerHTML = salesHistoryTable(matches);
  if (count) count.textContent = `${matches.length} فاتورة`;
}

function closeSalesDay() {
  const dateKey = today();
  if (salesDayClosing(dateKey)) return toast("اليومية مقفولة بالفعل لهذا اليوم.", "error");
  const notes = prompt("ملاحظات قفل اليومية (اختياري):", "") || "";
  const summary = salesDailySummary("today");
  const actor = actorSnapshot();
  data.dayClosings = data.dayClosings || [];
  data.dayClosings.push({
    id: nextId("DAY-", data.dayClosings),
    date: dateKey,
    closedAt: new Date().toISOString(),
    closedByUserId: actor.userId,
    closedByName: actor.name,
    salesTotal: summary.salesTotal,
    cashTotal: summary.cashTotal,
    returnsTotal: summary.returnsTotal,
    expensesTotal: summary.expenses,
    supplierPaymentsTotal: summary.supplierPayments,
    netMovement: summary.netMovement,
    notes,
    deletedAt: null
  });
  saveData("قفل يومية المبيعات", "المبيعات", dateKey);
  renderSales();
  toast("تم قفل اليومية. تعديل فواتير اليوم يحتاج صلاحية مدير.");
}

function printSalesDay() {
  const summary = salesDailySummary("today");
  printHtml(`تقرير مبيعات اليوم ${fmtDate(today())}`, `
    <div class="metric-strip">
      <div class="mini-metric"><span>إجمالي المبيعات</span><strong>${money(summary.salesTotal)}</strong></div>
      <div class="mini-metric"><span>عدد الفواتير</span><strong>${summary.invoiceCount}</strong></div>
      <div class="mini-metric"><span>صافي حركة اليوم</span><strong>${money(summary.netMovement)}</strong></div>
    </div>
    <table><thead><tr><th>الفاتورة</th><th>الوقت</th><th>العميل</th><th>الدفع</th><th>البائع</th><th>الصافي</th></tr></thead><tbody>
      ${summary.sales.map(sale => `<tr><td>${esc(sale.id)}</td><td>${esc(dateTimeLabel(sale.createdAt || sale.date))}</td><td>${esc(getCustomer(sale.customerId)?.name || sale.customerSnapshot?.name || "—")}</td><td>${esc(sale.payment || "—")}</td><td>${esc(saleCreatedByName(sale))}</td><td>${money(sale.total || 0)}</td></tr>`).join("") || `<tr><td colspan="6">لا توجد فواتير اليوم.</td></tr>`}
    </tbody></table>
    <div class="total">التحصيلات الفعلية: ${money(summary.actualCollections)} — المرتجعات النقدية: ${money(summary.cashReturns)} — المصروفات: ${money(summary.expenses)}</div>
  `);
  toast("تم تجهيز تقرير اليوم للطباعة.");
}

function limitedEditSale(id) {
  const sale = data.sales.find(item => item.id === id);
  if (!sale) return toast("لم يتم العثور على الفاتورة.", "error");
  if (!saleCanBeModified(sale)) return toast("هذه اليومية مقفولة. التعديل يحتاج صلاحية مدير.", "error");
  openModal(`تعديل محدود ${sale.id}`, "المبيعات", `
    <form id="limited-sale-edit-form" data-id="${esc(sale.id)}">
      <div class="form-grid">
        <div class="form-field"><label>قناة البيع</label><select name="channel">${["تجزئة","جملة","متجر إلكتروني"].map(value => `<option ${sale.channel === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
        <div class="form-field"><label>نوع العملية</label><select name="saleOperationType">${["بيع مباشر","طلب أونلاين","حجز / Pre-order","بيع مدرسي / جملة","استبدال","مرتجع جزئي"].map(value => `<option ${sale.saleOperationType === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
        <div class="form-field full"><label>ملاحظات مختصرة</label><input name="notes" value="${esc(sale.notes || "")}"></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">حفظ التعديل المحدود</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

function showPurchasesList() {
  openModal("سجل المشتريات والأمانة", "التوريد", `
    <div class="alert-item" style="margin-bottom:14px">
      <div class="alert-badge blue">▤</div>
      <div><strong>سجل موحد للمشتريات والأمانة</strong><span>يمكنك عرض المستند، اعتماد الاستلام، أو تسجيل مرتجع مشتريات من نفس السجل.</span></div>
    </div>
    <div class="table-wrap">${purchaseHistoryTable(sortedPurchases(), "data-modal-action")}</div>`);
}

function preparePurchaseForBook(id) {
  const book = getBook(id);
  if (!book) return toast("لم يتم العثور على الصنف.", "error");
  const suggestedQty = Math.max(1, Number(book.reorder || 0) - Number(book.stock || 0));
  draftPurchase = {
    supplierId: book.supplierId || data.suppliers[0]?.id || "",
    type: book.owned ? "شراء" : "أمانة",
    payment: "آجل",
    returnDeadline: book.returnDeadline || "",
    status: "تم الفحص والاستلام",
    paid: 0,
    shipping: 0,
    invoiceDiscount: 0,
    invoiceDiscountType: "percent",
    lines: [{ bookId: book.id, qty: suggestedQty, cost: productInventorySummary(book.id).lastPurchaseCost || book.cost || 0, coverPriceAtPurchase: productCoverPrice(book), supplierDiscountPercent: 0, discount: 0, discountType: "percent" }]
  };
  closeModal();
  navigate("purchases");
  toast(`تم تجهيز مستند شراء للصنف «${book.name}» بكمية مقترحة ${suggestedQty}.`);
}

function adjustStock(id) {
  const book = getBook(id);
  openModal("تسوية رصيد صنف", "الجرد والمخزون", `<form id="stock-form" data-id="${id}"><div class="alert-item" style="margin-bottom:15px"><div class="book-cover">${esc(book.name.charAt(0))}</div><div><strong>${esc(book.name)}</strong><span>الرصيد الحالي: ${book.stock} ${esc(itemUnitLabel(book))}</span></div></div><div class="form-grid"><div class="form-field"><label class="required">الرصيد الفعلي</label><input name="stock" type="number" required value="${book.stock}"></div><div class="form-field"><label>سبب التسوية</label><select name="reason"><option>جرد فعلي</option><option>تالف</option><option>مفقود</option><option>وحدات مجانية</option><option>تصحيح خطأ</option></select></div><div class="form-field full"><label>ملاحظات</label><textarea name="note"></textarea></div></div><div class="form-actions"><button class="btn" type="submit">اعتماد التسوية</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div></form>`);
}

function stockCountModal() {
  openModal("بدء جرد مخزني", "الجرد والمخزون", `<div class="alert-list">
    <div class="alert-item inventory-count-choice"><div class="alert-badge blue">▤</div><div><strong>جرد جزئي</strong><span>اختيار رف أو تصنيف ومراجعة أرصدته فقط.</span></div><button class="btn secondary small" data-modal-action="start-partial-count">بدء</button></div>
    <div class="alert-item inventory-count-choice"><div class="alert-badge">▥</div><div><strong>جرد كلي</strong><span>مراجعة جميع الأصناف واعتماد الفروقات دفعة واحدة.</span></div><button class="btn secondary small" data-modal-action="start-full-count">بدء</button></div>
  </div><p class="muted" style="font-size:9px">لن يتغير أي رصيد قبل الضغط على «اعتماد الجرد». جميع الفروقات تُسجل في سجل العمليات.</p>`);
}

function partialStockCountModal() {
  const shelves = [...new Set(data.books.map(book => book.shelf).filter(Boolean))].sort();
  const categories = [...new Set(data.books.map(book => book.category).filter(Boolean))].sort();
  openModal("إعداد الجرد الجزئي", "الجرد والمخزون", `
    <form id="partial-count-filter-form">
      <div class="form-grid">
        <div class="form-field"><label>طريقة الاختيار</label><select name="filterType" id="count-filter-type"><option value="shelf">حسب الرف / الموقع</option><option value="category">حسب التصنيف</option><option value="manual">اختيار أصناف يدويًا</option></select></div>
        <div class="form-field"><label>القيمة</label><select name="filterValue" id="count-filter-value">${shelves.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}</select></div>
      </div>
      <div id="manual-count-books" class="inventory-manual-list" hidden>${data.books.map(book => `<label><input type="checkbox" name="bookIds" value="${book.id}"> ${esc(book.name)} <small>(${esc(book.shelf || "بدون موقع")})</small></label>`).join("")}</div>
      <script type="application/json" id="count-shelves-data">${JSON.stringify(shelves)}</script>
      <script type="application/json" id="count-categories-data">${JSON.stringify(categories)}</script>
      <div class="form-actions"><button class="btn" type="submit">بدء الجرد الجزئي</button><button class="btn ghost" type="button" data-modal-action="back-to-count-types">رجوع</button></div>
    </form>`);
}

function inventoryCountRows(books) {
  return books.map(book => `<tr data-count-row data-book-id="${book.id}" data-system-stock="${book.stock}">
    <td><strong>${esc(book.name)}</strong><br><span class="muted">${esc(book.barcode || "—")} · ${esc(book.shelf || "بدون موقع")}</span></td>
    <td class="count-system-stock">${book.stock}</td>
    <td><input class="count-actual-stock" name="actual-${book.id}" type="number" required value="${book.stock}" aria-label="الرصيد الفعلي لـ ${esc(book.name)}"></td>
    <td class="count-difference neutral">0</td>
  </tr>`).join("");
}

function openInventoryCountForm(books, type = "جزئي") {
  if (!books.length) return toast("لا توجد أصناف مطابقة لبدء الجرد.", "error");
  openModal(`جرد ${type}`, "الجرد والمخزون", `
    <form id="inventory-count-form" data-count-type="${type}">
      <div class="inventory-count-summary">
        <div><span>عدد الأصناف</span><strong id="count-items-total">${books.length}</strong></div>
        <div><span>بفروقات</span><strong id="count-differences-total">0</strong></div>
        <div><span>صافي الفرق</span><strong id="count-net-difference">0</strong></div>
      </div>
      <div class="table-wrap inventory-count-table"><table><thead><tr><th>الصنف</th><th>رصيد النظام</th><th>الرصيد الفعلي</th><th>الفرق</th></tr></thead><tbody>${inventoryCountRows(books)}</tbody></table></div>
      <div class="form-grid" style="margin-top:15px"><div class="form-field"><label>سبب الجرد</label><select name="reason"><option>جرد دوري</option><option>جرد مفاجئ</option><option>تسليم عهدة</option><option>مراجعة موسمية</option></select></div><div class="form-field"><label>ملاحظات</label><input name="note" placeholder="اختياري"></div></div>
      <div class="form-actions"><button class="btn" type="submit">اعتماد الجرد وتحديث المخزون</button><button class="btn ghost" type="button" data-modal-action="back-to-count-types">إلغاء</button></div>
    </form>`);
  updateInventoryCountSummary();
}

function updateInventoryCountSummary() {
  const rows = [...modalBody.querySelectorAll("[data-count-row]")];
  let changed = 0;
  let net = 0;
  rows.forEach(row => {
    const systemStock = Number(row.dataset.systemStock || 0);
    const actual = Number(row.querySelector(".count-actual-stock")?.value || 0);
    const difference = actual - systemStock;
    const cell = row.querySelector(".count-difference");
    if (difference !== 0) changed += 1;
    net += difference;
    if (cell) {
      cell.textContent = difference > 0 ? `+${difference}` : String(difference);
      cell.className = `count-difference ${difference > 0 ? "positive" : difference < 0 ? "negative" : "neutral"}`;
    }
  });
  const changedElement = document.getElementById("count-differences-total");
  const netElement = document.getElementById("count-net-difference");
  if (changedElement) changedElement.textContent = changed;
  if (netElement) netElement.textContent = net > 0 ? `+${net}` : String(net);
}

function statementRows(id, kind) {
  const vouchers = data.receipts.filter(receipt => receipt.partyKind === kind && receipt.partyId === id);
  const invoices = kind === "customer"
    ? data.sales.filter(invoice => invoice.customerId === id)
    : data.purchases.filter(invoice => invoice.supplierId === id);
  const returnInvoices = (data.returns || []).filter(item => !item.deletedAt && (item.partyId === id || item.accountId === id) && (kind === "customer" ? returnKind(item.type) === "sale" : returnKind(item.type) === "purchase"));
  return [
    ...invoices.map(invoice => ({
      date: invoice.date,
      type:"invoice",
      reference: invoice.id,
      description: kind === "customer" ? "فاتورة مبيعات" : `مستند ${invoice.type || "مشتريات"}`,
      debit: invoice.status === "ملغاة" ? 0 : Number(invoice.remaining ?? invoice.total ?? 0),
      credit: 0,
      status: invoice.status,user:invoice.createdByName||invoice.createdByUsername||"—",links:{invoiceId:invoice.id,orderId:invoice.onlineOrderId||""}
    })),
    ...returnInvoices.map(item => ({
      date: item.date,
      type:"return",
      reference: returnNo(item),
      description: `${returnTypeLabel(item.type)} من ${item.sourceDocuments?.join("، ") || item.documentId || "—"} — ${returnSettlementLabel(item)}`,
      debit: 0,
      credit: Math.abs(Number(item.balanceEffect ?? ((item.debtReduction || 0) + (["customer-credit", "debt-only", "no-settlement"].includes(item.settlement) ? Number(item.customerDue || 0) : 0)))),
      status: item.status || "معتمد",user:item.createdBy||item.user||"—",links:{invoiceId:item.documentId||""}
    })),
    ...vouchers.map(receipt => ({
      date: receipt.date,
      type:"payment",
      reference: receipt.id,
      description: `إيصال ${receipt.type} — ${receipt.method}`,
      debit: 0,
      credit: receipt.status === "ملغى" ? 0 : Number(receipt.balanceApplied || 0),
      status: receipt.status,user:receipt.createdBy||"—",links:{receiptId:receipt.id}
    })),
    ...(kind==="customer"?(data.orderRefunds||[]).filter(item=>item.customerId===id&&!item.deletedAt).map(item=>({date:item.performedAt,type:item.settlementType,reference:item.refundId,description:cancellationSettlementLabel(item.settlementType),debit:["cash_refund","linked_disbursement"].includes(item.settlementType)?Number(item.amount):0,credit:item.settlementType==="customer_credit"?Number(item.amount):0,status:item.status,user:item.performedBy||"—",links:{invoiceId:item.invoiceId||"",orderId:item.orderId||"",receiptId:item.linkedReceiptId||""}})):[]),
    ...(kind==="customer"?(data.customerCreditUses||[]).filter(item=>item.customerId===id&&!item.deletedAt).map(item=>({date:item.performedAt,type:"credit_use",reference:item.id,description:"استخدام رصيد دائن في طلب جديد",debit:Number(item.amount),credit:0,status:item.status,user:item.performedBy||"—",links:{invoiceId:item.invoiceId||"",orderId:item.orderId||""}})):[]),
    ...(kind==="customer"?(data.onlineOrders||[]).filter(item=>item.customerId===id&&item.status==="ملغي").map(item=>({date:item.cancelledAt,type:"cancelled_order",reference:item.id,description:"إلغاء طلب — إلغاء مستند دون حذف",debit:0,credit:0,status:"ملغي",user:item.cancelledBy||"—",links:{orderId:item.id,invoiceId:item.saleId||""}})):[])
  ].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((row,index,rows)=>({...row,balance:rows.slice(0,index+1).reduce((sum,item)=>sum+Number(item.debit||0)-Number(item.credit||0),0)}));
}

function showStatement(id, kind) {
  const item = kind === "customer" ? getCustomer(id) : getSupplier(id);
  const movements = statementRows(id, kind);
  openModal(`كشف حساب: ${item.name}`, "الحسابات", `
    <div class="metric-strip">
      <div class="mini-metric"><span>الرصيد الحالي</span><strong>${money(item.balance)}</strong></div>
      <div class="mini-metric"><span>الدفعات المقدمة</span><strong>${money(item.advance || 0)}</strong></div>
      <div class="mini-metric"><span>الحد الائتماني</span><strong>${money(item.creditLimit)}</strong></div>
    </div>
    <div class="actions" style="margin:0 0 14px"><button class="btn secondary small" data-action="party-voucher" data-kind="${kind}" data-id="${id}" data-voucher-type="استلام">إيصال استلام</button><button class="btn ghost small" data-action="party-voucher" data-kind="${kind}" data-id="${id}" data-voucher-type="دفع">إيصال دفع</button></div>
    <div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>نوع الحركة</th><th>المرجع</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد بعد الحركة</th><th>الحالة</th><th>المستخدم</th><th>روابط المستندات</th></tr></thead><tbody>
      <tr><td colspan="10"><div class="statement-filters"><button class="tab active" type="button" data-action="statement-filter" data-filter="all">كل الحركات</button><button class="tab" type="button" data-action="statement-filter" data-filter="invoice">فواتير</button><button class="tab" type="button" data-action="statement-filter" data-filter="payment">مدفوعات</button><button class="tab" type="button" data-action="statement-filter" data-filter="refund">مردودات / Refunds</button><button class="tab" type="button" data-action="statement-filter" data-filter="credit">أرصدة دائنة</button><button class="tab" type="button" data-action="statement-filter" data-filter="cancelled_order">طلبات ملغاة</button><input type="date" data-statement-date="from" aria-label="من تاريخ"><input type="date" data-statement-date="to" aria-label="إلى تاريخ"></div></td></tr>
      ${movements.map(row => `<tr data-statement-row data-type="${esc(row.type||"")}" data-date="${esc(String(row.date||"").slice(0,10))}"><td>${fmtDate(row.date)}</td><td>${esc({invoice:"فاتورة",payment:"مدفوعات",cash_refund:"Refund",customer_credit:"رصيد دائن",linked_disbursement:"ربط صرف",pending_credit:"رصيد معلق",credit_use:"استخدام رصيد",cancelled_order:"طلب ملغي"}[row.type]||row.type||"حركة")}</td><td><strong>${esc(row.reference)}</strong></td><td>${esc(row.description)}</td><td class="money">${row.debit ? money(row.debit) : "—"}</td><td class="money">${row.credit ? money(row.credit) : "—"}</td><td class="money">${money(row.balance)}</td><td>${badge(row.status || "معتمد", ["ملغاة","ملغى"].includes(row.status) ? "danger" : "")}</td><td>${esc(row.user||"—")}</td><td>${row.links?.orderId?`<button class="row-action" data-action="view-online-order" data-id="${esc(row.links.orderId)}">${esc(row.links.orderId)}</button>`:""}${row.links?.invoiceId?`<button class="row-action" data-action="view-sale" data-id="${esc(row.links.invoiceId)}">${esc(row.links.invoiceId)}</button>`:""}</td></tr>`).join("") || `<tr><td colspan="10" class="text-center muted">لا توجد حركات مسجلة لهذا الطرف.</td></tr>`}
    </tbody></table></div>
    <div class="form-actions"><button class="btn" data-action="print-statement" data-id="${id}" data-kind="${kind}">طباعة كشف الحساب</button><button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
}

function applyStatementFilters(filter=modalBody.querySelector('[data-action="statement-filter"].active')?.dataset.filter||"all"){
  const from=modalBody.querySelector('[data-statement-date="from"]')?.value||"",to=modalBody.querySelector('[data-statement-date="to"]')?.value||"",groups={refund:["cash_refund","linked_disbursement"],credit:["customer_credit","pending_credit","credit_use"]};
  modalBody.querySelectorAll("[data-statement-row]").forEach(row=>{const type=row.dataset.type,date=row.dataset.date,typeOk=filter==="all"||type===filter||(groups[filter]||[]).includes(type),dateOk=(!from||date>=from)&&(!to||date<=to);row.hidden=!(typeOk&&dateOk);});
}

function viewPartyVoucher(id) {
  const receipt = data.receipts.find(item => item.id === id);
  if (!receipt) return toast("لم يتم العثور على الإيصال.", "error");
  openModal(`${receipt.id} — إيصال ${receipt.type}`, "إيصالات الأطراف", `
    <div class="receipt-print">
      <div class="section-title" style="margin:0 0 18px"><div><span class="eyebrow">مكتبة دوت كوم</span><h2>إيصال ${receipt.type}</h2><p>رقم ${esc(receipt.id)} · ${fmtDate(receipt.date)}</p></div>${badge(receipt.status, receipt.status === "ملغى" ? "danger" : "")}</div>
      <div class="metric-strip">
        <div class="mini-metric"><span>الطرف</span><strong>${esc(receipt.partyName)}</strong></div>
        <div class="mini-metric"><span>الصفة</span><strong>${receipt.partyKind === "customer" ? "عميل" : "مورد"}</strong></div>
        <div class="mini-metric"><span>المبلغ</span><strong>${money(receipt.amount)}</strong></div>
      </div>
      <div class="table-wrap"><table><tbody>
        <tr><th>الخزنة / الحساب</th><td>${esc(receipt.account)}</td><th>طريقة الدفع</th><td>${esc(receipt.method)}</td></tr>
        <tr><th>المرجع</th><td>${esc(receipt.reference || "—")}</td><th>تسوية الرصيد</th><td>${money(receipt.balanceApplied || 0)}</td></tr>
        <tr><th>البيان</th><td colspan="3">${esc(receipt.note || "—")}</td></tr>
      </tbody></table></div>
      <div style="display:flex;justify-content:space-between;gap:40px;margin-top:45px;font-size:11px"><span>توقيع المستلم: ....................</span><span>توقيع المحاسب: ....................</span></div>
    </div>
    <div class="form-actions"><button class="btn" data-action="print-voucher" data-id="${receipt.id}" data-format="a4">طباعة A4</button><button class="btn secondary" data-action="print-voucher" data-id="${receipt.id}" data-format="thermal">طباعة حرارية</button><button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
}

function printHtml(title, content, format = "a4") {
  const popup = window.open("", "_blank", "width=900,height=700");
  if (!popup) return toast("اسمح بالنوافذ المنبثقة لإتمام الطباعة.", "error");
  const width = format === "thermal" ? "80mm" : "210mm";
  const logoUrl = new URL("assets/dotcom-logo.png", location.href).href;
  const companyName = data.settings.companyName || "مكتبة دوت كوم";
  popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page{size:${format==="thermal" ? "80mm auto" : "A4"};margin:${format==="thermal" ? "4mm" : "12mm"}}
    :root{--brand:#4a82d0;--brand-dark:#1a2020;--brand-soft:#eef6ff;--line:#dfe8f2}
    *{box-sizing:border-box}
    body{font-family:Tahoma,Arial;width:${width};max-width:100%;margin:auto;color:#172023;background:#fff}
    h1,h2,p{margin:5px 0}
    .head{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:3px solid var(--brand);padding-bottom:12px;margin-bottom:12px}
    .brand-print{display:flex;align-items:center;gap:12px}
    .print-logo{width:${format==="thermal" ? "42px":"72px"};height:${format==="thermal" ? "42px":"72px"};object-fit:contain;border-radius:${format==="thermal" ? "8px":"14px"};background:#fff}
    .brand-title h2{margin:0;color:var(--brand-dark);font-size:${format==="thermal" ? "15px":"22px"}}
    .brand-title p{color:#667783;font-size:${format==="thermal" ? "9px":"12px"}}
    .doc-title{padding:7px 12px;border-radius:12px;color:var(--brand);background:var(--brand-soft);font-weight:800;font-size:${format==="thermal" ? "10px":"13px"};text-align:center}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th{color:#1f5fa8;background:#eef6ff}
    th,td{border-bottom:1px solid var(--line);padding:7px;text-align:right;font-size:${format==="thermal" ? "10px":"12px"}}
    .total{font-size:18px;font-weight:bold;margin-top:15px;color:#1f5fa8}
    .sign{display:flex;justify-content:space-between;gap:18px;margin-top:35px}
    @media print{button{display:none}.head{break-inside:avoid}}
  </style></head><body><div class="head"><div class="brand-print"><img class="print-logo" src="${esc(logoUrl)}" alt="${esc(companyName)}"><div class="brand-title"><h2>${esc(companyName)}</h2><p>نظام مكتبة دوت كوم</p></div></div><div class="doc-title">${esc(title)}</div></div>${content}<script>onload=()=>{print();}</script></body></html>`);
  popup.document.close();
}

function printSale(id, format = "a4") {
  const sale = data.sales.find(item => item.id === id);
  if (!sale) return;
  const customer = getCustomer(sale.customerId);
  const snapshot = sale.customerSnapshot || {};
  const lines = sale.lines || [];
  const linesMarkup = lines.map((line, index) => {
    const base = Number(line.qty || line.quantity || 0) * Number(line.price || line.unitSellingPrice || 0);
    const net = saleLineNet(line, line.qty || line.quantity || 0);
    const discount = Math.max(0, base - net);
    return `<tr><td>${index + 1}</td><td>${esc(getBook(line.bookId)?.name || line.bookId)}</td><td>${Number(line.qty || line.quantity || 0).toLocaleString("ar-EG")}</td><td>${money(line.price || line.unitSellingPrice || 0)}</td><td>${money(discount)}</td><td>${money(net)}</td></tr>`;
  }).join("");
  printHtml(`فاتورة بيع ${sale.id}`, `
    <div class="table-wrap"><table><tbody>
      <tr><th>رقم الفاتورة</th><td>${esc(sale.id)}</td><th>تاريخ ووقت البيع</th><td>${esc(dateTimeLabel(sale.createdAt || sale.date))}</td></tr>
      <tr><th>العميل</th><td>${esc(customer?.name || snapshot.name || "عميل نقدي")}</td><th>الهاتف</th><td dir="ltr">${esc(customer?.phone || snapshot.phone || "—")}</td></tr>
      <tr><th>قناة البيع</th><td>${esc(sale.channel || "—")}</td><th>نوع العملية</th><td>${esc(sale.saleOperationType || "بيع مباشر")}</td></tr>
      <tr><th>طريقة الدفع</th><td>${esc(sale.payment || "—")}</td><th>اسم البائع</th><td>${esc(saleCreatedByName(sale))}</td></tr>
    </tbody></table></div>
    <table><thead><tr><th>م</th><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>الإجمالي</th></tr></thead><tbody>${linesMarkup || `<tr><td colspan="6">لا توجد بنود تفصيلية.</td></tr>`}</tbody></table>
    <div class="table-wrap"><table><tbody>
      <tr><th>إجمالي قبل الخصم</th><td>${money(sale.subtotal || 0)}</td><th>إجمالي الخصم</th><td>${money(sale.discount || 0)}</td></tr>
      <tr><th>الشحن</th><td>${money(sale.shipping || 0)}</td><th>الصافي</th><td>${money(sale.total || 0)}</td></tr>
      <tr><th>المدفوع</th><td>${money(sale.paid || 0)}</td><th>المتبقي</th><td>${money(sale.remaining || 0)}</td></tr>
      <tr><th>ملاحظات</th><td colspan="3">${esc(sale.notes || "—")}</td></tr>
    </tbody></table></div>
    <p class="total">شكرًا لثقتكم في مكتبة دوت كوم</p>
    <div class="sign"><span>توقيع العميل: ............</span><span>تم البيع بواسطة: ${esc(saleCreatedByName(sale))}</span></div>
  `, format);
  toast("تم تجهيز الفاتورة للطباعة.");
}

function printPurchase(id, format = "a4") {
  const purchase = data.purchases.find(item => item.id === id);
  if (!purchase) return toast("لم يتم العثور على مستند الشراء.", "error");
  const supplier = getSupplier(purchase.supplierId);
  const lines = purchase.lines || [];
  const linesMarkup = lines.map((line, index) => {
    const qty = Number(line.qty || line.quantity || 0);
    const coverPrice = Number(line.coverPriceAtPurchase ?? productCoverPrice(getBook(line.bookId)) ?? 0);
    const discount = Number(line.supplierDiscountPercent ?? line.discount ?? 0);
    const unitCost = Number(line.unitPurchaseCost ?? line.cost ?? 0);
    const totalCost = Number(line.totalCost ?? purchaseLineNet(line, qty) ?? unitCost * qty);
    return `<tr><td>${index + 1}</td><td>${esc(getBook(line.bookId)?.name || line.bookId)}</td><td>${qty.toLocaleString("ar-EG")}</td><td>${money(coverPrice)}</td><td>${discount.toLocaleString("ar-EG")}%</td><td>${money(unitCost)}</td><td>${money(totalCost)}</td></tr>`;
  }).join("");
  printHtml(`فاتورة مشتريات ${purchase.id}`, `
    <table><tbody>
      <tr><th>رقم المستند</th><td dir="ltr">${esc(purchase.id)}</td><th>فاتورة المورد</th><td>${esc(purchase.supplierInvoiceNumber || "—")}</td></tr>
      <tr><th>المورد</th><td>${esc(supplier?.name || "—")}</td><th>التاريخ</th><td>${esc(dateTimeLabel(purchase.createdAt || purchase.date))}</td></tr>
      <tr><th>نوع المستند</th><td>${esc(purchase.type || "شراء")}</td><th>الحالة</th><td>${esc(purchase.status || "—")}</td></tr>
    </tbody></table>
    <table><thead><tr><th>م</th><th>الصنف</th><th>الكمية</th><th>سعر الغلاف</th><th>خصم المورد</th><th>سعر شراء النسخة</th><th>إجمالي التكلفة</th></tr></thead><tbody>${linesMarkup || `<tr><td colspan="7">لا توجد بنود تفصيلية.</td></tr>`}</tbody></table>
    <table><tbody>
      <tr><th>الإجمالي</th><td>${money(purchase.total || 0)}</td><th>المدفوع</th><td>${money(purchase.paid || 0)}</td></tr>
      <tr><th>المتبقي</th><td>${money(purchase.remaining || 0)}</td><th>الشحن / مصروفات إضافية</th><td>${money(purchase.shipping || 0)}</td></tr>
      <tr><th>ملاحظات</th><td colspan="3">${esc(purchase.notes || "—")}</td></tr>
    </tbody></table>
    <div class="sign"><span>توقيع المورد: ....................</span><span>استلم بواسطة: ${esc(currentUser?.name || currentUser?.username || "النظام")}</span></div>
  `, format);
  toast("تم تجهيز فاتورة المشتريات للطباعة.");
}

function printVoucher(id, format = "a4") {
  const receipt = data.receipts.find(item => item.id === id);
  if (!receipt) return;
  printHtml(`إيصال ${receipt.type} ${receipt.id}`, `<p>التاريخ: ${fmtDate(receipt.date)}</p><p>استلمنا من / دفعنا إلى: <strong>${esc(receipt.partyName)}</strong></p><div class="total">المبلغ: ${money(receipt.amount)}</div><p>طريقة الدفع: ${esc(receipt.method)} — الحساب: ${esc(receipt.account)}</p><p>البيان: ${esc(receipt.note||"—")}</p><div class="sign"><span>التوقيع: ............</span><span>المحاسب: ${esc(currentUser?.name||"")}</span></div>`, format);
}

function printReturn(id, format = "a4") {
  const item = (data.returns || []).find(row => row.id === id);
  if (!item) return toast("لم يتم العثور على المرتجع.", "error");
  const party = returnAccountName(item) || "—";
  const items = returnItems(item);
  printHtml(`مستند مرتجع ${returnNo(item)}`, `
    <p><strong>رقم المرتجع:</strong> ${esc(returnNo(item))}</p>
    <p><strong>نوع المرتجع:</strong> ${esc(returnTypeLabel(item.type))} ${item.mode === "by_account" ? "— مستقل حسب الحساب" : ""}</p>
    <p><strong>الحساب:</strong> ${esc(party)}</p>
    <p><strong>التاريخ:</strong> ${fmtDate(item.date)}</p>
    <table><thead><tr><th>الصنف</th><th>الفاتورة الأصلية</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>
      ${items.map(line => `<tr><td>${esc(getBook(line.bookId)?.name || line.bookId)}</td><td>${esc(line.sourceInvoiceNo || line.sourceInvoiceId || line.documentId || item.documentId || "—")}</td><td>${Number(line.qty || 0).toLocaleString("ar-EG")}</td><td>${money(line.unitPrice || line.unitValue || 0)}</td><td>${money(line.total || line.amount || 0)}</td></tr>`).join("")}
    </tbody></table>
    <div class="total">الإجمالي: ${money(item.subtotal ?? item.amount ?? 0)}</div>
    <p><strong>طريقة التسوية:</strong> ${esc(returnSettlementLabel(item))}</p>
    <p><strong>ملاحظات:</strong> ${esc(item.notes || item.reason || "—")}</p>
    <div class="sign"><span>توقيع المستلم / المسؤول: ............</span><span>توقيع المحاسب: ............</span></div>
  `, format);
}

function printOnlineOrder(id, format = "a4") {
  const order = getOnlineOrder(id);
  if (!order) return;
  if (!order.saleId && !order.shipmentId && !["مرتجع","ملغي"].includes(order.status)) {
    if(!order.confirmedAt||order.inventoryReservation?.status!=="active")return toast("يجب تأكيد الطلب وحجز المخزون أولًا قبل إصدار أمر التجهيز.","error");
  }
  printHtml(`أمر تجهيز الطلب ${order.id}`, `<p><strong>${esc(order.customerName)}</strong> — <span dir="ltr">${esc(order.phone)}</span></p><p>${esc(order.governorate)}، ${esc(order.city)}، ${esc(order.address)}</p><table><thead><tr><th>الصنف</th><th>الموقع</th><th>الكمية</th><th>تم</th></tr></thead><tbody>${order.lines.map(line=>`<tr><td>${esc(getBook(line.bookId)?.name||line.bookId)}</td><td>${esc(getBook(line.bookId)?.shelf||"—")}</td><td>${line.qty}</td><td>—</td></tr>`).join("")}</tbody></table><p>ملاحظات: ${esc(order.notes||"—")}</p><div class="sign"><span>المجهز: ............</span><span>المراجع: ............</span></div>`, format);
}

function printStatement(id, kind) {
  const party = kind === "customer" ? getCustomer(id) : getSupplier(id);
  if (!party) return;
  const movements = statementRows(id, kind);
  printHtml(`كشف حساب ${kind === "customer" ? "عميل" : "مورد"}`, `<p><strong>${esc(party.name)}</strong> — <span dir="ltr">${esc(party.phone||"")}</span></p><table><thead><tr><th>التاريخ</th><th>المرجع</th><th>البيان</th><th>مدين</th><th>دائن / مسدد</th><th>الحالة</th></tr></thead><tbody>${movements.map(row=>`<tr><td>${fmtDate(row.date)}</td><td>${esc(row.reference)}</td><td>${esc(row.description)}</td><td>${row.debit ? money(row.debit) : "—"}</td><td>${row.credit ? money(row.credit) : "—"}</td><td>${esc(row.status||"معتمد")}</td></tr>`).join("")||`<tr><td colspan="6">لا توجد حركات مسجلة.</td></tr>`}</tbody></table><div class="total">الرصيد الحالي: ${money(party.balance||0)}</div>${party.advance ? `<p>دفعات مقدمة: ${money(party.advance)}</p>` : ""}`);
}

function printCashDaily() {
  const rows = data.cash.filter(item=>!item.deletedAt && item.date===today());
  printHtml(`تقرير يومية الخزنة ${fmtDate(today())}`, `<table><thead><tr><th>السند</th><th>النوع</th><th>الحساب</th><th>البيان</th><th>المبلغ</th></tr></thead><tbody>${rows.map(item=>`<tr><td>${item.id}</td><td>${item.type}</td><td>${esc(item.account)}</td><td>${esc(item.party)}</td><td>${money(item.amount)}</td></tr>`).join("")}</tbody></table><div class="total">صافي اليوم: ${money(rows.reduce((sum,item)=>sum+(item.type==="قبض" ? item.amount : -item.amount),0))}</div>`);
}

function cancelPartyVoucher(id) {
  const receipt = data.receipts.find(item => item.id === id);
  if (!receipt || receipt.status === "ملغى") return toast("الإيصال ملغى بالفعل أو غير موجود.", "error");
  if (!confirm(`هل تريد إلغاء الإيصال ${id} وعكس أثره على الخزنة والرصيد؟`)) return;
  const party = receipt.partyKind === "customer" ? getCustomer(receipt.partyId) : getSupplier(receipt.partyId);
  if (party) {
    party.balance = Number(party.balance || 0) + Number(receipt.balanceApplied || 0);
    party.advance = Math.max(0, Number(party.advance || 0) - Number(receipt.advanceApplied || 0));
  }
  data.cash.push({
    id: nextId("TX-", data.cash),
    date: today(),
    type: receipt.type === "استلام" ? "صرف" : "قبض",
    locked: true,
    account: receipt.account,
    party: receipt.partyName,
    amount: receipt.amount,
    category: "عكس إيصال",
    note: `عكس الإيصال ${receipt.id}`,
    receiptId: receipt.id
  });
  receipt.status = "ملغى";
  receipt.cancelledAt = new Date().toISOString();
  saveData("إلغاء إيصال طرف", receipt.partyKind === "customer" ? "العملاء" : "الموردون", receipt.id);
  if (currentView === "parties") renderParties();
  else renderAccounting();
  toast("تم إلغاء الإيصال وعكس أثره على الخزنة وكشف الحساب.");
}

function updateShipment(id) {
  const item = data.shipments.find(s => s.id === id);
  openModal(`تحديث الشحنة ${id}`, "الشحن والتوصيل", `<form id="shipment-status-form" data-id="${id}"><div class="alert-item" style="margin-bottom:15px"><div class="alert-badge blue">▣</div><div><strong>${esc(item.company)} — ${esc(item.tracking)}</strong><span>${esc(item.customer)}، ${esc(item.city)}</span></div></div><div class="form-field"><label>حالة الشحنة</label><select name="status">${["جديدة","تم التجهيز","تم التسليم للشركة","في الطريق","تم التسليم","مرتجع"].map(s => `<option ${item.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div><div class="form-actions"><button class="btn" type="submit">حفظ الحالة</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div></form>`);
}

function showShippingCompanies() {
  const companies = data.shippingCompanies.filter(company => !company.deletedAt);
  openModal("شركات الشحن", "الإعدادات", `
    <form id="shipping-company-form" data-edit-id="">
      <div class="form-grid">
        <div class="form-field"><label class="required">اسم شركة الشحن</label><input name="name" required placeholder="مثال: شركة شحن جديدة"></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">إضافة شركة</button></div>
    </form>
    <div class="alert-list" style="margin-top:14px">${companies.map((company, i) => `<div class="alert-item"><div class="alert-badge blue">▣</div><div><strong>${esc(company.name)}</strong><span>${i < 2 ? "جاهزة لتسجيل أكواد التتبع — الربط التلقائي يحتاج API." : "شركة متاحة للاختيار من القوائم."}</span></div>${badge(company.active !== false ? "نشطة" : "موقوفة", company.active !== false ? "" : "gray")}<div class="row-actions"><button class="row-action" data-action="edit-shipping-company" data-id="${company.id}">تعديل</button><button class="row-action text-danger" data-action="delete-shipping-company" data-id="${company.id}">حذف</button></div></div>`).join("") || `<div class="alert-item"><div><strong>لا توجد شركات شحن</strong><span>أضف شركة واحدة على الأقل لاستخدام نموذج الشحن.</span></div></div>`}</div>`);
}

function editShippingCompany(id) {
  const company = data.shippingCompanies.find(item => item.id === id && !item.deletedAt);
  if (!company) return toast("شركة الشحن غير موجودة.", "error");
  const finance=carrierFinanceSettings(company);
  openModal("تعديل شركة الشحن", "الإعدادات", `
    <form id="shipping-company-form" data-edit-id="${company.id}">
      <div class="form-grid">
        <div class="form-field"><label class="required">اسم شركة الشحن</label><input name="name" required value="${esc(company.name)}"></div>
        <label class="choice-card"><input type="checkbox" name="active" ${company.active !== false ? "checked" : ""}><span><strong>نشطة</strong><small>تظهر في قوائم اختيار شركات الشحن.</small></span></label>
        <div class="form-field"><label>نسبة عمولة التحصيل %</label><input ${numericFieldAttributes({name:"commissionRate",value:finance.commissionRate})}></div>
        <div class="form-field"><label>الحد الأدنى للعمولة</label><input ${numericFieldAttributes({name:"minimumCommission",value:finance.minimumCommission})}></div>
        <div class="form-field"><label>أساس حساب العمولة</label><select name="commissionBasis"><option value="total_collection" ${finance.commissionBasis==="total_collection"?"selected":""}>إجمالي ما يدفعه العميل</option><option value="products_only" ${finance.commissionBasis==="products_only"?"selected":""}>قيمة المنتجات فقط</option><option value="custom" ${finance.commissionBasis==="custom"?"selected":""}>قيمة مخصصة</option></select></div>
        <div class="form-field"><label>القيمة المخصصة</label><input ${numericFieldAttributes({name:"customCommissionBase",value:finance.customCommissionBase})}></div>
        <label class="choice-card"><input type="checkbox" name="deductShippingCost" ${finance.deductShippingCost?"checked":""}><span><strong>خصم تكلفة التوصيل</strong></span></label>
        <label class="choice-card"><input type="checkbox" name="deductReturnFees" ${finance.deductReturnFees?"checked":""}><span><strong>خصم رسوم المرتجع</strong></span></label>
        <label class="choice-card"><input type="checkbox" name="autoCreateExpenses" ${finance.autoCreateExpenses?"checked":""}><span><strong>إنشاء مصروفات عند اعتماد التسوية</strong></span></label>
      </div>
      <div class="form-actions"><button class="btn" type="submit">حفظ التعديل</button><button class="btn ghost" type="button" data-action="shipping-companies">رجوع</button></div>
    </form>`);
}

function deleteShippingCompany(id) {
  const company = data.shippingCompanies.find(item => item.id === id && !item.deletedAt);
  if (!company) return toast("شركة الشحن غير موجودة.", "error");
  if (data.shipments.some(shipment => !shipment.deletedAt && shipment.company === company.name)) return toast("لا يمكن حذف شركة مستخدمة في شحنات مسجلة. يمكن إيقافها بدلًا من حذفها.", "error");
  company.deletedAt = new Date().toISOString();
  company.updatedAt = company.deletedAt;
  saveData("حذف شركة شحن", "الشحن", id);
  showShippingCompanies();
  toast("تم حذف شركة الشحن.");
}

function itemMovementRows(bookId) {
  const book = getBook(bookId);
  const movementRows = (data.stockMovements || [])
    .filter(item => item.bookId === bookId)
    .map(item => {
      const parts = operationDateParts(item.date);
      const qty = Number(item.quantity || 0);
      const context = movementDocumentContext(item.documentId);
      return {
        date: item.date,
        dayName: item.dayName || parts.dayName,
        time: item.time || parts.time,
        type: item.type || "حركة مخزون",
        documentNo: item.documentNo || item.documentId || "",
        documentType: item.documentType || context.documentType || "",
        partyName: item.partyName || context.partyName || item.note || "",
        inQty: qty > 0 ? qty : 0,
        outQty: qty < 0 ? Math.abs(qty) : 0,
        before: Number(item.before || 0),
        after: Number(item.after || 0),
        cost: Number(item.costAtOperation ?? book?.cost ?? 0),
        price: Number(item.priceAtOperation ?? book?.price ?? 0),
        effect: Number(item.financialImpact ?? qty * (qty < 0 ? Number(book?.price || 0) : Number(book?.cost || 0))),
        employee: item.employeeName || item.user || "النظام",
        note: item.note || ""
      };
    });
  const relatedAudit = (data.audit || [])
    .filter(row => row.entityId === bookId || row.documentNo === bookId)
    .map(row => ({
      date: row.createdAt || row.date,
      dayName: row.dayName || operationDateParts(row.createdAt || row.date).dayName,
      time: row.time || operationDateParts(row.createdAt || row.date).time,
      type: row.action || "عملية",
      documentNo: row.documentNo || row.entityId || bookId,
      documentType: row.moduleName || row.entity || "سجل العمليات",
      partyName: "",
      inQty: 0,
      outQty: 0,
      before: "",
      after: "",
      cost: Number(book?.cost || 0),
      price: Number(book?.price || 0),
      effect: 0,
      employee: row.employeeName || row.user || "النظام",
      note: row.notes || ""
    }));
  return [...movementRows, ...relatedAudit].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function itemMovementTable(bookId) {
  const rows = itemMovementRows(bookId);
  const canSeeCost = canAction("view-item-cost-profit");
  const financeHead = canSeeCost ? `<th>تكلفة وقتها</th><th>بيع وقتها</th><th>الأثر المالي</th>` : "";
  const colspan = canSeeCost ? 15 : 12;
  return `<div class="table-wrap stock-movement-table"><table><thead><tr><th>التاريخ</th><th>اليوم</th><th>الساعة</th><th>نوع العملية</th><th>المستند</th><th>العميل/المورد</th><th>داخل</th><th>خارج</th><th>قبل</th><th>بعد</th>${financeHead}<th>الموظف</th><th>ملاحظات</th></tr></thead><tbody>${rows.map(row => `<tr><td>${fmtDate(row.date)}</td><td>${esc(row.dayName)}</td><td>${esc(row.time)}</td><td>${esc(row.type)}</td><td><strong>${esc(row.documentNo || "—")}</strong><br><span class="muted">${esc(row.documentType || "")}</span></td><td>${esc(row.partyName || "—")}</td><td class="text-success">${row.inQty ? `+${row.inQty}` : "—"}</td><td class="text-danger">${row.outQty || "—"}</td><td>${row.before === "" ? "—" : row.before}</td><td>${row.after === "" ? "—" : row.after}</td>${canSeeCost ? `<td class="money">${money(row.cost)}</td><td class="money">${money(row.price)}</td><td class="money">${row.effect ? money(row.effect) : "—"}</td>` : ""}<td>${esc(row.employee)}</td><td>${esc(row.note || "—")}</td></tr>`).join("") || `<tr><td colspan="${colspan}" class="text-center muted">لا توجد حركات مسجلة بعد.</td></tr>`}</tbody></table></div>`;
}

function viewBook(id) {
  const book = getBook(id);
  if (!book) return toast("لم يتم العثور على الصنف.", "error");
  const canSeeCost = canAction("view-item-cost-profit");
  const summary = productInventorySummary(book.id);
  openModal(book.name, "بطاقة الصنف", `
    <div class="metric-strip">
      <div class="mini-metric"><span>الرصيد الحالي</span><strong>${summary.currentStockQty} ${esc(itemUnitLabel(book))}</strong></div>
      <div class="mini-metric"><span>آخر سعر شراء</span><strong>${canSeeCost ? money(summary.lastPurchaseCost) : "مخفي"}</strong></div>
      ${canSeeCost ? `<div class="mini-metric"><span>متوسط تكلفة المخزون</span><strong>${summary.hasIncompleteCost ? "تكلفة غير مكتملة" : money(summary.averageInventoryCost)}</strong></div>` : ""}
      ${canSeeCost ? `<div class="mini-metric"><span>قيمة المخزون</span><strong>${summary.hasIncompleteCost ? "تكلفة غير مكتملة" : money(summary.currentInventoryValue)}</strong></div>` : ""}
      <div class="mini-metric"><span>هامش متوقع</span><strong>${summary.expectedMarginAtDefaultPrice == null ? "غير متاح" : `${summary.expectedMarginAtDefaultPrice.toFixed(1)}%`}</strong></div>
    </div>
    <div class="table-wrap"><table><tbody>
      <tr><th>الباركود</th><td>${esc(book.barcode)}</td><th>باركود إضافي</th><td>${esc(book.extraBarcode || "—")}</td></tr>
      <tr><th>المؤلف / البراند</th><td>${esc(book.author || "—")}</td><th>الناشر / الشركة</th><td>${esc(book.publisher || "—")}</td></tr>
      <tr><th>التصنيف</th><td>${esc(book.category || "—")}</td><th>الصف / المقاس / المواصفة</th><td>${esc(book.grade || "—")}</td></tr>
      <tr><th>المورد</th><td>${esc(getSupplier(book.supplierId)?.name || "—")}</td><th>الموقع</th><td>${esc(book.shelf || "—")}</td></tr>
      <tr><th>سعر الغلاف</th><td>${money(productCoverPrice(book))}</td><th>سعر البيع الافتراضي</th><td>${money(productDefaultSellingPrice(book))}</td></tr>
      <tr><th>الملكية</th><td>${book.owned ? "مملوك" : "أمانة"}</td><th>موعد المرتجع</th><td>${fmtDate(book.returnDeadline)}</td></tr>
    </tbody></table></div>
    ${canSeeCost ? `<div class="card-header compact" style="margin-top:18px"><div><h3>دفعات المخزون FIFO</h3><p>كل دفعة لها تكلفة مستقلة ومتبقي مستقل.</p></div></div><div class="table-wrap"><table><thead><tr><th>Batch</th><th>المصدر</th><th>المورد</th><th>المستند</th><th>المستلم</th><th>المتبقي</th><th>تكلفة الوحدة</th><th>القيمة</th></tr></thead><tbody>${summary.batches.map(batch => `<tr><td>${esc(batch.batchId)}</td><td>${esc(batch.source || "purchase")}</td><td>${esc(getSupplier(batch.supplierId)?.name || "—")}</td><td>${esc(batch.purchaseInvoiceId || "—")}</td><td>${Number(batch.receivedQty || 0)}</td><td>${Number(batch.remainingQty || 0)}</td><td class="money">${Number(batch.unitCost || 0) ? money(batch.unitCost) : "تكلفة غير مكتملة"}</td><td class="money">${Number(batch.unitCost || 0) ? money(Number(batch.remainingQty || 0) * Number(batch.unitCost || 0)) : "تكلفة غير مكتملة"}</td></tr>`).join("") || `<tr><td colspan="8" class="text-center muted">لا توجد دفعات مخزون لهذا الصنف.</td></tr>`}</tbody></table></div>` : ""}
    <div class="card-header compact" style="margin-top:18px"><div><h3>كشف حركة الصنف</h3><p>تاريخ كامل يوضح دخول وخروج الصنف، المستند، الطرف، الموظف، الرصيد قبل/بعد، والأسعار وقت العملية.</p></div></div>
    ${itemMovementTable(book.id)}
    <div class="form-actions"><button class="btn" type="button" onclick="closeModal(); addBookModal(getBook('${book.id}'))">تعديل</button><button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
}

function deleteBook(id) {
  const book = getBook(id);
  if (!book) return;
  const used = data.sales.some(sale => sale.lines?.some(line => line.bookId === id)) || data.purchases.some(purchase => purchase.lines?.some(line => line.bookId === id));
  if (used) return toast("لا يمكن حذف صنف مرتبط بفواتير. يمكنك تعديل بياناته أو تصفير رصيده.", "error");
  if (!confirm(`هل تريد حذف الصنف «${book.name}» نهائيًا؟`)) return;
  book.deletedAt = new Date().toISOString();
  saveData("حذف صنف", "الأصناف", id);
  renderBooks();
  toast("تم حذف الصنف.");
}

async function deleteParty(id, kind) {
  const isCustomer = kind === "customer";
  const list = isCustomer ? data.customers : data.suppliers;
  const item = list.find(row => row.id === id);
  if (!item) return;
  const usedByReceipt = data.receipts.some(row => row.partyKind === kind && row.partyId === id);
  const used = usedByReceipt || (isCustomer ? data.sales.some(row => row.customerId === id) : data.purchases.some(row => row.supplierId === id) || data.books.some(row => row.supplierId === id));
  if (used) return toast(`لا يمكن حذف ${isCustomer ? "عميل" : "مورد"} مرتبط بحركات أو أصناف.`, "error");
  if (!confirm(`هل تريد حذف «${item.name}»؟`)) return;
  if (!isCustomer) {
    if (!serverConnected) return toast("حذف المورد يتطلب اتصالًا بالخادم.", "error");
    try {
      const response = await fetch(`/api/suppliers/${encodeURIComponent(id)}`, {
        method:"DELETE",
        headers:authHeaders(dbRevision ? { "If-Match":dbRevision } : {})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "تعذر حذف المورد.");
      dbRevision = response.headers.get("X-DB-Revision") || result.revision || dbRevision;
      item.deletedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      lastSuccessfulSaveAt = new Date().toISOString();
      renderParties();
      return toast("تم حذف المورد.");
    } catch (error) {
      return toast(error.message || "فشل الحذف على الخادم. لم يُحذف السجل.", "error");
    }
  }
  item.deletedAt = new Date().toISOString();
  const saved = await saveData("CUSTOMER_DELETED", "العملاء", id);
  if (!saved) {
    item.deletedAt = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return toast("فشل الحذف على الخادم. لم يُحذف السجل.", "error");
  }
  renderParties();
  toast("تم حذف السجل.");
}

function shipmentFinancialLinksMarkup(item) {
  const collection=(data.orderCollections||[]).find(row=>row.shipmentId===item.id&&row.status!=="reversed");
  const settlement=(data.carrierSettlements||[]).find(row=>row.id===(item.settlementId||collection?.settlementId));
  const expenses=(data.expenses||[]).filter(row=>row.shipmentId===item.id&&row.status!=="ملغي");
  return `<div class="finance-callout shipment-finance-links"><strong>الربط المالي</strong><span>التحصيل: ${collection?`${money(collection.amount)} — ${collection.status==="settled"?"تمت التسوية":"لدى شركة الشحن"}`:"غير مسجل"}${settlement?` · التسوية ${settlement.id}`:""}${expenses.length?` · ${expenses.length} مصروف مرتبط`:""}</span><div class="row-actions">${item.onlineOrderId?`<button class="row-action" data-modal-action="notification-view-order" data-id="${esc(item.onlineOrderId)}">${esc(item.onlineOrderId)}</button>`:""}${item.invoiceId||item.orderId?`<button class="row-action" data-modal-action="notification-view-invoice" data-id="${esc(item.invoiceId||item.orderId)}">${esc(item.invoiceId||item.orderId)}</button>`:""}${collection?`<button class="row-action" data-modal-action="notification-open-collection" data-id="${esc(collection.id)}">${esc(collection.id)}</button>`:""}${settlement?`<button class="row-action" data-modal-action="notification-open-settlement" data-id="${esc(settlement.id)}">${esc(settlement.id)}</button>`:""}</div></div>`;
}

function shipmentHistoryModal(id) {
  const item = data.shipments.find(row => row.id === id);
  if (!item) return toast("لم يتم العثور على الشحنة.", "error");
  const history = shipmentTrackingHistory(id);
  const isAdmin = canAction("show-tracking-debug");
  openModal(`سجل تتبع ${item.invoiceId || item.orderId || item.id}`, "الخط الزمني للشحنة", `
    <div class="shipment-history-head shipping-modal-summary">
      <div><span>رقم التتبع</span><strong dir="ltr">${esc(item.trackingNumber || item.tracking || "—")}</strong></div>
      <div><span>الحالة الحالية</span>${shipmentStatusBadge(item)}</div>
      <div><span>آخر تحديث</span><strong>${item.lastTrackedAt || item.lastTrackingAt ? dateTimeLabel(item.lastTrackedAt || item.lastTrackingAt) : "—"}</strong></div>
    </div>
    <div class="tracking-timeline shipping-modal-scroll">
      ${history.map(row => {
        const meta = SHIPPING_STATUSES[row.normalizedStatus] || { label:cleanDisplayText(row.statusText, "غير واضح", "غير واضح"), tone:"blue" };
        const manual = ["manual", "manual_review"].includes(row.source) || ["manual", "manual_review"].includes(row.provider);
        return `<article class="tracking-event ${meta.tone}">
          <div class="tracking-event-dot"></div>
          <div class="tracking-event-body">
            <div class="tracking-event-top"><strong>${esc(meta.label)}</strong><time>${dateTimeLabel(row.eventAt || row.fetchedAt || row.createdAt)}</time></div>
            <span class="tracking-source">${manual ? "تعديل يدوي" : "تحديث إلكتروني"}${manual && row.reviewedBy ? ` · ${esc(row.reviewedBy)}` : ""}</span>
            ${row.statusText && row.statusText !== meta.label ? `<p>نص البريد: ${esc(cleanDisplayText(row.statusText, "غير واضح", ""))}</p>` : ""}
            ${row.notes ? `<p>ملاحظة: ${esc(row.notes)}</p>` : ""}
          </div>
        </article>`;
      }).join("") || `<div class="empty-state"><strong>لا توجد تحديثات محفوظة بعد</strong><p>استخدم «تحديث إلكتروني» أو عدّل الحالة يدويًا.</p></div>`}
    </div>
    ${shipmentFinancialLinksMarkup(item)}
    ${isAdmin ? `<details class="technical-details"><summary>التفاصيل التقنية للإدارة</summary><div class="metric-strip"><div class="mini-metric"><span>آخر Run</span><strong>${esc(latestShipmentTrackingRun(id)?.id || "—")}</strong></div><div class="mini-metric"><span>الحالة الداخلية</span><strong>${esc(item.normalizedStatus || "—")}</strong></div><div class="mini-metric"><span>Failure Code</span><strong>${esc(item.trackingFailureCode || "—")}</strong></div></div></details>` : ""}
    <div class="form-actions">${isTerminalShipment(item) ? `<span class="shipping-tracking-complete">انتهى تتبع هذه الشحنة</span><button class="btn" type="button" disabled>تحديث إلكتروني</button>` : `<button class="btn" data-action="update-tracking-now" data-id="${item.id}">تحديث إلكتروني</button>`}<button class="btn secondary" data-action="edit-shipment-status" data-id="${item.id}">تعديل الحالة</button><button class="btn ghost" data-action="close-modal">إغلاق</button></div>`);
}

function viewShipment(id) {
  if (!canAction("show-tracking-debug")) return shipmentHistoryModal(id);
  const item = data.shipments.find(row => row.id === id);
  if (!item) return toast("لم يتم العثور على الشحنة.", "error");
  const history = shipmentTrackingHistory(id);
  const tracking = shipmentTrackingSummary(item);
  const lastRun = tracking.lastRun;
  const runStatus = lastRun ? (lastRun.success ? "success" : "failure") : "لا توجد محاولة";
  const failureCode = tracking.failureCode || "—";
  const failureMessage = tracking.siteBlocked ? "موقع البريد يمنع التشغيل الآلي" : cleanDisplayText(tracking.failureMessage, "غير متاح", "—");
  const debugFiles = [item.trackingDebug?.screenshotFile || lastRun?.screenshotPath, item.trackingDebug?.htmlFile || lastRun?.htmlSnapshotPath, item.trackingDebug?.jsonFile || lastRun?.diagnosticsPath].filter(Boolean);
  openModal(`الشحنة ${item.id}`, "تفاصيل التتبع", `
    <div class="metric-strip">
      <div class="mini-metric"><span>الحالة</span><strong>${esc(cleanDisplayText(item.status, "غير متاح", "غير متاح"))}</strong></div>
      <div class="mini-metric"><span>شركة الشحن</span><strong>${esc(item.carrier || item.company)}</strong></div>
      <div class="mini-metric"><span>آخر حركة</span><strong>${esc(tracking.movement)}</strong></div>
      <div class="mini-metric"><span>مستوى التنبيه</span><strong>${esc(item.alertLevel || "info")}</strong></div>
    </div>
    <div class="alert-item"><div class="alert-badge blue">▣</div><div><strong>كود التتبع: ${esc(item.trackingNumber || item.tracking)}</strong><span>الفاتورة ${esc(item.invoiceId || item.orderId || "—")}${item.onlineOrderId ? ` · الطلب ${esc(item.onlineOrderId)}` : ""} · ${esc(item.customerName || item.customer)}</span><span>${esc([item.governorate, item.city, item.address].filter(Boolean).join("، "))}</span><span>شركة الشحن: ${esc(item.carrier || item.company || "—")} · ${item.trackingEnabled ? "المتابعة مفعلة" : "المتابعة غير مفعلة"}</span></div></div>
    ${tracking.siteBlocked ? `<div class="alert-item warning"><div class="alert-badge gold">!</div><div><strong>فشل التتبع الآلي</strong><span>السبب: موقع البريد يمنع التشغيل الآلي</span><span>الكود: SITE_BLOCKED — تحتاج مراجعة يدوية</span></div></div>` : item.trackingError ? `<div class="alert-item danger"><div class="alert-badge red">!</div><div><strong>تعذر تحديث التتبع</strong><span>${esc(cleanDisplayText(item.trackingError, "غير متاح", "تعذر تحديث التتبع"))}</span></div></div>` : ""}
    <div class="metric-strip">
      <div class="mini-metric"><span>آخر نص حالة</span><strong>${esc(tracking.statusText)}</strong></div>
      <div class="mini-metric"><span>آخر موقع</span><strong>${esc(tracking.location)}</strong></div>
      <div class="mini-metric"><span>التحديث التالي</span><strong>${item.nextTrackingAt ? dateTimeLabel(item.nextTrackingAt) : "—"}</strong></div>
    </div>
    <h3 style="margin-top:16px">آخر محاولة تتبع</h3>
    <div class="metric-strip">
      <div class="mini-metric"><span>Run ID</span><strong>${esc(lastRun?.id || "—")}</strong></div>
      <div class="mini-metric"><span>وقت آخر محاولة</span><strong>${esc(lastRun?.finishedAt ? dateTimeLabel(lastRun.finishedAt) : item.lastTrackingAt ? dateTimeLabel(item.lastTrackingAt) : "—")}</strong></div>
      <div class="mini-metric"><span>النتيجة</span><strong>${esc(runStatus)}</strong></div>
      <div class="mini-metric"><span>failureCode</span><strong>${esc(failureCode)}</strong></div>
      <div class="mini-metric"><span>diagnostics</span><strong>${debugFiles.length ? `${debugFiles.length} ملفات` : "غير متاحة"}</strong></div>
    </div>
    ${lastRun || item.trackingDebug || item.trackingDiagnostics ? `<div class="alert-item ${tracking.siteBlocked ? "warning" : ""}"><div class="alert-badge ${tracking.siteBlocked ? "gold" : "blue"}">${tracking.siteBlocked ? "!" : "i"}</div><div><strong>${esc(failureMessage)}</strong><span>Screenshot: ${esc(item.trackingDebug?.screenshotFile || lastRun?.screenshotPath || "—")}</span><span>HTML: ${esc(item.trackingDebug?.htmlFile || lastRun?.htmlSnapshotPath || "—")}</span><span>JSON: ${esc(item.trackingDebug?.jsonFile || lastRun?.diagnosticsPath || "—")}</span></div></div>` : ""}
    ${shipmentFinancialLinksMarkup(item)}
    <h3 style="margin-top:16px">Timeline التتبع</h3>
    <div class="table-wrap"><table><thead><tr><th>وقت الحدث</th><th>الحالة الأصلية</th><th>الحالة الموحدة</th><th>الموقع</th><th>المصدر</th></tr></thead><tbody>${history.map(row => `<tr><td>${dateTimeLabel(row.eventAt || row.fetchedAt)}</td><td>${esc(cleanDisplayText(row.statusText, "غير متاح", "—"))}</td><td>${esc(row.normalizedStatus || "unknown")}</td><td>${esc(cleanDisplayText(row.location, "غير متاح", "لا يوجد موقع مؤكد"))}</td><td>${esc(row.provider || "—")}</td></tr>`).join("") || `<tr><td colspan="5" class="text-center muted">لا توجد حركات تتبع محفوظة بعد. لن يتم إنشاء أحداث إلا بعد Response حقيقي مؤكد من مزود التتبع.</td></tr>`}</tbody></table></div>
    <div class="form-actions">${isTerminalShipment(item) ? `<span class="shipping-tracking-complete">انتهى تتبع هذه الشحنة</span><button class="btn" type="button" disabled>تحديث التتبع الآن</button>` : `<button class="btn" data-action="update-tracking-now" data-id="${item.id}">تحديث التتبع الآن</button>`}${item.requiresComplaint ? `<button class="btn secondary" data-action="prepare-complaint" data-id="${item.id}">تجهيز شكوى</button>` : ""}<button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
  modalBody.querySelector(".form-actions")?.insertAdjacentHTML("afterbegin", `
    <button class="btn secondary" data-action="manual-tracking-result" data-id="${item.id}">تسجيل نتيجة يدوية</button>
    <button class="btn ghost" data-action="copy-tracking-code" data-id="${item.id}">نسخ كود التتبع</button>
    <button class="btn ghost" data-action="open-egypt-post">فتح موقع البريد المصري</button>
    <button class="btn ghost" data-action="open-egypt-post-with-code" data-id="${item.id}">فتح الموقع مع عرض الكود</button>
    <button class="row-action" data-action="quick-manual-tracking" data-status="delivered" data-id="${item.id}">تم التسليم</button>
    <button class="row-action" data-action="quick-manual-tracking" data-status="out_for_delivery" data-id="${item.id}">قيد التوصيل</button>
    <button class="row-action" data-action="quick-manual-tracking" data-status="failed_attempt" data-id="${item.id}">فشل التسليم</button>
    <button class="row-action" data-action="quick-manual-tracking" data-status="returned" data-id="${item.id}">مرتجع</button>
    <button class="row-action" data-action="quick-manual-tracking" data-status="unknown" data-id="${item.id}">يحتاج متابعة</button>
  `);
  if (item.trackingDebug?.screenshotFile) {
    if (canAction("show-tracking-debug")) modalBody.querySelector(".form-actions")?.insertAdjacentHTML("afterbegin", `<button class="btn secondary" data-action="show-tracking-debug" data-id="${item.id}">عرض بيانات تشخيص التتبع</button>`);
  }
}

/*  if (item.trackingDebug?.screenshotFile) {
    if (canAction("show-tracking-debug")) modalBody.querySelector(".form-actions")?.insertAdjacentHTML("afterbegin", `<button class="btn secondary" data-action="show-tracking-debug" data-id="${item.id}">عرض بيانات تشخيص التتبع</button>`);
  }
*/
function deleteShipment(id) {
  const item = data.shipments.find(row => row.id === id);
  if (!item || !confirm(`هل تريد حذف الشحنة ${id}؟`)) return;
  item.deletedAt = new Date().toISOString();
  const sale = data.sales.find(row => row.id === item.invoiceId || row.id === item.orderId);
  const order = data.onlineOrders.find(row => row.id === item.onlineOrderId);
  if (sale?.shipmentId === id) sale.shipmentId = null;
  if (order?.shipmentId === id) {
    order.shipmentId = null;
    order.status = order.saleId ? "لم يتم الشحن بعد" : "قيد التجهيز";
    order.updatedAt = item.deletedAt;
  }
  saveData("حذف شحنة", "الشحن", id);
  renderShipping();
  toast("تم حذف الشحنة.");
}

const COMPLAINT_STATUSES = {
  open: "مفتوحة",
  in_progress: "قيد المتابعة",
  closed: "مغلقة"
};

function complaintStatusLabel(value = "open") {
  const aliases = { ready_to_submit:"open", draft:"open", submitted:"in_progress", under_follow_up:"in_progress", resolved:"closed" };
  return COMPLAINT_STATUSES[aliases[value] || value] || COMPLAINT_STATUSES.open;
}

function shipmentComplaints(shipmentId) {
  return (data.complaints || [])
    .filter(item => item.shipmentId === shipmentId)
    .sort((a, b) => new Date(b.createdAt || b.openedAt || 0) - new Date(a.createdAt || a.openedAt || 0));
}

async function complaintRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: authHeaders({ "Content-Type":"application/json; charset=utf-8", ...(options.headers || {}) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "تعذر حفظ بيانات الشكوى.");
  dbRevision = response.headers.get("X-DB-Revision") || result.revision || dbRevision;
  await reloadRemoteData();
  return result;
}

function addShipmentComplaintModal(id) {
  if (!requireAction("add-shipment-complaint")) return;
  const shipment = data.shipments.find(row => row.id === id);
  if (!shipment) return toast("لم يتم العثور على الشحنة.", "error");
  openModal("إضافة شكوى", shipment.orderId || shipment.invoiceId || shipment.id, `
    <form id="add-shipment-complaint-form" class="shipping-modal-form" data-shipment-id="${esc(shipment.id)}">
      <div class="form-grid">
        <div class="form-field"><label class="required">رقم الشكوى</label><input name="complaintNumber" required autocomplete="off" dir="ltr" placeholder="أدخل رقم الشكوى"></div>
        <div class="form-field"><label>شركة الشحن</label><input value="${esc(shipment.carrier || shipment.company || "—")}" readonly></div>
        <div class="form-field"><label>الحالة</label><input value="مفتوحة" readonly></div>
        <div class="form-field full"><label>ملاحظة مختصرة <span class="muted">(اختيارية)</span></label><textarea name="notes" placeholder="أي تفاصيل تساعد في المتابعة"></textarea></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">حفظ الشكوى</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

async function createShipmentComplaint(shipmentId, formData) {
  try {
    await complaintRequest("/api/shipping/complaints", {
      method:"POST",
      body:JSON.stringify({ shipmentId, complaintNumber:String(formData.complaintNumber || "").trim(), notes:String(formData.notes || "").trim() })
    });
    closeModal();
    renderShipping();
    toast("تم تسجيل الشكوى وحفظها في السجل.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function shipmentComplaintsModal(shipmentId) {
  const shipment = data.shipments.find(row => row.id === shipmentId);
  if (!shipment) return toast("لم يتم العثور على الشحنة.", "error");
  const rows = shipmentComplaints(shipmentId);
  openModal(`سجل شكاوى ${shipment.orderId || shipment.invoiceId || shipment.id}`, `${rows.length} شكوى مسجلة`, `
    <div class="complaints-history shipping-modal-scroll">
      ${rows.map(item => `<article class="complaint-card ${item.status || item.complaintStatus || "open"}">
        <div class="complaint-card-head"><div><strong dir="ltr">${esc(item.complaintNumber || item.complaintReference || "—")}</strong><span>${arabicDateTimeLabel(item.createdAt || item.openedAt)}</span></div><span class="complaint-status ${item.status || item.complaintStatus || "open"}">${complaintStatusLabel(item.status || item.complaintStatus)}</span></div>
        <div class="complaint-meta"><span>سجلها: ${esc(item.createdByName || item.createdBy || "غير مسجل")}</span><span>شركة الشحن: ${esc(item.carrierName || item.carrierId || "—")}</span></div>
        ${item.notes ? `<p>الملاحظات: ${esc(item.notes)}</p>` : ""}
        ${(item.status || item.complaintStatus) === "closed" || item.closedAt ? `<div class="complaint-resolution"><strong>أغلقت ${arabicDateTimeLabel(item.closedAt || item.resolvedAt)}</strong><span>بواسطة: ${esc(item.closedByName || item.closedBy || "غير مسجل")}</span>${item.resolutionNotes ? `<p>ملاحظة الحل: ${esc(item.resolutionNotes)}</p>` : ""}</div>` : ""}
        ${canAction("manage-shipment-complaints") ? `<button class="row-action" data-action="edit-shipment-complaint" data-id="${item.id}">تعديل الحالة</button>` : ""}
      </article>`).join("") || `<div class="empty-state"><strong>لا توجد شكاوى مسجلة</strong><p>استخدم زر «إضافة شكوى» لتسجيل أول شكوى لهذه الشحنة.</p></div>`}
    </div>
    <div class="form-actions"><button class="btn" data-action="add-shipment-complaint" data-id="${shipment.id}">إضافة شكوى</button><button class="btn ghost" data-action="close-modal">إغلاق</button></div>`);
}

function editShipmentComplaintModal(id) {
  if (!requireAction("manage-shipment-complaints")) return;
  const complaint = (data.complaints || []).find(item => item.id === id);
  if (!complaint) return toast("لم يتم العثور على الشكوى.", "error");
  const status = complaint.status || complaint.complaintStatus || "open";
  openModal(`تعديل شكوى ${complaint.complaintNumber || complaint.complaintReference}`, "متابعة شكوى الشحن", `
    <form id="edit-shipment-complaint-form" class="shipping-modal-form" data-id="${esc(complaint.id)}">
      <div class="form-grid">
        <div class="form-field"><label>رقم الشكوى</label><input value="${esc(complaint.complaintNumber || complaint.complaintReference)}" readonly dir="ltr"></div>
        <div class="form-field"><label>الحالة</label><select name="status">${Object.entries(COMPLAINT_STATUSES).map(([value, label]) => `<option value="${value}" ${status === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>
        <div class="form-field full"><label>ملاحظة الحل <span class="muted">(اختيارية عند الإغلاق)</span></label><textarea name="resolutionNotes">${esc(complaint.resolutionNotes || "")}</textarea></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">حفظ التعديل</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

async function updateShipmentComplaint(id, formData) {
  try {
    const result = await complaintRequest(`/api/shipping/complaints/${encodeURIComponent(id)}`, {
      method:"PATCH",
      body:JSON.stringify({ status:formData.status, resolutionNotes:String(formData.resolutionNotes || "").trim() })
    });
    closeModal();
    renderShipping();
    shipmentComplaintsModal(result.complaint.shipmentId);
    toast(result.complaint.status === "closed" ? "تم إغلاق الشكوى وحفظ بيانات الإغلاق." : "تم تحديث حالة الشكوى.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function prepareShipmentComplaint(id) {
  addShipmentComplaintModal(id);
}

const MANUAL_TRACKING_STATUSES = {
  shipped: { label: "تم الشحن", operational: "تم التسليم للشركة" },
  in_transit: { label: "في مرحلة نقل", operational: "في الطريق" },
  out_for_delivery: { label: "جاري التسليم", operational: "خرج للتوصيل" },
  delivery_attempt_1: { label: "محاولة تسليم أولى", operational: "في الطريق" },
  delivery_attempt_2: { label: "محاولة تسليم ثانية", operational: "في الطريق" },
  delivery_attempt_3: { label: "محاولة تسليم ثالثة", operational: "في الطريق" },
  delivered: { label: "تم التسليم", operational: "تم التسليم" },
  returned: { label: "مرتجع", operational: "مرتجع" },
  unknown: { label: "غير واضح / يحتاج متابعة", operational: "" }
};

function manualTrackingStatusOptions(selected = "unknown") {
  return Object.entries(MANUAL_TRACKING_STATUSES).filter(([key]) => key !== "unknown").map(([key, item]) => `<option value="${key}" ${selected === key ? "selected" : ""}>${esc(item.label)}</option>`).join("");
}

function shipmentStatusQuickModal(id, selected = "") {
  const shipment = data.shipments.find(item => item.id === id);
  if (!shipment) return toast("لم يتم العثور على الشحنة.", "error");
  const current = selected || shipmentStatusCode(shipment);
  const needsNote = ["delivery_attempt_1", "delivery_attempt_2", "delivery_attempt_3", "returned"].includes(current);
  openModal("تعديل حالة الشحنة", shipment.invoiceId || shipment.orderId || shipment.id, `
    <form id="quick-shipment-status-form" class="shipping-modal-form" data-id="${esc(shipment.id)}">
      <div class="form-field"><label>الحالة الجديدة</label><select name="shippingStatus">${shipmentStatusOptions(current)}</select></div>
      <div class="form-field shipment-status-note ${needsNote ? "" : "is-hidden"}"><label>سبب المحاولة أو المرتجع <span class="muted">(اختياري)</span></label><textarea name="notes" placeholder="يمكن إضافة ملاحظة قصيرة للمتابعة"></textarea></div>
      <div class="form-actions"><button class="btn" type="submit">حفظ الحالة</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

async function applyManualShipmentStatus(id, statusCode, notes = "") {
  const shipment = data.shipments.find(item => item.id === id);
  const meta = SHIPPING_STATUSES[statusCode];
  if (!shipment || !meta) return toast("تعذر تحديد حالة الشحنة.", "error");
  const submitButton = modalBody.querySelector("#quick-shipment-status-form button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "جارٍ الحفظ...";
  }
  try {
    if (!serverConnected) throw new Error("حفظ حالة الشحنة يحتاج اتصالًا بالسيرفر.");
    const response = await fetch(`/api/shipping/shipments/${encodeURIComponent(id)}/status`, {
      method:"PATCH",
      headers:authHeaders({ "Content-Type":"application/json" }),
      body:JSON.stringify({ shippingStatus:statusCode, notes:String(notes || "").trim() })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.message || "تعذر حفظ حالة الشحنة.");
    dbRevision = response.headers.get("X-DB-Revision") || result.revision || dbRevision;
    await reloadRemoteData();
    const persisted = data.shipments.find(item => item.id === id);
    if (!persisted || shipmentStatusCode(persisted) !== statusCode) throw new Error("تم إرسال الحالة ولكن تعذر التحقق من حفظها.");
    closeModal();
    if (currentView === "shipping") renderShipping();
    toast(`تم تحديث الحالة إلى «${meta.label}».`);
    return true;
  } catch (error) {
    const message = /failed to fetch|networkerror|load failed/i.test(String(error?.message || ""))
      ? "تعذر الاتصال بالسيرفر لحفظ الحالة. تحقق من الاتصال ثم أعد المحاولة."
      : (error.message || "تعذر حفظ حالة الشحنة.");
    toast(message, "error");
    return false;
  } finally {
    if (submitButton?.isConnected) {
      submitButton.disabled = false;
      submitButton.textContent = "حفظ الحالة";
    }
  }
}

function copyShipmentTrackingCode(id) {
  const shipment = data.shipments.find(item => item.id === id);
  const trackingNumber = normalizeTrackingNumber(shipment?.trackingNumber || shipment?.tracking || "");
  if (!trackingNumber) return toast("لا يوجد كود تتبع مسجل لهذه الشحنة.", "error");
  navigator.clipboard?.writeText(trackingNumber)
    .then(() => toast(`تم نسخ كود التتبع: ${trackingNumber}`))
    .catch(() => {
      const box = document.createElement("textarea");
      box.value = trackingNumber;
      document.body.appendChild(box);
      box.select();
      document.execCommand("copy");
      box.remove();
      toast(`تم نسخ كود التتبع: ${trackingNumber}`);
    });
}

function openEgyptPostTrackingSite() {
  window.open(EGYPT_POST_TRACKING_URL, "_blank", "noopener,noreferrer");
}

function openEgyptPostWithCode(id) {
  const shipment = data.shipments.find(item => item.id === id);
  const trackingNumber = normalizeTrackingNumber(shipment?.trackingNumber || shipment?.tracking || "");
  openEgyptPostTrackingSite();
  openModal("مساعد التتبع اليدوي", "البريد المصري", `
    <div class="alert-item"><div class="alert-badge blue">☑</div><div><strong>افتح موقع البريد في التبويب الجديد</strong><span>انسخ الكود التالي والصقه في خانة التتبع داخل موقع البريد المصري.</span></div></div>
    <div class="metric-strip">
      <div class="mini-metric"><span>الشحنة</span><strong>${esc(id)}</strong></div>
      <div class="mini-metric"><span>كود التتبع</span><strong dir="ltr">${esc(trackingNumber || "—")}</strong></div>
    </div>
    <div class="form-actions">
      <button class="btn secondary" type="button" data-action="copy-tracking-code" data-id="${esc(id)}">نسخ كود التتبع</button>
      <button class="btn" type="button" data-action="manual-tracking-result" data-id="${esc(id)}">تسجيل نتيجة يدوية</button>
      <button class="btn ghost" type="button" data-action="open-egypt-post">فتح موقع البريد مرة أخرى</button>
      <button class="btn ghost" type="button" data-action="close-modal">إغلاق</button>
    </div>`);
}

function manualTrackingResultModal(id, preset = "") {
  const shipment = data.shipments.find(item => item.id === id);
  if (!shipment) return toast("لم يتم العثور على الشحنة.", "error");
  const trackingNumber = normalizeTrackingNumber(shipment.trackingNumber || shipment.tracking || "");
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const eventValue = now.toISOString().slice(0, 16);
  const selected = preset || shipment.normalizedStatus || "unknown";
  openModal(`تسجيل نتيجة يدوية — ${shipment.id}`, "Manual Tracking Assistant", `
    <form id="manual-tracking-form" data-id="${esc(shipment.id)}">
      <div class="alert-item warning"><div class="alert-badge gold">⚑</div><div><strong>لا يتم الاتصال بالبريد هنا</strong><span>هذا النموذج يسجل نتيجة راجعها الموظف يدويًا من موقع البريد المصري، ولا يتجاوز Cloudflare.</span></div></div>
      <div class="metric-strip">
        <div class="mini-metric"><span>كود التتبع</span><strong dir="ltr">${esc(trackingNumber || "—")}</strong></div>
        <div class="mini-metric"><span>الشركة</span><strong>${esc(shipment.carrier || shipment.company || "—")}</strong></div>
        <div class="mini-metric"><span>آخر خطأ آلي</span><strong>${esc(shipment.trackingDiagnostics?.failureCode || shipment.trackingError || "—")}</strong></div>
      </div>
      <div class="form-grid">
        <div class="form-field"><label>آخر حالة مختارة</label><select name="normalizedStatus">${manualTrackingStatusOptions(selected)}</select></div>
        <div class="form-field"><label>وصف الحالة بالعربي</label><input name="statusText" value="${esc(MANUAL_TRACKING_STATUSES[selected]?.label || "")}" placeholder="مثال: تم التسليم للعميل"></div>
        <div class="form-field"><label>موقع / فرع</label><input name="location" value="${esc(shipment.currentLocation || "")}" placeholder="مثال: مكتب بريد القاهرة"></div>
        <div class="form-field"><label>تاريخ ووقت الحدث</label><input name="eventAt" type="datetime-local" value="${eventValue}"></div>
        <div class="form-field full"><label>ملاحظات داخلية</label><textarea name="notes" placeholder="أي ملاحظة تخص مراجعة الموظف">${esc(shipment.manualReviewNotes || "")}</textarea></div>
      </div>
      <label class="alert-item" style="cursor:pointer"><input type="checkbox" name="updateOperationalStatus" value="yes" style="width:auto"><div><strong>تحديث حالة الشحنة التشغيلية</strong><span>يتم تغيير حالة الشحنة فقط إذا اخترت هذا الخيار.</span></div></label>
      <label class="alert-item" style="cursor:pointer"><input type="checkbox" name="clearManualReview" value="yes" checked style="width:auto"><div><strong>إنهاء manual review</strong><span>إزالة علامة تحتاج مراجعة يدوية بعد تسجيل النتيجة.</span></div></label>
      <div class="form-actions">
        <button class="btn" type="submit">حفظ النتيجة اليدوية</button>
        <button class="btn secondary" type="button" data-action="copy-tracking-code" data-id="${esc(shipment.id)}">نسخ الكود</button>
        <button class="btn ghost" type="button" data-action="open-egypt-post">فتح البريد المصري</button>
        <button class="btn ghost" type="button" data-action="close-modal">إلغاء</button>
      </div>
    </form>`);
}

function saveManualTrackingResult(id, values = {}) {
  const shipment = data.shipments.find(item => item.id === id);
  if (!shipment) return toast("لم يتم العثور على الشحنة.", "error");
  data.trackingHistory = data.trackingHistory || [];
  const actor = actorSnapshot();
  const reviewedAt = new Date().toISOString();
  const statusCode = values.normalizedStatus || "unknown";
  const statusLabel = values.statusText || MANUAL_TRACKING_STATUSES[statusCode]?.label || "نتيجة يدوية";
  const eventAt = values.eventAt ? new Date(values.eventAt).toISOString() : reviewedAt;
  const entry = {
    id: nextId("TRK-", data.trackingHistory),
    shipmentId: shipment.id,
    trackingNumber: normalizeTrackingNumber(shipment.trackingNumber || shipment.tracking || ""),
    provider: "manual_review",
    source: "manual_review",
    eventStatus: statusCode,
    eventLabel: statusLabel,
    statusText: statusLabel,
    normalizedStatus: statusCode,
    eventLocation: values.location || "",
    location: values.location || "",
    eventDate: eventAt.slice(0, 10),
    eventTime: new Date(eventAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
    eventAt,
    rawText: values.notes || "",
    notes: values.notes || "",
    reviewedByUserId: actor.userId,
    reviewedByUsername: actor.username,
    reviewedBy: actor.name,
    reviewedAt,
    createdAt: reviewedAt
  };
  data.trackingHistory.push(entry);
  shipment.lastStatusText = statusLabel;
  shipment.currentLocation = values.location || shipment.currentLocation || "";
  shipment.lastTrackingAt = reviewedAt;
  shipment.lastTrackingSource = "manual_review";
  shipment.lastTrackingEventCount = Number(shipment.lastTrackingEventCount || 0) + 1;
  shipment.manualReviewedAt = reviewedAt;
  shipment.manualReviewedByUserId = actor.userId;
  shipment.manualReviewedBy = actor.name;
  shipment.manualReviewNotes = values.notes || "";
  if (values.updateOperationalStatus) {
    const operational = values.operationalStatus || MANUAL_TRACKING_STATUSES[statusCode]?.operational || "";
    if (operational) shipment.status = operational;
    shipment.currentStatus = statusLabel;
    shipment.normalizedStatus = statusCode;
    if (statusCode === "delivered") shipment.deliveredAt = shipment.deliveredAt || reviewedAt;
    if (statusCode === "returned") shipment.returnedAt = shipment.returnedAt || reviewedAt;
  }
  if (values.clearManualReview) {
    shipment.manualInterventionNeeded = false;
    shipment.manual_review_required = false;
    shipment.trackingError = "";
  }
  shipment.updatedAt = reviewedAt;
  shipment.updated = reviewedAt;
  data.audit.push(auditEntry({
    action: `تسجيل نتيجة تتبع يدوية: ${statusLabel}`,
    operationType: "manual_tracking_review",
    moduleName: "الشحن",
    entityType: "shipment",
    entity: "الشحن",
    entityId: shipment.id,
    documentNo: shipment.trackingNumber || shipment.tracking || shipment.id,
    notes: values.notes || ""
  }));
  saveData();
  closeModal();
  if (currentView === "shipping") renderShipping();
  toast("تم حفظ نتيجة التتبع اليدوية وتسجيلها في السجل.");
}

function quickManualTracking(id, statusCode) {
  const item = MANUAL_TRACKING_STATUSES[statusCode] || MANUAL_TRACKING_STATUSES.unknown;
  saveManualTrackingResult(id, {
    normalizedStatus: statusCode,
    statusText: item.label,
    eventAt: new Date().toISOString(),
    location: "",
    notes: "Quick Action من مساعد التتبع اليدوي",
    updateOperationalStatus: ["delivered", "out_for_delivery", "failed_attempt", "returned"].includes(statusCode),
    clearManualReview: statusCode !== "unknown"
  });
}

function viewCashTransaction(id) {
  const item = data.cash.find(row => row.id === id);
  if (!item) return toast("لم يتم العثور على الحركة المالية.", "error");
  const refs = cashRelatedReferences(item);
  const relatedCash = item.transferId ? data.cash.filter(row => row.transferId === item.transferId && row.id !== item.id && !row.deletedAt) : [];
  const relatedAudit = (data.audit || []).filter(row => {
    const text = `${row.entityId || ""} ${row.action || ""}`;
    return text.includes(item.id) || refs.some(ref => text.includes(ref));
  }).slice(-8).reverse();
  const refButtons = refs.map(ref => {
    const action = statementRecordAction(ref);
    return action
      ? `<button class="row-action" type="button" data-action="open-statement-record" data-reference="${esc(ref)}">${esc(ref)}</button>`
      : `<span class="badge gray">${esc(ref)}</span>`;
  }).join(" ");
  openModal(`${item.id} — تفاصيل الحركة`, "دفتر الحركة المالية", `
    <div class="metric-strip">
      <div class="mini-metric"><span>النوع</span><strong>${esc(item.type)}</strong></div>
      <div class="mini-metric"><span>المبلغ</span><strong>${money(item.amount)}</strong></div>
      <div class="mini-metric"><span>الحساب / الخزنة</span><strong>${esc(item.account)}</strong></div>
    </div>
    <div class="table-wrap">
      <table><tbody>
        <tr><th>رقم الحركة</th><td><strong>${esc(item.id)}</strong></td></tr>
        <tr><th>تاريخ المستند</th><td>${fmtDate(item.date)}</td></tr>
        <tr><th>تاريخ ووقت التنفيذ</th><td>${dateTimeLabel(item.createdAt || item.date)}</td></tr>
        <tr><th>تمت بواسطة</th><td>${esc(actorLabel(item))}</td></tr>
        <tr><th>آخر تعديل</th><td>${item.updatedAt ? `${dateTimeLabel(item.updatedAt)} — ${esc(item.updatedBy || item.createdBy || "—")}` : "—"}</td></tr>
        <tr><th>الطرف / البيان</th><td>${esc(item.party || "—")}</td></tr>
        <tr><th>التصنيف</th><td>${esc(item.category || "—")}</td></tr>
        <tr><th>الملاحظات</th><td>${esc(item.note || "—")}</td></tr>
        <tr><th>الحالة</th><td>${item.deletedAt ? badge("محذوفة", "danger") : isLockedCash(item) ? badge("تلقائية مرتبطة بمستند", "blue") : badge("يدوية")}</td></tr>
        <tr><th>المستندات المرتبطة</th><td>${refButtons || `<span class="muted">لا توجد مستندات مرتبطة مسجلة.</span>`}</td></tr>
      </tbody></table>
    </div>
    ${relatedCash.length ? `<div class="card-header compact"><div><h3>الطرف الآخر من التحويل</h3><p>الحركة المقابلة لنفس التحويل بين الخزن.</p></div></div><div class="table-wrap"><table><thead><tr><th>رقم الحركة</th><th>النوع</th><th>الحساب</th><th>المبلغ</th></tr></thead><tbody>${relatedCash.map(row => `<tr><td>${esc(row.id)}</td><td>${badge(row.type, row.type === "صرف" ? "danger" : "")}</td><td>${esc(row.account)}</td><td class="money">${money(row.amount)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${relatedAudit.length ? `<div class="card-header compact"><div><h3>سجل العمليات المرتبط</h3><p>آخر عمليات مراجعة مرتبطة بهذه الحركة أو مستنداتها.</p></div></div><div class="table-wrap"><table><thead><tr><th>الوقت</th><th>العملية</th><th>المستخدم</th></tr></thead><tbody>${relatedAudit.map(row => `<tr><td>${dateTimeLabel(row.date)}</td><td>${esc(row.action)}</td><td>${esc(row.user || "—")}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
}

function deleteCash(id) {
  const item = data.cash.find(row => row.id === id);
  if (!item) return;
  if (isLockedCash(item)) return toast("هذه حركة تلقائية مرتبطة بمستند. ألغِ الفاتورة أو الإيصال الأصلي بدل حذف القيد.", "error");
  if (!confirm(`هل تريد حذف الحركة المالية ${id}؟`)) return;
  const actor = actorSnapshot();
  item.deletedAt = new Date().toISOString();
  item.deletedBy = actor.name;
  item.deletedByUsername = actor.username;
  item.deletedByRole = actor.role;
  item.deletedById = actor.userId;
  saveData("حذف حركة مالية", "الحسابات", id);
  renderAccounting();
  toast("تم حذف الحركة المالية.");
}

function viewEmployee(id) {
  const item = data.employees.find(row => row.id === id);
  if (!item) return;
  openModal(item.name, "بطاقة الموظف", `
    <div class="metric-strip">
      <div class="mini-metric"><span>الوظيفة</span><strong>${esc(item.role)}</strong></div>
      <div class="mini-metric"><span>الراتب</span><strong>${money(item.salary)}</strong></div>
      <div class="mini-metric"><span>الحضور</span><strong>${esc(item.attendance)}</strong></div>
    </div>
    <div class="alert-item"><div class="alert-badge blue">⚙</div><div><strong>الصلاحيات</strong><span>${esc(item.permissions)}</span></div></div>`);
}

function deleteEmployee(id) {
  const item = data.employees.find(row => row.id === id);
  if (!item || !confirm(`هل تريد حذف ملف الموظف «${item.name}»؟`)) return;
  item.deletedAt = new Date().toISOString();
  saveData("حذف موظف", "الموظفون", id);
  renderHr();
  toast("تم حذف ملف الموظف.");
}

function viewSale(id) {
  const sale = data.sales.find(item => item.id === id);
  if (!sale) return;
  const lines = sale.lines || [];
  const customer = getCustomer(sale.customerId);
  const shipment = shipmentForSale(sale.id);
  openModal(`فاتورة ${sale.id}`, "تفاصيل فاتورة البيع", `
    <div class="metric-strip">
      <div class="mini-metric"><span>الإجمالي</span><strong>${money(sale.total)}</strong></div>
      <div class="mini-metric"><span>المدفوع</span><strong>${money(sale.paid ?? sale.total)}</strong></div>
      <div class="mini-metric"><span>المتبقي</span><strong>${money(sale.remaining || 0)}</strong></div>
      <div class="mini-metric"><span>تم البيع بواسطة</span><strong>${esc(saleCreatedByName(sale))}</strong></div>
    </div>
    <div class="table-wrap" style="margin-bottom:14px"><table><tbody>
      <tr><th>تاريخ ووقت البيع</th><td>${esc(dateTimeLabel(sale.createdAt || sale.date))}</td><th>قناة البيع</th><td>${esc(sale.channel || "—")}</td></tr>
      <tr><th>نوع العملية</th><td>${esc(sale.saleOperationType || "بيع مباشر")}</td><th>طريقة الدفع</th><td>${esc(sale.payment || "—")}</td></tr>
      <tr><th>حالة الدفع</th><td>${esc(paymentStatusLabel(sale))}</td><th>ملاحظات</th><td>${esc(sale.notes || "—")}</td></tr>
    </tbody></table></div>
    <div class="alert-item" style="margin-bottom:14px"><div class="alert-badge blue">👤</div><div><strong>${esc(customer?.name || "عميل غير مسجل")}</strong><span>${esc(customer?.phone || "لا يوجد رقم موبايل")}${sale.onlineOrderId ? ` · طلب أونلاين ${esc(sale.onlineOrderId)}` : ""}${shipment ? ` · كود التتبع ${esc(shipment.tracking)}` : ""}</span></div>${shipment ? `<button class="btn ghost small" data-action="view-shipment-from-sale" data-id="${shipment.id}">عرض الشحنة</button>` : ""}</div>
    <div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th>بعد الخصم</th></tr></thead><tbody>
      ${lines.map(line => `<tr><td>${esc(getBook(line.bookId)?.name || line.bookId)}</td><td>${line.qty}</td><td>${money(line.price)}</td><td>${lineDiscountLabel(line)}</td><td>${money(saleLineNet(line, line.qty))}</td></tr>`).join("") || `<tr><td colspan="5" class="text-center muted">فاتورة تجريبية قديمة بدون بنود تفصيلية.</td></tr>`}
    </tbody></table></div>
    <div class="invoice-totals-grid"><span>قبل الخصم <b>${money(sale.subtotalBeforeDiscount??sale.subtotal??sale.total)}</b></span><span>إجمالي الخصم <b>${money(sale.discount||0)}</b></span><span>بعد الخصم <b>${money(sale.subtotalAfterDiscount??Math.max(0,Number(sale.total||0)-Number(sale.shipping||0)))}</b></span><span>الشحن <b>${money(sale.shipping||0)}</b></span><span class="grand">الإجمالي <b>${money(sale.total)}</b></span><span>المدفوع <b>${money(sale.paidAmount??sale.paid??0)}</b></span><span>المتبقي <b>${money(sale.remainingAmount??sale.remaining??0)}</b></span></div>
    <div class="form-actions"><button class="btn" data-action="print-sale" data-id="${sale.id}" data-format="a4">طباعة A4</button><button class="btn secondary" data-action="print-sale" data-id="${sale.id}" data-format="thermal">طباعة حرارية</button>${!["ملغاة","مرتجع"].includes(sale.status) ? `<button class="btn ghost" data-action="return-sale" data-id="${sale.id}">تسجيل مرتجع</button>` : ""}<button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
}

function salePaymentModal(id) {
  const sale = data.sales.find(item => item.id === id);
  if (!sale || sale.status === "ملغاة") return toast("لا يمكن تسجيل سداد لفاتورة ملغاة.", "error");
  if (!saleCanBeModified(sale)) return toast("هذه اليومية مقفولة. التحصيل أو التعديل يحتاج صلاحية مدير.", "error");
  if (!sale.remaining) return toast("الفاتورة مسددة بالكامل.", "error");
  openModal(`تحصيل الفاتورة ${id}`, "المبيعات والتحصيل", `
    <form id="sale-payment-form" data-id="${id}">
      <div class="alert-item" style="margin-bottom:15px"><div class="alert-badge blue">↓</div><div><strong>المتبقي ${money(sale.remaining)}</strong><span>${esc(getCustomer(sale.customerId)?.name || "")}</span></div></div>
      <div class="form-grid">
        <div class="form-field"><label class="required">قيمة التحصيل</label><input name="amount" type="number" min="0.01" max="${sale.remaining}" required value="${sale.remaining}"></div>
        <div class="form-field"><label>الحساب</label><select name="account">${cashAccountOptions()}</select></div>
        <div class="form-field full"><label>التاريخ</label><input name="date" type="date" value="${today()}"></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">حفظ التحصيل</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

async function cancelSale(id) {
  const sale = data.sales.find(item => item.id === id);
  if (!saleCanBeModified(sale)) return toast("هذه اليومية مقفولة. الإلغاء يحتاج صلاحية مدير.", "error");
  if (sale && shipmentForSale(id)) return toast("لا يمكن إلغاء فاتورة مرتبطة بشحنة. ألغِ الشحنة أولًا.", "error");
  if (sale?.status === "مرتجع جزئي") return toast("لا يمكن إلغاء فاتورة عليها مرتجع جزئي. أكمل المرتجع من شاشة المرتجعات أو راجع السجل.", "error");
  if (!sale || sale.status === "ملغاة") return;
  try{const result=await orderWorkflowRequest(cancellationEndpoint("sale",id,"cancellation/preview"),{method:"GET"});if(result.financial.paid>0)return openCancellationSettlement("sale",id,result.financial);if(!confirm(`سيتم إبطال الفاتورة ${id} وإرجاع الكميات للمخزون. هل أنت متأكد؟`))return;await orderWorkflowRequest(cancellationEndpoint("sale",id,"cancel"),{body:{reason:"إبطال فاتورة بيع"}});if(currentView==="sales")renderSales();else showSalesList();toast("تم إبطال الفاتورة وإرجاع المخزون دون حذف المستند.");}catch(error){toast(error.message,"error");}
}

function returnedQuantityMap(type, documentId) {
  const map = new Map();
  const acceptedTypes = type === "purchase" ? ["purchase", "purchase_return"] : ["sale", "sales_return"];
  (data.returns || [])
    .filter(item => !item.deletedAt && acceptedTypes.includes(item.type) && Array.isArray(returnItems(item)) && (item.documentId === documentId || returnItems(item).some(line => line.documentId === documentId || line.sourceInvoiceId === documentId)))
    .forEach(item => returnItems(item).forEach(line => {
      if (line.documentId && line.documentId !== documentId) return;
      if (line.sourceInvoiceId && line.sourceInvoiceId !== documentId) return;
      const key = String(line.lineIndex ?? line.bookId ?? "");
      map.set(key, Number(map.get(key) || 0) + Number(line.qty || 0));
    }));
  return map;
}

function saleLineNet(line, qty = Number(line.qty || 0)) {
  const sourceQty = Math.max(1, Number(line.qty || 1));
  if (line.finalNet != null) return Math.max(0, Number(line.finalNet || 0) / sourceQty * Number(qty || 0));
  const unitBase = Number(line.price || 0);
  const base = qty * unitBase;
  const discount = Number(line.discount || 0);
  if (line.discountType === "amount") return Math.max(0, base - (discount / sourceQty) * qty);
  return Math.max(0, base * (1 - discount / 100));
}

function purchaseLineNet(line, qty = Number(line.qty || 0)) {
  const sourceQty = Math.max(1, Number(line.qty || 1));
  if (line.finalNet != null) return Math.max(0, Number(line.finalNet || 0) / sourceQty * Number(qty || 0));
  const base = Number(qty || 0) * Number(line.cost || 0);
  const discount = Number(line.discount || 0);
  if (line.discountType === "amount") return Math.max(0, base - (discount / sourceQty) * Number(qty || 0));
  return Math.max(0, base * (1 - discount / 100));
}

function lineDiscountLabel(line) {
  const totalDiscount = Number(line.totalDiscount ?? line.lineDiscount ?? 0);
  if (totalDiscount > 0) return money(totalDiscount);
  const discount = Number(line.discount || 0);
  if (!discount) return "—";
  return line.discountType === "amount" ? money(discount) : `${discount}%`;
}

function saleReturnableLines(sale) {
  const returned = returnedQuantityMap("sale", sale?.id);
  return (sale?.lines || []).map((line, index) => {
    const soldQty = Number(line.qty || 0);
    const returnedQty = Number(returned.get(String(index)) || returned.get(String(line.bookId)) || 0);
    return { ...line, documentId: sale?.id || "", saleId: sale?.id || "", saleDate: sale?.date || "", lineIndex: index, returnedQty, remaining: Math.max(0, soldQty - returnedQty), lineAmount: saleLineNet(line, soldQty) };
  }).filter(line => line.bookId && line.remaining > 0);
}

function customerReturnableSaleLines(customerId) {
  return data.sales
    .filter(sale => !sale.deletedAt && sale.customerId === customerId && !["ملغاة","مرتجع"].includes(sale.status))
    .flatMap(sale => saleReturnableLines(sale).map(line => ({ ...line, saleId: sale.id, documentId: sale.id, saleDate: sale.date, saleTotal: Number(sale.total || 0), saleRemaining: Number(sale.remaining || 0), saleReturnedRemaining: Number(sale.returnedRemaining || 0) })))
    .sort((a, b) => String(b.saleDate).localeCompare(String(a.saleDate)) || String(b.saleId).localeCompare(String(a.saleId)));
}

function purchaseReturnableLines(purchase) {
  if (!purchase || purchase.status === "بانتظار الفحص") return [];
  const returned = returnedQuantityMap("purchase", purchase?.id);
  return (purchase?.lines || []).map((line, index) => {
    const purchasedQty = Number(line.qty || 0);
    const returnedQty = Number(returned.get(String(index)) || returned.get(String(line.bookId)) || 0);
    return { ...line, documentId: purchase?.id || "", purchaseId: purchase?.id || "", purchaseDate: purchase?.date || "", supplierInvoiceNumber: purchase?.supplierInvoiceNumber || "", lineIndex: index, returnedQty, remaining: Math.max(0, purchasedQty - returnedQty), lineAmount: purchaseLineNet(line, purchasedQty) };
  }).filter(line => line.bookId && line.remaining > 0);
}

function supplierReturnablePurchaseLines(supplierId) {
  return data.purchases
    .filter(purchase => !purchase.deletedAt && purchase.supplierId === supplierId && !["ملغاة","مرتجع","بانتظار الفحص"].includes(purchase.status))
    .flatMap(purchase => purchaseReturnableLines(purchase).map(line => ({ ...line, purchaseId: purchase.id, documentId: purchase.id, purchaseDate: purchase.date, purchaseTotal: Number(purchase.total || 0), purchaseRemaining: Number(purchase.remaining || 0), purchaseReturnedRemaining: Number(purchase.returnedRemaining || 0), supplierInvoiceNumber: purchase.supplierInvoiceNumber || "" })))
    .sort((a, b) => String(b.purchaseDate).localeCompare(String(a.purchaseDate)) || String(b.purchaseId).localeCompare(String(a.purchaseId)));
}

function selectedSupplierReturnLinesFromForm(formData, returnableLines) {
  return returnableLines.map(line => {
    const key = `${line.purchaseId}__${line.lineIndex}`;
    const qty = Math.max(0, Math.min(Number(formData[`returnQty-${key}`] || 0), Number(line.remaining || 0)));
    const unitValue = Number(line.qty || 0) ? purchaseLineNet(line, Number(line.qty || 0)) / Number(line.qty || 1) : Number(line.cost || 0);
    return qty > 0 ? {
      documentId: line.purchaseId,
      sourceInvoiceId: line.purchaseId,
      sourceInvoiceNo: line.supplierInvoiceNumber || line.purchaseId,
      lineIndex: line.lineIndex,
      bookId: line.bookId,
      qty,
      unitValue,
      unitPrice: unitValue,
      amount: purchaseLineNet(line, qty),
      total: purchaseLineNet(line, qty),
      reason: formData.reason || ""
    } : null;
  }).filter(Boolean);
}

function updateSupplierPurchaseReturnSummary() {
  const form = document.getElementById("purchase-supplier-return-form");
  if (!form) return;
  const amount = [...form.querySelectorAll(".supplier-return-qty")]
    .reduce((sum, input) => sum + Math.max(0, Math.min(Number(input.value || 0), Number(input.max || 0))) * Number(input.dataset.unitValue || 0), 0);
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = money(value); };
  set("supplier-return-total", amount);
  set("supplier-return-paid", form.elements.settlement?.value === "cash" ? amount : 0);
  set("supplier-return-balance", form.elements.settlement?.value === "cash" ? 0 : amount);
  const cashField = form.querySelector("[data-cash-account-field]");
  if (cashField) cashField.hidden = form.elements.settlement?.value !== "cash";
}

function selectedReturnLinesFromForm(formData, returnableLines, valueFn) {
  return returnableLines.map(line => {
    const qty = Math.max(0, Math.min(Number(formData[`returnQty-${line.lineIndex}`] || 0), Number(line.remaining || 0)));
    return qty > 0 ? {
      lineIndex: line.lineIndex,
      bookId: line.bookId,
      qty,
      unitValue: Number(line.qty || 0) ? valueFn(line, Number(line.qty || 0)) / Number(line.qty || 1) : 0,
      amount: valueFn(line, qty)
    } : null;
  }).filter(Boolean);
}

function selectedCustomerReturnLinesFromForm(formData, returnableLines) {
  return returnableLines.map(line => {
    const key = `${line.saleId}__${line.lineIndex}`;
    const qty = Math.max(0, Math.min(Number(formData[`returnQty-${key}`] || 0), Number(line.remaining || 0)));
    return qty > 0 ? {
      documentId: line.saleId,
      lineIndex: line.lineIndex,
      bookId: line.bookId,
      qty,
      unitValue: Number(line.qty || 0) ? saleLineNet(line, Number(line.qty || 0)) / Number(line.qty || 1) : Number(line.price || 0),
      unitPrice: Number(line.qty || 0) ? saleLineNet(line, Number(line.qty || 0)) / Number(line.qty || 1) : Number(line.price || 0),
      sourceInvoiceId: line.saleId,
      sourceInvoiceNo: line.saleId,
      amount: saleLineNet(line, qty),
      total: saleLineNet(line, qty)
    } : null;
  }).filter(Boolean);
}

function saleReturnCalculation(sale, selectedLines, replacementDeduction = 0) {
  const returnAmount = selectedLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const total = Math.max(1, Number(sale?.total || 0));
  const remainingBase = Number(sale?.remaining || 0) + Number(sale?.returnedRemaining || 0);
  const debtReduction = Math.min(Number(sale?.remaining || 0), remainingBase * returnAmount / total);
  const replacement = Math.max(0, Math.min(Number(replacementDeduction || 0), Math.max(0, returnAmount - debtReduction)));
  const customerDue = Math.max(0, returnAmount - debtReduction - replacement);
  return { returnAmount, debtReduction, replacement, customerDue };
}

function customerSaleReturnCalculation(selectedLines, replacementDeduction = 0) {
  const returnAmount = selectedLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const debtReduction = selectedLines.reduce((sum, line) => {
    const sale = data.sales.find(item => item.id === line.documentId);
    if (!sale) return sum;
    const saleReturnAmount = selectedLines.filter(row => row.documentId === sale.id).reduce((s, row) => s + Number(row.amount || 0), 0);
    const total = Math.max(1, Number(sale.total || 0));
    const remainingBase = Number(sale.remaining || 0) + Number(sale.returnedRemaining || 0);
    const saleDebt = Math.min(Number(sale.remaining || 0), remainingBase * saleReturnAmount / total);
    return sum + (line === selectedLines.find(row => row.documentId === sale.id) ? saleDebt : 0);
  }, 0);
  const replacement = Math.max(0, Math.min(Number(replacementDeduction || 0), Math.max(0, returnAmount - debtReduction)));
  const customerDue = Math.max(0, returnAmount - debtReduction - replacement);
  return { returnAmount, debtReduction, replacement, customerDue };
}

function updateSaleReturnSummary() {
  const form = document.getElementById("sale-return-form");
  if (!form) return;
  const rows = [...form.querySelectorAll(".sale-return-qty")];
  const returnAmount = rows.reduce((sum, input) => sum + Math.max(0, Math.min(Number(input.value || 0), Number(input.max || 0))) * Number(input.dataset.unitValue || 0), 0);
  const saleRemaining = Number(form.dataset.saleRemaining || 0);
  const saleTotal = Math.max(1, Number(form.dataset.saleTotal || 0));
  const returnedRemaining = Number(form.dataset.returnedRemaining || 0);
  const debtReduction = Math.min(saleRemaining, (saleRemaining + returnedRemaining) * returnAmount / saleTotal);
  const replacementInput = form.querySelector('[name="replacementDeduction"]');
  const replacement = Math.max(0, Math.min(Number(replacementInput?.value || 0), Math.max(0, returnAmount - debtReduction)));
  const customerDue = Math.max(0, returnAmount - debtReduction - replacement);
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = money(value); };
  set("sale-return-gross", returnAmount);
  set("sale-return-debt", debtReduction);
  set("sale-return-replacement", replacement);
  set("sale-return-due", customerDue);
  const settlement = form.elements.settlement?.value || "cash";
  const cashField = form.querySelector('[data-cash-account-field]');
  if (cashField) cashField.hidden = settlement !== "cash";
}

function updateCustomerSaleReturnSummary() {
  const form = document.getElementById("sale-customer-return-form");
  if (!form) return;
  const rows = [...form.querySelectorAll(".customer-return-qty")];
  const selectedLines = rows.map(input => {
    const qty = Math.max(0, Math.min(Number(input.value || 0), Number(input.max || 0)));
    return qty > 0 ? { documentId: input.dataset.saleId, amount: qty * Number(input.dataset.unitValue || 0) } : null;
  }).filter(Boolean);
  const { returnAmount, debtReduction, replacement, customerDue } = customerSaleReturnCalculation(selectedLines, form.elements.replacementDeduction?.value);
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = money(value); };
  set("customer-return-gross", returnAmount);
  set("customer-return-debt", debtReduction);
  set("customer-return-replacement", replacement);
  set("customer-return-due", customerDue);
  const settlement = form.elements.settlement?.value || "cash";
  const cashField = form.querySelector("[data-cash-account-field]");
  if (cashField) cashField.hidden = settlement !== "cash";
}

function isFullyReturned(documentLines, selectedLines, previouslyReturnedMap) {
  return (documentLines || []).every((line, index) => {
    const previous = Number(previouslyReturnedMap.get(String(index)) || previouslyReturnedMap.get(String(line.bookId)) || 0);
    const selected = Number(selectedLines.find(row => row.lineIndex === index)?.qty || 0);
    return previous + selected >= Number(line.qty || 0);
  });
}

function showReturnDocumentPicker(type) {
  const isSale = type === "sale";
  const docs = isSale
    ? data.sales.filter(sale => !sale.deletedAt && getCustomer(sale.customerId) && !["ملغاة","مرتجع"].includes(sale.status) && saleReturnableLines(sale).length)
    : data.purchases.filter(purchase => !purchase.deletedAt && !["ملغاة","مرتجع"].includes(purchase.status));
  openModal(isSale ? "اختيار فاتورة بيع للمرتجع" : "اختيار مستند شراء للمرتجع", "المرتجعات", `
    <div class="toolbar" style="padding:0 0 15px;border-bottom:0"><div class="search"><input id="return-doc-search" autocomplete="off" placeholder="${isSale ? "ابحث برقم الفاتورة أو العميل أو الصنف..." : "ابحث برقم المستند أو فاتورة المورد أو المورد أو الصنف..."}"></div></div>
    <div class="table-wrap"><table><thead><tr><th>${isSale ? "الفاتورة" : "المستند"}</th>${isSale ? "" : "<th>فاتورة المورد</th>"}<th>${isSale ? "العميل" : "المورد"}</th><th>التاريخ</th><th>المتاح</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${docs.map(doc => {
        const lines = isSale ? saleReturnableLines(doc) : purchaseReturnableLines(doc);
        const party = isSale ? getCustomer(doc.customerId)?.name : getSupplier(doc.supplierId)?.name;
        const searchText = normalizeReturnSearch(`${doc.id} ${doc.supplierInvoiceNumber || ""} ${party || ""} ${lines.map(line => getBook(line.bookId)?.name || line.bookId).join(" ")}`);
        const available = lines.reduce((sum, line) => sum + Number(line.remaining || 0), 0);
        const unavailableReason = !isSale && doc.status === "بانتظار الفحص" ? "بانتظار الاستلام" : !lines.length ? "لا توجد بنود قابلة للمرتجع" : "";
        return `<tr data-return-doc-row data-search="${esc(searchText)}"><td><strong>${esc(doc.id)}</strong></td>${isSale ? "" : `<td>${esc(doc.supplierInvoiceNumber || "—")}</td>`}<td>${esc(party || "—")}</td><td>${fmtDate(doc.date)}</td><td>${available}</td><td>${unavailableReason ? badge(unavailableReason, "warning") : badge(doc.status || (isSale ? "معتمدة" : "مستلمة"), doc.status === "مرتجع جزئي" ? "warning" : "")}</td><td>${lines.length ? `<button class="row-action" data-modal-action="${isSale ? "return-sale" : "return-purchase"}" data-id="${doc.id}">تسجيل مرتجع</button>` : `<span class="muted">غير متاح</span>`}</td></tr>`;
      }).join("") || `<tr><td colspan="${isSale ? 6 : 7}" class="text-center muted">لا توجد مستندات مسجلة.</td></tr>`}
    </tbody></table></div>`);
}

function saleReturnByCustomerModal(customerId = "") {
  const customer = getCustomer(customerId);
  if (!customer) {
    return openModal("فاتورة مرتجع مبيعات حسب العميل", "المرتجعات", `
      <div class="alert-item" style="margin-bottom:15px"><div class="alert-badge blue">👤</div><div><strong>ابدأ باختيار العميل</strong><span>سيعرض النظام الأصناف التي اشتراها هذا العميل فقط، بدون فتح الفاتورة الأصلية.</span></div></div>
      <div class="form-field full sale-customer-picker">
        <label class="required">بحث عن العميل المسجل</label>
        <div class="search"><input id="return-customer-search" autocomplete="off" placeholder="اكتب اسم العميل أو رقم الهاتف"></div>
        <div id="return-customer-suggestions" class="customer-suggestions"></div>
      </div>`);
  }
  const lines = customerReturnableSaleLines(customer.id);
  if (!lines.length) return toast("لا توجد أصناف مبيعات متاحة للمرتجع لهذا العميل.", "error");
  openModal(`فاتورة مرتجع جديدة — ${customer.name}`, "مرتجع حسب العميل", `
    <form id="sale-customer-return-form" data-customer-id="${customer.id}">
      <div class="alert-item" style="margin-bottom:15px"><div class="alert-badge red">↶</div><div><strong>${esc(customer.name)} — ${esc(customer.id)}</strong><span>اختر الأصناف من مبيعات هذا العميل فقط. لا تحتاج لفتح الفاتورة الأصلية.</span></div><button class="btn ghost small" type="button" data-action="statement" data-kind="customer" data-id="${customer.id}">كشف الحساب</button></div>
      <div class="toolbar" style="padding:0 0 15px;border-bottom:0"><div class="search"><input id="customer-return-line-search" autocomplete="off" placeholder="ابحث داخل فواتير العميل: رقم فاتورة أو اسم صنف..."></div></div>
      <div class="table-wrap" style="margin-bottom:14px"><table><thead><tr><th>الفاتورة</th><th>الصنف</th><th>المباع</th><th>تم إرجاعه</th><th>المتاح</th><th>كمية المرتجع</th><th>قيمة المتاح</th></tr></thead><tbody>
        ${lines.map(line => {
          const key = `${line.saleId}__${line.lineIndex}`;
          const unitValue = Number(line.qty || 0) ? saleLineNet(line, Number(line.qty || 0)) / Number(line.qty || 1) : Number(line.price || 0);
          const book = getBook(line.bookId);
          const searchText = normalizeReturnSearch(`${line.saleId} ${fmtDate(line.saleDate)} ${book?.name || line.bookId} ${book?.barcode || ""} ${book?.extraBarcode || ""}`);
          return `<tr data-customer-return-row data-search="${esc(searchText)}"><td><strong>${esc(line.saleId)}</strong><br><span class="muted">${fmtDate(line.saleDate)}</span></td><td>${esc(book?.name || line.bookId)}<br><span class="muted">${esc(book?.barcode || "")}</span></td><td>${Number(line.qty || 0).toLocaleString("ar-EG")}</td><td>${Number(line.returnedQty || 0).toLocaleString("ar-EG")}</td><td>${Number(line.remaining || 0).toLocaleString("ar-EG")}</td><td><input class="customer-return-qty" name="returnQty-${key}" type="number" min="0" max="${line.remaining}" data-sale-id="${esc(line.saleId)}" data-line-index="${line.lineIndex}" data-unit-value="${unitValue}" value="0"></td><td class="money">${money(saleLineNet(line, line.remaining))}</td></tr>`;
        }).join("")}
      </tbody></table></div>
      <div class="metric-strip" style="margin-bottom:14px">
        <div class="mini-metric"><span>قيمة الأصناف المرتجعة</span><strong id="customer-return-gross">${money(0)}</strong></div>
        <div class="mini-metric"><span>تخصم من المديونية</span><strong id="customer-return-debt">${money(0)}</strong></div>
        <div class="mini-metric"><span>أصناف/قيمة بديلة تخصم</span><strong id="customer-return-replacement">${money(0)}</strong></div>
        <div class="mini-metric"><span>المطلوب رده للعميل</span><strong id="customer-return-due">${money(0)}</strong></div>
      </div>
      <div class="form-grid">
        <div class="form-field"><label>لو العميل أخذ صنف/منتج بديل</label><input name="replacementDeduction" type="number" min="0" value="0" placeholder="قيمة تخصم من المرتجع"></div>
        <div class="form-field"><label>تسوية المبلغ المطلوب للعميل</label><select name="settlement"><option value="cash">رد نقدي من الخزنة</option><option value="customer-credit">خصم من رصيد العميل / حفظ كرصيد دائن</option><option value="no-settlement">بدون تسوية حالية، يضاف كرصيد مستحق</option><option value="debt-only">خصم من مديونية العميل فقط</option></select></div>
        <div class="form-field" data-cash-account-field><label>خزنة رد المبلغ</label><select name="account">${cashAccountOptions("الخزينة الرئيسية")}</select></div>
        <div class="form-field"><label>تاريخ المرتجع</label><input name="date" type="date" value="${today()}"></div>
        <div class="form-field full"><label class="required">سبب المرتجع</label><input name="reason" required placeholder="مثال: استرجاع العميل لمنتجات من فواتيره"></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">اعتماد فاتورة المرتجع</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
  setTimeout(updateCustomerSaleReturnSummary, 0);
}

function purchaseReturnBySupplierModal(supplierId = "") {
  const supplier = getSupplier(supplierId);
  if (!supplier) {
    return openModal("مرتجع مشتريات مستقل حسب المورد", "المرتجعات", `
      <div class="alert-item" style="margin-bottom:15px"><div class="alert-badge blue">↶</div><div><strong>ابدأ باختيار المورد</strong><span>سيعرض النظام الأصناف التي تم شراؤها من هذا المورد من أكثر من مستند شراء.</span></div></div>
      <div class="form-field full sale-customer-picker">
        <label class="required">بحث عن المورد</label>
        <div class="search"><input id="return-supplier-search" autocomplete="off" placeholder="اكتب اسم المورد أو رقم الهاتف"></div>
        <div id="return-supplier-suggestions" class="customer-suggestions"></div>
      </div>`);
  }
  const lines = supplierReturnablePurchaseLines(supplier.id);
  if (!lines.length) return toast("لا توجد أصناف مشتريات متاحة للمرتجع لهذا المورد.", "error");
  openModal(`مرتجع مشتريات مستقل — ${supplier.name}`, "مرتجع حسب المورد", `
    <form id="purchase-supplier-return-form" data-supplier-id="${supplier.id}">
      <div class="alert-item" style="margin-bottom:15px"><div class="alert-badge red">↶</div><div><strong>${esc(supplier.name)} — ${esc(supplier.id)}</strong><span>اختر أصنافًا من مستندات شراء مختلفة في نفس فاتورة المرتجع.</span></div><button class="btn ghost small" type="button" data-action="statement" data-kind="supplier" data-id="${supplier.id}">كشف الحساب</button></div>
      <div class="toolbar" style="padding:0 0 15px;border-bottom:0"><div class="search"><input id="supplier-return-line-search" autocomplete="off" placeholder="ابحث باسم الصنف أو الباركود أو رقم مستند الشراء..."></div></div>
      <div class="table-wrap" style="margin-bottom:14px"><table><thead><tr><th>مستند الشراء</th><th>فاتورة المورد</th><th>الصنف</th><th>المشتراة</th><th>تم إرجاعه</th><th>المتاح</th><th>كمية المرتجع</th><th>قيمة المتاح</th></tr></thead><tbody>
        ${lines.map(line => {
          const key = `${line.purchaseId}__${line.lineIndex}`;
          const book = getBook(line.bookId);
          const unitValue = Number(line.qty || 0) ? purchaseLineNet(line, Number(line.qty || 0)) / Number(line.qty || 1) : Number(line.cost || 0);
          const searchText = normalizeReturnSearch(`${line.purchaseId} ${line.supplierInvoiceNumber || ""} ${book?.name || line.bookId} ${book?.barcode || ""} ${book?.extraBarcode || ""}`);
          return `<tr data-supplier-return-row data-search="${esc(searchText)}"><td><strong>${esc(line.purchaseId)}</strong><br><span class="muted">${fmtDate(line.purchaseDate)}</span></td><td>${esc(line.supplierInvoiceNumber || "—")}</td><td>${esc(book?.name || line.bookId)}<br><span class="muted">${esc(book?.barcode || "")}</span></td><td>${Number(line.qty || 0).toLocaleString("ar-EG")}</td><td>${Number(line.returnedQty || 0).toLocaleString("ar-EG")}</td><td>${Number(line.remaining || 0).toLocaleString("ar-EG")}</td><td><input class="supplier-return-qty" name="returnQty-${key}" type="number" min="0" max="${line.remaining}" data-unit-value="${unitValue}" value="0"></td><td class="money">${money(purchaseLineNet(line, line.remaining))}</td></tr>`;
        }).join("")}
      </tbody></table></div>
      <div class="metric-strip" style="margin-bottom:14px">
        <div class="mini-metric"><span>إجمالي المرتجع</span><strong id="supplier-return-total">${money(0)}</strong></div>
        <div class="mini-metric"><span>نقدي مستلم من المورد</span><strong id="supplier-return-paid">${money(0)}</strong></div>
        <div class="mini-metric"><span>تأثير حساب المورد</span><strong id="supplier-return-balance">${money(0)}</strong></div>
      </div>
      <div class="form-grid">
        <div class="form-field"><label>طريقة التسوية المالية</label><select name="settlement"><option value="cash">رد نقدي من المورد للخزنة</option><option value="account-credit">خصم من رصيد المورد</option><option value="no-settlement">بدون تسوية حالية، يضاف كرصيد مستحق</option></select></div>
        <div class="form-field" data-cash-account-field><label>خزنة استلام المبلغ</label><select name="account">${cashAccountOptions("الخزينة الرئيسية")}</select></div>
        <div class="form-field"><label>تاريخ المرتجع</label><input name="date" type="date" value="${today()}"></div>
        <div class="form-field full"><label class="required">سبب المرتجع</label><input name="reason" required placeholder="مثال: إرجاع أصناف للمورد"></div>
        <div class="form-field full"><label>ملاحظات</label><input name="notes" placeholder="اختياري"></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">اعتماد مرتجع المشتريات المستقل</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
  setTimeout(updateSupplierPurchaseReturnSummary, 0);
}

function showReturnSearch() {
  const rows = (data.returns || []).filter(item => !item.deletedAt);
  openModal("بحث في المرتجعات", "المرتجعات", `
    <div class="toolbar" style="padding:0 0 15px;border-bottom:0"><div class="search"><input id="return-search-box" autocomplete="off" placeholder="ابحث برقم المرتجع أو الحساب أو الفاتورة الأصلية..."></div></div>
    <div class="table-wrap"><table><thead><tr><th>رقم المرتجع</th><th>النوع</th><th>الحساب</th><th>الإجمالي</th><th>التاريخ</th><th></th></tr></thead><tbody>
      ${rows.map(item => {
        const search = normalizeReturnSearch(`${returnNo(item)} ${returnAccountName(item) || ""} ${item.sourceDocuments?.join(" ") || ""} ${returnItems(item).map(line => `${line.documentId || ""} ${line.sourceInvoiceNo || ""} ${getBook(line.bookId)?.name || ""}`).join(" ")}`);
        return `<tr data-return-search-row data-search="${esc(search)}"><td><strong>${esc(returnNo(item))}</strong></td><td>${returnTypeLabel(item.type)}</td><td>${esc(returnAccountName(item) || "—")}</td><td class="money">${money(item.subtotal ?? item.amount ?? 0)}</td><td>${fmtDate(item.date)}</td><td><button class="row-action" data-action="view-return" data-id="${esc(item.id)}">عرض</button></td></tr>`;
      }).join("") || `<tr><td colspan="6" class="text-center muted">لا توجد مرتجعات مسجلة.</td></tr>`}
    </tbody></table></div>`);
}

function viewReturn(id) {
  const item = (data.returns || []).find(row => row.id === id);
  if (!item) return toast("لم يتم العثور على المرتجع.", "error");
  const isSale = returnKind(item.type) === "sale";
  const party = returnAccountName(item);
  const items = returnItems(item);
  openModal(`مستند مرتجع ${returnNo(item)}`, returnTypeLabel(item.type), `
    <div class="metric-strip">
      <div class="mini-metric"><span>أصل المستند</span><strong>${esc(item.sourceDocuments?.length ? item.sourceDocuments.join("، ") : item.documentId || "—")}</strong></div>
      <div class="mini-metric"><span>قيمة المرتجع</span><strong>${money(item.subtotal ?? item.amount ?? 0)}</strong></div>
      <div class="mini-metric"><span>${isSale ? "المطلوب للعميل" : "تأثير المورد"}</span><strong>${money(item.customerDue ?? item.supplierDue ?? Math.abs(item.balanceEffect || 0) ?? item.amount ?? 0)}</strong></div>
      <div class="mini-metric"><span>التاريخ</span><strong>${fmtDate(item.date)}</strong></div>
    </div>
    <div class="alert-item" style="margin-bottom:14px"><div class="alert-badge red">↶</div><div><strong>${esc(party || "—")}</strong><span>${esc(item.reason || item.notes || "بدون سبب مسجل")} — ${esc(returnSettlementLabel(item))}</span></div></div>
    <div class="metric-strip" style="margin-bottom:14px">
      <div class="mini-metric"><span>خصم مديونية</span><strong>${money(item.debtReduction || 0)}</strong></div>
      <div class="mini-metric"><span>أصناف/قيمة بديلة</span><strong>${money(item.replacementDeduction || 0)}</strong></div>
      <div class="mini-metric"><span>رقم المرتجع</span><strong>${esc(returnNo(item))}</strong></div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>الفاتورة الأصلية</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>
      ${items.map(line => `<tr><td>${esc(line.sourceInvoiceNo || line.sourceInvoiceId || line.documentId || item.documentId || "—")}</td><td>${esc(getBook(line.bookId)?.name || line.bookId)}</td><td>${Number(line.qty || 0).toLocaleString("ar-EG")}</td><td class="money">${money(line.unitPrice || line.unitValue || 0)}</td><td class="money">${money(line.total || line.amount || 0)}</td></tr>`).join("") || `<tr><td colspan="5" class="text-center muted">مرتجع قديم بدون تفاصيل أصناف.</td></tr>`}
    </tbody></table></div>
    <div class="form-actions"><button class="btn" type="button" data-action="print-return" data-id="${esc(item.id)}">طباعة</button><button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
}

function saleReturnModal(id) {
  const sale = data.sales.find(item => item.id === id);
  if (!sale || ["ملغاة","مرتجع"].includes(sale.status)) return toast("الفاتورة غير متاحة كمرتجع.", "error");
  const customer = getCustomer(sale.customerId);
  if (!customer) return toast("لا يمكن تسجيل مرتجع إلا لفاتورة مرتبطة بعميل مسجل.", "error");
  const returnableLines = saleReturnableLines(sale);
  if (!returnableLines.length) return toast("لا توجد كميات متاحة للمرتجع في هذه الفاتورة.", "error");
  openModal(`فاتورة مرتجع جديدة من ${id}`, "مرتجعات المبيعات", `
    <form id="sale-return-form" data-id="${id}" data-sale-total="${Number(sale.total || 0)}" data-sale-remaining="${Number(sale.remaining || 0)}" data-returned-remaining="${Number(sale.returnedRemaining || 0)}">
      <div class="alert-item" style="margin-bottom:15px"><div class="alert-badge red">↶</div><div><strong>${esc(customer.name)} — ${esc(customer.id)}</strong><span>فاتورة مرتجع مرتبطة بحساب العميل. يتم اختيار أصناف من فواتير العميل فقط.</span></div><button class="btn ghost small" type="button" data-action="statement" data-kind="customer" data-id="${customer.id}">كشف الحساب</button></div>
      <div class="table-wrap" style="margin-bottom:14px"><table><thead><tr><th>الصنف</th><th>المباع</th><th>تم إرجاعه</th><th>المتاح</th><th>كمية المرتجع</th><th>قيمة المتاح</th></tr></thead><tbody>
        ${returnableLines.map(line => {
          const unitValue = Number(line.qty || 0) ? saleLineNet(line, Number(line.qty || 0)) / Number(line.qty || 1) : Number(line.price || 0);
          return `<tr><td>${esc(getBook(line.bookId)?.name || line.bookId)}</td><td>${Number(line.qty || 0).toLocaleString("ar-EG")}</td><td>${Number(line.returnedQty || 0).toLocaleString("ar-EG")}</td><td>${Number(line.remaining || 0).toLocaleString("ar-EG")}</td><td><input class="sale-return-qty" name="returnQty-${line.lineIndex}" type="number" min="0" max="${line.remaining}" data-unit-value="${unitValue}" value="0"></td><td class="money">${money(saleLineNet(line, line.remaining))}</td></tr>`;
        }).join("")}
      </tbody></table></div>
      <div class="metric-strip" style="margin-bottom:14px">
        <div class="mini-metric"><span>قيمة الأصناف المرتجعة</span><strong id="sale-return-gross">${money(0)}</strong></div>
        <div class="mini-metric"><span>تخصم من مديونية الفاتورة</span><strong id="sale-return-debt">${money(0)}</strong></div>
        <div class="mini-metric"><span>أصناف/قيمة بديلة تخصم</span><strong id="sale-return-replacement">${money(0)}</strong></div>
        <div class="mini-metric"><span>المطلوب رده للعميل</span><strong id="sale-return-due">${money(0)}</strong></div>
      </div>
      <div class="form-grid">
        <div class="form-field"><label>لو العميل أخذ صنف/منتج بديل</label><input name="replacementDeduction" type="number" min="0" value="0" placeholder="قيمة تخصم من المرتجع"></div>
        <div class="form-field"><label>تسوية المبلغ المطلوب للعميل</label><select name="settlement"><option value="cash">رد نقدي من الخزنة</option><option value="customer-credit">خصم من رصيد العميل / حفظ كرصيد دائن</option><option value="no-settlement">بدون تسوية حالية، يضاف كرصيد مستحق</option><option value="debt-only">خصم من مديونية العميل فقط</option></select></div>
        <div class="form-field" data-cash-account-field><label>خزنة رد المبلغ</label><select name="account">${cashAccountOptions(sale.payment === "نقدي" || sale.payment === "آجل" ? "الخزينة الرئيسية" : sale.payment)}</select></div>
        <div class="form-field"><label>تاريخ المرتجع</label><input name="date" type="date" value="${today()}"></div>
        <div class="form-field full"><label class="required">سبب المرتجع</label><input name="reason" required placeholder="مثال: استرجاع العميل للطلب"></div>
      </div>
      <div class="alert-item" style="margin-top:14px"><div class="alert-badge blue">≋</div><div><strong>تنبيه حسابي</strong><span>إذا كان على العميل مديونية، يتم خصم جزء الفاتورة غير المسدد أولًا، ثم يتم رد أو حفظ صافي المستحق حسب الاختيار.</span></div></div>
      <div class="form-actions"><button class="btn" type="submit">اعتماد فاتورة المرتجع</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
  setTimeout(updateSaleReturnSummary, 0);
}

function processSaleReturn(id, { account, date, reason }) {
  const sale = data.sales.find(item => item.id === id);
  if (!sale || ["ملغاة","مرتجع"].includes(sale.status)) return toast("الفاتورة غير متاحة كمرتجع.", "error");
  const returnableLines = saleReturnableLines(sale);
  const form = document.getElementById("sale-return-form");
  const formData = form ? Object.fromEntries(new FormData(form).entries()) : {};
  const selectedLines = selectedReturnLinesFromForm(formData, returnableLines, saleLineNet);
  if (!selectedLines.length) return toast("حدد كمية لصنف واحد على الأقل.", "error");
  const { returnAmount, debtReduction, replacement, customerDue } = saleReturnCalculation(sale, selectedLines, formData.replacementDeduction);
  const total = Math.max(1, Number(sale.total || 0));
  const returnId = nextId("RET-", data.returns);
  const returnInvoiceId = `RINV-${returnId.replace(/\D/g, "").padStart(3, "0")}`;
  const settlement = formData.settlement || "cash";
  selectedLines.forEach(line => {
    const book = getBook(line.bookId);
    if (book) {
      const before = book.stock;
      book.stock += Number(line.qty || 0);
      recordStockMovement(book, "مرتجع مبيعات", Number(line.qty || 0), before, book.stock, sale.id, reason || "مرتجع فاتورة");
    }
  });
  const customer = getCustomer(sale.customerId);
  if (customer) {
    customer.balance = Number(customer.balance || 0) - debtReduction;
    if (settlement === "customer-credit") customer.balance = Number(customer.balance || 0) - customerDue;
    if (settlement === "debt-only") customer.balance = Math.max(0, Number(customer.balance || 0) - customerDue);
    if (settlement === "no-settlement") customer.balance = Number(customer.balance || 0) - customerDue;
    const pts = Math.floor(Number(sale.pointsAwarded || 0) * returnAmount / total);
    if (pts) customer.points = Math.max(0, Number(customer.points || 0) - pts);
  }
  if (settlement === "cash" && customerDue > 0) {
    data.cash.push({ id: nextId("TX-", data.cash), date: date || today(), type: "صرف", locked: true, account: normalizeCashAccountName(account) || "الخزينة الرئيسية", party: customer?.name || "عميل", amount: Number(customerDue.toFixed(2)), category: "مرتجع مبيعات", note: `فاتورة مرتجع ${returnInvoiceId} من ${sale.id} — ${reason || ""}`, returnId });
  }
  const fullyReturned = isFullyReturned(sale.lines || [], selectedLines, returnedQuantityMap("sale", sale.id));
  if (fullyReturned) {
    const shipment = shipmentForSale(sale.id);
    if (shipment) { shipment.status = "مرتجع"; shipment.updated = new Date().toISOString(); shipment.updatedAt = shipment.updated; }
    if (sale.onlineOrderId) {
      const order = data.onlineOrders.find(o => o.id === sale.onlineOrderId);
      if (order) { order.status = "مرتجع"; order.updatedAt = new Date().toISOString(); }
    }
  }
  sale.status = fullyReturned ? "مرتجع" : "مرتجع جزئي";
  sale.paid = Math.max(0, Number(sale.paid || 0) - customerDue - replacement);
  sale.remaining = Math.max(0, Number(sale.remaining || 0) - debtReduction);
  sale.returnedPaid = Number(sale.returnedPaid || 0) + customerDue + replacement;
  sale.returnedRemaining = Number(sale.returnedRemaining || 0) + debtReduction;
  sale.returnedAt = new Date().toISOString();
  sale.returnReason = reason || "";
  const balanceEffect = ["customer-credit", "debt-only", "no-settlement"].includes(settlement) ? -customerDue - debtReduction : -debtReduction;
  const items = selectedLines.map(line => ({ bookId: line.bookId, sourceInvoiceId: sale.id, sourceInvoiceNo: sale.id, lineIndex: line.lineIndex, qty: Number(line.qty || 0), unitPrice: Number(line.unitValue || 0), total: Number(line.amount || 0), reason: reason || "" }));
  data.returns.push({
    id: returnId, returnNo: returnInvoiceId, returnInvoiceId, type: "sales_return", mode: "from_invoice", accountType: "customer", accountId: sale.customerId,
    documentId: sale.id, sourceDocuments: [sale.id], date: date || today(), partyId: sale.customerId, items,
    subtotal: Number(returnAmount.toFixed(2)), amount: Number(returnAmount.toFixed(2)), debtReduction: Number(debtReduction.toFixed(2)), replacementDeduction: Number(replacement.toFixed(2)),
    customerDue: Number(customerDue.toFixed(2)), settlementType: settlement, settlement, paidAmount: settlement === "cash" ? Number(customerDue.toFixed(2)) : 0, balanceEffect: Number(balanceEffect.toFixed(2)), account: settlement === "cash" ? normalizeCashAccountName(account) || "الخزينة الرئيسية" : "",
    reason: reason || "", notes: "", lines: selectedLines, createdBy: currentUser?.name || currentUser?.username || "النظام", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "معتمد", deletedAt: null
  });
  saveData("فاتورة مرتجع مبيعات", "المرتجعات", returnInvoiceId);
  closeModal();
  currentView === "returns" ? renderReturns() : showSalesList();
  toast(`تم اعتماد فاتورة المرتجع ${returnInvoiceId} وتحديث حساب العميل.`);
}

function processCustomerSaleReturn(customerId, { account, date, reason, settlement, replacementDeduction }) {
  const customer = getCustomer(customerId);
  if (!customer) return toast("يجب اختيار عميل مسجل لفاتورة المرتجع.", "error");
  const returnableLines = customerReturnableSaleLines(customerId);
  const form = document.getElementById("sale-customer-return-form");
  const formData = form ? Object.fromEntries(new FormData(form).entries()) : {};
  const selectedLines = selectedCustomerReturnLinesFromForm(formData, returnableLines);
  if (!selectedLines.length) return toast("حدد كمية لصنف واحد على الأقل.", "error");
  const { returnAmount, debtReduction, replacement, customerDue } = customerSaleReturnCalculation(selectedLines, replacementDeduction);
  const returnId = nextId("RET-", data.returns);
  const returnInvoiceId = nextReturnNo("SR-");
  const sourceSaleIds = [...new Set(selectedLines.map(line => line.documentId))];

  selectedLines.forEach(line => {
    const book = getBook(line.bookId);
    if (book) {
      const before = book.stock;
      book.stock += Number(line.qty || 0);
      recordStockMovement(book, "مرتجع مبيعات", Number(line.qty || 0), before, book.stock, returnInvoiceId, `مرتجع من فاتورة ${line.documentId}`);
    }
  });

  sourceSaleIds.forEach(saleId => {
    const sale = data.sales.find(item => item.id === saleId);
    if (!sale) return;
    const selectedForSale = selectedLines.filter(line => line.documentId === saleId);
    const saleReturnAmount = selectedForSale.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const saleDebtReduction = Math.min(Number(sale.remaining || 0), (Number(sale.remaining || 0) + Number(sale.returnedRemaining || 0)) * saleReturnAmount / Math.max(1, Number(sale.total || 0)));
    const paidImpact = returnAmount > 0 ? (customerDue + replacement) * saleReturnAmount / returnAmount : 0;
    const fullyReturned = isFullyReturned(sale.lines || [], selectedForSale, returnedQuantityMap("sale", sale.id));
    sale.status = fullyReturned ? "مرتجع" : "مرتجع جزئي";
    sale.remaining = Math.max(0, Number(sale.remaining || 0) - saleDebtReduction);
    sale.paid = Math.max(0, Number(sale.paid || 0) - paidImpact);
    sale.returnedRemaining = Number(sale.returnedRemaining || 0) + saleDebtReduction;
    sale.returnedPaid = Number(sale.returnedPaid || 0) + paidImpact;
    sale.returnedAt = new Date().toISOString();
    sale.returnReason = reason || "";
    if (fullyReturned) {
      const shipment = shipmentForSale(sale.id);
      if (shipment) { shipment.status = "مرتجع"; shipment.updated = new Date().toISOString(); shipment.updatedAt = shipment.updated; }
      if (sale.onlineOrderId) {
        const order = data.onlineOrders.find(o => o.id === sale.onlineOrderId);
        if (order) { order.status = "مرتجع"; order.updatedAt = new Date().toISOString(); }
      }
    }
  });

  customer.balance = Number(customer.balance || 0) - debtReduction;
  if (settlement === "customer-credit") customer.balance = Number(customer.balance || 0) - customerDue;
  if (settlement === "debt-only") customer.balance = Math.max(0, Number(customer.balance || 0) - customerDue);
  if (settlement === "no-settlement") customer.balance = Number(customer.balance || 0) - customerDue;
  if (settlement === "cash" && customerDue > 0) {
    data.cash.push({ id: nextId("TX-", data.cash), date: date || today(), type: "صرف", locked: true, account: normalizeCashAccountName(account) || "الخزينة الرئيسية", party: customer.name, amount: Number(customerDue.toFixed(2)), category: "مرتجع مبيعات", note: `فاتورة مرتجع ${returnInvoiceId} — ${reason || ""}`, returnId });
  }

  const balanceEffect = ["customer-credit", "debt-only", "no-settlement"].includes(settlement) ? -customerDue - debtReduction : -debtReduction;
  const items = selectedLines.map(line => ({
    bookId: line.bookId,
    sourceInvoiceId: line.documentId,
    sourceInvoiceNo: line.sourceInvoiceNo || line.documentId,
    lineIndex: line.lineIndex,
    qty: Number(line.qty || 0),
    unitPrice: Number(line.unitPrice || line.unitValue || 0),
    total: Number(line.amount || line.total || 0),
    reason: reason || ""
  }));
  data.returns.push({
    id: returnId, returnNo: returnInvoiceId, returnInvoiceId, type: "sales_return", mode: "by_account", accountType: "customer", accountId: customerId,
    documentId: sourceSaleIds.length === 1 ? sourceSaleIds[0] : "متعدد", sourceDocuments: sourceSaleIds,
    date: date || today(), partyId: customerId, items, subtotal: Number(returnAmount.toFixed(2)), amount: Number(returnAmount.toFixed(2)),
    debtReduction: Number(debtReduction.toFixed(2)), replacementDeduction: Number(replacement.toFixed(2)), customerDue: Number(customerDue.toFixed(2)),
    settlementType: settlement, settlement, paidAmount: settlement === "cash" ? Number(customerDue.toFixed(2)) : 0, balanceEffect: Number(balanceEffect.toFixed(2)),
    account: settlement === "cash" ? normalizeCashAccountName(account) || "الخزينة الرئيسية" : "",
    reason: reason || "", notes: "", lines: selectedLines, createdBy: currentUser?.name || currentUser?.username || "النظام", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "معتمد", deletedAt: null
  });
  saveData("فاتورة مرتجع مبيعات حسب العميل", "المرتجعات", returnInvoiceId);
  closeModal();
  renderReturns();
  toast(`تم اعتماد فاتورة المرتجع ${returnInvoiceId} وربطها بحساب العميل.`);
}

function processSupplierPurchaseReturn(supplierId, { account, date, reason, settlement, notes }) {
  const supplier = getSupplier(supplierId);
  if (!supplier) return toast("يجب اختيار مورد مسجل لمرتجع المشتريات.", "error");
  const returnableLines = supplierReturnablePurchaseLines(supplierId);
  const form = document.getElementById("purchase-supplier-return-form");
  const formData = form ? Object.fromEntries(new FormData(form).entries()) : {};
  const selectedLines = selectedSupplierReturnLinesFromForm({ ...formData, reason }, returnableLines);
  if (!selectedLines.length) return toast("حدد كمية لصنف واحد على الأقل.", "error");
  for (const line of selectedLines) {
    const sourceLine = returnableLines.find(row => row.purchaseId === line.documentId && Number(row.lineIndex) === Number(line.lineIndex));
    if (!sourceLine || Number(line.qty || 0) > Number(sourceLine.remaining || 0)) return toast("لا يمكن إرجاع كمية أكبر من الكمية المتاحة.", "error");
    const book = getBook(line.bookId);
    if (book && Number(book.stock || 0) < Number(line.qty || 0)) return toast(`لا يمكن تسجيل المرتجع لأن رصيد «${book.name}» أقل من الكمية المطلوبة.`, "error");
  }
  const subtotal = selectedLines.reduce((sum, line) => sum + Number(line.amount || line.total || 0), 0);
  const returnId = nextId("RET-", data.returns);
  const returnNo = nextReturnNo("PR-");
  const settledByCash = settlement === "cash";
  const balanceEffect = settledByCash ? 0 : -subtotal;
  const paidAmount = settledByCash ? subtotal : 0;
  const now = new Date().toISOString();
  selectedLines.forEach(line => {
    const book = getBook(line.bookId);
    if (book) {
      const before = Number(book.stock || 0);
      book.stock = before - Number(line.qty || 0);
      recordStockMovement(book, "مرتجع مشتريات مستقل", -Number(line.qty || 0), before, book.stock, returnNo, `مرتجع للمورد ${supplier.name} من مستند ${line.documentId}`);
    }
  });
  const sourcePurchaseIds = [...new Set(selectedLines.map(line => line.documentId))];
  sourcePurchaseIds.forEach(purchaseId => {
    const purchase = data.purchases.find(item => item.id === purchaseId);
    if (!purchase) return;
    const selectedForPurchase = selectedLines.filter(line => line.documentId === purchaseId);
    const fullyReturned = isFullyReturned(purchase.lines || [], selectedForPurchase, returnedQuantityMap("purchase", purchase.id));
    purchase.status = fullyReturned ? "مرتجع" : "مرتجع جزئي";
    const purchaseAmount = selectedForPurchase.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const total = Math.max(1, Number(purchase.total || 0));
    const remainingReduction = Math.min(Number(purchase.remaining || 0), (Number(purchase.remaining || 0) + Number(purchase.returnedRemaining || 0)) * purchaseAmount / total);
    const paidImpact = subtotal > 0 ? paidAmount * purchaseAmount / subtotal : 0;
    purchase.remaining = Math.max(0, Number(purchase.remaining || 0) - remainingReduction);
    purchase.paid = Math.max(0, Number(purchase.paid || 0) - paidImpact);
    purchase.returnedRemaining = Number(purchase.returnedRemaining || 0) + remainingReduction;
    purchase.returnedPaid = Number(purchase.returnedPaid || 0) + paidImpact;
    purchase.returnedAt = now;
    purchase.returnReason = reason || "";
  });
  if (balanceEffect) supplier.balance = Number(supplier.balance || 0) + balanceEffect;
  if (paidAmount > 0) {
    data.cash.push({ id: nextId("TX-", data.cash), date: date || today(), type: "قبض", locked: true, account: normalizeCashAccountName(account) || "الخزينة الرئيسية", party: supplier.name, amount: Number(paidAmount.toFixed(2)), category: "مرتجع مشتريات", note: `مرتجع مشتريات مستقل ${returnNo} — ${reason || ""}`, returnId });
  }
  const items = selectedLines.map(line => ({
    bookId: line.bookId,
    sourceInvoiceId: line.documentId,
    sourceInvoiceNo: line.sourceInvoiceNo || line.documentId,
    lineIndex: line.lineIndex,
    qty: Number(line.qty || 0),
    unitPrice: Number(line.unitPrice || line.unitValue || 0),
    total: Number(line.amount || line.total || 0),
    reason: reason || ""
  }));
  data.returns.push({
    id: returnId,
    returnNo,
    returnInvoiceId: returnNo,
    type: "purchase_return",
    mode: "by_account",
    accountType: "supplier",
    accountId: supplierId,
    partyId: supplierId,
    documentId: sourcePurchaseIds.length === 1 ? sourcePurchaseIds[0] : "متعدد",
    sourceDocuments: sourcePurchaseIds,
    date: date || today(),
    items,
    lines: selectedLines,
    subtotal: Number(subtotal.toFixed(2)),
    amount: Number(subtotal.toFixed(2)),
    settlementType: settlement,
    settlement,
    paidAmount: Number(paidAmount.toFixed(2)),
    balanceEffect: Number(balanceEffect.toFixed(2)),
    supplierDue: Number((settledByCash ? 0 : subtotal).toFixed(2)),
    notes: notes || "",
    reason: reason || "",
    account: settledByCash ? normalizeCashAccountName(account) || "الخزينة الرئيسية" : "",
    createdBy: currentUser?.name || currentUser?.username || "النظام",
    createdAt: now,
    updatedAt: now,
    status: "معتمد",
    deletedAt: null
  });
  saveData("مرتجع مشتريات مستقل حسب المورد", "المرتجعات", returnNo);
  closeModal();
  renderReturns();
  toast(`تم اعتماد مرتجع المشتريات ${returnNo} وربطه بحساب المورد.`);
}

function deleteSale(id) {
  const sale = data.sales.find(item => item.id === id);
  if (!sale || sale.status !== "ملغاة") return toast("يجب إلغاء الفاتورة قبل حذفها.", "error");
  if (!confirm(`حذف الفاتورة الملغاة ${id} من العرض؟ سيظل الحدث مسجلًا بسجل العمليات.`)) return;
  sale.deletedAt = new Date().toISOString();
  saveData("حذف فاتورة ملغاة", "المبيعات", id);
  showSalesList();
  toast("تم حذف الفاتورة الملغاة.");
}

function viewPurchase(id) {
  const purchase = data.purchases.find(item => item.id === id);
  if (!purchase) return;
  openModal(`مستند ${purchase.id}`, "تفاصيل المشتريات", `
    <div class="metric-strip">
      <div class="mini-metric"><span>الإجمالي</span><strong>${money(purchase.total)}</strong></div>
      <div class="mini-metric"><span>المدفوع</span><strong>${money(purchase.paid || 0)}</strong></div>
      <div class="mini-metric"><span>المتبقي</span><strong>${money(purchase.remaining || 0)}</strong></div>
      <div class="mini-metric"><span>فاتورة المورد</span><strong>${esc(purchase.supplierInvoiceNumber || "—")}</strong></div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الغلاف</th><th>خصم المورد</th><th>سعر شراء النسخة</th><th>إجمالي التكلفة</th><th>Batch</th></tr></thead><tbody>
    ${(purchase.lines || []).map(line => `<tr><td>${esc(getBook(line.bookId)?.name || line.bookId)}</td><td>${line.qty || line.quantity}</td><td class="money">${money(line.coverPriceAtPurchase ?? productCoverPrice(getBook(line.bookId)))}</td><td>${Number(line.supplierDiscountPercent ?? line.discount ?? 0)}%</td><td class="money">${money(line.unitPurchaseCost ?? line.cost)}</td><td class="money">${money(line.totalCost ?? purchaseLineNet(line, line.qty))}</td><td>${esc(line.batchId || "—")}</td></tr>`).join("") || `<tr><td colspan="7" class="text-center muted">مستند تجريبي قديم بدون بنود تفصيلية.</td></tr>`}
    </tbody></table></div>
    <div class="form-actions"><button class="btn" data-action="print-purchase" data-id="${purchase.id}" data-format="a4">طباعة A4</button><button class="btn secondary" data-action="print-purchase" data-id="${purchase.id}" data-format="thermal">طباعة حرارية</button>${!["ملغاة","مرتجع","بانتظار الفحص"].includes(purchase.status) ? `<button class="btn ghost" data-action="return-purchase" data-id="${purchase.id}">تسجيل مرتجع</button>` : ""}<button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
}

function cancelPurchase(id) {
  const purchase = data.purchases.find(item => item.id === id);
  if (purchase?.status === "مرتجع جزئي") return toast("لا يمكن إلغاء مستند عليه مرتجع جزئي. أكمل المرتجع من شاشة المرتجعات أو راجع السجل.", "error");
  if (!purchase || purchase.status === "ملغاة" || !confirm(`سيتم إلغاء المستند ${id} وخصم كمياته من المخزون. هل أنت متأكد؟`)) return;
  for (const line of (purchase.status === "مستلمة" ? (purchase.lines || []) : [])) {
    const book = getBook(line.bookId);
    if (book && book.stock < Number(line.qty || 0)) return toast(`لا يمكن الإلغاء لأن رصيد «${book.name}» أقل من كمية المستند.`, "error");
  }
  (purchase.status === "مستلمة" ? (purchase.lines || []) : []).forEach(line => {
    const book = getBook(line.bookId);
    if (book) { const before = book.stock; book.stock -= Number(line.qty || 0); recordStockMovement(book, purchase.type === "أمانة" ? "إلغاء أمانة" : "إلغاء شراء", -Number(line.qty || 0), before, book.stock, purchase.id, "إلغاء المستند"); }
  });
  const supplier = getSupplier(purchase.supplierId);
  if (supplier && purchase.type === "شراء") supplier.balance = Math.max(0, Number(supplier.balance || 0) - Number(purchase.remaining || 0));
  if (Number(purchase.paid || 0) > 0) {
    data.cash.push({
      id: nextId("TX-", data.cash),
      date: today(),
      type: "قبض",
      locked: true,
      account: "الخزينة الرئيسية",
      party: supplier?.name || "مورد",
      amount: Number(purchase.paid),
      category: "مرتجع مشتريات",
      note: `استرداد قيمة المستند الملغى ${purchase.id}`
    });
  }
  purchase.status = "ملغاة";
  purchase.cancelledAt = new Date().toISOString();
  saveData("إلغاء فاتورة شراء", "المشتريات", id);
  showPurchasesList();
  toast("تم إلغاء المستند وتحديث المخزون.");
}

function purchaseReturnModal(id) {
  const purchase = data.purchases.find(item => item.id === id);
  if (!purchase || ["ملغاة","مرتجع"].includes(purchase.status)) return toast("المستند غير متاح كمرتجع.", "error");
  const returnableLines = purchaseReturnableLines(purchase);
  if (!returnableLines.length) return toast("لا توجد كميات متاحة للمرتجع في هذا المستند.", "error");
  openModal(`مرتجع مستند ${id}`, "مرتجعات المشتريات", `
    <form id="purchase-return-form" data-id="${id}">
      <div class="alert-item" style="margin-bottom:15px"><div class="alert-badge red">↶</div><div><strong>${esc(getSupplier(purchase.supplierId)?.name || "مورد")}</strong><span>اختر الأصناف والكميات المراد إرجاعها للمورد فقط.</span></div></div>
      <div class="table-wrap" style="margin-bottom:14px"><table><thead><tr><th>الصنف</th><th>المستلم</th><th>تم إرجاعه</th><th>المتاح</th><th>كمية المرتجع</th><th>قيمة المتاح</th></tr></thead><tbody>
        ${returnableLines.map(line => `<tr><td>${esc(getBook(line.bookId)?.name || line.bookId)}</td><td>${Number(line.qty || 0).toLocaleString("ar-EG")}</td><td>${Number(line.returnedQty || 0).toLocaleString("ar-EG")}</td><td>${Number(line.remaining || 0).toLocaleString("ar-EG")}</td><td><input name="returnQty-${line.lineIndex}" type="number" min="0" max="${line.remaining}" value="0"></td><td class="money">${money(purchaseLineNet(line, line.remaining))}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="form-grid">
        <div class="form-field"><label>رقم فاتورة المورد</label><input name="supplierInvoiceNumber" value="${esc(purchase.supplierInvoiceNumber || "")}" placeholder="رقم فاتورة المورد الأصلية"></div>
        <div class="form-field"><label>رقم إشعار/فاتورة مرتجع المورد</label><input name="supplierReturnInvoiceNumber" placeholder="اختياري"></div>
        <div class="form-field"><label>خزنة استرداد المبلغ</label><select name="account">${cashAccountOptions("الخزينة الرئيسية")}</select></div>
        <div class="form-field"><label>تاريخ المرتجع</label><input name="date" type="date" value="${today()}"></div>
        <div class="form-field full"><label class="required">سبب المرتجع</label><input name="reason" required placeholder="مثال: إرجاع للمورد"></div>
      </div>
      <div class="form-actions"><button class="btn" type="submit">اعتماد المرتجع</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
    </form>`);
}

function processPurchaseReturn(id, { account, date, reason, supplierInvoiceNumber, supplierReturnInvoiceNumber }) {
  const purchase = data.purchases.find(item => item.id === id);
  if (!purchase || ["ملغاة","مرتجع"].includes(purchase.status)) return toast("المستند غير متاح كمرتجع.", "error");
  const returnableLines = purchaseReturnableLines(purchase);
  const form = document.getElementById("purchase-return-form");
  const formData = form ? Object.fromEntries(new FormData(form).entries()) : {};
  const selectedLines = selectedReturnLinesFromForm(formData, returnableLines, purchaseLineNet);
  if (!selectedLines.length) return toast("حدد كمية لصنف واحد على الأقل.", "error");
  for (const line of selectedLines) {
    const book = getBook(line.bookId);
    if (book && book.stock < Number(line.qty || 0)) return toast(`لا يمكن تسجيل المرتجع لأن رصيد «${book.name}» أقل من الكمية المطلوبة.`, "error");
  }
  selectedLines.forEach(line => {
    const book = getBook(line.bookId);
    if (book) {
      const before = book.stock;
      book.stock -= Number(line.qty || 0);
      recordStockMovement(book, purchase.type === "أمانة" ? "مرتجع أمانة" : "مرتجع مشتريات", -Number(line.qty || 0), before, book.stock, purchase.id, reason || "مرتجع مشتريات");
    }
  });
  const returnAmount = selectedLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const total = Math.max(1, Number(purchase.total || 0));
  const paidBase = Number(purchase.paid || 0) + Number(purchase.returnedPaid || 0);
  const remainingBase = Number(purchase.remaining || 0) + Number(purchase.returnedRemaining || 0);
  const paidRefund = Math.min(Number(purchase.paid || 0), paidBase * returnAmount / total);
  const remainingReduction = Math.min(Number(purchase.remaining || 0), remainingBase * returnAmount / total);
  const returnId = nextId("RET-", data.returns);
  const supplier = getSupplier(purchase.supplierId);
  if (supplier && purchase.type === "شراء") supplier.balance = Math.max(0, Number(supplier.balance || 0) - remainingReduction);
  if (paidRefund > 0) {
    data.cash.push({ id: nextId("TX-", data.cash), date: date || today(), type: "قبض", locked: true, account: normalizeCashAccountName(account) || "الخزينة الرئيسية", party: supplier?.name || "مورد", amount: Number(paidRefund.toFixed(2)), category: "مرتجع مشتريات", note: `مرتجع مستند ${purchase.id} — ${reason || ""}`, returnId });
  }
  const fullyReturned = isFullyReturned(purchase.lines || [], selectedLines, returnedQuantityMap("purchase", purchase.id));
  purchase.status = fullyReturned ? "مرتجع" : "مرتجع جزئي";
  purchase.paid = Math.max(0, Number(purchase.paid || 0) - paidRefund);
  purchase.remaining = Math.max(0, Number(purchase.remaining || 0) - remainingReduction);
  purchase.returnedPaid = Number(purchase.returnedPaid || 0) + paidRefund;
  purchase.returnedRemaining = Number(purchase.returnedRemaining || 0) + remainingReduction;
  purchase.returnedAt = new Date().toISOString();
  purchase.returnReason = reason || "";
  data.returns.push({
    id: returnId,
    returnNo: supplierReturnInvoiceNumber || nextReturnNo("PR-"),
    returnInvoiceId: supplierReturnInvoiceNumber || nextReturnNo("PR-"),
    type: "purchase_return",
    mode: "from_invoice",
    accountType: "supplier",
    accountId: purchase.supplierId,
    documentId: purchase.id,
    sourceDocuments: [purchase.id],
    supplierInvoiceNumber: supplierInvoiceNumber || purchase.supplierInvoiceNumber || "",
    supplierReturnInvoiceNumber: supplierReturnInvoiceNumber || "",
    date: date || today(),
    partyId: purchase.supplierId,
    items: selectedLines.map(line => ({ bookId: line.bookId, sourceInvoiceId: purchase.id, sourceInvoiceNo: supplierInvoiceNumber || purchase.supplierInvoiceNumber || purchase.id, lineIndex: line.lineIndex, qty: Number(line.qty || 0), unitPrice: Number(line.unitValue || 0), total: Number(line.amount || 0), reason: reason || "" })),
    subtotal: Number(returnAmount.toFixed(2)),
    amount: Number(returnAmount.toFixed(2)),
    settlementType: paidRefund > 0 ? "cash" : "account-credit",
    settlement: paidRefund > 0 ? "cash" : "account-credit",
    paidAmount: Number(paidRefund.toFixed(2)),
    balanceEffect: Number((-remainingReduction).toFixed(2)),
    reason: reason || "",
    lines: selectedLines,
    createdBy: currentUser?.name || currentUser?.username || "النظام",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "معتمد",
    deletedAt: null
  });
  saveData("مرتجع مشتريات", "المشتريات", purchase.id);
  closeModal();
  currentView === "returns" ? renderReturns() : showPurchasesList();
  toast("تم تسجيل مرتجع المشتريات وتحديث المخزون والخزنة.");
}

function receivePurchase(id) {
  const purchase = data.purchases.find(item => item.id === id);
  if (!purchase || purchase.status !== "بانتظار الفحص") return toast("المستند غير متاح للاستلام.", "error");
  (purchase.lines || []).forEach(line => {
    const book = getBook(line.bookId);
    if (book) { const before = book.stock; book.stock += Number(line.qty || 0); recordStockMovement(book, purchase.type === "أمانة" ? "استلام أمانة" : "استلام شراء", Number(line.qty || 0), before, book.stock, purchase.id, "اعتماد الفحص والاستلام"); }
  });
  purchase.status = "مستلمة";
  purchase.receivedAt = new Date().toISOString();
  saveData("اعتماد استلام مشتريات", "المشتريات", id);
  showPurchasesList();
  toast("تم اعتماد الاستلام وتحديث المخزون.");
}

function deletePurchase(id) {
  const purchase = data.purchases.find(item => item.id === id);
  if (!purchase || purchase.status !== "ملغاة") return toast("يجب إلغاء المستند أولًا.", "error");
  if (!confirm(`هل تريد حذف المستند الملغى ${id}؟`)) return;
  purchase.deletedAt = new Date().toISOString();
  saveData("حذف مستند شراء ملغى", "المشتريات", id);
  showPurchasesList();
  toast("تم حذف المستند الملغى.");
}

function showTrialBalance() {
  const receipts = activeCash().filter(item => item.type === "قبض").reduce((sum, item) => sum + item.amount, 0);
  const payments = activeCash().filter(item => item.type === "صرف").reduce((sum, item) => sum + item.amount, 0);
  const inventory = data.books.reduce((sum, book) => sum + productInventorySummary(book.id).currentInventoryValue, 0);
  const customers = data.customers.reduce((sum, item) => sum + item.balance, 0);
  const suppliers = data.suppliers.reduce((sum, item) => sum + item.balance, 0);
  openModal("ميزان المراجعة المبسط", "التقارير المحاسبية", `
    <div class="table-wrap"><table><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>
      <tr><td>الخزائن والبنوك</td><td>${money(Math.max(0, receipts - payments))}</td><td>—</td></tr>
      <tr><td>المخزون</td><td>${money(inventory)}</td><td>—</td></tr>
      <tr><td>العملاء</td><td>${money(customers)}</td><td>—</td></tr>
      <tr><td>الموردون</td><td>—</td><td>${money(suppliers)}</td></tr>
      <tr><td>المصروفات</td><td>${money(payments)}</td><td>—</td></tr>
      <tr><td>الإيرادات المحصلة</td><td>—</td><td>${money(receipts)}</td></tr>
    </tbody></table></div>
    <p class="muted" style="font-size:9px">هذا ميزان تشغيلي مبسط. الميزان القانوني يحتاج دليل حسابات وقيود مزدوجة كاملة ومراجعة محاسب.</p>`);
}

function showChartOfAccounts() {
  const accounts = [
    ["1", "الأصول", "رئيسي"], ["1101", "الخزينة الرئيسية", "فرعي"], ["1102", "البنك الأهلي", "فرعي"],
    ["1201", "العملاء", "فرعي"], ["1301", "المخزون", "فرعي"], ["2", "الالتزامات", "رئيسي"],
    ["2101", "الموردون", "فرعي"], ["3", "حقوق الملكية", "رئيسي"], ["4", "الإيرادات", "رئيسي"],
    ["4101", "المبيعات", "فرعي"], ["5", "المصروفات", "رئيسي"], ["5101", "تكلفة المبيعات", "فرعي"],
    ["5201", "مصروفات الشحن", "فرعي"], ["5202", "الرواتب", "فرعي"]
  ];
  openModal("دليل الحسابات المقترح", "الحسابات", `<div class="table-wrap"><table><thead><tr><th>الكود</th><th>الحساب</th><th>النوع</th></tr></thead><tbody>${accounts.map(a => `<tr><td>${a[0]}</td><td>${a[1]}</td><td>${badge(a[2], a[2] === "رئيسي" ? "blue" : "")}</td></tr>`).join("")}</tbody></table></div>`);
}

function topCustomerRows() {
  return data.customers.filter(customer => !customer.deletedAt).map(customer => {
    const sales = activeSalesList().filter(sale => sale.customerId === customer.id);
    const orders = (data.onlineOrders || []).filter(order => !order.deletedAt && (order.customerId === customer.id || normalizePhone(order.phone) === normalizePhone(customer.phone)));
    const returns = (data.returns || []).filter(item => !item.deletedAt && returnKind(item.type) === "sale" && (item.accountId === customer.id || item.partyId === customer.id));
    const receipts = (data.receipts || []).filter(item => item.partyKind === "customer" && item.partyId === customer.id && item.status !== "ملغى");
    const total = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const paid = sales.reduce((sum, sale) => sum + Number(sale.paid ?? sale.total ?? 0), 0) + receipts.filter(item => item.type === "استلام").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const remaining = sales.reduce((sum, sale) => sum + Number(sale.remaining || 0), 0);
    const returnsTotal = returns.reduce((sum, item) => sum + Number(item.subtotal ?? item.amount ?? 0), 0);
    const itemCounts = {};
    sales.forEach(sale => (sale.lines || []).forEach(line => itemCounts[line.bookId] = (itemCounts[line.bookId] || 0) + Number(line.qty || 0)));
    const favItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, qty]) => `${getBook(id)?.name || id} (${qty})`).join("، ");
    const last = sales.map(sale => sale.date).sort().pop() || "";
    return { customer, invoices: sales.length, orders: orders.length, total, paid, remaining, returnsTotal, net: total - returnsTotal, last, avg: sales.length ? total / sales.length : 0, favItems };
  }).filter(row => row.invoices || row.orders || row.total || row.returnsTotal).sort((a, b) => b.net - a.net);
}

function topSupplierRows() {
  return data.suppliers.filter(supplier => !supplier.deletedAt).map(supplier => {
    const purchases = data.purchases.filter(purchase => !purchase.deletedAt && purchase.supplierId === supplier.id && purchase.status !== "ملغاة");
    const returns = (data.returns || []).filter(item => !item.deletedAt && returnKind(item.type) === "purchase" && (item.accountId === supplier.id || item.partyId === supplier.id));
    const receipts = (data.receipts || []).filter(item => item.partyKind === "supplier" && item.partyId === supplier.id && item.status !== "ملغى");
    const total = purchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);
    const paid = purchases.reduce((sum, purchase) => sum + Number(purchase.paid || 0), 0) + receipts.filter(item => item.type === "دفع").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const remaining = purchases.reduce((sum, purchase) => sum + Number(purchase.remaining || 0), 0);
    const returnsTotal = returns.reduce((sum, item) => sum + Number(item.subtotal ?? item.amount ?? 0), 0);
    const itemCounts = {};
    purchases.forEach(purchase => (purchase.lines || []).forEach(line => itemCounts[line.bookId] = (itemCounts[line.bookId] || 0) + Number(line.qty || 0)));
    const favItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, qty]) => `${getBook(id)?.name || id} (${qty})`).join("، ");
    const last = purchases.map(purchase => purchase.date).sort().pop() || "";
    return { supplier, invoices: purchases.length, total, paid, remaining, returnsTotal, net: total - returnsTotal, last, avg: purchases.length ? total / purchases.length : 0, favItems };
  }).filter(row => row.invoices || row.total || row.returnsTotal).sort((a, b) => b.net - a.net);
}

function topCustomersReport() {
  const rows = topCustomerRows();
  return `<div class="toolbar" style="padding:0 0 15px;border-bottom:0"><input type="date" aria-label="من"><input type="date" aria-label="إلى"><select class="filter-select"><option>كل المحافظات</option>${EGYPT_GOVERNORATES.map(g => `<option>${esc(g)}</option>`).join("")}</select><select class="filter-select"><option>كل مصادر الطلب</option><option>تجزئة</option><option>جملة</option><option>متجر إلكتروني</option><option>WhatsApp</option></select></div>
  <div class="table-wrap"><table><thead><tr><th>#</th><th>العميل</th><th>الهاتف</th><th>المحافظة</th><th>الفواتير</th><th>الطلبات</th><th>إجمالي المبيعات</th><th>المدفوع</th><th>المتبقي</th><th>المرتجعات</th><th>صافي التعامل</th><th>آخر شراء</th><th>متوسط الطلب</th><th>أكثر الأصناف</th></tr></thead><tbody>${rows.map((row, index) => `<tr class="clickable-row" data-modal-action="best-customer-detail" data-id="${row.customer.id}"><td>${index + 1}</td><td><strong>${esc(row.customer.name)}</strong><br><span class="muted">${esc(row.customer.id)}</span></td><td dir="ltr">${esc(row.customer.phone || "—")}</td><td>${esc(row.customer.governorate || "—")}</td><td>${row.invoices}</td><td>${row.orders}</td><td class="money">${money(row.total)}</td><td class="money">${money(row.paid)}</td><td class="money">${money(row.remaining)}</td><td class="money">${money(row.returnsTotal)}</td><td class="money">${money(row.net)}</td><td>${fmtDate(row.last)}</td><td class="money">${money(row.avg)}</td><td>${esc(row.favItems || "—")}</td></tr>`).join("") || `<tr><td colspan="14" class="text-center muted">لا توجد تعاملات كافية.</td></tr>`}</tbody></table></div>`;
}

function topSuppliersReport() {
  const rows = topSupplierRows();
  return `<div class="toolbar" style="padding:0 0 15px;border-bottom:0"><input type="date" aria-label="من"><input type="date" aria-label="إلى"><select class="filter-select"><option>كل أنواع الموردين</option><option>كتب</option><option>أدوات مكتبية</option><option>سبلايز</option></select><select class="filter-select"><option>كل حالات الحساب</option><option>له رصيد</option><option>بدون رصيد</option></select></div>
  <div class="table-wrap"><table><thead><tr><th>#</th><th>المورد</th><th>الهاتف</th><th>فواتير الشراء</th><th>إجمالي المشتريات</th><th>المدفوع</th><th>المتبقي</th><th>مرتجعات الشراء</th><th>صافي التعامل</th><th>آخر شراء</th><th>أكثر الأصناف</th><th>متوسط الفاتورة</th></tr></thead><tbody>${rows.map((row, index) => `<tr class="clickable-row" data-modal-action="best-supplier-detail" data-id="${row.supplier.id}"><td>${index + 1}</td><td><strong>${esc(row.supplier.name)}</strong><br><span class="muted">${esc(row.supplier.id)}</span></td><td dir="ltr">${esc(row.supplier.phone || "—")}</td><td>${row.invoices}</td><td class="money">${money(row.total)}</td><td class="money">${money(row.paid)}</td><td class="money">${money(row.remaining)}</td><td class="money">${money(row.returnsTotal)}</td><td class="money">${money(row.net)}</td><td>${fmtDate(row.last)}</td><td>${esc(row.favItems || "—")}</td><td class="money">${money(row.avg)}</td></tr>`).join("") || `<tr><td colspan="12" class="text-center muted">لا توجد تعاملات كافية.</td></tr>`}</tbody></table></div>`;
}

function bestCustomerDetail(id) {
  const customer = getCustomer(id);
  if (!customer) return toast("لم يتم العثور على العميل.", "error");
  openModal(`كشف تفصيلي — ${customer.name}`, "أفضل العملاء", `${voucherPartyPanelMarkup("customer", id)}<div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
}

function bestSupplierDetail(id) {
  const supplier = getSupplier(id);
  if (!supplier) return toast("لم يتم العثور على المورد.", "error");
  openModal(`كشف تفصيلي — ${supplier.name}`, "أفضل الموردين", `${voucherPartyPanelMarkup("supplier", id)}<div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
}

function openReport(index) {
  const activeSales = activeSalesList();
  const soldByBook = {};
  activeSales.forEach(sale => sale.lines.forEach(line => soldByBook[line.bookId] = (soldByBook[line.bookId] || 0) + Number(line.qty || 0)));
  const expenses = data.cash.filter(item => item.type === "صرف" && !item.deletedAt).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const salesTotal = activeSales.reduce((sum, s) => sum + s.total, 0);
  const cogsSummary = salesCogsSummary(activeSales);
  const salesCost = cogsSummary.cost;
  const activeReturns = (data.returns || []).filter(item => !item.deletedAt);
  const salesReturns = activeReturns.filter(item => returnKind(item.type) === "sale");
  const purchaseReturns = activeReturns.filter(item => returnKind(item.type) === "purchase");
  const returnRowsTable = rows => `<div class="table-wrap"><table><thead><tr><th>رقم المرتجع</th><th>الحساب</th><th>التاريخ</th><th>الأصناف</th><th>الإجمالي</th><th>التسوية</th></tr></thead><tbody>${rows.map(item => `<tr><td>${esc(returnNo(item))}</td><td>${esc(returnAccountName(item) || "—")}</td><td>${fmtDate(item.date)}</td><td>${Number(returnItems(item).reduce((sum, line) => sum + Number(line.qty || 0), 0)).toLocaleString("ar-EG")}</td><td class="money">${money(item.subtotal ?? item.amount ?? 0)}</td><td>${esc(returnSettlementLabel(item))}</td></tr>`).join("") || `<tr><td colspan="6" class="text-center muted">لا توجد بيانات.</td></tr>`}</tbody></table></div>`;
  const groupedReturnRows = (rows, kind) => {
    const map = new Map();
    rows.forEach(item => {
      const id = item.accountId || item.partyId || "";
      const name = kind === "supplier" ? getSupplier(id)?.name : getCustomer(id)?.name;
      if (!map.has(id)) map.set(id, { name: name || id || "—", count: 0, amount: 0 });
      const entry = map.get(id);
      entry.count += 1;
      entry.amount += Number(item.subtotal ?? item.amount ?? 0);
    });
    return `<div class="table-wrap"><table><thead><tr><th>الحساب</th><th>عدد المرتجعات</th><th>الإجمالي</th></tr></thead><tbody>${[...map.values()].sort((a,b)=>b.amount-a.amount).map(row => `<tr><td>${esc(row.name)}</td><td>${row.count}</td><td class="money">${money(row.amount)}</td></tr>`).join("") || `<tr><td colspan="3" class="text-center muted">لا توجد بيانات.</td></tr>`}</tbody></table></div>`;
  };
  const returnedBooksReport = () => {
    const map = new Map();
    activeReturns.forEach(item => returnItems(item).forEach(line => {
      if (!map.has(line.bookId)) map.set(line.bookId, { qty: 0, amount: 0 });
      const entry = map.get(line.bookId);
      entry.qty += Number(line.qty || 0);
      entry.amount += Number(line.total || line.amount || 0);
    }));
    return `<div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الكمية المرتجعة</th><th>القيمة</th></tr></thead><tbody>${[...map.entries()].sort((a,b)=>b[1].qty-a[1].qty).map(([id,row]) => `<tr><td>${esc(getBook(id)?.name || id)}</td><td>${row.qty}</td><td class="money">${money(row.amount)}</td></tr>`).join("") || `<tr><td colspan="3" class="text-center muted">لا توجد بيانات.</td></tr>`}</tbody></table></div>`;
  };
  const productProfitabilityReport = () => {
    const map = new Map();
    activeSales.forEach(sale => (sale.lines || []).forEach(line => {
      const id = line.bookId || line.productId;
      if (!map.has(id)) map.set(id, { qty: 0, revenue: 0, cogs: 0, incomplete: 0 });
      const row = map.get(id);
      const lineCogs = saleLineCogs(line);
      row.qty += Number(line.qty || line.quantity || 0);
      row.revenue += saleLineRevenue(line);
      if (lineCogs === null) row.incomplete += 1;
      else row.cogs += lineCogs;
    }));
    return `<div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الكمية</th><th>الإيراد</th><th>COGS FIFO</th><th>الربح الإجمالي</th></tr></thead><tbody>${[...map.entries()].sort((a,b)=>b[1].revenue-a[1].revenue).map(([id,row]) => `<tr><td>${esc(getBook(id)?.name || id)}</td><td>${row.qty}</td><td class="money">${money(row.revenue)}</td><td class="money">${row.incomplete ? "تكلفة غير مكتملة" : money(row.cogs)}</td><td class="money">${row.incomplete ? "غير متاح" : money(row.revenue - row.cogs)}</td></tr>`).join("") || `<tr><td colspan="5" class="text-center muted">لا توجد بيانات.</td></tr>`}</tbody></table></div>`;
  };
  const supplierProfitabilityReport = () => {
    const map = new Map();
    const ensure = id => {
      if (!map.has(id || "unknown")) map.set(id || "unknown", { supplierId: id || "unknown", revenue: 0, cogs: 0, qty: 0, incomplete: 0 });
      return map.get(id || "unknown");
    };
    activeSales.forEach(sale => (sale.lines || []).forEach(line => {
      const qty = Number(line.qty || line.quantity || 0);
      const revenue = saleLineRevenue(line);
      if (Array.isArray(line.batchAllocations) && line.batchAllocations.length && qty > 0) {
        line.batchAllocations.forEach(allocation => {
          if (allocation.batchId === "UNALLOCATED" || allocation.unitCost === null || allocation.unitCost === undefined) {
            ensure(getBook(line.bookId || line.productId)?.supplierId).incomplete += 1;
            return;
          }
          const batch = (data.inventoryBatches || []).find(item => item.batchId === allocation.batchId || item.id === allocation.batchId);
          const row = ensure(batch?.supplierId || getBook(line.bookId || line.productId)?.supplierId);
          const allocQty = Number(allocation.qty || 0);
          row.qty += allocQty;
          row.revenue += revenue * (allocQty / qty);
          row.cogs += allocQty * Number(allocation.unitCost || 0);
        });
      } else {
        const row = ensure(getBook(line.bookId || line.productId)?.supplierId);
        const lineCogs = saleLineCogs(line);
        row.qty += qty;
        row.revenue += revenue;
        if (lineCogs === null) row.incomplete += 1;
        else row.cogs += lineCogs;
      }
    }));
    return `<div class="table-wrap"><table><thead><tr><th>المورد</th><th>الكمية المباعة</th><th>الإيراد المنسوب</th><th>تكلفة الدفعات</th><th>الربح</th></tr></thead><tbody>${[...map.values()].sort((a,b)=>b.revenue-a.revenue).map(row => `<tr><td>${esc(getSupplier(row.supplierId)?.name || row.supplierId || "غير محدد")}</td><td>${Number(row.qty.toFixed(2))}</td><td class="money">${money(row.revenue)}</td><td class="money">${row.incomplete ? "تكلفة غير مكتملة" : money(row.cogs)}</td><td class="money">${row.incomplete ? "غير متاح" : money(row.revenue - row.cogs)}</td></tr>`).join("") || `<tr><td colspan="5" class="text-center muted">لا توجد بيانات.</td></tr>`}</tbody></table></div>`;
  };
  const inventoryValueReport = () => `<div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الرصيد</th><th>متوسط التكلفة</th><th>قيمة المخزون</th><th>حالة التكلفة</th></tr></thead><tbody>${data.books.filter(book => !book.deletedAt).map(book => { const summary = productInventorySummary(book.id); return `<tr><td>${esc(book.name)}</td><td>${summary.currentStockQty}</td><td class="money">${summary.hasIncompleteCost ? "تكلفة غير مكتملة" : money(summary.averageInventoryCost)}</td><td class="money">${summary.hasIncompleteCost ? "تكلفة غير مكتملة" : money(summary.currentInventoryValue)}</td><td>${summary.hasIncompleteCost ? badge("تحتاج مراجعة", "warning") : badge("مكتملة")}</td></tr>`; }).join("")}</tbody></table></div>`;
  const lastPurchaseCostReport = () => `<div class="table-wrap"><table><thead><tr><th>الصنف</th><th>آخر سعر شراء</th><th>سعر الغلاف</th><th>سعر البيع الافتراضي</th></tr></thead><tbody>${data.books.filter(book => !book.deletedAt).map(book => { const summary = productInventorySummary(book.id); return `<tr><td>${esc(book.name)}</td><td class="money">${summary.lastPurchaseCost ? money(summary.lastPurchaseCost) : "غير متاح"}</td><td class="money">${money(productCoverPrice(book))}</td><td class="money">${money(productDefaultSellingPrice(book))}</td></tr>`; }).join("")}</tbody></table></div>`;
  const averageCostReport = () => `<div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الرصيد الحالي</th><th>متوسط تكلفة المخزون</th><th>قيمة المخزون</th></tr></thead><tbody>${data.books.filter(book => !book.deletedAt).map(book => { const summary = productInventorySummary(book.id); return `<tr><td>${esc(book.name)}</td><td>${summary.currentStockQty}</td><td class="money">${summary.hasIncompleteCost ? "تكلفة غير مكتملة" : money(summary.averageInventoryCost)}</td><td class="money">${summary.hasIncompleteCost ? "تكلفة غير مكتملة" : money(summary.currentInventoryValue)}</td></tr>`; }).join("")}</tbody></table></div>`;
  const marginReport = () => `<div class="table-wrap"><table><thead><tr><th>الصنف</th><th>سعر البيع الافتراضي</th><th>متوسط التكلفة</th><th>الهامش المتوقع</th></tr></thead><tbody>${data.books.filter(book => !book.deletedAt).map(book => { const summary = productInventorySummary(book.id); return `<tr><td>${esc(book.name)}</td><td class="money">${money(productDefaultSellingPrice(book))}</td><td class="money">${summary.hasIncompleteCost ? "تكلفة غير مكتملة" : money(summary.averageInventoryCost)}</td><td>${summary.expectedMarginAtDefaultPrice == null ? "غير متاح" : `${summary.expectedMarginAtDefaultPrice.toFixed(1)}%`}</td></tr>`; }).join("")}</tbody></table></div>`;
  const reportBuilders = [
    () => ["المبيعات اليومية والشهرية", `<div class="table-wrap"><table><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th><th>المدفوع</th></tr></thead><tbody>${activeSales.map(s => `<tr><td>${s.id}</td><td>${fmtDate(s.date)}</td><td>${esc(getCustomer(s.customerId)?.name || "")}</td><td>${money(s.total)}</td><td>${money(s.paid ?? s.total)}</td></tr>`).join("")}</tbody></table></div>`],
    () => ["صافي الربح", `<div class="metric-strip"><div class="mini-metric"><span>المبيعات</span><strong>${money(salesTotal)}</strong></div><div class="mini-metric"><span>تكلفة المبيعات FIFO</span><strong>${money(salesCost)}</strong></div><div class="mini-metric"><span>سطور تكلفة غير مكتملة</span><strong>${cogsSummary.incompleteLines}</strong></div><div class="mini-metric"><span>المصروفات</span><strong>${money(expenses)}</strong></div></div><h2>صافي الربح: ${cogsSummary.incompleteLines ? "غير مكتمل بسبب سطور بدون تكلفة مؤكدة" : money(salesTotal - salesCost - expenses)}</h2>`],
    () => ["أكثر الأصناف مبيعًا", `<div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الكمية</th></tr></thead><tbody>${Object.entries(soldByBook).sort((a,b)=>b[1]-a[1]).map(([id,qty])=>`<tr><td>${esc(getBook(id)?.name || id)}</td><td>${qty}</td></tr>`).join("")}</tbody></table></div>`],
    () => ["تقرير إعادة الطلب", booksTable(data.books.filter(book => !book.deletedAt && book.stock <= book.reorder))],
    () => ["تقرير الأصناف الراكدة", booksTable(data.books.filter(book => !book.deletedAt && (!book.lastSale || (Date.now() - new Date(book.lastSale).getTime()) / 86400000 >= data.settings.staleDays)))],
    () => ["مديونية العملاء", `<div class="table-wrap"><table><thead><tr><th>العميل</th><th>الرصيد</th><th>الحد</th></tr></thead><tbody>${data.customers.filter(c => !c.deletedAt && c.balance).map(c => `<tr><td>${esc(c.name)}</td><td>${money(c.balance)}</td><td>${money(c.creditLimit)}</td></tr>`).join("")}</tbody></table></div>`],
    () => ["مديونية الموردين", `<div class="table-wrap"><table><thead><tr><th>المورد</th><th>الرصيد</th><th>مدة السداد</th></tr></thead><tbody>${data.suppliers.filter(s=>!s.deletedAt).map(s => `<tr><td>${esc(s.name)}</td><td>${money(s.balance)}</td><td>${s.terms} يوم</td></tr>`).join("")}</tbody></table></div>`],
    () => ["أداء الخصومات", `<div class="table-wrap"><table><thead><tr><th>الفاتورة</th><th>قبل الخصم</th><th>الخصم</th><th>بعد الخصم</th></tr></thead><tbody>${activeSales.map(s => `<tr><td>${s.id}</td><td>${money(s.subtotal)}</td><td>${money(s.discount)}</td><td>${money(Number(s.subtotal || 0) - Number(s.discount || 0))}</td></tr>`).join("")}</tbody></table></div>`],
    () => ["الموسمية", `<div class="empty-state"><div class="empty-icon">◇</div><h3>الموسم أغسطس – يوليو</h3><p>إجمالي مبيعات البيانات الحالية: ${money(salesTotal)}.</p></div>`],
    () => ["الشحنات المتأخرة", shipmentsTable(data.shipments.filter(s => !s.deletedAt && s.status !== "تم التسليم"))],
    () => ["المرتجعات", returnRowsTable(activeReturns)],
    () => ["مرتجعات المبيعات حسب الفترة", returnRowsTable(salesReturns)],
    () => ["مرتجعات المشتريات حسب الفترة", returnRowsTable(purchaseReturns)],
    () => ["مرتجعات حسب العميل", groupedReturnRows(salesReturns, "customer")],
    () => ["مرتجعات حسب المورد", groupedReturnRows(purchaseReturns, "supplier")],
    () => ["أكثر الأصناف المرتجعة", returnedBooksReport()],
    () => ["تأثير المرتجعات على الأرباح والمخزون", `<div class="metric-strip"><div class="mini-metric"><span>مرتجعات المبيعات</span><strong>${money(salesReturns.reduce((sum,item)=>sum+Number(item.subtotal ?? item.amount ?? 0),0))}</strong></div><div class="mini-metric"><span>مرتجعات المشتريات</span><strong>${money(purchaseReturns.reduce((sum,item)=>sum+Number(item.subtotal ?? item.amount ?? 0),0))}</strong></div><div class="mini-metric"><span>صافي أثر الخزنة</span><strong>${money(activeReturns.reduce((sum,item)=>sum + (returnKind(item.type)==="purchase" ? Number(item.paidAmount||0) : -Number(item.paidAmount||0)),0))}</strong></div></div>${returnedBooksReport()}`],
    () => ["ربحية الصنف", productProfitabilityReport()],
    () => ["ربحية المورد", supplierProfitabilityReport()],
    () => ["قيمة المخزون الحالية", inventoryValueReport()],
    () => ["آخر سعر شراء", lastPurchaseCostReport()],
    () => ["متوسط تكلفة المخزون", averageCostReport()],
    () => ["هامش الربح حسب سعر البيع الحالي", marginReport()],
    () => ["العملاء المتوقفون", `<div class="empty-state"><div class="empty-icon">◇</div><h3>العملاء المتوقفون</h3><p>${data.customers.filter(c=>!c.deletedAt && !activeSales.some(s=>s.customerId===c.id)).length} عميل بلا مبيعات مسجلة.</p></div>`],
    () => ["أفضل العملاء", topCustomersReport()],
    () => ["أفضل الموردين", topSuppliersReport()]
  ];
  const [title, content] = (reportBuilders[index] || reportBuilders[0])();
  openModal(title, "التقارير والتحليلات", `${content}<div class="form-actions"><button class="btn ghost" onclick="window.print()">طباعة / PDF</button><button class="btn ghost" type="button" data-action="close-modal">إغلاق</button></div>`);
}

function exportReportCsv(index) {
  const rows = [["التقرير", "مكتبة دوت كوم"], ["تاريخ التصدير", new Date().toLocaleString("ar-EG")]];
  if (Number(index) === 2) {
    const totals = {};
    data.sales.filter(s=>s.status!=="ملغاة").forEach(s=>s.lines.forEach(l=>totals[l.bookId]=(totals[l.bookId]||0)+Number(l.qty||0)));
    rows.push(["الصنف","الكمية"], ...Object.entries(totals).map(([id,qty])=>[getBook(id)?.name||id,qty]));
  } else if (Number(index) === 24) {
    rows.push(["الترتيب","العميل","الهاتف","المحافظة","عدد الفواتير","عدد الطلبات","إجمالي المبيعات","المدفوع","المتبقي","المرتجعات","صافي التعامل","آخر شراء","متوسط الطلب","أكثر الأصناف"],
      ...topCustomerRows().map((row, i) => [i + 1, row.customer.name, row.customer.phone || "", row.customer.governorate || "", row.invoices, row.orders, row.total, row.paid, row.remaining, row.returnsTotal, row.net, row.last, row.avg, row.favItems]));
  } else if (Number(index) === 25) {
    rows.push(["الترتيب","المورد","الهاتف","عدد فواتير الشراء","إجمالي المشتريات","المدفوع","المتبقي","مرتجعات المشتريات","صافي التعامل","آخر شراء","أكثر الأصناف","متوسط الفاتورة"],
      ...topSupplierRows().map((row, i) => [i + 1, row.supplier.name, row.supplier.phone || "", row.invoices, row.total, row.paid, row.remaining, row.returnsTotal, row.net, row.last, row.favItems, row.avg]));
  } else {
    rows.push(["المرجع","التاريخ","البيان","القيمة"], ...data.sales.filter(s=>s.status!=="ملغاة").map(s=>[s.id,s.date,getCustomer(s.customerId)?.name||"",s.total]));
  }
  const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8" }));
  link.download = `dotcom-report-${index}-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function permissionCheckbox(name, value, title, description, checked) {
  return `<label class="permission-check">
    <input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? "checked" : ""}>
    <span><strong>${esc(title)}</strong><small>${esc(description || value)}</small></span>
  </label>`;
}

function permissionFormMarkup({ scope, id, title, subtitle, perms, inherited }) {
  const viewSet = new Set(perms.views || []);
  const actionSet = new Set(perms.actions || []);
  return `<form id="permission-form" data-scope="${scope}" ${scope === "role" ? `data-role="${esc(id)}"` : `data-username="${esc(id)}"`}>
    <div class="alert-item" style="margin-bottom:16px">
      <div class="alert-badge blue">⚙</div>
      <div><strong>${esc(title)}</strong><span>${esc(subtitle)} · المسموح حاليًا: ${permissionSummary(perms)}</span></div>
      ${inherited ? badge("مخصص", "blue") : badge("افتراضي")}
    </div>
    ${scope === "user" ? `<label class="alert-item" style="cursor:pointer;margin-bottom:16px"><input type="checkbox" name="resetUserPermissions" value="yes" style="width:auto"><div><strong>إلغاء التخصيص لهذا المستخدم</strong><span>عند الحفظ سيتم الرجوع تلقائيًا لصلاحيات الدور.</span></div></label>` : ""}
    <div class="permission-layout">
      <section class="permission-section">
        <div class="card-header compact"><div><h3>الشاشات / الأقسام</h3><p>حدد الصفحات التي تظهر للمستخدم في القائمة الجانبية.</p></div></div>
        <div class="permission-list">
          ${VIEW_DEFINITIONS.map(([key, label, desc]) => permissionCheckbox("views", key, label, desc, viewSet.has(key))).join("")}
        </div>
      </section>
      <section class="permission-section">
        <div class="card-header compact"><div><h3>الإجراءات التفصيلية</h3><p>تحكم في الأزرار والعمليات داخل كل قسم.</p></div></div>
        <div class="permission-action-groups">
          ${PERMISSION_ACTIONS.map(([group, actions]) => `<details open class="permission-group"><summary>${esc(group)}</summary><div class="permission-list">${actions.map(([key, label]) => permissionCheckbox("actions", key, label, key, actionSet.has(key))).join("")}</div></details>`).join("")}
        </div>
      </section>
    </div>
    <div class="form-actions"><button class="btn" type="submit">حفظ الصلاحيات</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>
  </form>`;
}

function customizeRole(role) {
  const info = ROLE_DEFINITIONS.find(item => item.id === role) || { id: role, label: role, scope: "صلاحيات مخصصة" };
  const perms = rolePermissions(role);
  openModal(`صلاحيات دور: ${info.label}`, "الأدوار والصلاحيات", permissionFormMarkup({
    scope: "role",
    id: role,
    title: info.label,
    subtitle: info.scope,
    perms,
    inherited: Boolean(data.settings?.permissions?.roles?.[role])
  }));
}

function customizeUser(username) {
  const user = (data.users || []).find(item => item.username === username);
  if (!user) return toast("لم يتم العثور على المستخدم.", "error");
  const perms = effectivePermissionsForUser(user);
  openModal(`صلاحيات المستخدم: ${user.name || user.username}`, "المستخدمون والصلاحيات", permissionFormMarkup({
    scope: "user",
    id: user.username,
    title: user.name || user.username,
    subtitle: `اسم الدخول: ${user.username} · الدور: ${user.role}`,
    perms,
    inherited: Boolean(data.settings?.permissions?.users?.[user.username])
  }));
}

async function createBackup() {
  if (!serverConnected) return toast("النسخ الاحتياطي على القرص يتطلب تشغيل النظام من START-HERE.cmd.", "error");
  try {
    await saveQueue;
    const response = await fetch("/api/backup", { method: "POST", headers: authHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    toast(`تم إنشاء النسخة الاحتياطية: ${result.file}`);
  } catch (error) {
    toast(error.message || "تعذر إنشاء النسخة الاحتياطية.", "error");
  }
}

async function showRestoreBackups() {
  try {
    const response = await fetch("/api/backups", { headers: authHeaders(), cache:"no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    openModal("استعادة نسخة احتياطية", "أمان البيانات", `<div class="alert-list">${result.backups.map(file=>`<div class="alert-item"><div class="alert-badge blue">▧</div><div><strong>${esc(file.name)}</strong><span>${new Date(file.date).toLocaleString("ar-EG")} · ${Math.ceil(file.size/1024)} KB</span></div><button class="btn ghost small" data-action="restore-backup" data-file="${esc(file.name)}">استعادة</button></div>`).join("")||"<p>لا توجد نسخ.</p>"}</div>`);
  } catch (error) { toast(error.message || "تعذر قراءة النسخ الاحتياطية.", "error"); }
}

async function restoreBackup(file) {
  if (!confirm(`سيتم حفظ نسخة من البيانات الحالية ثم استعادة ${file}. هل تستمر؟`)) return;
  try {
    const response = await fetch("/api/restore", { method:"POST", headers:authHeaders({"Content-Type":"application/json"}), body:JSON.stringify({file}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    dbRevision = result.revision || "";
    closeModal(); await initializeDatabase(); toast("تمت استعادة النسخة الاحتياطية.");
  } catch (error) { toast(error.message || "تعذر الاستعادة.", "error"); }
}

function showAuditLog() {
  openModal("سجل العمليات", "المراجعة والأمان", `
    <div class="toolbar" style="padding:0 0 15px;border-bottom:0">
      <div class="search"><input id="audit-search" autocomplete="off" placeholder="ابحث بالعملية أو المستند أو الموظف أو القسم..."></div>
      <select id="audit-employee" class="filter-select"><option value="">كل الموظفين</option>${[...new Set((data.audit || []).map(row => row.employeeName || row.user).filter(Boolean))].map(name => `<option>${esc(name)}</option>`).join("")}</select>
      <select id="audit-module" class="filter-select"><option value="">كل الأقسام</option>${[...new Set((data.audit || []).map(row => row.moduleName || row.entity).filter(Boolean))].map(name => `<option>${esc(name)}</option>`).join("")}</select>
      <input id="audit-from" type="date">
      <input id="audit-to" type="date">
      <button class="btn ghost small" type="button" data-modal-action="export-audit-log">CSV</button>
    </div>
    <div class="table-wrap" id="audit-log-results">${auditLogTable(data.audit.slice().reverse())}</div>`);
}

function auditLogTable(rows) {
  return `<table><thead><tr><th>Operation ID</th><th>التاريخ</th><th>اليوم</th><th>الوقت</th><th>نوع العملية</th><th>القسم</th><th>الكيان</th><th>رقم المستند</th><th>الموظف</th><th>الدور</th><th>ملاحظات</th></tr></thead><tbody>${rows.map(row => {
    const parts = operationDateParts(row.createdAt || row.date);
    return `<tr><td>${esc(row.operationId || row.id)}</td><td>${fmtDate(row.createdAt || row.date)}</td><td>${esc(row.dayName || parts.dayName)}</td><td>${esc(row.time || parts.time)}</td><td>${esc(row.operationType || row.action)}</td><td>${esc(row.moduleName || row.entity || "—")}</td><td>${esc(row.entityType || row.entity || "—")}</td><td>${esc(row.documentNo || row.entityId || "—")}</td><td>${esc(row.employeeName || row.user || "النظام")}</td><td>${esc(row.employeeRole || row.role || "—")}</td><td>${esc(row.notes || row.action || "—")}</td></tr>`;
  }).join("") || `<tr><td colspan="11" class="text-center muted">لا توجد عمليات مطابقة.</td></tr>`}</tbody></table>`;
}

function filteredAuditRows() {
  const term = normalizeSmartSearch(document.getElementById("audit-search")?.value || "");
  const employee = document.getElementById("audit-employee")?.value || "";
  const module = document.getElementById("audit-module")?.value || "";
  const from = document.getElementById("audit-from")?.value || "";
  const to = document.getElementById("audit-to")?.value || "";
  return (data.audit || []).slice().reverse().filter(row => {
    const created = String(row.createdAt || row.date || "").slice(0, 10);
    if (employee && (row.employeeName || row.user) !== employee) return false;
    if (module && (row.moduleName || row.entity) !== module) return false;
    if (from && created < from) return false;
    if (to && created > to) return false;
    if (!term) return true;
    return normalizeSmartSearch([row.operationId, row.action, row.operationType, row.moduleName, row.entity, row.entityId, row.documentNo, row.employeeName, row.user, row.notes].join(" ")).includes(term);
  });
}

function updateAuditLogResults() {
  const target = document.getElementById("audit-log-results");
  if (target) target.innerHTML = auditLogTable(filteredAuditRows());
}

function exportAuditLogCsv() {
  const rows = [["operationId","operationType","moduleName","entityType","entityId","documentNo","employeeName","employeeRole","date","dayName","time","notes"]];
  filteredAuditRows().forEach(row => rows.push([row.operationId || row.id, row.operationType || row.action, row.moduleName || row.entity, row.entityType || row.entity, row.entityId, row.documentNo || row.entityId, row.employeeName || row.user, row.employeeRole || row.role, row.createdAt || row.date, row.dayName || "", row.time || "", row.notes || ""]));
  const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8" }));
  link.download = `audit-log-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function saveSettings() {
  data.settings.companyName = document.getElementById("setting-name").value;
  data.settings.currency = document.getElementById("setting-currency").value;
  data.settings.seasonStart = Number(document.getElementById("setting-season").value);
  data.settings.staleDays = Number(document.getElementById("setting-stale").value);
  data.settings.approvalDiscount = Number(document.getElementById("setting-discount").value);
  data.settings.allowNegativeStock = document.getElementById("setting-negative").value === "true";
  data.settings.tracking.intervalHours = [1, 3, 6, 12, 24].includes(Number(document.getElementById("tracking-interval")?.value)) ? Number(document.getElementById("tracking-interval")?.value) : 6;
  data.settings.tracking.minIntervalHours = [1, 3, 6, 12, 24].includes(Number(document.getElementById("tracking-min-interval")?.value)) ? Number(document.getElementById("tracking-min-interval")?.value) : data.settings.tracking.intervalHours;
  data.settings.tracking.maxConcurrent = 1;
  data.settings.tracking.minDelaySeconds = Math.max(5, Number(document.getElementById("tracking-min-delay")?.value || 15));
  data.settings.tracking.activeShipmentMaxAgeDays = Math.max(1, Number(data.settings.tracking.activeShipmentMaxAgeDays || 45));
  data.settings.tracking.maxAttempts = Math.max(1, Number(document.getElementById("tracking-max-attempts")?.value || 5));
  data.settings.tracking.noMovementHours = Number(document.getElementById("tracking-no-movement")?.value || data.settings.tracking.noMovementHours || 48);
  data.settings.tracking.complaintNoMovementHours = Number(document.getElementById("tracking-complaint-hours")?.value || data.settings.tracking.complaintNoMovementHours || 72);
  data.settings.tracking.manualPause = document.getElementById("tracking-manual-pause")?.value === "true";
  data.settings.tracking.providerName = TRACKING_PROVIDER_NAME;
  data.settings.tracking.providerType = "Browser Automation";
  data.settings.tracking.providerEndpoint = EGYPT_POST_TRACKING_URL;
  data.settings.tracking.providerMethod = "BROWSER";
  data.settings.tracking.mode = "Browser Automation";
  data.settings.tracking.cost = "Free";
  data.settings.tracking.subscriptionRequired = false;
  data.settings.tracking.apiKeyRequired = false;
  data.settings.tracking.timeoutMs = 45000;
  data.settings.tracking.rateLimitMs = 15000;
  saveData("تعديل إعدادات النظام", "الإعدادات", "SYSTEM");
  toast("تم حفظ إعدادات النشاط وسياسات الموافقة.");
}

async function runSelfTest() {
  const results = [];
  data.books = data.books.filter(item => !String(item.id || "").includes("-QA-"));
  data.customers = data.customers.filter(item => !String(item.id || "").includes("-QA-") && !["01099999999","01012345678"].includes(normalizePhone(item.phone)) && item.name !== "عميل فاتورة اختبار");
  data.sales = data.sales.filter(item => !String(item.id || "").includes("-QA-") && item.onlineOrderId !== "ORD-QA-001");
  data.purchases = data.purchases.filter(item => !String(item.id || "").includes("-QA-") && !item.lines?.some(line => String(line.bookId || "").includes("-QA-")));
  data.inventoryBatches = (data.inventoryBatches || []).filter(item => !String(item.productId || item.bookId || "").includes("-QA-") && !String(item.batchId || item.id || "").includes("-QA-"));
  data.onlineOrders = data.onlineOrders.filter(item => !String(item.id || "").includes("-QA-"));
  data.shipments = data.shipments.filter(item => !String(item.id || "").includes("-QA-") && item.onlineOrderId !== "ORD-QA-001" && !String(item.tracking || "").startsWith("QA-"));
  data.stockMovements = data.stockMovements.filter(item => !String(item.bookId || "").includes("-QA-") && item.documentId !== "ORD-QA-001");
  const originalData = JSON.stringify(data);
  const originalConfirm = window.confirm;
  const originalAlert = window.alert;
  window.confirm = () => true;
  window.alert = () => {};

  const check = (name, condition, detail = "") => {
    results.push({ name, ok: Boolean(condition), detail: condition ? "" : detail });
  };

  try {
    check("جلسة مستخدم موثقة", Boolean(currentUser?.id && sessionToken));
    check("تطبيع الأرقام العربية والكسور", normalizeArabicNumericText("١٢٥٫٥٠") === "125.50" && normalizeArabicNumericText("۱۲۵.۵۰") === "125.50");
    const decimalInput = document.createElement("input");
    decimalInput.type = "number";
    decimalInput.name = "amount";
    configureNumericInput(decimalInput);
    decimalInput.value = "١٢٥٫٥٠";
    check("الإدخال المالي يقبل العربية", sanitizeNumericInputValue(decimalInput, { commit:true }) === "125.5" && decimalInput.inputMode === "decimal");
    const quantityInput = document.createElement("input");
    quantityInput.type = "number";
    quantityInput.className = "sale-qty";
    quantityInput.min = "1";
    configureNumericInput(quantityInput);
    quantityInput.value = "١٢٫٥";
    check("حقول الكمية أعداد صحيحة فقط", sanitizeNumericInputValue(quantityInput, { commit:true }) === "12" && quantityInput.inputMode === "numeric");
    decimalInput.value = "-5";
    check("منع السالب في الحقول المالية العامة", sanitizeNumericInputValue(decimalInput, { commit:true }) === "5");
    const shippingCostInput = document.createElement("input");
    shippingCostInput.name = "cost";
    shippingCostInput.type = "text";
    shippingCostInput.inputMode = "decimal";
    shippingCostInput.dataset.numericInput = "true";
    shippingCostInput.dataset.numericKind = "decimal";
    shippingCostInput.dataset.allowNegative = "false";
    shippingCostInput.min = "0";
    shippingCostInput.value = "١٢٫٥٠";
    check("تكلفة الشحن الديناميكية تقبل العربية والكسور", sanitizeNumericInputValue(shippingCostInput, { commit:true }) === "12.5");
    shippingCostInput.value = "-12.50";
    check("تكلفة الشحن لا تقبل السالب", sanitizeNumericInputValue(shippingCostInput, { commit:true }) === "12.5");
    check("دور المالك يفتح كل الصفحات", ROLE_VIEWS["مالك"].length === VIEW_DEFINITIONS.length);
    const ownerUser = currentUser;
    currentUser = { id:"QA", username:"cashier", name:"كاشير اختبار", role:"كاشير" };
    check("منع الكاشير من صفحة الحسابات", canView("accounting") === false);
    check("منع الكاشير من حذف الأصناف", canAction("delete-book") === false);
    const negativeStockBook = data.books.find(book => Number(book.stock || 0) >= 0);
    const negativeStockBefore = Number(negativeStockBook?.stock || 0);
    const negativeSettingBefore = data.settings.allowNegativeStock;
    data.settings.allowNegativeStock = false;
    check("منع المخزون السالب عند إغلاق الإعداد", Boolean(negativeStockError(negativeStockBook, negativeStockBefore + 1)));
    data.settings.allowNegativeStock = true;
    check("منع الكاشير من تجاوز المخزون رغم فتح الإعداد", Boolean(negativeStockError(negativeStockBook, negativeStockBefore + 1)));
    check("فشل التحقق لا يعدل رصيد الصنف", Number(negativeStockBook?.stock || 0) === negativeStockBefore);
    currentUser = ownerUser;
    check("السماح للمالك بتجاوز المخزون عند فتح الإعداد", negativeStockError(negativeStockBook, negativeStockBefore + 1) === "");
    const enoughBook = data.books.find(book => book.id !== negativeStockBook?.id && Number(book.stock || 0) > 0);
    currentUser = { id:"QA", username:"cashier", name:"كاشير اختبار", role:"كاشير" };
    check("فاتورة متعددة الأصناف تُرفض عند نقص صنف واحد", [negativeStockError(enoughBook, 1), negativeStockError(negativeStockBook, negativeStockBefore + 1)].filter(Boolean).length === 1);
    currentUser = ownerUser;
    data.settings.allowNegativeStock = negativeSettingBefore;
    const views = ["dashboard", "books", "sales", "onlineOrders", "purchases", "parties", "shipping", "accounting", "reports", "hr", "settings"];
    for (const view of views) {
      navigate(view);
      check(`تحميل صفحة ${view}`, root.children.length > 0 && document.getElementById("page-title").textContent.length > 0, "لم يتم إنشاء محتوى الصفحة.");
    }

    navigate("books");
    check("حساب سعر الشراء بعد الخصم", calculateDiscountedPurchaseCost(200, 15) === 170);
    check("منع خصم شراء أكبر من 100%", calculateDiscountedPurchaseCost(200, 150) === 0);
    const testBook = {
      id: "B-QA-001", name: "صنف اختبار آلي", itemType: "سبلايز", unit: "قطعة", author: "QA", publisher: "QA", category: "اختبار",
      grade: "", shelf: "QA-1", barcode: "QA0001", extraBarcode: "", coverPrice: 25, defaultSellingPrice: 20, purchaseListPrice: 25, purchaseDiscount: 0, lastPurchasePrice: 10, cost: 10, price: 20,
      stock: 10, reorder: 2, supplierId: data.suppliers[0]?.id || "", owned: true, lastSale: null
    };
    addBookModal(testBook);
    check("إظهار نوع الصنف العام في نموذج الصنف", document.querySelector('[name="itemType"]')?.value === "سبلايز");
    check("إظهار وحدة قياس الصنف", document.querySelector('[name="unit"]')?.value === "قطعة");
    check("إخفاء خصم الشراء من بطاقة الصنف", !document.getElementById("book-purchase-discount"));
    check("عرض سعر الغلاف في بطاقة الصنف", Number(document.querySelector('[name="coverPrice"]')?.value) === 25);
    check("عرض سعر البيع الافتراضي", Number(document.querySelector('[name="defaultSellingPrice"]')?.value) === 20);
    check("آخر سعر شراء غير متاح بدون مستند شراء", document.querySelector('[name="lastPurchasePrice"]')?.value === "غير متاح" && document.querySelector('[name="lastPurchasePrice"]')?.readOnly === true);
    closeModal();
    data.books.push(testBook);
    check("إضافة صنف", Boolean(getBook(testBook.id)));
    getBook(testBook.id).defaultSellingPrice = 25;
    check("تعديل صنف", productDefaultSellingPrice(getBook(testBook.id)) === 25);
    stockCountModal();
    check("تفعيل زر بدء الجرد الجزئي", Boolean(modalBody.querySelector('[data-modal-action="start-partial-count"]')));
    check("تفعيل زر بدء الجرد الكلي", Boolean(modalBody.querySelector('[data-modal-action="start-full-count"]')));
    partialStockCountModal();
    check("إظهار اختيار الرف أو التصنيف في الجرد الجزئي", Boolean(document.getElementById("count-filter-type")) && Boolean(document.getElementById("count-filter-value")));
    openInventoryCountForm([testBook], "جزئي");
    const countInput = modalBody.querySelector(".count-actual-stock");
    if (countInput) {
      countInput.value = "13";
      countInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    check("حساب فرق الجرد مباشرة", modalBody.querySelector(".count-difference")?.textContent === "+3");
    check("تحديث ملخص فروقات الجرد", document.getElementById("count-differences-total")?.textContent === "1" && document.getElementById("count-net-difference")?.textContent === "+3");
    modalBody.querySelector("#inventory-count-form")?.requestSubmit();
    check("اعتماد الجرد وتحديث رصيد الصنف", getBook(testBook.id).stock === 13);
    check("تسجيل الجرد في سجل العمليات", data.audit.some(item => item.entity === "المخزون" && item.action.includes("اعتماد جرد جزئي")));

    const discountedOrderTotals = onlineOrderTotals([
      { bookId:testBook.id, qty:2, price:25, discount:10, discountType:"percent" },
      { bookId:testBook.id, qty:1, price:25, discount:0, discountType:"percent" }
    ], 15, "amount", 0);
    check("توزيع خصم فاتورة الأونلاين على الأصناف", Math.abs(discountedOrderTotals.lines.reduce((sum, line) => sum + line.orderDiscountShare, 0) - 15) < 0.000001);
    check("تطابق صافي بنود الأونلاين مع إجمالي البضاعة", Math.abs(discountedOrderTotals.lines.reduce((sum, line) => sum + line.finalNet, 0) - discountedOrderTotals.goods) < 0.000001);
    onlineOrderModal();
    check("المحافظة في طلب الأونلاين قائمة فقط", document.querySelector('#online-order-form [name="governorate"]')?.tagName === "SELECT");
    check("حالات طلب الأونلاين منظمة", ONLINE_ORDER_STATUSES.join("|") === "طلب جديد|قيد التجهيز|تم إنشاء الفاتورة|لم يتم الشحن بعد|تم إنشاء الشحنة|خرج للتوصيل|تم التسليم|مرتجع|ملغي");
    closeModal();

    const qaOrder = {
      id:"ORD-QA-001", date:today(), customerName:"عميل أونلاين اختبار", phone:"01099999999",
      governorate:"القاهرة", city:"مدينة نصر", address:"عنوان اختبار", source:"المتجر الإلكتروني",
      paymentMethod:"الدفع عند الاستلام", shippingCost:50, tracking:"", status:"طلب جديد", notes:"QA",
      lines:[{bookId:testBook.id,qty:1,price:25}], orderDiscount:20, orderDiscountType:"percent", total:70,
      createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null
    };
    data.onlineOrders.push(qaOrder);
    renderOnlineOrders();
    check("تسجيل طلب أونلاين جديد بدون فاتورة", Boolean(document.querySelector('[data-record-type="online-order"][data-record-id="ORD-QA-001"]')) && !qaOrder.saleId && !qaOrder.shipmentId);
    const shipmentCountBeforeInvoice = data.shipments.length;
    createShipmentFromOrder(qaOrder.id, { company:"بوسطة", tracking:"QA-BEFORE-INVOICE", status:"تم التجهيز", cost:50 });
    check("منع إنشاء شحنة قبل الفاتورة", data.shipments.length === shipmentCountBeforeInvoice && !qaOrder.shipmentId);
    convertOnlineOrderToSale(qaOrder.id, { print:false, askShipping:false });
    check("منع إنشاء فاتورة قبل تجهيز الطلب", !qaOrder.saleId);
    const saleCountBeforePrepare = data.sales.length;
    viewOnlineOrder(qaOrder.id);
    modalBody.querySelector(`[data-action="print-online-order"][data-id="${qaOrder.id}"]`)?.click();
    check("زر أمر تجهيز يغير الحالة دون فاتورة أو شحنة", qaOrder.status === "قيد التجهيز" && data.sales.length === saleCountBeforePrepare && !qaOrder.shipmentId);
    const beforeOrderSaleStock = getBook(testBook.id).stock;
    convertOnlineOrderToSale(qaOrder.id, { print:false, askShipping:false });
    check("تأكيد طلب أونلاين ثم إنشاء فاتورة", Boolean(qaOrder.saleId && data.sales.find(s=>s.id===qaOrder.saleId) && qaOrder.status === "تم إنشاء الفاتورة"));
    const qaOrderSale = data.sales.find(s => s.id === qaOrder.saleId);
    check("نقل خصم فاتورة الأونلاين إلى بنود البيع", Math.abs(qaOrderSale.lines.reduce((sum, line) => sum + line.qty * line.price * (1 - line.discount / 100), 0) - 20) < 0.000001);
    check("نقل بيانات العميل والشحن إلى الفاتورة", qaOrderSale.customerId && qaOrderSale.customerSnapshot?.governorate === "القاهرة" && qaOrderSale.shipping === 50);
    check("تأثير فاتورة الأونلاين على المخزون", getBook(testBook.id).stock === beforeOrderSaleStock - 1, `قبل=${beforeOrderSaleStock} بعد=${getBook(testBook.id).stock}`);
    check("تسجيل حركة مخزون لفاتورة الأونلاين", data.stockMovements.some(m=>m.documentId===qaOrder.saleId && m.type==="بيع أونلاين"));
    postInvoiceShippingChoice(qaOrder.id, qaOrder.saleId);
    document.querySelector('#post-invoice-shipping-choice input[value="no"]').checked = true;
    document.getElementById("post-invoice-shipping-choice")?.requestSubmit();
    check("اختيار لم يتم الشحن بعد بعد الفاتورة", qaOrder.status === "لم يتم الشحن بعد" && !qaOrder.shipmentId);
    const saleCountAfterOrderInvoice = data.sales.length;
    convertOnlineOrderToSale(qaOrder.id, { print:false, askShipping:false });
    check("منع تكرار الفاتورة لنفس الطلب", data.sales.length === saleCountAfterOrderInvoice);
    closeModal();
    createShipmentFromOrder(qaOrder.id, { company:"بوسطة", tracking:"QA-TRACK-001", status:"تم التجهيز", cost:50 });
    const qaShipment = data.shipments.find(s=>s.id===qaOrder.shipmentId);
    check("إنشاء شحنة بعد الفاتورة", Boolean(qaShipment && qaShipment.onlineOrderId===qaOrder.id && qaShipment.invoiceId===qaOrder.saleId));
    check("اختيار شركة شحن من قائمة مسجلة", activeShippingCompanies().some(company => company.name === qaShipment.company));
    const shipmentCountBeforeBadCompany = data.shipments.length;
    qaOrder.shipmentId = "";
    qaOrder.status = "لم يتم الشحن بعد";
    createShipmentFromOrder(qaOrder.id, { company:"شركة مكتوبة يدويًا", tracking:"QA-BAD-COMPANY", status:"تم التجهيز", cost:50 });
    check("منع شركة شحن غير مسجلة", data.shipments.length === shipmentCountBeforeBadCompany);
    qaOrder.shipmentId = qaShipment.id;
    qaOrder.status = "تم إنشاء الشحنة";
    check("سحب بيانات العميل والعنوان إلى الشحنة", qaShipment.customerId === qaOrderSale.customerId && qaShipment.governorate === "القاهرة" && qaShipment.phone === qaOrder.phone);
    const shipmentCountAfterCreation = data.shipments.length;
    createShipmentFromOrder(qaOrder.id, { company:"Mylerz", tracking:"QA-DUPLICATE", status:"تم التجهيز", cost:60 });
    check("منع تكرار الشحنة لنفس الطلب", data.shipments.length === shipmentCountAfterCreation);
    closeModal();
    deleteShipment(qaShipment.id);
    cancelSale(qaOrder.saleId);
    check("إلغاء فاتورة الطلب يعيد المخزون", getBook(testBook.id).stock === beforeOrderSaleStock, `متوقع=${beforeOrderSaleStock} فعلي=${getBook(testBook.id).stock}`);

    navigate("sales");
    const originalStock = getBook(testBook.id).stock;
    salesScreenMode = "invoice";
    draftSale = { customerId: "", channel: "تجزئة", saleOperationType: "بيع مباشر", payment: "نقدي", date: today(), paid: 20, lines: [{ bookId: testBook.id, qty: 1, price: 25, discount: 0 }] };
    renderSales();
    check("وجود بحث العميل داخل الفاتورة", Boolean(document.getElementById("sale-customer-search")));
    const customerSearch = document.getElementById("sale-customer-search");
    customerSearch.value = "مكتبة";
    customerSearch.dispatchEvent(new Event("input", { bubbles:true }));
    check("البحث عن عميل أثناء كتابة الاسم", Boolean(document.querySelector('#sale-customer-suggestions [data-action="choose-sale-customer"]')));
    document.querySelector('#sale-customer-suggestions [data-action="choose-sale-customer"]')?.click();
    check("اختيار عميل مسجل وملء بياناته", Boolean(draftSale.customerId && document.getElementById("sale-customer-details")?.textContent.includes("الهاتف")));
    document.querySelector('[data-action="register-sale-customer"]')?.click();
    check("فتح تسجيل عميل جديد من الفاتورة", Boolean(document.getElementById("party-form")?.dataset.returnToSale === "true"));
    const customerGovernorate = document.querySelector('#party-form [name="governorate"]');
    check("المحافظة في نموذج العميل قائمة فقط", customerGovernorate?.tagName === "SELECT" && EGYPT_GOVERNORATES.length === 27);
    if (document.getElementById("party-form")) {
      document.querySelector('#party-form [name="name"]').value = "عميل فاتورة اختبار";
      document.querySelector('#party-form [name="phone"]').value = "01012345678";
      customerGovernorate.value = "القاهرة";
      document.querySelector('#party-form [name="city"]').value = "مدينة نصر";
      document.querySelector('#party-form [name="address"]').value = "عنوان اختبار";
      document.getElementById("party-form").requestSubmit();
    }
    check("تسجيل عميل جديد وربطه بالفاتورة تلقائيًا", getCustomer(draftSale.customerId)?.name === "عميل فاتورة اختبار");
    const salesBeforeMissingCustomer = data.sales.length;
    const selectedQaCustomerId = draftSale.customerId;
    draftSale.customerId = "";
    saveSale();
    check("منع حفظ فاتورة بدون Customer ID", data.sales.length === salesBeforeMissingCustomer);
    draftSale.customerId = selectedQaCustomerId;
    salesScreenMode = "invoice";
    renderSales();
    document.getElementById("sale-payment").value = "نقدي";
    saveSale();
    const testSale = data.sales.find(s => s.status !== "ملغاة" && s.lines?.some(line => line.bookId === testBook.id));
    check("تسجيل فاتورة لعميل موجود", Boolean(testSale?.customerId && getCustomer(testSale.customerId)));
    check("خصم المخزون بعد البيع", getBook(testBook.id).stock === originalStock - 1);
    check("حساب المدفوع والمتبقي", testSale?.paid === 20 && testSale?.remaining === 5);
    if (testSale) cancelSale(testSale.id);
    check("إرجاع المخزون بعد إلغاء البيع", getBook(testBook.id).stock === originalStock);

    navigate("purchases");
    const stockBeforePurchase = getBook(testBook.id).stock;
    draftPurchase = { supplierId: data.suppliers[0]?.id || "", type: "شراء", payment: "نقدي", returnDeadline: "", status: "تم الفحص والاستلام", paid: 5, shipping: 0, invoiceDiscount: 0, invoiceDiscountType: "percent", lines: [{ bookId: testBook.id, qty: 2, cost: 10, discount: 0, discountType: "percent" }] };
    renderPurchases();
    savePurchase();
    const testPurchase = data.purchases.find(p => p.lines?.some(line => line.bookId === testBook.id));
    check("إنشاء فاتورة شراء", Boolean(testPurchase));
    check("آخر سعر شراء مشتق من آخر مستند معتمد", latestApprovedPurchaseCost(testBook.id) === 10);
    addBookModal(testBook);
    check("آخر سعر شراء ظاهر وغير قابل للكتابة بعد الشراء", Number(document.querySelector('[name="lastPurchasePrice"]')?.value) === 10 && document.querySelector('[name="lastPurchasePrice"]')?.readOnly === true);
    closeModal();
    check("زيادة المخزون بعد الشراء", getBook(testBook.id).stock === stockBeforePurchase + 2);
    if (testPurchase) cancelPurchase(testPurchase.id);
    check("تحديث المخزون بعد إلغاء الشراء", getBook(testBook.id).stock === stockBeforePurchase);

    const receiptCustomer = data.customers.find(customer => customer.id !== "C001" && customer.balance > 0);
    const receiptBalanceBefore = receiptCustomer?.balance || 0;
    const cashCountBefore = data.cash.length;
    const testReceipt = createPartyVoucher({
      type: "استلام",
      partyKind: "customer",
      partyId: receiptCustomer.id,
      amount: 50,
      date: today(),
      account: "الخزينة الرئيسية",
      method: "نقدي",
      balanceMode: "settle",
      reference: "QA",
      note: "اختبار إيصال استلام"
    }, { skipSave: true });
    check("إنشاء إيصال استلام عميل", Boolean(testReceipt?.id));
    check("تحديث مديونية العميل بالإيصال", receiptCustomer.balance === Math.max(0, receiptBalanceBefore - 50));
    check("تحديث الخزنة بالإيصال", data.cash.length === cashCountBefore + 1 && data.cash.at(-1).receiptId === testReceipt.id);
    cancelPartyVoucher(testReceipt.id);
    check("عكس أثر الإيصال عند الإلغاء", receiptCustomer.balance === receiptBalanceBefore && testReceipt.status === "ملغى");

    check("بحث الفواتير برقم الفاتورة", findSalesInvoices("INV-1047").some(invoice => invoice.id === "INV-1047"));
    const linkedTracking = data.shipments.find(shipment => shipment.invoiceId === "INV-1047" || shipment.orderId === "INV-1047")?.tracking;
    check("بحث الفواتير بكود التتبع", Boolean(linkedTracking && findSalesInvoices(linkedTracking).some(invoice => invoice.id === "INV-1047")));
    check("بحث الفواتير برقم الموبايل", findSalesInvoices("01000000001").some(invoice => invoice.id === "INV-1047"));
    check("بحث الفواتير باسم العميل", findSalesInvoices("مكتبة المستقبل").some(invoice => invoice.id === "INV-1047"));
    check("البحث في الفواتير بدون نتائج", findSalesInvoices("لا-توجد-فاتورة-بهذا-الرقم").length === 0);

    navigate("dashboard");
    const dashboardStats = () => new Set([...root.querySelectorAll('.stat-card.interactive[data-action="dashboard-stat"][data-stat]')].map(card => card.dataset.stat));
    const ownerStats = dashboardStats();
    check("بطاقات Dashboard المطلوبة للمالك", requiredDashboardStatsForRole("مالك").every(stat => ownerStats.has(stat)), `الموجود: ${[...ownerStats].join("، ")}`);
    const dashboardOwner = currentUser;
    currentUser = { id:"QA-CASHIER", username:"cashier", name:"كاشير اختبار", role:"كاشير" };
    renderDashboard();
    const cashierStats = dashboardStats();
    check("بطاقات Dashboard المطلوبة للكاشير", requiredDashboardStatsForRole("كاشير").every(stat => cashierStats.has(stat)), `الموجود: ${[...cashierStats].join("، ")}`);
    check("صلاحيات Dashboard للكاشير لا تمنح التكلفة", canAction("view-item-cost-profit") === false && canAction("allow-negative-stock") === false);
    currentUser = dashboardOwner;
    renderDashboard();
    check("بطاقة الشحنات مجهزة للتحديث الدوري", Boolean(document.getElementById("dashboard-shipment-list")) && SHIPMENT_REFRESH_INTERVAL === 60000);
    check("مؤقت تحديث الشحنات يعمل مرة واحدة", Boolean(shipmentRefreshTimer));
    check("زر تحديث الشحنات الفوري ظاهر", Boolean(root.querySelector('[data-action="refresh-dashboard-shipments"]')));
    check("الشحنات في اللوحة قابلة للفتح", data.shipments.length === 0 || Boolean(root.querySelector('[data-action="dashboard-view-shipment"][data-id]')));
    const shipmentRefreshBeforeTest = lastShipmentRefresh?.getTime() || 0;
    await refreshDashboardShipments({ silent: true });
    check("تحديث بيانات الشحنات دون إعادة تحميل الصفحة", (lastShipmentRefresh?.getTime() || 0) >= shipmentRefreshBeforeTest && currentView === "dashboard");
    check("إظهار وقت آخر تحديث للشحنات", document.getElementById("shipment-refresh-status")?.textContent.includes("آخر تحديث"));
    for (const type of ["sales", "inventory", "customer-debt", "stock-alerts"]) {
      showDashboardStatDetails(type);
      check(`فتح تفاصيل بطاقة ${type}`, !modal.hidden && modalTitle.textContent.length > 0 && modalBody.textContent.trim().length > 0);
      closeModal();
    }
    const notificationItems = getNotificationItems();
    updateNotificationBadge();
    check("حساب عدد التنبيهات تلقائيًا", notificationItems.length === Number(document.getElementById("notification-count").textContent));
    check("عرض التنبيهات داخل لوحة المتابعة", root.querySelectorAll(".dashboard-alert-item").length === Math.min(3, notificationItems.length));
    check("ربط تنبيه اللوحة بالسجل المطلوب", Boolean(root.querySelector('.dashboard-alert-item[data-action="dashboard-alert-open"][data-id]')));
    check("إظهار إجراءات التفاصيل والتعديل داخل التنبيه", Boolean(root.querySelector('.dashboard-inline-actions [data-action="dashboard-alert-open"]')) && Boolean(root.querySelector('.dashboard-inline-actions [data-action^="dashboard-alert-edit-"]')));
    check("زر عدد التنبيهات يفتح مركز المتابعة", Boolean(root.querySelector('.alert-count-button[data-action="open-notifications"]')));
    showNotificationCenter();
    check("عرض التنبيهات داخل مركز المتابعة", !modal.hidden && modalBody.querySelectorAll(".notification-item").length === notificationItems.length);
    check("ظهور أزرار التفاصيل والتعديل", Boolean(modalBody.querySelector('[data-modal-action="notification-view-book"], [data-modal-action="notification-view-shipment"]')) && Boolean(modalBody.querySelector('[data-modal-action="notification-edit-book"], [data-modal-action="notification-edit-shipment"]')));
    const lowStockBook = data.books.find(book => book.stock <= book.reorder);
    if (lowStockBook) {
      preparePurchaseForBook(lowStockBook.id);
      check("تجهيز شراء من تنبيه المخزون", draftPurchase.lines[0].bookId === lowStockBook.id && draftPurchase.lines[0].qty > 0);
    }
    closeModal();
    if (lowStockBook) {
      navigateToRecord("book", lowStockBook.id, "view");
      await new Promise(resolve => setTimeout(resolve, 850));
      check("الانتقال المباشر إلى الصنف من التنبيه", currentView === "books" && Boolean(document.querySelector(`[data-record-type="book"][data-record-id="${lowStockBook.id}"].target-highlight`)));
      closeModal();
    }
    const testShipment = data.shipments.find(shipment => data.sales.some(sale => sale.id === shipment.orderId)) || data.shipments[0];
    if (testShipment) {
      navigateToRecord("shipment", testShipment.id, "edit");
      await new Promise(resolve => setTimeout(resolve, 850));
      check("الانتقال المباشر إلى الشحنة وفتح التعديل", currentView === "shipping" && modalTitle.textContent.includes("تعديل"));
      closeModal();
      if (data.sales.some(sale => sale.id === testShipment.orderId)) {
        navigateToRecord("invoice", testShipment.orderId, "view");
        await new Promise(resolve => setTimeout(resolve, 1350));
        check("فتح الفاتورة المرتبطة من تنبيه الشحنة", currentView === "sales" && modalTitle.textContent.includes(testShipment.orderId));
        closeModal();
      }
    }

    const returnBook = { ...testBook, id:"B-RETURN-QA", name:"كتاب اختبار المرتجعات", barcode:"RET-QA-001", stock:20, cost:10, price:30, deletedAt:null };
    const returnCustomer = { id:"C-RETURN-QA", name:"عميل مرتجعات اختبار", phone:"01088887777", governorate:"القاهرة", city:"مدينة نصر", address:"اختبار", type:"تجزئة", creditLimit:1000, balance:120, points:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null };
    const returnSupplier = { id:"S-RETURN-QA", name:"مورد مرتجعات اختبار", phone:"01077778888", terms:30, balance:300, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null };
    data.books.push(returnBook);
    data.customers.push(returnCustomer);
    data.suppliers.push(returnSupplier);
    data.sales.push(
      { id:"INV-RET-QA1", date:today(), customerId:returnCustomer.id, channel:"تجزئة", payment:"آجل", subtotal:60, discount:0, total:60, paid:0, remaining:60, status:"معتمدة", lines:[{ bookId:returnBook.id, qty:2, price:30, discount:0, discountType:"percent", finalNet:60 }], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null },
      { id:"INV-RET-QA2", date:today(), customerId:returnCustomer.id, channel:"تجزئة", payment:"آجل", subtotal:90, discount:0, total:90, paid:0, remaining:90, status:"معتمدة", lines:[{ bookId:returnBook.id, qty:3, price:30, discount:0, discountType:"percent", finalNet:90 }], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null }
    );
    data.purchases.push(
      { id:"PUR-RET-QA1", date:today(), supplierId:returnSupplier.id, supplierInvoiceNumber:"SUP-RET-1", type:"شراء", payment:"آجل", subtotal:40, discount:0, total:40, paid:0, remaining:40, status:"مستلمة", lines:[{ bookId:returnBook.id, qty:2, cost:20, discount:0, discountType:"percent", finalNet:40 }], shipping:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null },
      { id:"PUR-RET-QA2", date:today(), supplierId:returnSupplier.id, supplierInvoiceNumber:"SUP-RET-2", type:"شراء", payment:"آجل", subtotal:60, discount:0, total:60, paid:0, remaining:60, status:"مستلمة", lines:[{ bookId:returnBook.id, qty:3, cost:20, discount:0, discountType:"percent", finalNet:60 }], shipping:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null }
    );
    const saleReturnStockBefore = getBook(returnBook.id).stock;
    const saleReturnBalanceBefore = getCustomer(returnCustomer.id).balance;
    saleReturnByCustomerModal(returnCustomer.id);
    const customerReturnInputs = [...modalBody.querySelectorAll(".customer-return-qty")];
    if (customerReturnInputs[0]) customerReturnInputs[0].value = "1";
    if (customerReturnInputs[1]) customerReturnInputs[1].value = "2";
    const customerReturnForm = document.getElementById("sale-customer-return-form");
    if (customerReturnForm) {
      customerReturnForm.elements.settlement.value = "no-settlement";
      customerReturnForm.elements.reason.value = "QA مرتجع مستقل حسب العميل";
      customerReturnForm.requestSubmit();
    }
    const createdSalesReturn = data.returns.find(item => item.returnNo?.startsWith("SR-") && item.accountId === returnCustomer.id);
    check("إنشاء مرتجع مبيعات مستقل من أكثر من فاتورة", Boolean(createdSalesReturn && createdSalesReturn.sourceDocuments?.length === 2 && returnItems(createdSalesReturn).length === 2));
    check("زيادة المخزون بعد مرتجع المبيعات المستقل", getBook(returnBook.id).stock === saleReturnStockBefore + 3);
    check("تعديل حساب العميل بعد مرتجع المبيعات المستقل", getCustomer(returnCustomer.id).balance < saleReturnBalanceBefore);
    check("تسجيل حركة مخزون لكل صنف في مرتجع المبيعات المستقل", data.stockMovements.filter(item => item.documentId === createdSalesReturn?.returnNo).length >= 2);
    check("تسجيل مرتجع المبيعات المستقل في audit log", data.audit.some(item => item.entity === "المرتجعات" && item.entityId === createdSalesReturn?.returnNo));
    const remainingAfterSaleReturn = customerReturnableSaleLines(returnCustomer.id).reduce((sum, line) => sum + Number(line.remaining || 0), 0);
    check("منع تجاوز كمية مرتجع المبيعات المتاحة", remainingAfterSaleReturn === 2);

    const purchaseReturnStockBefore = getBook(returnBook.id).stock;
    const supplierBalanceBefore = getSupplier(returnSupplier.id).balance;
    purchaseReturnBySupplierModal(returnSupplier.id);
    const supplierReturnInputs = [...modalBody.querySelectorAll(".supplier-return-qty")];
    if (supplierReturnInputs[0]) supplierReturnInputs[0].value = "1";
    if (supplierReturnInputs[1]) supplierReturnInputs[1].value = "2";
    const supplierReturnForm = document.getElementById("purchase-supplier-return-form");
    if (supplierReturnForm) {
      supplierReturnForm.elements.settlement.value = "account-credit";
      supplierReturnForm.elements.reason.value = "QA مرتجع مستقل حسب المورد";
      supplierReturnForm.requestSubmit();
    }
    const createdPurchaseReturn = data.returns.find(item => item.returnNo?.startsWith("PR-") && item.accountId === returnSupplier.id);
    check("إنشاء مرتجع مشتريات مستقل من أكثر من فاتورة", Boolean(createdPurchaseReturn && createdPurchaseReturn.sourceDocuments?.length === 2 && returnItems(createdPurchaseReturn).length === 2));
    check("نقص المخزون بعد مرتجع المشتريات المستقل", getBook(returnBook.id).stock === purchaseReturnStockBefore - 3);
    check("تعديل حساب المورد بعد مرتجع المشتريات المستقل", getSupplier(returnSupplier.id).balance < supplierBalanceBefore);
    check("تسجيل حركة مخزون لكل صنف في مرتجع المشتريات المستقل", data.stockMovements.filter(item => item.documentId === createdPurchaseReturn?.returnNo).length >= 2);
    check("تسجيل مرتجع المشتريات المستقل في audit log", data.audit.some(item => item.entity === "المرتجعات" && item.entityId === createdPurchaseReturn?.returnNo));
    check("حفظ بنية returns الجديدة للمرتجعات المستقلة", createdSalesReturn?.mode === "by_account" && createdPurchaseReturn?.mode === "by_account" && Array.isArray(createdSalesReturn.items) && Array.isArray(createdPurchaseReturn.items));
    renderReports();
    check("ظهور تقارير المرتجعات الجديدة", root.textContent.includes("مرتجعات المبيعات حسب الفترة") && root.textContent.includes("أكثر الأصناف المرتجعة") && root.textContent.includes("تأثير المرتجعات"));

    data.books = data.books.filter(item => item.id !== testBook.id);
    check("حذف صنف غير مرتبط", !getBook(testBook.id));

    const expectedActions = [
      "add-book","view-book","edit-book","delete-book","adjust-stock","stock-count",
      "add-sale-line","reset-sale","save-sale","show-sales-list",
      "add-purchase-line","save-purchase","show-purchases-list",
      "new-sale-return-customer","new-purchase-return-supplier","open-return-search","open-sale-return-list","open-purchase-return-list","start-sale-return","start-purchase-return","view-return",
      "add-customer","add-supplier","statement","edit-party","delete-party","party-voucher","view-party-voucher","cancel-party-voucher",
      "view-shipment","update-shipment","delete-shipment","copy-tracking-code","open-egypt-post","open-egypt-post-with-code","manual-tracking-result","quick-manual-tracking","test-local-rpa","shipping-companies","edit-shipping-company","delete-shipping-company",
      "add-cash-in","add-cash-out","view-cash","edit-cash","delete-cash","trial-balance","chart-accounts",
      "open-report","whatsapp-report","add-employee","view-employee","edit-employee","delete-employee",
      "save-settings","backup-db","audit-log","customize-role","customize-user","dashboard-stat","open-notifications",
      "dashboard-alert-open","dashboard-alert-edit-book","dashboard-alert-adjust-stock","dashboard-alert-buy-book",
      "dashboard-alert-edit-shipment","dashboard-alert-view-invoice","refresh-dashboard-shipments",
      "dashboard-view-shipment","add-online-order","view-online-order","edit-online-order","convert-order-sale",
      "create-order-shipment","quick-add-sale-book","export-report","print-sale","print-voucher","print-return","print-online-order",
      "print-statement","print-cash-daily","restore-db","close-modal"
    ];
    const source = document.documentElement.innerHTML + String(root.onclick || "");
    expectedActions.forEach(action => check(`ربط الزر ${action}`, document.querySelector(`[data-action="${action}"]`) || action === "close-modal" || appHasActionHandler(action), "لا يوجد عنصر أو معالج."));
    check("زر التنبيهات", Boolean(document.getElementById("notification-btn")));
    check("زر القائمة الجانبية", Boolean(document.getElementById("menu-btn")));
    check("الاتصال بقاعدة البيانات", serverConnected, "التطبيق يعمل في وضع المتصفح الاحتياطي فقط.");
    const conflictResponse = await fetch("/api/db", { method:"PUT", headers:authHeaders({"Content-Type":"application/json","If-Match":"invalid-revision"}), body:JSON.stringify(data) });
    check("منع تعارض الحفظ بين نافذتين", conflictResponse.status === 409);
    const resetResponse = await fetch("/api/reset", { method:"POST", headers:authHeaders() });
    check("تعطيل مسار إعادة ضبط قاعدة البيانات", resetResponse.status === 403);
  } catch (error) {
    results.push({ name: "خطأ غير متوقع أثناء الاختبار", ok: false, detail: error.stack || error.message });
  } finally {
    data = normalizeData(JSON.parse(originalData));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (serverConnected) {
      try { await persistToServer(); } catch {}
    }
    window.confirm = originalConfirm;
    window.alert = originalAlert;
    navigate("dashboard");
  }

  const passed = results.filter(item => item.ok).length;
  const failed = results.length - passed;
  const report = document.createElement("section");
  report.id = "qa-report";
  report.dataset.passed = String(passed);
  report.dataset.failed = String(failed);
  report.style.cssText = "position:fixed;inset:10px;z-index:9999;overflow:auto;background:#fff;padding:20px;font-family:monospace;direction:rtl";
  report.innerHTML = `<h1>QA ${failed === 0 ? "PASS" : "FAIL"} — ${passed}/${results.length}</h1><pre>${esc(JSON.stringify(results, null, 2))}</pre>`;
  document.body.appendChild(report);
}

function appHasActionHandler(action) {
  const handlers = {
    "add-book": addBookModal, "view-book": viewBook, "edit-book": addBookModal, "delete-book": deleteBook,
    "adjust-stock": adjustStock, "stock-count": stockCountModal, "save-sale": saveSale,
    "show-sales-list": showSalesList, "save-purchase": savePurchase, "show-purchases-list": showPurchasesList,
    "new-purchase-document": resetPurchaseDraft, "view-purchase": viewPurchase, "receive-purchase": receivePurchase,
    "cancel-purchase": cancelPurchase, "delete-purchase": deletePurchase,
    "new-sale-return-customer": saleReturnByCustomerModal,
    "new-purchase-return-supplier": purchaseReturnBySupplierModal, "open-return-search": showReturnSearch,
    "open-sale-return-list": showReturnDocumentPicker, "open-purchase-return-list": showReturnDocumentPicker,
    "start-sale-return": saleReturnModal, "start-purchase-return": purchaseReturnModal, "view-return": viewReturn, "print-return": printReturn,
    "add-customer": addPartyModal, "add-supplier": addPartyModal, "statement": showStatement,
    "edit-party": addPartyModal, "delete-party": deleteParty, "party-voucher": partyVoucherModal,
    "view-party-voucher": viewPartyVoucher, "cancel-party-voucher": cancelPartyVoucher, "add-shipment": addShipmentModal,
    "view-shipment": viewShipment, "update-shipment": addShipmentModal, "delete-shipment": deleteShipment,
    "shipping-companies": showShippingCompanies, "edit-shipping-company": editShippingCompany, "delete-shipping-company": deleteShippingCompany, "add-cash-in": cashModal, "add-cash-out": cashModal,
    "view-cash": viewCashTransaction, "edit-cash": cashModal, "delete-cash": deleteCash, "add-cash-account": cashAccountModal,
    "edit-cash-account": cashAccountModal, "cash-transfer": cashTransferModal, "trial-balance": showTrialBalance,
    "chart-accounts": showChartOfAccounts, "open-report": openReport, "view-best-customers": openReport, "view-best-suppliers": openReport, "add-employee": employeeModal,
    "view-employee": viewEmployee, "edit-employee": employeeModal, "delete-employee": deleteEmployee,
    "save-settings": saveSettings, "backup-db": createBackup, "audit-log": showAuditLog, "export-audit-log": exportAuditLogCsv,
    "customize-role": customizeRole, "customize-user": customizeUser, "dashboard-stat": showDashboardStatDetails, "shipping-stat": applyShippingStatFilter, "reset-shipping-filters": resetShippingFilters,
    "open-notifications": showNotificationCenter, "dashboard-alert-open": navigateToRecord,
    "dashboard-alert-edit-book": navigateToRecord, "dashboard-alert-adjust-stock": navigateToRecord,
    "dashboard-alert-buy-book": preparePurchaseForBook, "dashboard-alert-edit-shipment": navigateToRecord,
    "dashboard-alert-view-invoice": navigateToRecord, "refresh-dashboard-shipments": refreshDashboardShipments,
    "dashboard-view-shipment": navigateToRecord, "add-online-order": onlineOrderModal,
    "view-online-order": viewOnlineOrder, "edit-online-order": onlineOrderModal,
    "convert-order-sale": convertOnlineOrderToSale, "create-order-shipment": createShipmentFromOrder,
    "update-tracking-now": updateShipmentTrackingNow, "update-all-tracking": updateAllTrackingNow, "test-local-rpa": testLocalRpaService, "retry-pending-tracking": retryPendingTracking, "show-tracking-debug": showTrackingDebug,
    "copy-tracking-code": copyShipmentTrackingCode, "open-egypt-post": openEgyptPostTrackingSite,
    "open-egypt-post-with-code": openEgyptPostWithCode, "manual-tracking-result": manualTrackingResultModal,
    "quick-manual-tracking": quickManualTracking,
    "test-tracking-connection": testTrackingConnection, "prepare-complaint": prepareShipmentComplaint,
    "add-shipment-complaint": addShipmentComplaintModal, "shipment-complaints": shipmentComplaintsModal, "edit-shipment-complaint": editShipmentComplaintModal,
    "quick-add-sale-book": addBookToDraftSale, "quick-add-purchase-book": addBookToDraftPurchase, "export-report": exportReportCsv,
    "print-sale": printSale, "print-voucher": printVoucher, "print-online-order": printOnlineOrder,
    "print-statement": printStatement, "print-cash-daily": printCashDaily, "restore-db": showRestoreBackups,
    "omni-refresh": renderOmnichannel, "omni-open": omniOpenConversation, "omni-claim": omniClaim,
    "omni-send": omniSend, "omni-simulate-whatsapp": omniSimulate, "omni-simulate-messenger": omniSimulate
  };
  return typeof handlers[action] === "function" || ["add-sale-line","reset-sale","add-purchase-line","return-sale","return-purchase","choose-return-customer","choose-return-supplier","register-online-order-customer","choose-online-order-customer","whatsapp-report","close-modal"].includes(action);
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.getRegistrations?.()
    .then(registrations => Promise.all(registrations.map(reg => reg.unregister())))
    .then(() => (window.caches ? caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))) : null))
    .catch(() => {});
}

initializeAuth();
