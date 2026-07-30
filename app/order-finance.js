(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OrderFinance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function normalizeNumber(value) {
    const normalized = String(value ?? "")
      .trim()
      .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[٫,]/g, ".")
      .replace(/\s+/g, "");
    if (!/^\d*(?:\.\d*)?$/.test(normalized)) return NaN;
    return normalized === "" || normalized === "." ? 0 : Number(normalized);
  }

  function calculateDiscount(baseValue, inputValue = 0, inputType = "percent") {
    const base = Math.max(0, round(baseValue));
    const parsed = normalizeNumber(inputValue);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error("قيمة الخصم غير صالحة.");
    const type = inputType === "amount" ? "amount" : "percent";
    if (type === "percent" && parsed > 100) throw new Error("نسبة الخصم لا يمكن أن تتجاوز 100%.");
    if (type === "amount" && parsed > base) throw new Error("قيمة الخصم لا يمكن أن تتجاوز السعر.");
    const amount = round(type === "amount" ? parsed : base * parsed / 100);
    const percent = round(base > 0 ? amount * 100 / base : 0);
    return { inputType:type, inputValue:round(parsed), discountAmount:amount, discountPercent:percent, finalAmount:round(base - amount) };
  }

  function calculateOrder(lines = [], options = {}) {
    const computed = lines.map((source, index) => {
      const qty = Math.max(1, Math.trunc(normalizeNumber(source.qty ?? source.quantity ?? 1) || 1));
      const price = normalizeNumber(source.price ?? source.unitPrice ?? 0);
      if (!Number.isFinite(price) || price < 0) throw new Error(`سعر الصنف رقم ${index + 1} غير صالح.`);
      const originalTotal = round(qty * price);
      const discountScope=source.discountScope==="unit"?"unit":"line";
      const discountBase=discountScope==="unit"?price:originalTotal;
      const discount = calculateDiscount(discountBase, source.discount ?? source.discountPercent ?? source.discountAmount ?? 0, source.discountType || (source.discountAmount != null ? "amount" : "percent"));
      const unitDiscountAmount=discountScope==="unit"?discount.discountAmount:round(discount.discountAmount/qty);
      const lineDiscountAmount=discountScope==="unit"?round(discount.discountAmount*qty):discount.discountAmount;
      const finalUnitPrice=round(price-unitDiscountAmount),lineFinalAmount=round(originalTotal-lineDiscountAmount);
      return {
        ...source, qty, price:round(price), originalTotal,
        discount:discount.inputValue, discountType:discount.inputType,discountScope,
        unitOriginalPrice:round(price),unitDiscountAmount,unitFinalPrice:finalUnitPrice,
        discountAmount:lineDiscountAmount, discountPercent:discount.discountPercent,
        lineDiscount:lineDiscountAmount,lineDiscountTotal:lineDiscountAmount,totalDiscount:lineDiscountAmount,
        finalUnitPrice, lineFinalAmount, finalNet:lineFinalAmount,
        lineTotal:lineFinalAmount
      };
    });
    const subtotalBeforeDiscount = round(computed.reduce((sum, line) => sum + line.originalTotal, 0));
    const productDiscountTotal = round(computed.reduce((sum, line) => sum + line.discountAmount, 0));
    const subtotalAfterProductDiscount = round(subtotalBeforeDiscount - productDiscountTotal);
    const orderDiscount = calculateDiscount(subtotalAfterProductDiscount, options.orderDiscount || 0, options.orderDiscountType || "percent");
    const shipping = normalizeNumber(options.shippingCost || 0);
    if (!Number.isFinite(shipping) || shipping < 0) throw new Error("تكلفة الشحن غير صالحة.");
    const grandTotal = round(orderDiscount.finalAmount + shipping);
    let allocated = 0;
    const linesWithAllocation = computed.map((line, index) => {
      const share = subtotalAfterProductDiscount > 0
        ? round(index === computed.length - 1 ? orderDiscount.discountAmount - allocated : orderDiscount.discountAmount * line.finalNet / subtotalAfterProductDiscount)
        : 0;
      allocated = round(allocated + share);
      return { ...line, orderDiscountShare:share, totalDiscount:round(line.discountAmount + share), finalNet:round(line.finalNet - share), lineTotal:round(line.finalNet - share) };
    });
    return {
      lines:linesWithAllocation,
      subtotal:subtotalBeforeDiscount,
      subtotalBeforeDiscount,
      lineDiscountTotal:productDiscountTotal,
      productDiscountTotal,
      orderDiscount:orderDiscount.discountAmount,
      orderDiscountAmount:orderDiscount.discountAmount,
      orderDiscountPercent:orderDiscount.discountPercent,
      discountTotal:round(productDiscountTotal + orderDiscount.discountAmount),
      goods:orderDiscount.finalAmount,
      subtotalAfterDiscount:orderDiscount.finalAmount,
      shipping:round(shipping),
      total:grandTotal,
      grandTotal
    };
  }

  function calculatePayment(grandTotalValue, confirmedPaidValue = 0) {
    const grandTotal = normalizeNumber(grandTotalValue);
    const paidAmount = normalizeNumber(confirmedPaidValue);
    if (!Number.isFinite(grandTotal) || grandTotal < 0) throw new Error("إجمالي الطلب غير صالح.");
    if (!Number.isFinite(paidAmount) || paidAmount < 0) throw new Error("المبلغ المدفوع غير صالح.");
    if (round(paidAmount) > round(grandTotal)) throw new Error("المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الطلب. راجع الاسترداد أو المعالجة المالية.");
    const remainingAmount = round(grandTotal - paidAmount);
    return {
      grandTotal:round(grandTotal), paidAmount:round(paidAmount), remainingAmount,
      amountDueAtDelivery:remainingAmount,
      paymentStatus:paidAmount <= 0 ? "unpaid" : remainingAmount <= 0 ? "paid" : "partially_paid"
    };
  }

  return { round, normalizeNumber, calculateDiscount, calculateOrder, calculatePayment };
});
