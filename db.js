import path from 'path';
import fs from 'fs';
import os from 'os';
import initSqlJs from 'sql.js';
import bcrypt from 'bcryptjs';
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

let db = null;

// Dual-engine initialization: Attempt node:sqlite first, fallback to sql.js WASM for Node <22 or Vercel serverless environment
try {
  const { DatabaseSync } = await import('node:sqlite');
  const nodeDb = new DatabaseSync(dbPath);
  nodeDb.exec('PRAGMA foreign_keys = ON;');
  
  db = {
    exec(sql) {
      return nodeDb.exec(sql);
    },
    prepare(sql) {
      const stmt = nodeDb.prepare(sql);
      return {
        get(...params) {
          return stmt.get(...params);
        },
        all(...params) {
          return stmt.all(...params);
        },
        run(...params) {
          return stmt.run(...params);
        }
      };
    }
  };
} catch (nodeSqliteErr) {
  console.warn('Notice: node:sqlite unavailable, using sql.js WASM engine:', nodeSqliteErr.message);
  
  const SQL = await initSqlJs();
  let sqlJsDb;
  if (fs.existsSync(dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(dbPath);
      sqlJsDb = new SQL.Database(fileBuffer);
    } catch (e) {
      sqlJsDb = new SQL.Database();
    }
  } else {
    sqlJsDb = new SQL.Database();
  }

  function saveSqlJsDisk() {
    try {
      const data = sqlJsDb.export();
      const buffer = Buffer.from(data);
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dbPath, buffer);
    } catch (e) {}
  }

  db = {
    exec(sql) {
      sqlJsDb.run(sql);
      saveSqlJsDisk();
    },
    prepare(sql) {
      return {
        get(...params) {
          try {
            const stmt = sqlJsDb.prepare(sql);
            stmt.bind(params);
            let res = undefined;
            if (stmt.step()) {
              res = stmt.getAsObject();
            }
            stmt.free();
            return res;
          } catch (e) {
            console.error('sql.js get error:', e.message, sql, params);
            return undefined;
          }
        },
        all(...params) {
          try {
            const stmt = sqlJsDb.prepare(sql);
            stmt.bind(params);
            const res = [];
            while (stmt.step()) {
              res.push(stmt.getAsObject());
            }
            stmt.free();
            return res;
          } catch (e) {
            console.error('sql.js all error:', e.message, sql, params);
            return [];
          }
        },
        run(...params) {
          try {
            sqlJsDb.run(sql, params);
            const res = sqlJsDb.exec('SELECT last_insert_rowid() as id, changes() as changes');
            const lastInsertRowid = Number(res[0] && res[0].values[0] ? res[0].values[0][0] : 0);
            const changes = Number(res[0] && res[0].values[0] ? res[0].values[0][1] : 0);
            saveSqlJsDisk();
            return { lastInsertRowid, changes };
          } catch (e) {
            console.error('sql.js run error:', e.message, sql, params);
            return { lastInsertRowid: 0, changes: 0 };
          }
        }
      };
    }
  };
}

// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    email TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create modpacks table
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

// Migration: Ensure columns exist
try {
  db.exec("ALTER TABLE modpacks ADD COLUMN release_status TEXT DEFAULT 'released' CHECK(release_status IN ('released', 'demo', 'coming_soon'));");
} catch (e) {}
try {
  db.exec("ALTER TABLE modpacks ADD COLUMN release_date TEXT DEFAULT NULL;");
} catch (e) {}
try {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';");
} catch (e) {}
try {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT DEFAULT '';");
} catch (e) {}
try {
  db.exec("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT '';");
} catch (e) {}

// Create download_requests table
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

// Create modpack_pages table for presentations
db.exec(`
  CREATE TABLE IF NOT EXISTS modpack_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    modpack_id INTEGER UNIQUE NOT NULL REFERENCES modpacks(id) ON DELETE CASCADE,
    layout_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create site_settings table
db.exec(`
  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Create events table
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    thumbnail TEXT,
    event_date TEXT NOT NULL,
    prize TEXT,
    link_url TEXT,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date DESC);
