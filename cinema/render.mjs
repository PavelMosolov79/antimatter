// node cinema/render.mjs preview|final [from] [to]
import { launch } from './cdp.mjs';
import { startServer } from './server.mjs';

const mode = process.argv[2] ?? 'preview';
const out = process.env.CINEMA_OUT ?? '/tmp/cinema-out';
const srv = startServer(out);
const b = await launch({ width: 1080, height: 1920 });
b.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled') console.log('page:', m.params.args.map((a) => a.value ?? a.description).join(' '));
});
await b.equip();
await b.goto('http://localhost:5173/cinema/index.html');
for (let i = 0; i < 80 && !(await b.eval('typeof window.__ready !== "undefined"')); i++) await new Promise((r) => setTimeout(r, 250));
await b.eval('window.__ready');
const t0 = Date.now();
const res = await b.eval(`window.__render(${JSON.stringify({ mode, from: Number(process.argv[3] ?? 0), to: Number(process.argv[4] ?? 15) })})`);
console.log('done in', ((Date.now() - t0) / 1000).toFixed(1), 's', res, srv.saved);
b.close();
srv.close();
