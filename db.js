import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dataDir, isServerless, rootDir } from './paths.js';

// Safe determination of writable SQLite database path
let dbPath = path.join(dataDir, 'mcintroduce.db');

try {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
} catch (err) {
  // If dataDir cannot be written (e.g. read-only filesystem), fallback directly to os.tmpdir()
  dbPath = path.join(os.tmpdir(), 'mcintroduce.db');
}

// If running in serverless environment and a pre-seeded local db exists, copy it to the writable location
if (isServerless) {
  const localDbPath = path.join(rootDir, 'data', 'mcintroduce.db');
  if (!fs.existsSync(dbPath) && fs.existsSync(localDbPath)) {
    try {
      fs.copyFileSync(localDbPath, dbPath);
    } catch (e) {
      console.warn('Vercel database copy notice:', e.message);
    }
  }
}

// Initialize SQLite database using Node's built-in node:sqlite
const db = new DatabaseSync(dbPath);

// Enable foreign keys and WAL mode for reliability and performance
db.exec('PRAGMA foreign_keys = ON;');

// Create users table for Phase 1
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create modpacks table for Phase 3
db.exec(`
  CREATE TABLE IF NOT EXISTS modpacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    short_description TEXT NOT NULL,
    long_description TEXT NOT NULL,
    thumbnail TEXT,
    external_download_link TEXT NOT NULL,
    download_mode TEXT NOT NULL CHECK(download_mode IN ('open', 'approval')),
    release_status TEXT NOT NULL DEFAULT 'released' CHECK(release_status IN ('released', 'demo', 'coming_soon')),
    release_date TEXT DEFAULT NULL,
    tags TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_modpacks_owner ON modpacks(owner_id);
  CREATE INDEX IF NOT EXISTS idx_modpacks_created ON modpacks(created_at DESC);
`);

// Migration: Ensure 'release_status' and 'release_date' columns exist in modpacks table
try {
  db.exec("ALTER TABLE modpacks ADD COLUMN release_status TEXT DEFAULT 'released' CHECK(release_status IN ('released', 'demo', 'coming_soon'));");
} catch (e) {
  // Column already exists
}
try {
  db.exec("ALTER TABLE modpacks ADD COLUMN release_date TEXT DEFAULT NULL;");
} catch (e) {
  // Column already exists
}

// Create download_requests table for Phase 4
db.exec(`
  CREATE TABLE IF NOT EXISTS download_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    modpack_id INTEGER NOT NULL REFERENCES modpacks(id) ON DELETE CASCADE,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(modpack_id, requester_id)
  );

  CREATE INDEX IF NOT EXISTS idx_requests_modpack ON download_requests(modpack_id);
  CREATE INDEX IF NOT EXISTS idx_requests_requester ON download_requests(requester_id);
`);

// Create modpack_pages table for Phase 6
db.exec(`
  CREATE TABLE IF NOT EXISTS modpack_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    modpack_id INTEGER UNIQUE NOT NULL REFERENCES modpacks(id) ON DELETE CASCADE,
    layout_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_pages_modpack ON modpack_pages(modpack_id);
`);

// Migration: Ensure 'role' column exists in users table
try {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin'));");
} catch (e) {
  // Column already exists
}

// Seed the admin account 'doki' and the featured modpack 'Minecraft 2: Biohazard'
import bcrypt from 'bcryptjs';

