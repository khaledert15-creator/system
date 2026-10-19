'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/app.js','utf8');
function fn(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2);}
// The whole smart search block, from the normalizer to the row filter, with its constants.
const blockStart=source.indexOf('function normalizeSmartSearch('),blockEnd=source.indexOf('function normalizeArabicDigits(');
assert(blockStart>=0&&blockEnd>blockStart,'smart search block');
const c={data:{books:[]},itemTypeLabel:()=>''};vm.createContext(c);
vm.runInContext([source.slice(blockStart,blockEnd),fn('normalizeArabicDigits'),fn('bookSearchFields'),fn('smartBookSearch'),
 'Object.assign(globalThis,{smartMatch,smartFilter,smartBookSearch});'].join('\n'),c);

const order=['ORD-0156','INV-0131','انور محمد عبده','01200470083','الغربية، المحلة الكبرى','EN50571608EG'];
const cases=[
 ['أنور',true,'hamza on alef'],['انور عبده',true,'words in any order'],['عبده انور',true,'reversed order'],['انور احمد',false,'every word must match'],
 ['156',true,'order number by digits'],['ORD-156',true,'order code without zero padding'],['0131',true,'invoice digits'],
 ['01200470083',true,'full phone'],['0120 047 0083',true,'phone with spaces'],['+201200470083',true,'phone with +20'],['1200470083',true,'phone without leading zero'],['٠١٢٠٠٤٧٠٠٨٣',true,'Arabic numerals'],
 ['المحله',true,'ta marbuta vs ha'],['غربيه',true,'without ال'],['محلة',true,'without ال and with ة'],['en50571608eg',true,'tracking code any case'],
 ['انوور',true,'one typo'],['مكتبه',false,'unrelated word'],['',true,'empty query shows everything'],
];
for(const [query,expected,label] of cases)assert.equal(c.smartMatch(query,order),expected,`${label}: ${query}`);
console.log('PASS smart search handles spelling, word order, numbers, phones and typos');

// Real book names from the store: the same subject and grade are written many ways.
const book=(query,name,expected=true)=>assert.equal(c.smartMatch(query,[name],false),expected,`${query} → ${name}`);
book('فيزيا','الخبير فيزياء 3ث');book('فيزياء','الخبير فيزيا بنك الاسأله 3ث');book('فيزيكس','التفوق فيزياء 3ث');
book('كيميستري','التفوق كيمياء 3ث');book('كيمياء','الوافي كيميستري أساله 3ث');book('بايو','المرجع احياء شرح 3ث');book('احياء','المرجع بايو 3ث');
book('اسئلة','نيوتن اسأله 3ث');book('انجلش 1ث','فنتاستيك انجليزي 1ث');book('الأضواء عربي','الأضواء لغة عربية 6 ابتدائي');
book('تالته ثانوي','نيوتن اسأله 3ث');book('الصف الثالث الثانوي فيزياء','التفوق فيزياء 3ث');book('3ث','ماي نيوفريند للصف الثالث الثانوى ترم ثاني');
book('3 ث','المعاصر انجليزي 3ث');book('اولى ثانوي','فنتاستيك انجليزي 1ث');book('اعدادي 3','المعاصر رياضيات 3 إعدادي');
book('بكالوريا 2 فيزياء','الوافي فيزياء 2 باكلوريا');book('2بكالوريا عربي','الامتحان عربي 2 بكالوريا');book('عربي 2 بكالوريا','البرهان عربي 2بكالوريا');
book('كيمياء 3ث','التفوق فيزياء 3ث',false);book('اولي ثانوي','المعاصر رياضيات 2 باكلوريا ترم اول',false);book('احمد','محمد علي',false);
console.log('PASS bookstore spellings: subjects, grades, باكلوريا and أسئلة variants match each other');

const names=list=>list.map(item=>item.name);
const customers=[{name:'محمود علي'},{name:'محمد علي'},{name:'أحمد سمير'}];
assert.deepEqual(names(c.smartFilter(customers,'محمود',x=>[x.name])),['محمود علي'],'an exact match hides near names');
assert.deepEqual(names(c.smartFilter(customers.slice(1),'محمود',x=>[x.name])),['محمد علي'],'typos are tolerated only when nothing matches exactly');
assert.deepEqual(names(c.smartFilter(customers,'',x=>[x.name])).length,3,'empty query keeps the list');
console.log('PASS list search shows exact matches first and falls back to typo tolerance');

c.data.books=[{id:'B1',name:'التفوق فيزياء 3ث',barcode:'9771'},{id:'B2',name:'الوافي فيزيكس 3ث'},{id:'B3',name:'نيوتن اسأله 3ث'},{id:'B4',name:'الوافي فيزياء 2 باكلوريا'},{id:'B5',name:'قديم',deletedAt:'x'}];
assert.deepEqual(names(c.smartBookSearch('فيزياء 3ث',8)),['التفوق فيزياء 3ث','الوافي فيزيكس 3ث'],'all words, synonyms included, best name match first');
assert.deepEqual(names(c.smartBookSearch('9771',8)),['التفوق فيزياء 3ث'],'barcode');
assert.deepEqual(names(c.smartBookSearch('نيوتن فيزياء',8)).sort(),['التفوق فيزياء 3ث','الوافي فيزياء 2 باكلوريا','الوافي فيزيكس 3ث','نيوتن اسأله 3ث'].sort(),'no book has both words: show the closest ones');
assert.deepEqual(names(c.smartBookSearch('قديم',8)),[],'deleted books are hidden');
console.log('PASS book search ranks books and falls back to partial matches');
