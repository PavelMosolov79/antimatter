// node cinema/verify.mjs [file]: plays the finished video in Chrome, saves a contact sheet of it and reports its sound.
import { launch } from './cdp.mjs';
import { startServer } from './server.mjs';
const out = process.env.CINEMA_OUT ?? '/tmp/cinema-out';
const file = process.argv[2] ?? 'antimatter-promo.mp4';
const srv = startServer(out);
const b = await launch({ width: 1080, height: 1920 });
await b.goto('http://localhost:5173/cinema/equip.html');
const res = await b.eval(`(async()=>{
  const url='http://127.0.0.1:5599/${file}';
  const v=document.createElement('video'); v.crossOrigin='anonymous'; v.src=url; v.muted=true; v.preload='auto';
  await new Promise((r,j)=>{v.onloadedmetadata=r; v.onerror=()=>j(new Error('video error '+(v.error&&v.error.message)));});
  const info={duration:v.duration,w:v.videoWidth,h:v.videoHeight};
  const TW=216,TH=384,cols=10; const sheet=document.createElement('canvas'); sheet.width=cols*TW; sheet.height=4*TH; const g=sheet.getContext('2d');
  let next=0; const sums=[];
  await new Promise(done=>{
    const cb=(now,meta)=>{ if(meta.mediaTime>=next){ const i=Math.round(next/0.5); g.drawImage(v,(i%cols)*TW,Math.floor(i/cols)*TH,TW,TH); g.fillStyle='#fff'; g.font='16px monospace'; g.fillText(meta.mediaTime.toFixed(2),(i%cols)*TW+6,Math.floor(i/cols)*TH+18); next+=0.5; }
      if(v.ended||meta.mediaTime>=v.duration-0.08) return done(); v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb); v.onended=done; v.play();
  });
  const blob=await new Promise(r=>sheet.toBlob(r,'image/png')); await fetch('http://127.0.0.1:5599/save?name=verify-sheet.png',{method:'POST',body:blob});
  const ac=new AudioContext(); const buf=await ac.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const d=buf.getChannelData(0); let peak=0; const rms=[]; for(let s=0;s<Math.floor(buf.duration);s++){let sum=0; for(let i=s*buf.sampleRate;i<(s+1)*buf.sampleRate;i++){sum+=d[i]*d[i]; peak=Math.max(peak,Math.abs(d[i]));} rms.push(Math.sqrt(sum/buf.sampleRate).toFixed(2));}
  info.audio={channels:buf.numberOfChannels,dur:buf.duration,peak:peak.toFixed(2),rms:rms.join(' ')};
  return JSON.stringify(info);
})()`);
console.log(res);
b.close();
srv.close();
