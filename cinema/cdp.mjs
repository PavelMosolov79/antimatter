// A small driver for headless Chrome over the DevTools protocol (no dependencies): launch, navigate, evaluate, screenshot.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launch({ width = 1080, height = 1920, port = 9333, scale = 1, mobile = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cinema-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
  ], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {}
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) listeners.forEach((f) => f(msg));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: !!mobile });
  const api = {
    send,
    on: (f) => listeners.push(f),
    async goto(url) { await send('Page.navigate', { url }); await new Promise((r) => setTimeout(r, 500)); },
    async eval(expr, { await: aw = true } = {}) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: aw, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(path, clip) {
      const { writeFileSync } = await import('node:fs');
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    /** Builds the fully equipped ships into this browser's storage (cinema/layouts.ts) before the game loads. */
    async equip() {
      await this.goto('http://localhost:5173/cinema/equip.html');
      for (let i = 0; i < 40 && !(await this.eval('window.__equipped === true')); i++) await new Promise((r) => setTimeout(r, 250));
    },
    close() { try { ws.close(); } catch {} proc.kill(); },
  };
  return api;
}
