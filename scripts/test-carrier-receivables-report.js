#!/usr/bin/env node
"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"../app/app.js"),"utf8");
const start=app.indexOf("function carrierReceivablesSnapshot(");
const end=app.indexOf("\nfunction renderCarrierReceivables()",start);
assert(start>0&&end>start,"receivables calculator is present");
const snapshot=vm.runInNewContext(`(${app.slice(start,end).trim()})`);
const shipment=(id,status,amount,extra={})=>({id,company:"البريد المصري",trackingNumber:`TR-${id}`,status,collectionAmount:amount,createdAt:"2026-10-11",...extra});
const finance=row=>({collectionAmount:row.collectionAmount,expectedNetSettlement:row.collectionAmount-10,collectionCommissionExpected:10,carrierShippingCostExpected:0});
const status=row=>row.status;
const db={
  shipments:[
    shipment("transit","in_transit",100),
    shipment("delivered","delivered",200),
    shipment("collected","delivered",300),
    shipment("direct","delivered",400,{financialCollectionStatus:"settled"}),
    shipment("approved","delivered",500,{settlementId:"SET-1"}),
    shipment("cancelled","delivered",600,{deletedAt:"2026-10-11"}),
    shipment("returned","returned",700),
    shipment("reversed","delivered",800)
  ],
  orderCollections:[
    {shipmentId:"collected",amount:290,expectedNetTransfer:280,status:"collected_by_carrier"},
    {shipmentId:"reversed",amount:800,expectedNetTransfer:790,status:"reversed"}
  ],
  carrierSettlements:[{id:"SET-1",approvedAt:"2026-10-11",lines:[{shipmentId:"approved"}]}]
};
const rows=snapshot(db,finance,status);
assert.equal(rows.length,4,"only open, non-returned shipments appear");
assert.equal(rows.find(row=>row.shipment.id==="collected").kind,"collected","recorded carrier collection is confirmed");
assert.equal(rows.find(row=>row.shipment.id==="collected").net,280,"confirmed amount uses recorded net after the actual collection difference");
assert.equal(rows.find(row=>row.shipment.id==="delivered").kind,"delivered","delivered without proof remains unconfirmed");
assert.equal(rows.find(row=>row.shipment.id==="transit").kind,"in_transit","in-transit amount is only potential");
assert.equal(rows.find(row=>row.shipment.id==="reversed").kind,"delivered","reversed proof is not counted as collected");
assert.equal(rows.reduce((sum,row)=>sum+row.net,0),1350,"open amounts are not duplicated by direct receipt or settlement");
assert(app.includes('["carrier-receivables","مستحقات شركات الشحن",["view-financial-reports"]]'),"report is permission-gated in finance tabs");
assert(app.includes('financeTab==="carrier-receivables"'),"report is reachable from finance navigation");
const renderEnd=app.indexOf("\nfunction renderFinancialReports()",end);
const context=vm.createContext({
  data:db,carrierReceivablesCompany:"",carrierReceivablesSearch:"",financeTabsMarkup:()=>"",
  normalizeSmartSearch:value=>String(value||"").toLowerCase(),smartFilter:(items,query,valuesOf)=>!query?items:items.filter(item=>valuesOf(item).join(" ").toLowerCase().includes(String(query).toLowerCase())),shipmentFinanceValues:finance,shipmentStatusCode:status,
  moneyCents:value=>Math.round(Number(value||0)*100),centsMoney:value=>Number((value/100).toFixed(2)),money:value=>`${value} ج.م`,
  statCard:(label,value)=>`<section>${label}: ${value}</section>`,esc:value=>String(value??""),fmtDate:value=>value,
  badge:value=>`<em>${value}</em>`,shipmentStatusMeta:row=>({label:row.status})
});
vm.runInContext(app.slice(start,renderEnd),context);
const html=vm.runInContext("renderCarrierReceivables()",context);
assert.match(html,/مستحق مثبت لدى الشركات: 280 ج\.م/,"confirmed balance is visually separate from estimates");
assert.match(html,/إجمالي محتمل خارج المكتبة: 1350 ج\.م/,"potential total includes open stages only");
assert.match(html,/data-action="view-shipment"/,"detail rows link to their source shipment");
console.log("Carrier receivables report tests passed.");
