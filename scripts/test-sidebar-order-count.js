const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const s=fs.readFileSync('app/app.js','utf8');
function fn(name){const start=s.indexOf(`function ${name}(`);return s.slice(start,s.indexOf('\n}',start)+2);}
const badges={};const context={data:{onlineOrders:[{status:'جديد'},{workflowStage:'preparing'},{workflowStage:'awaiting_shipping'},{workflowStage:'shipped',shipmentId:'S1'},{status:'تم التسليم'},{status:'ملغي'},{status:'جديد',deletedAt:'today'}],shipments:[{status:'خرج للتوصيل'}]},document:{getElementById:id=>badges[id] ||= {textContent:'',hidden:true}}};
vm.createContext(context);vm.runInContext(fn('onlineOrderWorkflowStage')+'\n'+fn('updateSidebarBadges'),context);context.updateSidebarBadges();
assert.equal(badges['nav-orders-badge'].textContent,3);assert.equal(badges['nav-shipping-badge'].textContent,1);
console.log('PASS order badge counts only new, preparing and ready orders; shipped orders remain in shipping count');
