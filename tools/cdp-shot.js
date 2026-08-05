// DUSTLINE CDP screenshot + smoke-test tool.
// Loads the game in headless Chrome, captures console errors, saves a PNG.
// Usage: node tools/cdp-shot.js [--cam=plaza|alley|market|tower|gun|hud] [--out=path]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9222;
const PROFILE = resolve(ROOT, 'shots/.chromeprofile');
const shots = resolve(ROOT, 'shots');
mkdirSync(shots, { recursive: true });

const args = process.argv.slice(2);
const cam = args.find(a => a.startsWith('--cam='))?.split('=')[1] || 'plaza';
const outArg = args.find(a => a.startsWith('--out='))?.split('=')[1];
const waitMs = parseInt(args.find(a => a.startsWith('--wait='))?.split('=')[1] || '5000', 10);
const url = `http://localhost:4173/?cam=${cam}`;

if (!existsSync(CHROME)) { console.error('Chrome not found at', CHROME); process.exit(1); }

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  '--window-size=1600,900',
  '--hide-scrollbars',
  '--disable-background-networking',
  '--disable-dev-shm-usage',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getPageWs() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* chrome still booting */ }
    await sleep(300);
  }
  throw new Error('Chrome CDP did not come up');
}

async function main() {
  const wsUrl = await getPageWs();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 300));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const ex = m.params.exceptionDetails;
      errors.push((ex?.text || 'exception') + ' ' + (ex?.exception?.description || '').slice(0, 300));
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(waitMs);

  // game state
  const stateRes = await send('Runtime.evaluate', {
    expression: `(() => { const g = window.__DUSTLINE__; return g ? { state: g.state, hasScene: !!g.scene, hasRenderer: !!g.renderer, bots: g.remote ? g.remote.size : 0, canvas: !!document.querySelector('canvas') } : { state: 'NO GAME' }; })()`,
    returnByValue: true,
  });
  const state = stateRes.result?.result?.value;

  // screenshot
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const out = outArg || resolve(shots, cam + '.png');
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('shot:', out);

  await sleep(800);
  console.log('game:', JSON.stringify(state));
  console.log('console errors:', errors.length ? errors.slice(0, 10) : 'NONE');

  ws.close();
  chrome.kill();
  process.exit(errors.length ? 2 : 0);
}

main().catch((e) => { console.error('FAIL:', e.message); chrome.kill(); process.exit(1); });