`);

// Export default SVG fallback thumbnail
export const DEFAULT_THUMBNAIL_SVG = "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22800%22%20height%3D%22400%22%20viewBox%3D%220%200%20800%20400%22%3E%3Crect%20width%3D%22800%22%20height%3D%22400%22%20fill%3D%22%230c1410%22%2F%3E%3Crect%20x%3D%222%22%20y%3D%222%22%20width%3D%22796%22%20height%3D%22396%22%20fill%3D%22none%22%20stroke%3D%22%232dd4bf%22%20stroke-width%3D%222%22%20stroke-dasharray%3D%228%208%22%20opacity%3D%220.4%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2248%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%232dd4bf%22%20font-family%3D%22monospace%22%20font-weight%3D%22bold%22%20font-size%3D%2228%22%3EMINECRAFT%20MODPACK%3C%2Ftext%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2260%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%2394a3b8%22%20font-family%3D%22sans-serif%22%20font-size%3D%2214%22%3EOfficial%20Community%20Release%3C%2Ftext%3E%3C%2Fsvg%3E";

export function cleanThumbnail(thumb) {
  if (!thumb || thumb === '' || thumb.startsWith('/uploads/')) {
    return DEFAULT_THUMBNAIL_SVG;
  }
  return thumb;
}

// Clean legacy upload paths
try {
  db.exec(`UPDATE modpacks SET thumbnail = '${DEFAULT_THUMBNAIL_SVG}' WHERE thumbnail IS NULL OR thumbnail = '' OR thumbnail LIKE '/uploads/%'`);
} catch (e) {}

// Seed default featured_modpack_id
try {
  const existingFeatured = db.prepare('SELECT value FROM site_settings WHERE key = ?').get('featured_modpack_id');
  if (!existingFeatured) {
    db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?)').run('featured_modpack_id', '1');
  }
} catch (e) {}

// Seed the admin account and featured modpack
try {
  const adminUsername = (process.env.ADMIN_USERNAME || 'doki').trim();
  const adminPassword = (process.env.ADMIN_PASSWORD || 'doki123').trim();

  let doki = db.prepare('SELECT id, username, role FROM users WHERE username = ? COLLATE NOCASE').get(adminUsername);
  const passwordHash = bcrypt.hashSync(adminPassword, 10);
  if (!doki) {
    const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(adminUsername, passwordHash, 'admin');
    doki = { id: Number(result.lastInsertRowid), username: adminUsername, role: 'admin' };
  } else {
    db.prepare("UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?").run(passwordHash, doki.id);
    doki.role = 'admin';
  }

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
    const packResult = insertPack.run(
      doki.id,
      'Minecraft 2: Biohazard',
      shortDesc,
      longDesc,
      null,
      downloadLink,
      'open',
      'Biohazard,Survival,Adventure,Plague,Overworld,End'
    );

    const modpackId = Number(packResult.lastInsertRowid);

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
          images: [],
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
    const cleanLongDesc = `The Ender Dragon has been defeated, but when we return to the Overworld, everything has withered away due to a strange plague caused by a mysterious entity. We will have to wander everywhere to search for the truth and also to return to The End.

