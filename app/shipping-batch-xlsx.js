"use strict";

const zlib = typeof require === "function" ? require("zlib") : null;

const UPLOAD_HEADERS = ["Package_Serial","Description","Total_Weight","Package_volume","COD_Value","Item_Special_Notes","Customer_Name","Mobile_No","Street","City","Package_Ref. Number","Merchant_Name","Warehouse_Name","HasPOD","SellerName","Post_Id"];
const LOOKUP_ROWS = [
  ["Service_Type","Service_Category","Payment_Type","Service","City","ReturnServiceType","Packagevolume"],
  ["Door-to-Door","Delivery","Pre-Paid","Same Day","CAIRO","Door-to-Door","Small"],
  ["Door-to-Counter","Return","Cash-on-Delivery","Next Day","GIZA","Counter-to-Door","medium"],
  ["","","CC-on-Delivery","","ALEXANDRIA","","Large"],
  ["","","Paid","","BEHIRA","",""],
  ...["QALIUBIA","GHARBIA","MONOUFIA","DOMITTA","DAKAHLIA","KAFR EL SHEIKH","MARSA MATROUH","ISMAILIA","SUEZ","PORT SAID","SHARKIA","FAYOUM","BANI SWEIF","MENIA","ASSIUT","SOUHAGE","QENA","ASWAN","LOUXOR","RED SEA"].map(city=>["","","","",city,"",""])
];
const CITY_MAP = new Map([
  ["القاهرة","CAIRO"],["الجيزة","GIZA"],["الاسكندرية","ALEXANDRIA"],["الإسكندرية","ALEXANDRIA"],["البحيرة","BEHIRA"],["القليوبية","QALIUBIA"],["الغربية","GHARBIA"],["المنوفية","MONOUFIA"],["دمياط","DOMITTA"],["الدقهلية","DAKAHLIA"],["كفر الشيخ","KAFR EL SHEIKH"],["مطروح","MARSA MATROUH"],["الإسماعيلية","ISMAILIA"],["الاسماعيلية","ISMAILIA"],["السويس","SUEZ"],["بورسعيد","PORT SAID"],["بور سعيد","PORT SAID"],["الشرقية","SHARKIA"],["الفيوم","FAYOUM"],["بني سويف","BANI SWEIF"],["المنيا","MENIA"],["أسيوط","ASSIUT"],["اسيوط","ASSIUT"],["سوهاج","SOUHAGE"],["قنا","QENA"],["أسوان","ASWAN"],["اسوان","ASWAN"],["الأقصر","LOUXOR"],["الاقصر","LOUXOR"],["البحر الأحمر","RED SEA"],["البحر الاحمر","RED SEA"]
]);

