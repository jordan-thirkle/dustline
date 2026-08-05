// DUSTLINE production entrypoint: same-origin static client + WebSocket server.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createServer } from './index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
};

const httpServer = http.createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent((req.url || '/').split('?')[0]);
    const pathname = requested === '/' ? '/index.html' : requested;
    const file = normalize(join(ROOT, pathname));
    if (!file.startsWith(ROOT)) throw new Error('invalid path');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': file.endsWith('update.json') ? 'no-store' : 'public, max-age=60',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server: httpServer, path: '/' });
const game = createServer({ server: httpServer, wss });

httpServer.listen(PORT, () => console.log(`DUSTLINE production server on :${PORT}`));

process.on('SIGTERM', () => {
  game.close();
  wss.close();
  httpServer.close(() => process.exit(0));
});
process.on('SIGINT', () => process.emit('SIGTERM'));