try {
  // Check if admin user 'doki' exists
  let doki = db.prepare('SELECT id, username, role FROM users WHERE username = ? COLLATE NOCASE').get('doki');
  if (!doki) {
    const passwordHash = bcrypt.hashSync('doki123', 10);
    const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('doki', passwordHash, 'admin');
    doki = { id: Number(result.lastInsertRowid), username: 'doki', role: 'admin' };
    console.log("Seeded admin account 'doki' with password 'doki123'");
  } else if (doki.role !== 'admin') {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(doki.id);
    doki.role = 'admin';
  }

  // Check if 'Minecraft 2: Biohazard' modpack exists
  let biohazardPack = db.prepare("SELECT id FROM modpacks WHERE name LIKE '%Minecraft 2%Biohazard%'").get();
  if (!biohazardPack) {
    const insertPack = db.prepare(`
      INSERT INTO modpacks (
        owner_id, name, short_description, long_description, thumbnail, 
        external_download_link, download_mode, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const shortDesc = 'The Ender Dragon has been defeated, but when we return to the Overworld, everything has withered away due to a strange plague caused by a mysterious entity. We will have to wander everywhere to search for the truth and also to return to The End.';
    
    const longDesc = `The Ender Dragon has been defeated, but when we return to the Overworld, everything has withered away due to a strange plague caused by a mysterious entity. We will have to wander everywhere to search for the truth and also to return to The End.

=== KEY MODPACK FEATURES ===
• The Biohazard Plague: A catastrophic biological corruption sweeping across the Overworld, withering flora and mutating creatures.
• Withered Forest Biomes: Explore desolate biomes filled with eerie fog, fallen birch and oak logs, and hazardous spore clouds.
• The Mysterious Entity: Investigate ancient laboratory ruins, decipher cryptic research journals, and track down the eldritch entity behind the outbreak.
• Survival & Antidote Crafting: Synthesize hazard suits, craft localized quarantine barriers, and brew biological cures.
• Return to The End: Gather purified catalyst stones from the deepest withered bastions to rekindle the fractured End Portal and face the final truth.`;

    const downloadLink = 'https://drive.google.com/drive/folders/1AiHaMZaoQpv7LcKi2rF-erqG4ymZiCN6';
    const thumbnail = '/uploads/panorama_5.png';
    const packResult = insertPack.run(
      doki.id,
      'Minecraft 2: Biohazard',
      shortDesc,
      longDesc,
      thumbnail,
      downloadLink,
      'open',
      'Biohazard,Survival,Adventure,Plague,Overworld,End'
    );

    const modpackId = Number(packResult.lastInsertRowid);
    console.log(`Seeded 'Minecraft 2: Biohazard' modpack (ID: ${modpackId})`);

    // Seed custom presentation page for Minecraft 2: Biohazard
    const pageLayout = {
      settings: {
        backgroundColor: '#0c1410',
        accentColor: '#2dd4bf',
      },
      blocks: [
        {
          id: 'b_bio_1',
          type: 'text',
          title: 'Minecraft 2: Biohazard',
          subtitle: "Doki's Official Apocalyptic Survival Modpack",
          content: 'The Ender Dragon has been defeated, but when we return to the Overworld, everything has withered away due to a strange plague caused by a mysterious entity. We will have to wander everywhere to search for the truth and also to return to The End.',
        },
        {
          id: 'b_bio_2',
          type: 'gallery',
          title: 'Official Modpack Artwork & Screenshots',
          images: ['/uploads/panorama_5.png'],
        },
        {
          id: 'b_bio_3',
          type: 'features',
          title: 'Survival & Story Pillars',
          items: [
            { icon: 'biohazard', title: 'The Wither Plague', description: 'Overworld vegetation has rotted into poisoned ash and toxic mire.' },
            { icon: 'search', title: 'Search For The Truth', description: 'Discover underground research stations and identify the mysterious entity.' },
            { icon: 'sparkles', title: 'Return To The End', description: 'Reactivate the cleansed End portal to eliminate the corruption at its source.' },
            { icon: 'tools', title: 'Bio-Engineering', description: 'Extract serums, craft decontamination filters, and survive toxic weather.' }
          ],
        },
        {
          id: 'b_bio_4',
          type: 'cube_3d',
          title: 'Hazard Core Voxel',
          blockType: 'emerald',
        },
        {
          id: 'b_bio_5',
          type: 'download',
          title: 'Download Minecraft 2: Biohazard',
          description: 'Official Google Drive distribution folder containing all required client mods, config, and installation instructions.',
        },
      ],
    };

    db.prepare('INSERT INTO modpack_pages (modpack_id, layout_json) VALUES (?, ?)').run(
      modpackId,
      JSON.stringify(pageLayout)
    );
  } else {
    // Ensure existing record uses /uploads/panorama_5.png and clean icon identifiers
    const cleanLongDesc = `The Ender Dragon has been defeated, but when we return to the Overworld, everything has withered away due to a strange plague caused by a mysterious entity. We will have to wander everywhere to search for the truth and also to return to The End.

=== KEY MODPACK FEATURES ===
• The Biohazard Plague: A catastrophic biological corruption sweeping across the Overworld, withering flora and mutating creatures.
• Withered Forest Biomes: Explore desolate biomes filled with eerie fog, fallen birch and oak logs, and hazardous spore clouds.
• The Mysterious Entity: Investigate ancient laboratory ruins, decipher cryptic research journals, and track down the eldritch entity behind the outbreak.
• Survival & Antidote Crafting: Synthesize hazard suits, craft localized quarantine barriers, and brew biological cures.
• Return to The End: Gather purified catalyst stones from the deepest withered bastions to rekindle the fractured End Portal and face the final truth.`;

    db.prepare("UPDATE modpacks SET thumbnail = '/uploads/panorama_5.png', long_description = ? WHERE id = ?").run(cleanLongDesc, biohazardPack.id);
    const existingPage = db.prepare('SELECT layout_json FROM modpack_pages WHERE modpack_id = ?').get(biohazardPack.id);
    if (existingPage && existingPage.layout_json) {
      let updatedLayoutJson = existingPage.layout_json
        .replace(/\/uploads\/minecraft2-biohazard\.jpg/g, '/uploads/panorama_5.png')
        .replace(/"icon":"☣️"/g, '"icon":"biohazard"')
        .replace(/"icon":"🔍"/g, '"icon":"search"')
        .replace(/"icon":"🌌"/g, '"icon":"sparkles"')
        .replace(/"icon":"🧪"/g, '"icon":"tools"');
      db.prepare('UPDATE modpack_pages SET layout_json = ? WHERE modpack_id = ?').run(updatedLayoutJson, biohazardPack.id);
    }
  }

} catch (seedErr) {
  console.error('Seeding error:', seedErr);
}

export default db;
