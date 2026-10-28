'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/app.js','utf8'),css=fs.readFileSync('app/styles.css','utf8');
function fn(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2);}
const blockStart=source.indexOf('function normalizeSmartSearch('),blockEnd=source.indexOf('function normalizeArabicDigits(');

// A tiny DOM: the search input, its dropdown, the table body and the count.
const el=id=>({id,innerHTML:'',textContent:'',value:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;}});
const nodes={'party-search':el('party-search'),'party-search-suggestions':el('party-search-suggestions'),'party-table-body':el('party-table-body'),'party-search-count':el('party-search-count')};
const customers=[
 {id:'C001',name:'عبير مصطفى',phone:'01116340734',type:'تجزئة',balance:520,creditLimit:0},
 {id:'C002',name:'عمر ماجد سعدالدين مصطفى',phone:'01091380820',type:'تجزئة',balance:135,creditLimit:0,governorate:'القاهرة'},
 {id:'C004',name:'عبير محذوفة',phone:'01200000000',type:'تجزئة',balance:0,creditLimit:0,deletedAt:'2026-10-29T10:00:00Z'},
 {id:'C003',name:'محمد ابراهيم السيد',phone:'01144696287',type:'تجزئة',balance:130,creditLimit:0},
 ...Array.from({length:12},(_,i)=>({id:`C1${String(i).padStart(2,'0')}`,name:`احمد مصطفى ${i}`,phone:`0100000000${i}`,type:'جملة',balance:0,creditLimit:0})),
];
const c={data:{customers,suppliers:[]},partyTab:'customers',partySearchTerm:'',itemTypeLabel:()=>'',
 document:{getElementById:id=>nodes[id],activeElement:nodes['party-search']},
 esc:v=>String(v??''),money:v=>`${v} ج.م`,badge:v=>v,partyRow:item=>`<tr>${item.id}</tr>`,scheduleStickyTableScrollbar(){}};
vm.createContext(c);
vm.runInContext([source.slice(blockStart,blockEnd),fn('normalizeArabicDigits'),fn('normalizePhone'),fn('recordPhones'),fn('phonesText'),fn('customerSearchFields'),fn('activeParties'),fn('filterParties'),fn('renderPartySearchSuggestions'),fn('closePartySearchSuggestions')].join('\n'),c);
const search=q=>{nodes['party-search'].value=q;c.filterParties();return nodes['party-search-suggestions'].innerHTML;};

let html=search('عبير');
assert.match(html,/data-action="party-search-pick" data-id="C001" data-kind="customer"/);
assert.match(html,/01116340734/);assert.match(html,/520 ج\.م/);
assert.equal(nodes['party-search'].attrs['aria-expanded'],'true');
assert.doesNotMatch(html,/C004/);assert.doesNotMatch(nodes['party-table-body'].innerHTML,/C004/);
console.log('PASS typing a name lists the matching customer with code, phone and balance; deleted ones are not listed');

html=search('0109 138 0820');
assert.match(html,/data-id="C002"/);assert.doesNotMatch(html,/data-id="C001"/);
console.log('PASS phone with spaces finds the customer');

html=search('مصطفى');
assert.equal((html.match(/party-search-pick/g)||[]).length,8);assert.match(html,/و٦ نتيجة أخرى في الجدول/);
console.log('PASS the dropdown shows at most 8 and says how many more are in the table');

assert.match(search('زززز'),/لا يوجد عميل مطابق/);
assert.equal(search(''),'');assert.equal(nodes['party-search'].attrs['aria-expanded'],'false');
console.log('PASS no match says so; an empty box closes the dropdown');

c.document.activeElement=null;assert.equal(search('عبير'),'');
console.log('PASS the dropdown stays closed when the box is not focused (page render)');

assert.match(source,/if \(action === "party-search-pick"\) \{ closePartySearchSuggestions\(\); showStatement\(target\.dataset\.id, target\.dataset\.kind\); \}/);
assert.match(source,/if \(event\.key === "Enter" && event\.target === input\) \{ event\.preventDefault\(\); list\?\.querySelector\("button"\)\?\.click\(\)/);
assert.match(source,/if\(!event\.target\.closest\?\.\("\.party-search"\)\)closePartySearchSuggestions\(\)/);
assert.match(css,/\.party-search-suggestions \{[^}]*position: absolute/);assert.match(css,/\.party-search-suggestions:empty \{ display: none; \}/);
console.log('PASS picking a result (click or Enter) opens the statement; clicking outside closes it');
