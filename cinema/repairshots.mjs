// Screenshots of the dock's repair screen, a ship shot to pieces and then mended step by step (node cinema/repairshots.mjs).
import { launch } from './cdp.mjs';
const b = await launch({ width: 1080, height: 1920 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await b.equip();
await b.goto('http://localhost:5173/');
await wait(4500);
const click = (txt, sel = 'button') => b.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.offsetParent&&e.textContent.trim().toLowerCase().startsWith(${JSON.stringify(txt.toLowerCase())}));if(!e)return 'none:${txt}';e.click();return 'ok'})()`);
const SHIP = process.argv[2] ?? 'cruiser';
console.log(await click('Док'));
await wait(1200);
// the ship comes back from a hard fight
console.log(await b.eval(`(async()=>{
  const A = window.__antimatter, g = A.game;
  const { World } = await import('/src/sim/world.ts');
  const { captureShip } = await import('/src/sim/runSave.ts');
  const { SHIPS } = await import('/src/sim/ships.ts');
  const { storeGarage, entryOf } = await import('/src/sim/garage.ts');
  const spec = SHIPS.find(s => s.id === ${JSON.stringify(SHIP)});
  const bp = spec.build();
  const w = new World(5);
  const body = w.spawnShip(spec.build(), 0, 0, 0, { name: 'x', team: 0, player: true, duty: g.duty(spec.id) });
  let s = 11; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 16; i++) {
    const wp = body.localToWorld(body.grid.width * (0.2 + 0.6 * rnd()), body.grid.height * (0.1 + 0.8 * rnd()), { x: 0, y: 0 });
    w.explode(wp.x, wp.y, 3 + rnd() * 5, 260, 1);
  }
  w.processDamaged();
  const saved = captureShip(w.player || body, bp);
  g.garage[spec.id] = { damage: saved, job: null };
  storeGarage(g.garage);
  g.wallet.metal = 5000; g.wallet.credits = 500;
  g.openDock(spec.id);
  return JSON.stringify({ hurt: saved.hp.length, gone: saved.gone.length });
})()`));
await wait(1500);
console.log(await click('Ремонт'));
await wait(1500);
await b.shot('cinema/assets/repair-0.png');
console.log(await click('Начать ремонт'));
await wait(700);
const N = 16;
for (let i = 1; i <= N; i++) {
  const p = Math.min(0.995, (i - 1) / (N - 1));
  await b.eval(`(()=>{ const g = window.__antimatter.game; const e = g.garage[${JSON.stringify(SHIP)}]; if (e && e.job) { e.job.total = 20; e.job.start = Date.now() - ${p} * 20000; } })()`);
  await wait(450);
  await b.shot('cinema/assets/repair-' + i + '.png');
}
await wait(300);
await b.eval(`(()=>{ const g = window.__antimatter.game; const e = g.garage[${JSON.stringify(SHIP)}]; if (e && e.job) { e.job.start = Date.now() - 25000; } })()`);
await wait(1200);
await b.shot('cinema/assets/repair-' + (N + 1) + '.png');
b.close();
