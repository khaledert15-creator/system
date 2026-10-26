#!/usr/bin/env node
// Runs the real quickOrderLastBookDiscount from app.js against sample orders and invoices.
const fs=require("fs"),path=require("path"),assert=require("assert"),vm=require("vm");
const root=path.resolve(__dirname,".."),app=fs.readFileSync(path.join(root,"app/app.js"),"utf8");
const OrderFinance=require(path.join(root,"app/order-finance.js"));

function extract(name){
  const start=app.indexOf(`function ${name}(`);
  assert(start>=0,`${name} not found`);
  let depth=0,i=app.indexOf("{\n",start);
  for(;i<app.length;i++){if(app[i]==="{")depth++;else if(app[i]==="}"&&--depth===0)break;}
  return app.slice(start,i+1);
}

const context={OrderFinance,data:{},getBook:id=>context.data.books.find(book=>book.id===id)};
vm.createContext(context);
vm.runInContext(`${extract("onlineOrderWorkflowStage")}\n${extract("quickOrderLastBookDiscount")}`,context);
const last=bookId=>context.quickOrderLastBookDiscount(bookId);
const order=(id,createdAt,line,extra={})=>({id,createdAt,updatedAt:createdAt,status:"قيد التجهيز",workflowStage:"awaiting_preparation",lines:[{bookId:"B1",qty:1,price:100,discountScope:"unit",...line}],...extra});
let passed=0;const check=(name,fn)=>{fn();passed++;console.log(`PASS ${name}`);};

check("wholesale invoices are ignored",()=>{
  context.data={books:[{id:"B1",price:100}],onlineOrders:[order("ORD-1","2026-10-01T10:00:00Z",{discount:10,discountType:"percent"})],
    sales:[{id:"INV-9",date:"2026-10-20",channel:"جملة",lines:[{bookId:"B1",qty:10,price:100,discount:35,discountType:"percent"}]}]};
  assert.deepStrictEqual([last("B1").percent,last("B1").reference],[10,"ORD-1"]);
});

check("a whole-line amount is spread over the copies",()=>{
  context.data={books:[{id:"B1",price:50}],onlineOrders:[order("ORD-2","2026-10-02T10:00:00Z",{qty:10,price:50,discount:200,discountType:"amount",discountScope:"line"})],sales:[]};
  assert.strictEqual(last("B1").percent,40);
});

check("a per-copy amount becomes its percent",()=>{
  context.data={books:[{id:"B1",price:80}],onlineOrders:[order("ORD-3","2026-10-02T10:00:00Z",{qty:3,price:80,discount:20,discountType:"amount"})],sales:[]};
  assert.strictEqual(last("B1").percent,25);
});

check("cancelled, refused, returned, draft and deleted orders are ignored",()=>{
  context.data={books:[{id:"B1",price:100,discount:0}],sales:[],onlineOrders:[
    order("ORD-1","2026-10-01T10:00:00Z",{discount:5,discountType:"percent"}),
    order("ORD-2","2026-10-02T10:00:00Z",{discount:50,discountType:"percent"},{status:"ملغي",workflowStage:"cancelled"}),
    order("ORD-3","2026-10-03T10:00:00Z",{discount:60,discountType:"percent"},{status:"مرتجع",workflowStage:"returned",refusedAt:"2026-10-05T10:00:00Z",refusal:{id:"RET-1"}}),
    order("ORD-4","2026-10-04T10:00:00Z",{discount:70,discountType:"percent"},{status:"مسودة",workflowStage:"draft"}),
    order("ORD-5","2026-10-05T10:00:00Z",{discount:80,discountType:"percent"},{deletedAt:"2026-10-06T10:00:00Z"}),
    order("ORD-6","2026-10-06T10:00:00Z",{discount:90,discountType:"percent"},{status:"تم الشحن",workflowStage:"shipped",returnedAt:"2026-10-09T10:00:00Z"})
  ]};
  assert.deepStrictEqual([last("B1").percent,last("B1").reference],[5,"ORD-1"]);
});

check("the newest order wins even when an older one was updated later",()=>{
  const old=order("ORD-1","2026-09-01T10:00:00Z",{discount:30,discountType:"percent"},{status:"تم الشحن",workflowStage:"shipped"});
  old.updatedAt="2026-10-25T10:00:00Z";
  context.data={books:[{id:"B1",price:100}],sales:[],onlineOrders:[old,order("ORD-2","2026-10-01T10:00:00Z",{discount:15,discountType:"percent"})]};
  assert.deepStrictEqual([last("B1").percent,last("B1").reference],[15,"ORD-2"]);
});

check("without order history the product's own discount is used",()=>{
  context.data={books:[{id:"B1",price:100,discount:12}],onlineOrders:[],sales:[{id:"INV-1",date:"2026-10-20",lines:[{bookId:"B1",qty:1,price:100,discount:40,discountType:"percent"}]}]};
  assert.deepStrictEqual([last("B1").percent,last("B1").found],[12,false]);
});

console.log(`${passed}/${passed} quick order last discount tests passed`);
