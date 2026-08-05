import { createServer } from '../server/index.js';

const server = await createServer({ port: 0 });
const modes = ['tdm', 'dom', 'kc', 'snd', 'ffa'];

try {
  for (const mode of modes) {
    const room = server.registry.create(mode, 'dustline');
    const player = {
      id: `ci-${mode}`,
      name: 'CI PILOT',
      ws: { send() {}, readyState: 1 },
      deviceId: `ci-${mode}`,
      loadout: { primary: 'm4', secondary: 'pistol' },
      totalXp: 0,
      stats: {},
      perks: {},
      ready: false,
    };
    room.addHuman(player);
    room.tryStart();
    for (let i = 0; i < 750; i++) server.registry.tickAll(1 / 30);
    if (!room.sim || room.sim.modeId !== mode) throw new Error(`${mode} did not initialize`);
    console.log(`${mode}: ok`);
  }
} finally {
  server.close();
}
