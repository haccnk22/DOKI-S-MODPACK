import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import db from '../db.js';
import { getAuthenticatedUser } from '../auth-helper.js';
import { uploadsDir } from '../paths.js';

const router = express.Router({ mergeParams: true });

// Multer storage for gallery images
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const randomName = 'page_' + crypto.randomBytes(16).toString('hex') + ext;
    cb(null, randomName);
  },
});

const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext) && allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only valid image files (PNG, JPG, WEBP, GIF) are allowed'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// Middleware: Require authenticated user
function requireAuth(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'You must be logged in to perform this action' });
  }
  if (!req.session) req.session = {};
  req.session.userId = user.userId;
  next();
}

// Helper: YouTube URL validation & video ID extraction
function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : null;
}

// Helper: Valid Hex Color
function isValidHexColor(color) {
  return typeof color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color);
}

// Allowed 3D Block types
const ALLOWED_3D_BLOCKS = ['grass', 'diamond', 'tnt', 'gold', 'redstone', 'obsidian', 'wood', 'bookshelf', 'emerald'];

// GET /api/modpacks/:id/page - Get page layout for public view and editor
router.get('/', (req, res) => {
  try {
    const modpackId = parseInt(req.params.id, 10);
    if (isNaN(modpackId)) {
      return res.status(400).json({ error: 'Invalid modpack ID' });
    }

    const packStmt = db.prepare(`
      SELECT m.id, m.owner_id, m.name, m.short_description, m.long_description, m.thumbnail, m.download_mode, m.tags, u.username AS owner_username
      FROM modpacks m
      JOIN users u ON m.owner_id = u.id
      WHERE m.id = ?
    `);
    const modpack = packStmt.get(modpackId);

    if (!modpack) {
      return res.status(404).json({ error: 'Modpack not found' });
    }

    const authUser = getAuthenticatedUser(req);
    const isOwner = !!(authUser && (authUser.userId === modpack.owner_id || authUser.role === 'admin'));

    // Check if custom page layout exists
    const pageStmt = db.prepare('SELECT layout_json, updated_at FROM modpack_pages WHERE modpack_id = ?');
    const pageRecord = pageStmt.get(modpackId);

    let layout;
    if (pageRecord) {
      try {
        layout = JSON.parse(pageRecord.layout_json);
      } catch (e) {
        layout = null;
      }
    }

    // Default layout if none saved yet
    if (!layout) {
      layout = {
        settings: {
          backgroundColor: '#0c121e',
          accentColor: '#5b8731',
        },
        blocks: [
          {
            id: 'b_' + Date.now() + '_1',
            type: 'text',
            title: modpack.name,
            subtitle: modpack.short_description,
            content: modpack.long_description,
          },
          ...(modpack.thumbnail ? [{
            id: 'b_' + Date.now() + '_2',
            type: 'gallery',
            title: 'Featured Showcase',
            images: [modpack.thumbnail],
          }] : []),
          {
            id: 'b_' + Date.now() + '_3',
            type: 'cube_3d',
            title: 'Featured Voxel Showcase',
            blockType: 'diamond',
            caption: 'Crafted with premium community assets and tailored performance mods.',
          },
          {
            id: 'b_' + Date.now() + '_4',
            type: 'features',
            title: 'Key Modpack Features',
            items: [
              { icon: '⚡', title: 'High Performance', description: 'Optimized rendering and low memory footprint for smooth gameplay.' },
              { icon: '⚔️', title: 'New Mechanics', description: 'Custom progression, unique tools, and enriched world exploration.' },
              { icon: '🌍', title: 'Immense Worlds', description: 'Overhauled biomes, mystical dungeons, and immersive soundscapes.' },
            ],
          },
          {
            id: 'b_' + Date.now() + '_5',
            type: 'download',
            title: 'Ready to Play?',
            description: modpack.download_mode === 'open' 
              ? 'Click below to instantly download this modpack.' 
              : 'Submit a download request to gain creator access.',
          },
        ],
      };
    }

    return res.json({
      success: true,
      modpack: {
        id: modpack.id,
        name: modpack.name,
        short_description: modpack.short_description,
        thumbnail: modpack.thumbnail,
        download_mode: modpack.download_mode,
        owner_username: modpack.owner_username,
        tags: modpack.tags,
      },
      page: layout,
      isOwner: !!isOwner,
      updatedAt: pageRecord ? pageRecord.updated_at : null,
    });
  } catch (err) {
    console.error('Get page error:', err);
    return res.status(500).json({ error: 'Failed to retrieve page layout' });
  }
});

