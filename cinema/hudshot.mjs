// Screenshots of the real battle HUD, phone and desktop (node cinema/hudshot.mjs), to look at before redesigning it.
import { launch } from './cdp.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [name, opts] of [['mobile', { width: 430, height: 932, scale: 2, mobile: true, port: 9333 }], ['desktop', { width: 1280, height: 800, port: 9334 }]]) {
  const b = await launch(opts);
  await b.equip();
  await b.goto('http://localhost:5173/');
  await wait(4500);
  await b.eval(`(()=>{const g=window.__antimatter.game; g.reset('cruiser','squad'); g.screen='game'; document.getElementById('title').style.display='none';})()`);
  await wait(6000);
  await b.shot('/tmp/hud-' + name + '.png');
  b.close();
}
