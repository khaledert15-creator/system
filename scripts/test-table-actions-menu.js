const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const s=fs.readFileSync('app/app.js','utf8'),start=s.indexOf('function positionTableActionsMenu('),fn=s.slice(start,s.indexOf('\n}',start)+2);
const c={window:{innerWidth:1000,innerHeight:700}};vm.createContext(c);vm.runInContext(fn,c);
function place(anchor,width=180,height=160){const panel={style:{},getBoundingClientRect:()=>({width,height})};c.positionTableActionsMenu({open:true,querySelector:s=>s==='summary'?{getBoundingClientRect:()=>anchor}:panel});return panel.style;}
let style=place({left:30,top:600,bottom:640});assert.equal(style.position,'fixed');assert.equal(style.top,'434px');assert.equal(style.left,'30px');
style=place({left:900,top:50,bottom:90});assert.equal(style.top,'96px');assert.equal(style.left,'812px');
c.window={innerWidth:320,innerHeight:240};style=place({left:5,top:130,bottom:170},180,400);assert.equal(style.left,'8px');assert.equal(style.top,'8px');assert.equal(style.maxHeight,'116px');
console.log('PASS last-row menu opens upward; right-edge and small-screen menus stay inside viewport');