// PUT /api/modpacks/:id/page - Save page layout (Owner only, strictly validated)
router.put('/', requireAuth, (req, res) => {
  try {
    const modpackId = parseInt(req.params.id, 10);
    if (isNaN(modpackId)) {
      return res.status(400).json({ error: 'Invalid modpack ID' });
    }

    const checkStmt = db.prepare('SELECT owner_id FROM modpacks WHERE id = ?');
    const modpack = checkStmt.get(modpackId);

    if (!modpack) {
      return res.status(404).json({ error: 'Modpack not found' });
    }

    const authUser = getAuthenticatedUser(req);
    const hasPermission = authUser && (authUser.userId === modpack.owner_id || authUser.role === 'admin');

    if (!hasPermission) {
      return res.status(403).json({ error: 'Only the modpack creator or admin (doki) can edit this page' });
    }

    const { settings, blocks } = req.body;

    // Validate page settings
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Invalid page settings format' });
    }

    const sanitizedSettings = {
      backgroundColor: isValidHexColor(settings.backgroundColor) ? settings.backgroundColor : '#0c121e',
      accentColor: isValidHexColor(settings.accentColor) ? settings.accentColor : '#5b8731',
    };

    // Validate blocks array
    if (!Array.isArray(blocks)) {
      return res.status(400).json({ error: 'Blocks must be an array' });
    }

    if (blocks.length > 30) {
      return res.status(400).json({ error: 'Maximum 30 blocks allowed per page' });
    }

    const sanitizedBlocks = [];

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b || typeof b !== 'object') continue;

      const blockId = (typeof b.id === 'string' && b.id.trim()) ? b.id.trim() : 'b_' + Date.now() + '_' + i;
      const type = String(b.type).trim();

      switch (type) {
        case 'text': {
          sanitizedBlocks.push({
            id: blockId,
            type: 'text',
            title: String(b.title || '').trim().slice(0, 120),
            subtitle: String(b.subtitle || '').trim().slice(0, 200),
            content: String(b.content || '').trim().slice(0, 4000),
          });
          break;
        }

        case 'gallery': {
          let images = [];
          if (Array.isArray(b.images)) {
            images = b.images
              .map(img => String(img).trim())
              .filter(img => img.startsWith('/uploads/') || /^https?:\/\//i.test(img))
              .slice(0, 10);
          }
          sanitizedBlocks.push({
            id: blockId,
            type: 'gallery',
            title: String(b.title || '').trim().slice(0, 120),
            images,
          });
          break;
        }

        case 'youtube': {
          const rawUrl = String(b.url || '').trim();
          const videoId = extractYouTubeId(rawUrl);
          if (!videoId) {
            return res.status(400).json({ error: `Block ${i + 1}: Invalid YouTube video URL` });
          }
          sanitizedBlocks.push({
            id: blockId,
            type: 'youtube',
            title: String(b.title || '').trim().slice(0, 120),
            url: `https://www.youtube.com/watch?v=${videoId}`,
            videoId,
          });
          break;
        }

        case 'features': {
          let items = [];
          if (Array.isArray(b.items)) {
            items = b.items.slice(0, 12).map(item => ({
              icon: String(item.icon || '⭐').trim().slice(0, 8),
              title: String(item.title || '').trim().slice(0, 80),
              description: String(item.description || '').trim().slice(0, 250),
            }));
          }
          sanitizedBlocks.push({
            id: blockId,
            type: 'features',
            title: String(b.title || '').trim().slice(0, 120),
            items,
          });
          break;
        }

        case 'cube_3d': {
          const chosenBlock = ALLOWED_3D_BLOCKS.includes(b.blockType) ? b.blockType : 'grass';
          sanitizedBlocks.push({
            id: blockId,
            type: 'cube_3d',
            title: String(b.title || '').trim().slice(0, 120),
            blockType: chosenBlock,
            caption: String(b.caption || '').trim().slice(0, 200),
          });
          break;
        }

        case 'download': {
          sanitizedBlocks.push({
            id: blockId,
            type: 'download',
            title: String(b.title || 'Download Modpack').trim().slice(0, 120),
            description: String(b.description || '').trim().slice(0, 300),
          });
          break;
        }

        default:
          return res.status(400).json({ error: `Block ${i + 1}: Unknown block type '${type}'` });
      }
    }

    const layoutData = {
      settings: sanitizedSettings,
      blocks: sanitizedBlocks,
    };

    const layoutJson = JSON.stringify(layoutData);

    // Upsert into modpack_pages
    const upsertStmt = db.prepare(`
      INSERT INTO modpack_pages (modpack_id, layout_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(modpack_id) DO UPDATE SET 
        layout_json = excluded.layout_json, 
        updated_at = CURRENT_TIMESTAMP
    `);
    upsertStmt.run(modpackId, layoutJson);
    if (db.saveSnapshot) db.saveSnapshot();

    return res.json({
      success: true,
      message: 'Page presentation saved successfully',
      layout: layoutData,
    });
  } catch (err) {
    console.error('Save page error:', err);
    return res.status(500).json({ error: 'Failed to save page layout' });
  }
});

// POST /api/modpacks/:id/page/upload-image - Upload screenshot for gallery block
router.post('/upload-image', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Image exceeds the 5 MB limit' });
      }
      return res.status(400).json({ error: err.message || 'Image upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file was provided' });
    }

    let imageUrl = `/uploads/${req.file.filename}`;
    try {
      const fileBuf = fs.readFileSync(req.file.path);
      const mime = req.file.mimetype || 'image/png';
      imageUrl = `data:${mime};base64,${fileBuf.toString('base64')}`;
    } catch (readErr) {
      imageUrl = `/uploads/${req.file.filename}`;
    }
    return res.json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl,
    });
  });
});

export default router;
