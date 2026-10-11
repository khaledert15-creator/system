"use strict";

// These are carrier costs from the Egyptian Post Waslha tariff supplied by the
// business (origin: Sharqia). Customer-facing shipping prices are independent.
const DEFAULT_RATES = Object.freeze({
  "الشرقية":63.20,
  "القاهرة":74.60,"الجيزة":74.60,"القليوبية":74.60,"الإسكندرية":74.60,
  "البحيرة":74.60,"المنوفية":74.60,"الغربية":74.60,"الدقهلية":74.60,
  "دمياط":74.60,"كفر الشيخ":74.60,
  "الإسماعيلية":86,"بورسعيد":86,"السويس":86,
  "الفيوم":103.10,"بني سويف":103.10,"المنيا":103.10,"أسيوط":103.10,
  "سوهاج":120.20,"قنا":120.20,"الأقصر":120.20,"أسوان":120.20,
  "البحر الأحمر":120.20,
  "شمال سيناء":126,"جنوب سيناء":126,"مطروح":126,"الوادي الجديد":126
});

const GOVERNORATES = Object.freeze(Object.keys(DEFAULT_RATES));
const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const numberFromInput = value => Number(String(value ?? "").replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٫،]/g,".").replace(/٬/g,"").trim());

function defaultTariff() {
  return {version:1,origin:"الشرقية",source:"قائمة وصلها 2026/04/01",extraKgCost:7,byGovernorate:{...DEFAULT_RATES},activatedAt:null};
}

function normalizeTariff(source) {
  const value=source&&typeof source==="object"?source:defaultTariff();
  const version=Number(value.version);
  const extraKgCost=numberFromInput(value.extraKgCost);
  if(!Number.isInteger(version)||version<1||!Number.isFinite(extraKgCost)||extraKgCost<=0||Math.abs(Math.round(extraKgCost*100)-extraKgCost*100)>1e-7)throw new Error("تعريفة البريد غير صالحة.");
  const rates={};
  for(const governorate of GOVERNORATES){
    const rate=numberFromInput(value.byGovernorate?.[governorate]);
    if(!Number.isFinite(rate)||rate<=0||Math.abs(Math.round(rate*100)-rate*100)>1e-7)throw new Error(`تكلفة البريد لمحافظة ${governorate} غير صالحة.`);
    rates[governorate]=roundMoney(rate);
  }
  return {version,origin:"الشرقية",source:String(value.source||"تعريفة البريد المصري").trim().slice(0,120),extraKgCost:roundMoney(extraKgCost),byGovernorate:rates,activatedAt:value.activatedAt||null};
}

function normalizeWeightGrams(value) {
  const grams=numberFromInput(value);
  if(!Number.isInteger(grams)||grams<1||grams>500000)throw new Error("أدخل وزن الطرد بالجرام، من 1 إلى 500000 جرام.");
  return grams;
}

function quote(tariffSource,governorate,weightInput) {
  const tariff=normalizeTariff(tariffSource);
  const weightGrams=normalizeWeightGrams(weightInput);
  const destination=String(governorate||"").trim();
  if(!Object.hasOwn(tariff.byGovernorate,destination))throw new Error("لا توجد تعريفة بريد لهذه المحافظة؛ راجع بيانات العنوان.");
  const includedGrams=destination==="الشرقية"?1000:2000;
  const extraKilos=Math.max(0,Math.ceil((weightGrams-includedGrams)/1000));
  const baseCost=tariff.byGovernorate[destination];
  const extraCost=roundMoney(extraKilos*tariff.extraKgCost);
  return {governorate:destination,weightGrams,includedGrams,extraKilos,baseCost,extraCost,totalCost:roundMoney(baseCost+extraCost),tariffVersion:tariff.version,tariffSource:tariff.source,tariffActivatedAt:tariff.activatedAt};
}

function statementNet(grossCost,discount) {
  const gross=numberFromInput(grossCost),deduction=numberFromInput(discount);
  if(!Number.isFinite(gross)||gross<0||!Number.isFinite(deduction)||deduction<0||deduction>gross)throw new Error("إجمالي كشف البريد أو الخصم غير صالح.");
  return roundMoney(gross-deduction);
}

const api={DEFAULT_RATES,GOVERNORATES,defaultTariff,normalizeTariff,normalizeWeightGrams,quote,statementNet,roundMoney,numberFromInput};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(typeof window!=="undefined")window.PostalShipping=api;
