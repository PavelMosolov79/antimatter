// node cinema/sheet.mjs a.png b.png ... : puts small copies of the pictures side by side in one image (for looking over)
import { launch } from './cdp.mjs';
import { startServer } from './server.mjs';
import { readFileSync } from 'node:fs';
const files = process.argv.slice(2);
const srv = startServer('/tmp/cinema-out');
const b = await launch({ width: 800, height: 600 });
await b.goto('http://localhost:5173/cinema/equip.html');
const imgs = files.map((f) => 'data:image/png;base64,' + readFileSync(f).toString('base64'));
await b.eval(`(async()=>{
  const list=${JSON.stringify(imgs)}; const TW=270, TH=480, cols=Math.min(8,list.length); const rows=Math.ceil(list.length/cols);
  const c=document.createElement('canvas'); c.width=cols*TW; c.height=rows*TH; const g=c.getContext('2d');
  for (let i=0;i<list.length;i++){ const im=new Image(); im.src=list[i]; await im.decode(); g.drawImage(im,(i%cols)*TW,Math.floor(i/cols)*TH,TW,TH); }
  const blob=await new Promise(r=>c.toBlob(r,'image/png')); await fetch('http://127.0.0.1:5599/save?name=sheet.png',{method:'POST',body:blob});
})()`);
b.close();
srv.close();
