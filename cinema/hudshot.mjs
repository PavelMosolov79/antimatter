// Screenshots of the real battle HUD in a run (phone and computer): node cinema/hudshot.mjs [wait-seconds]
import { launch } from './cdp.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = Number(process.argv[2] ?? 8);
const errs = [];
for (const [name, opts] of [['mobile', { width: 430, height: 932, scale: 2, mobile: true, port: 9333 }], ['desktop', { width: 1280, height: 800, port: 9334 }]]) {
  const b = await launch(opts);
  b.on((m) => { if (m.method === 'Runtime.exceptionThrown') errs.push(name + ': ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)); });
  await b.equip();
  await b.goto('http://localhost:5173/');
  await wait(4500);
  await b.eval(`(()=>{const g=window.__antimatter.game; g.screen='game'; document.getElementById('title').style.display='none'; for (const id of ['dock','mods','crew','road']) { const e=document.getElementById(id); if (e) e.style.display='none'; } g.openDock('cruiser');})()`);
  await wait(800);
  await b.eval(`window.__antimatter.game.startRun()`);
  await wait(800);
  await b.eval(`window.__antimatter.game.travel(1)`);
  await wait(secs * 1000);
  console.log(name, await b.eval(`(()=>{const g=window.__antimatter.game; return JSON.stringify({t:g.world.time.toFixed(1), log:g.dispatcher.log.map(m=>m.title+'@'+m.at.toFixed(1)+'x'+m.n), foes:g.world.bodies.filter(b=>b.sys&&b.sys.team===1).map(b=>b.id+b.sys.name+(b.sys.dead?'dead':''))})})()`));
  await b.shot('/tmp/hud-' + name + '.png');
  if (process.argv[3] === 'deck') {
    await b.eval(`(()=>{const g=window.__antimatter.game, w=g.world, p=w.player; for (const [fx,fy] of [[.5,.52],[.3,.6],[.7,.45]]) { const q=p.localToWorld(p.grid.width*fx, p.grid.height*fy,{x:0,y:0}); w.explode(q.x,q.y,4.5,500,1); } })()`);
    await wait(2500);
    await b.eval(`(()=>{const g=window.__antimatter.game; g.scene.layerView=2; g.scene.zoom=1.1;})()`);
    await wait(1500);
    await b.shot('/tmp/hud-' + name + '-deck.png');
  }
  b.close();
}
console.log(errs.join('\n') || 'no errors');
