const fs = require("fs");
const { env } = require("../config/env");
const { phoneSearchVariants, normalizePhone } = require("../utils/phone");

class CustomerLookupService {
  constructor({ databasePath = env.existingAppDatabasePath } = {}) {
    this.databasePath = databasePath;
  }

  readDb() {
    if (!fs.existsSync(this.databasePath)) return {};
    return JSON.parse(fs.readFileSync(this.databasePath, "utf8"));
  }

  findByPhone(phone) {
    const db = this.readDb();
    const variants = phoneSearchVariants(phone);
    const customer = (db.customers || []).find(item => variants.includes(String(item.phone || "").trim()) || variants.includes(normalizePhone(item.phone || "")));
    if (!customer) return { customer: null, orders: [], sales: [], shipments: [] };
    return this.contextForCustomer(customer.id);
  }

  contextForCustomer(customerId) {
    const db = this.readDb();
    const customer = (db.customers || []).find(item => item.id === customerId) || null;
    const orders = (db.onlineOrders || []).filter(item => item.customerId === customerId);
    const sales = (db.sales || []).filter(item => item.customerId === customerId || orders.some(order => order.saleId === item.id));
    const shipments = (db.shipments || []).filter(item => item.customerId === customerId || orders.some(order => order.shipmentId === item.id || order.id === item.onlineOrderId) || sales.some(sale => sale.id === item.invoiceId || sale.id === item.orderId));
    return { customer, orders, sales, shipments };
  }

  suggestLinksByPhone(phone) {
    const context = this.findByPhone(phone);
    return {
      customerId: context.customer?.id || null,
      onlineOrderId: context.orders?.[0]?.id || null,
      saleId: context.sales?.[0]?.id || null,
      shipmentId: context.shipments?.[0]?.id || null,
      context
    };
  }
}

module.exports = { CustomerLookupService };