=== KEY MODPACK FEATURES ===
• The Biohazard Plague: A catastrophic biological corruption sweeping across the Overworld, withering flora and mutating creatures.
• Withered Forest Biomes: Explore desolate biomes filled with eerie fog, fallen birch and oak logs, and hazardous spore clouds.
• The Mysterious Entity: Investigate ancient laboratory ruins, decipher cryptic research journals, and track down the eldritch entity behind the outbreak.
• Survival & Antidote Crafting: Synthesize hazard suits, craft localized quarantine barriers, and brew biological cures.
• Return to The End: Gather purified catalyst stones from the deepest withered bastions to rekindle the fractured End Portal and face the final truth.`;

    db.prepare("UPDATE modpacks SET long_description = ? WHERE id = ?").run(cleanLongDesc, biohazardPack.id);
  }

} catch (seedErr) {
  console.error('Seeding error:', seedErr);
}

const snapshotFile = path.join(dataDir, 'db_snapshot.json');

function saveSnapshot() {
  try {
    const users = db.prepare('SELECT * FROM users').all();
    const modpacks = db.prepare('SELECT * FROM modpacks').all();
    const download_requests = db.prepare('SELECT * FROM download_requests').all();
    const modpack_pages = db.prepare('SELECT * FROM modpack_pages').all();
    const site_settings = db.prepare('SELECT * FROM site_settings').all();
    const events = db.prepare('SELECT * FROM events').all();

    const snapshot = { users, modpacks, download_requests, modpack_pages, site_settings, events, timestamp: Date.now() };
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2), 'utf8');

    const localSnapshot = path.join(rootDir, 'data', 'db_snapshot.json');
    if (localSnapshot !== snapshotFile) {
      try {
        const dir = path.dirname(localSnapshot);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(localSnapshot, JSON.stringify(snapshot, null, 2), 'utf8');
      } catch (e) {}
    }
  } catch (err) {
    console.warn('Failed to save DB snapshot:', err.message);
  }
}

function restoreSnapshot() {
  try {
    let fileToLoad = snapshotFile;
    const localSnapshot = path.join(rootDir, 'data', 'db_snapshot.json');
    if (!fs.existsSync(fileToLoad) && fs.existsSync(localSnapshot)) {
      fileToLoad = localSnapshot;
    }
    if (!fs.existsSync(fileToLoad)) return;

    const content = fs.readFileSync(fileToLoad, 'utf8');
    const snapshot = JSON.parse(content);

    if (Array.isArray(snapshot.users)) {
      for (const u of snapshot.users) {
        const existing = db.prepare('SELECT id FROM users WHERE id = ? OR username = ? COLLATE NOCASE').get(u.id, u.username);
        if (!existing) {
          db.prepare('INSERT OR REPLACE INTO users (id, username, password_hash, role, email, bio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(u.id, u.username, u.password_hash, u.role || 'user', u.email || '', u.bio || '', u.created_at || new Date().toISOString());
        }
      }
    }

    if (Array.isArray(snapshot.modpacks)) {
      for (const p of snapshot.modpacks) {
        const existing = db.prepare('SELECT id FROM modpacks WHERE id = ?').get(p.id);
        if (!existing) {
          db.prepare(`
            INSERT OR REPLACE INTO modpacks (
              id, owner_id, name, short_description, long_description, thumbnail,
              external_download_link, download_mode, release_status, release_date, tags, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            p.id, p.owner_id, p.name, p.short_description, p.long_description, p.thumbnail,
            p.external_download_link, p.download_mode, p.release_status || 'released', p.release_date || null,
            p.tags || '', p.created_at || new Date().toISOString()
          );
        }
      }
    }

    if (Array.isArray(snapshot.download_requests)) {
      for (const r of snapshot.download_requests) {
        const existing = db.prepare('SELECT id FROM download_requests WHERE id = ?').get(r.id);
        if (!existing) {
          db.prepare('INSERT OR REPLACE INTO download_requests (id, modpack_id, requester_id, status, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(r.id, r.modpack_id, r.requester_id, r.status, r.created_at || new Date().toISOString());
        }
      }
    }

    if (Array.isArray(snapshot.modpack_pages)) {
      for (const pg of snapshot.modpack_pages) {
        const existing = db.prepare('SELECT id FROM modpack_pages WHERE id = ?').get(pg.id);
        if (!existing) {
          db.prepare('INSERT OR REPLACE INTO modpack_pages (id, modpack_id, layout_json, updated_at) VALUES (?, ?, ?, ?)')
            .run(pg.id, pg.modpack_id, pg.layout_json, pg.updated_at || new Date().toISOString());
        }
      }
    }

    if (Array.isArray(snapshot.site_settings)) {
      for (const s of snapshot.site_settings) {
        db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run(s.key, s.value);
      }
    }

    if (Array.isArray(snapshot.events)) {
      for (const ev of snapshot.events) {
        const existing = db.prepare('SELECT id FROM events WHERE id = ?').get(ev.id);
        if (!existing) {
          db.prepare(`
            INSERT OR REPLACE INTO events (id, creator_id, title, thumbnail, event_date, prize, link_url, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            ev.id, ev.creator_id, ev.title, ev.thumbnail, ev.event_date,
            ev.prize || '', ev.link_url || '', ev.description, ev.created_at || new Date().toISOString()
          );
        }
      }
    }
  } catch (err) {
    console.warn('Failed to restore DB snapshot:', err.message);
  }
}

db.saveSnapshot = saveSnapshot;
db.restoreSnapshot = restoreSnapshot;

restoreSnapshot();

export default db;
