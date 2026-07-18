# UX/UI Phase 1 Baseline

Captured before the phase-1 redesign on `feature/ui-ux-redesign-phase-1`.

## Navigation and permissions

The application is a single-page RTL interface. Navigation is controlled by the existing `data-view` contract and `ROLE_VIEWS`/`canView()` in `app/app.js`.

Current views: `dashboard`, `books`, `sales`, `onlineOrders`, `omnichannel`, `purchases`, `returns`, `parties`, `shipping`, `accounting`, `reports`, `hr`, `settings`.

Roles: owner/مالك, manager/مدير, accountant/محاسب, cashier/كاشير, warehouse/مخزن, shipping/شحن. The sidebar must continue to use the existing view identifiers so role filtering remains authoritative.

## Stable DOM contracts

Shell IDs: `login-screen`, `login-form`, `login-message`, `app-shell`, `sidebar`, `main-nav`, `menu-btn`, `page-kicker`, `page-title`, `notification-btn`, `notification-count`, `current-user-name`, `current-user-role`, `logout-btn`, `view-root`, `modal-backdrop`, `modal-title`, `modal-eyebrow`, `modal-body`, `close-modal`, `toast-root`, `empty-state-template`.

Sales IDs: `sale-customer-search`, `sale-customer-suggestions`, `sale-customer-details`, `sale-channel`, `sale-operation-type`, `sale-payment`, `sale-date`, `sale-book-search`, `sale-quick-qty`, `sale-book-suggestions`, `sale-lines`, `sale-subtotal`, `sale-line-discount-total`, `sale-invoice-discount`, `sale-invoice-discount-type`, `sale-discount-total`, `sale-points`, `sale-paid`, `sale-total`, `sale-remaining`, `sale-warning`.

The complete machine-readable inventory remains discoverable with:

```sh
rg -o 'data-view="[^"]+"|data-action="[^"]+"|data-modal-action="[^"]+"|id="[^"]+"' app/index.html app/app.js
```

## Modal inventory

The shared `openModal()`/`closeModal()` shell is used for notifications, dashboard details, products, customers/suppliers, online orders, shipping, cash, employees, inventory counts, statements, vouchers, sales history, purchase history, returns, reports, permissions, backups and audit log.

## Existing sales path

1. Navigate to `sales`.
2. Trigger `new-sale-invoice`.
3. Search by barcode/name through `sale-book-search`.
4. Trigger `quick-add-sale-book`; duplicate products increment the existing quantity.
5. Optionally select a customer and discounts/payment.
6. Trigger `save-sale`.
7. `saveSale()` validates stock/cost/credit, updates inventory and persists through the existing storage API.
8. Open previous invoices through `show-sales-list`, then view, print, collect, return, cancel or open the linked shipment according to permissions.

## Printing paths

Existing print functions and action contracts are preserved: `printSale()` (`a4`/`thermal`), `printVoucher()`, `printReturn()`, `printOnlineOrder()`, `printStatement()`, `printCashDaily()`, `printSalesDay()` and report print/PDF through `printHtml()`.

## Baseline viewport captures

- `docs/screenshots/before-1440x900.png`
- `docs/screenshots/before-1280x800.png`
- `docs/screenshots/before-1024x768.png`

## Baseline smoke flows

- Open sales center.
- Open a new cash invoice.
- Search/add an item by name or barcode.
- Save the invoice through the existing persistence path.
- Print through the existing sale print path.
- Open the previous-invoices view and an invoice record.

These contracts are the rollback/reference baseline for phase 1. No backend endpoint or database shape is included in the redesign scope.
