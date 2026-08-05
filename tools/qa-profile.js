// Deterministic local QA profile seed. Runtime accounts stay untracked.
import { Persistence } from '../server/persistence.js';

const profileId = 'dustline-qa-profile';
const persistence = new Persistence();
const profile = persistence.getOrCreate(profileId, 'QA PILOT');
profile.totalXp = 1250;
profile.loadout = { primary: 'ak', secondary: 'pistol' };
profile.unlockedWeapons = ['m4', 'pistol', 'knife', 'mp5', 'shotgun', 'ak'];
profile.stats = { ...profile.stats, kills: 42, deaths: 17, assists: 12, wins: 3, games: 5, score: 6800, bestStreak: 8 };
persistence.save();
persistence.close();
console.log(JSON.stringify({ profileId, name: profile.name, totalXp: profile.totalXp, loadout: profile.loadout }, null, 2));
