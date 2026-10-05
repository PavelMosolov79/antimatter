// Takes what the film page sends (contact sheets, the finished video) and writes it to a folder.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function startServer(outDir, port = 5599) {
  mkdirSync(outDir, { recursive: true });
  const saved = [];
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.end();
    if (req.method === 'GET') {
      const file = join(outDir, new URL(req.url, 'http://x').pathname.slice(1));
      if (!existsSync(file)) {
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader('Content-Type', file.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');
      return createReadStream(file).pipe(res);
    }
    const name = new URL(req.url, 'http://x').searchParams.get('name') ?? 'file.bin';
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const path = join(outDir, name);
      writeFileSync(path, Buffer.concat(chunks));
      saved.push(path);
      res.end('ok');
    });
  });
  server.listen(port);
  return { saved, close: () => server.close() };
}
