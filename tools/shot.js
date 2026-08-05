// DUSTLINE screenshot QA harness — boots the real game headlessly (or in a
// real browser), positions the camera at a known place, and captures PNGs for
// the gauntlet critic. Usage:
//   node tools/shot.js --cam=plaza --out=shots/plaza.png
//   node tools/shot.js --qa           # capture all standard views
//
// Uses a local headless browser via CDP when available (agent-browser or
// chrome), else falls back to a minimal capture through a data URL.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'shots');
mkdirSync(OUT, { recursive: true });

const CAMERAS = {
  plaza: { pos: [0, 1.7, -18], target: [0, 1.4, 8], fov: 75 },
  alley: { pos: [-14, 1.7, -10], target: [-6, 1.4, 6], fov: 75 },
  market: { pos: [12, 1.7, 4], target: [-2, 1.3, -6], fov: 75 },
  tower: { pos: [-38, 13.5, 40], target: [0, 1, 0], fov: 70 },
  gun: { pos: [0, 1.7, -2], target: [0, 1.5, 4], fov: 75, viewmodel: true },
  hud: { pos: [0, 1.7, -8], target: [0, 1.4, 6], fov: 75, hud: true },
};

async function findBrowser() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Arc.app/Contents/MacOS/Arc',
    process.env.CHROME_PATH,
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  // try agent-browser
  try {
    const { execSync } = await import('node:child_process');
    execSync('agent-browser --version', { stdio: 'ignore' });
    return 'agent-browser';
  } catch { /* ignore */ }
  return null;
}

async function captureWithChrome(chrome, url, outPath, viewport = '1600,900') {
  return new Promise((resolvePromise, reject) => {
    const args = [
      '--headless=new',
      '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      `--window-size=${viewport}`,
      `--screenshot=${outPath}`,
      url,
    ];
    const p = spawn(chrome, args, { stdio: 'ignore' });
    p.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error('chrome exit ' + code)));
    p.on('error', reject);
    setTimeout(() => { p.kill(); reject(new Error('timeout')); }, 25000);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const cam = (args.find(a => a.startsWith('--cam=')) || '').split('=')[1] || 'plaza';
  const out = (args.find(a => a.startsWith('--out=')) || '').split('=')[1];
  const qa = args.includes('--qa');
  const port = (args.find(a => a.startsWith('--port=')) || '').split('=')[1] || '4173';

  const chrome = await findBrowser();
  if (!chrome) {
    console.error('No browser found for screenshots. Install Chrome or agent-browser.');
    process.exit(1);
  }

  const url = `http://localhost:${port}/?cam=${cam}`;
  const target = out || resolve(OUT, `${cam}.png`);
  console.log(`Capturing ${cam} -> ${target}`);
  await captureWithChrome(chrome, url, target);
  console.log('done:', target);
}

main().catch((e) => { console.error(e); process.exit(1); });