function xmlEscape(value="") { return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"); }
function xmlDecode(value="") { return String(value).replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&"); }
function columnName(index){let out="";for(let n=index+1;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;}
function sheetXml(rows){
  const body=rows.map((row,r)=>`<row r="${r+1}">${row.map((value,c)=>{if(value===null||value===undefined||value==="")return "";const ref=`${columnName(c)}${r+1}`;return typeof value==="number"?`<c r="${ref}"><v>${value}</v></c>`:`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;}).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}
let crcTable;
function crc32(buffer){if(!crcTable)crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});let crc=0xffffffff;for(const byte of buffer)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function zipStore(files){
  const locals=[],centrals=[];let offset=0;
  for(const [name,content] of Object.entries(files)){const nameBuf=Buffer.from(name),data=Buffer.isBuffer(content)?content:Buffer.from(content),crc=crc32(data),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(0,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(nameBuf.length,26);locals.push(local,nameBuf,data);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(nameBuf.length,28);central.writeUInt32LE(offset,42);centrals.push(central,nameBuf);offset+=local.length+nameBuf.length+data.length;}
  const centralSize=centrals.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,...centrals,end]);
}
function workbookBuffer(rows){
  if(!zlib)throw new Error("XLSX generation requires Node.js");
  return zipStore({
    "[Content_Types].xml":`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels":`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml":`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="Sheet2" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml":sheetXml([UPLOAD_HEADERS,...rows]),"xl/worksheets/sheet2.xml":sheetXml(LOOKUP_ROWS)
  });
}
function unzip(buffer){
  if(!zlib)throw new Error("XLSX parsing requires Node.js");const files=new Map();let pos=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));if(pos<0)throw new Error("ملف Excel غير صالح.");const count=buffer.readUInt16LE(pos+10),centralOffset=buffer.readUInt32LE(pos+16);pos=centralOffset;
  for(let i=0;i<count;i++){if(buffer.readUInt32LE(pos)!==0x02014b50)break;const method=buffer.readUInt16LE(pos+10),compressed=buffer.readUInt32LE(pos+20),nameLen=buffer.readUInt16LE(pos+28),extraLen=buffer.readUInt16LE(pos+30),commentLen=buffer.readUInt16LE(pos+32),localOffset=buffer.readUInt32LE(pos+42),name=buffer.slice(pos+46,pos+46+nameLen).toString();const localNameLen=buffer.readUInt16LE(localOffset+26),localExtraLen=buffer.readUInt16LE(localOffset+28),start=localOffset+30+localNameLen+localExtraLen,raw=buffer.slice(start,start+compressed);files.set(name,method===8?zlib.inflateRawSync(raw):raw);pos+=46+nameLen+extraLen+commentLen;}return files;
}
function parseSheet(buffer){
  const files=unzip(buffer),sharedXml=files.get("xl/sharedStrings.xml")?.toString()||"",shared=[...sharedXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map(m=>xmlDecode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join(""))),xml=(files.get("xl/worksheets/sheet1.xml")||files.get("xl/worksheets/sheet.xml"))?.toString();if(!xml)throw new Error("لم يتم العثور على ورقة الشحنات داخل الملف.");const rows=[];
  for(const rowMatch of xml.matchAll(/<row[^>]*r="?(\d+)"?[^>]*>([\s\S]*?)<\/row>/g)){const row=[];for(const cell of rowMatch[2].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)){const attrs=cell[1],body=cell[2],ref=attrs.match(/\br="([A-Z]+)\d+"/)?.[1];if(!ref)continue;const type=attrs.match(/\bt="([^"]+)"/)?.[1]||"",index=[...ref].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1,inline=[...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join(""),v=body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1]??inline;row[index]=type==="s"?shared[Number(v)]??"":type==="inlineStr"?xmlDecode(inline):xmlDecode(v);}rows.push(row);}return rows;
}
function cityCode(value=""){const key=String(value).trim();return CITY_MAP.get(key)||key.toUpperCase();}
function orderDescription(order,books=[]){const names=(order.lines||[]).map(line=>{const book=books.find(item=>item.id===(line.bookId||line.productId));return `${book?.name||line.bookName||line.bookId} × ${Number(line.qty||1)}`;});return `[ORDER:${order.id}]\n${names.join("\n")}`;}
function orderToUploadRow(order,{books=[],merchantName="مكتبة دوت كوم",warehouseName="المخزن الرئيسي"}={}){const paid=Number(order.paidAmount||0),cod=Math.max(0,Number(order.total||0)-paid),units=(order.lines||[]).reduce((sum,line)=>sum+Number(line.qty||0),0);return [order.id,orderDescription(order,books),Math.max(500,units*500),"Small",cod,order.notes||"",order.customerName||"",order.phone||"",[order.address,order.city].filter(Boolean).join(" - "),cityCode(order.governorate),order.id,merchantName,warehouseName,"No","مكتبة دوت كوم",""];}
function normalizeDigits(value=""){return String(value).replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();}
function normalizePhone(value=""){return normalizeDigits(value).replace(/\D/g,"");}
function extractOrderId(text=""){return String(text).match(/\[ORDER\s*:\s*([^\]]+)\]/i)?.[1]?.trim().toUpperCase()||String(text).match(/\bORD-[A-Z0-9-]+\b/i)?.[0]?.toUpperCase()||"";}
function packageRows(buffer){const rows=parseSheet(buffer),headerIndex=rows.findIndex(row=>row.some(value=>String(value||"").trim()==="BareCode"));if(headerIndex<0)throw new Error("لم يتم العثور على أعمدة ملف Packages.");const headers=rows[headerIndex].map(value=>String(value||"").trim()),index=name=>headers.findIndex(value=>value===name);return rows.slice(headerIndex+1).map(row=>({trackingNumber:String(row[index("BareCode")]||row[index("Reference Number")]||"").trim().toUpperCase(),referenceNumber:String(row[index("Reference Number")]||"").trim(),status:String(row[index("Status Name")]||"").trim(),customerName:String(row[index("Customer Name")]||"").trim(),phone:normalizePhone(row[index("رقم الهاتف")]),cod:Number(row[index("COD Value")]||0),description:String(row[index(" وصف المحتوى")]||row[index("وصف المحتوى")]||"").trim(),orderId:extractOrderId(row[index(" وصف المحتوى")]||row[index("وصف المحتوى")]||"")})).filter(row=>row.trackingNumber&&(row.phone||row.customerName));}

const api={UPLOAD_HEADERS,LOOKUP_ROWS,cityCode,orderDescription,orderToUploadRow,workbookBuffer,packageRows,extractOrderId,normalizePhone};
if(typeof module!=="undefined")module.exports=api;
