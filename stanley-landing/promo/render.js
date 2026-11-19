const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();
for(const n of process.argv.slice(2)){const p=await b.newPage({viewport:{width:1080,height:1350},deviceScaleFactor:Number(process.env.DSF||1)});
await p.goto('file://'+__dirname+'/'+n+'.html',{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(300);
const f=await p.evaluate(()=>[...document.fonts].filter(x=>x.status==='loaded').map(x=>x.family).join(','));console.log(n,'fonts:',f);
await p.screenshot({path:n+(process.env.DSF==='2'?'@2x':'')+'.png'});await p.close();}
await b.close();})();
