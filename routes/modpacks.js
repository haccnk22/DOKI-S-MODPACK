import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db, { cleanThumbnail } from '../db.js';
import { getAuthenticatedUser } from '../auth-helper.js';
import { uploadsDir } from '../paths.js';

const router = express.Router();

// Multer storage with random file names
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const randomName = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, randomName);
  },
});

// File filter: images only (png, jpg, webp, gif), max 5 MB
const allowedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext) && allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (PNG, JPG, WEBP, GIF) are allowed'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max
  },
});

// Helper middleware: require login
function requireAuth(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'You must be logged in to perform this action' });
  }
  if (!req.session) req.session = {};
  req.session.userId = user.userId;
  req.session.username = user.username;
  req.session.role = user.role;
  req.user = user;
  next();
}

// Helper middleware: require admin (doki)
function requireAdmin(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'You must be logged in to perform this action' });
  }
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Permission denied: Only the admin (doki) can upload or modify modpacks' });
  }
  if (!req.session) req.session = {};
  req.session.userId = user.userId;
  req.session.username = user.username;
  req.session.role = user.role;
  req.user = user;
  next();
}

// GET /api/modpacks/featured - Retrieve homepage featured modpack & list for admin custom selection
router.get('/featured', (req, res) => {
  try {
    let setting = db.prepare('SELECT value FROM site_settings WHERE key = ?').get('featured_modpack_id');
    let featuredId = setting ? parseInt(setting.value, 10) : 1;

    let stmt = db.prepare(`
      SELECT 
        m.id,
        m.owner_id,
        u.username AS owner_username,
        m.name,
        m.short_description,
        m.long_description,
        m.thumbnail,
        m.download_mode,
        m.release_status,
        m.release_date,
        m.tags,
        m.created_at
      FROM modpacks m
      JOIN users u ON m.owner_id = u.id
      WHERE m.id = ?
    `);
    let pack = stmt.get(featuredId);

    if (!pack) {
      pack = db.prepare(`
        SELECT 
          m.id, m.owner_id, u.username AS owner_username, m.name, m.short_description, 
          m.long_description, m.thumbnail, m.download_mode, m.release_status, m.release_date, m.tags, m.created_at
        FROM modpacks m 
        JOIN users u ON m.owner_id = u.id 
        ORDER BY m.created_at ASC LIMIT 1
      `).get();
    }

    if (pack) {
      pack.thumbnail = cleanThumbnail(pack.thumbnail);
    }

    const allModpacks = db.prepare('SELECT id, name, release_status FROM modpacks ORDER BY name ASC').all();

    return res.json({
      success: true,
      featured: pack || null,
      allModpacks,
    });
  } catch (err) {
    console.error('Get featured modpack error:', err);
    return res.status(500).json({ error: 'Failed to retrieve featured modpack' });
  }
});

// POST /api/modpacks/featured - Admin selects which modpack appears on homepage
router.post('/featured', requireAdmin, (req, res) => {
  try {
    const { modpackId } = req.body;
    const targetId = parseInt(modpackId, 10);
    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'Invalid modpack ID' });
    }

    const pack = db.prepare('SELECT id, name FROM modpacks WHERE id = ?').get(targetId);
    if (!pack) {
      return res.status(404).json({ error: 'Selected modpack does not exist' });
    }

    db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run('featured_modpack_id', String(targetId));
    if (db.saveSnapshot) db.saveSnapshot();

    const fullPack = db.prepare(`
      SELECT 
        m.id, m.owner_id, u.username AS owner_username, m.name, m.short_description, 
        m.long_description, m.thumbnail, m.download_mode, m.release_status, m.release_date, m.tags, m.created_at
      FROM modpacks m 
      JOIN users u ON m.owner_id = u.id 
      WHERE m.id = ?
    `).get(targetId);

    if (fullPack) {
      fullPack.thumbnail = cleanThumbnail(fullPack.thumbnail);
    }

    return res.json({
      success: true,
      message: `Homepage featured modpack updated to '${pack.name}'`,
      featured: fullPack,
    });
  } catch (err) {
    console.error('Set featured modpack error:', err);
    return res.status(500).json({ error: 'Failed to update featured modpack' });
  }
});

// GET /api/modpacks - List modpacks (Public response - NEVER includes download link)
router.get('/', (req, res) => {
  try {
    const search = req.query.search ? String(req.query.search).trim() : '';
    const tag = req.query.tag ? String(req.query.tag).trim() : '';
    const status = req.query.status ? String(req.query.status).trim() : '';

    let sql = `
      SELECT 
        m.id,
        m.owner_id,
        u.username AS owner_username,
        m.name,
        m.short_description,
        m.thumbnail,
        m.download_mode,
        m.release_status,
        m.release_date,
        m.tags,
        m.created_at
      FROM modpacks m
      JOIN users u ON m.owner_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (m.name LIKE ? OR m.short_description LIKE ? OR m.tags LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    if (tag && tag.toLowerCase() !== 'all') {
      sql += ` AND (',' || m.tags || ',' LIKE ?)`;
      params.push(`%,${tag},%`);
    }

    if (status && status.toLowerCase() !== 'all') {
      sql += ` AND m.release_status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY m.created_at DESC`;

    const stmt = db.prepare(sql);
    const rawModpacks = stmt.all(...params);
    const modpacks = rawModpacks.map(m => ({
      ...m,
      thumbnail: cleanThumbnail(m.thumbnail),
    }));

    return res.json({
      success: true,
      modpacks,
    });
  } catch (err) {
    console.error('List modpacks error:', err);
    return res.status(500).json({ error: 'Failed to retrieve modpacks' });
  }
});

// GET /api/modpacks/:id - Single modpack details (Public response - NEVER includes download link)
router.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid modpack ID' });
    }

    const stmt = db.prepare(`
      SELECT 
        m.id,
        m.owner_id,
        u.username AS owner_username,
        m.name,
        m.short_description,
        m.long_description,
        m.thumbnail,
        m.download_mode,
        m.release_status,
        m.release_date,
        m.tags,
        m.created_at
      FROM modpacks m
      JOIN users u ON m.owner_id = u.id
      WHERE m.id = ?
    `);
    const modpack = stmt.get(id);

    if (!modpack) {
      return res.status(404).json({ error: 'Modpack not found' });
    }

    const authUser = getAuthenticatedUser(req);
    const isAdmin = !!(authUser && authUser.role === 'admin');
    const isOwner = !!(authUser && (authUser.userId === modpack.owner_id || isAdmin));

    return res.json({
      success: true,
      modpack: {
        ...modpack,
        thumbnail: cleanThumbnail(modpack.thumbnail),
        isOwner,
        isAdmin,
      },
    });
  } catch (err) {
    console.error('Get modpack error:', err);
    return res.status(500).json({ error: 'Failed to retrieve modpack details' });
  }
});

// GET /api/modpacks/:id/manage - Admin/Owner-only endpoint to prefill the edit form
router.get('/:id/manage', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid modpack ID' });
    }

    const stmt = db.prepare(`
      SELECT 
        id,
        owner_id,
        name,
        short_description,
        long_description,
        thumbnail,
        external_download_link,
        download_mode,
        release_status,
        release_date,
        tags,
        created_at
      FROM modpacks
      WHERE id = ?
    `);
    const modpack = stmt.get(id);

    if (!modpack) {
      return res.status(404).json({ error: 'Modpack not found' });
    }

    return res.json({
      success: true,
      modpack,
    });
  } catch (err) {
    console.error('Manage modpack error:', err);
    return res.status(500).json({ error: 'Failed to load modpack manage data' });
  }
});

// POST /api/modpacks - Create new modpack (Admin only)
router.post('/', requireAdmin, (req, res) => {
  upload.single('thumbnail')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Thumbnail image exceeds the 5 MB limit' });
      }
      return res.status(400).json({ error: err.message || 'File upload error' });
    }

    try {
      const { name, short_description, long_description, external_download_link, download_mode, release_status, release_date, tags } = req.body;

      // Validation
      if (!name || typeof name !== 'string' || name.trim().length < 3 || name.trim().length > 100) {
        return res.status(400).json({ error: 'Modpack name must be between 3 and 100 characters' });
      }

      if (!short_description || typeof short_description !== 'string' || short_description.trim().length < 5 || short_description.trim().length > 300) {
        return res.status(400).json({ error: 'Short description must be between 5 and 300 characters' });
      }

      if (!long_description || typeof long_description !== 'string' || long_description.trim().length < 10) {
        return res.status(400).json({ error: 'Long description must be at least 10 characters' });
      }

      if (!external_download_link || typeof external_download_link !== 'string') {
        return res.status(400).json({ error: 'External download link is required' });
      }

      try {
        const parsedUrl = new URL(external_download_link.trim());
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return res.status(400).json({ error: 'Download link must start with http:// or https://' });
        }
      } catch (urlErr) {
        return res.status(400).json({ error: 'Invalid download link URL format' });
      }

      if (download_mode !== 'open' && download_mode !== 'approval') {
        return res.status(400).json({ error: "Download mode must be either 'open' or 'approval'" });
      }

      // Release status & date validation
      const validStatuses = ['released', 'demo', 'coming_soon'];
      const cleanReleaseStatus = validStatuses.includes(release_status) ? release_status : 'released';
      let cleanReleaseDate = null;
      if ((cleanReleaseStatus === 'demo' || cleanReleaseStatus === 'coming_soon') && release_date && typeof release_date === 'string') {
        cleanReleaseDate = release_date.trim().slice(0, 100) || null;
      }

      // Format tags
      let cleanTags = '';
      if (tags && typeof tags === 'string') {
        cleanTags = tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .slice(0, 10)
          .join(',');
      }

      // Thumbnail path (saving data URL for serverless durability + fallback disk path)
      let thumbnailPath = null;
      if (req.file) {
        try {
          const fileBuf = fs.readFileSync(req.file.path);
          const mime = req.file.mimetype || 'image/png';
          thumbnailPath = `data:${mime};base64,${fileBuf.toString('base64')}`;
        } catch (readErr) {
          thumbnailPath = `/uploads/${req.file.filename}`;
        }
      }

      // Parameterized insert
      const insertStmt = db.prepare(`
        INSERT INTO modpacks (
          owner_id,
          name,
          short_description,
          long_description,
          thumbnail,
          external_download_link,
          download_mode,
          release_status,
          release_date,
          tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = insertStmt.run(
        req.session.userId,
        name.trim(),
        short_description.trim(),
        long_description.trim(),
        thumbnailPath,
        external_download_link.trim(),
        download_mode,
        cleanReleaseStatus,
        cleanReleaseDate,
        cleanTags
      );

      const modpackId = Number(result.lastInsertRowid);
      if (db.saveSnapshot) db.saveSnapshot();

      return res.status(201).json({
        success: true,
        message: 'Modpack created successfully',
        modpackId,
      });
    } catch (createErr) {
      console.error('Create modpack error:', createErr);
      return res.status(500).json({ error: 'Failed to create modpack' });
    }
  });
});

// PUT /api/modpacks/:id - Edit existing modpack (Admin only)
router.put('/:id', requireAdmin, (req, res) => {
  upload.single('thumbnail')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Thumbnail image exceeds the 5 MB limit' });
      }
      return res.status(400).json({ error: err.message || 'File upload error' });
    }

    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid modpack ID' });
      }

      // Check existence
      const checkStmt = db.prepare('SELECT owner_id, thumbnail FROM modpacks WHERE id = ?');
      const existing = checkStmt.get(id);

      if (!existing) {
        return res.status(404).json({ error: 'Modpack not found' });
      }

      const { name, short_description, long_description, external_download_link, download_mode, release_status, release_date, tags } = req.body;

      // Validation
      if (!name || typeof name !== 'string' || name.trim().length < 3 || name.trim().length > 100) {
        return res.status(400).json({ error: 'Modpack name must be between 3 and 100 characters' });
      }

      if (!short_description || typeof short_description !== 'string' || short_description.trim().length < 5 || short_description.trim().length > 300) {
        return res.status(400).json({ error: 'Short description must be between 5 and 300 characters' });
      }

      if (!long_description || typeof long_description !== 'string' || long_description.trim().length < 10) {
        return res.status(400).json({ error: 'Long description must be at least 10 characters' });
      }

      if (!external_download_link || typeof external_download_link !== 'string') {
        return res.status(400).json({ error: 'External download link is required' });
      }

      try {
        const parsedUrl = new URL(external_download_link.trim());
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return res.status(400).json({ error: 'Download link must start with http:// or https://' });
        }
      } catch (urlErr) {
        return res.status(400).json({ error: 'Invalid download link URL format' });
      }

      if (download_mode !== 'open' && download_mode !== 'approval') {
        return res.status(400).json({ error: "Download mode must be either 'open' or 'approval'" });
      }

      // Release status & date validation
      const validStatuses = ['released', 'demo', 'coming_soon'];
      const cleanReleaseStatus = validStatuses.includes(release_status) ? release_status : 'released';
      let cleanReleaseDate = null;
      if ((cleanReleaseStatus === 'demo' || cleanReleaseStatus === 'coming_soon') && release_date && typeof release_date === 'string') {
        cleanReleaseDate = release_date.trim().slice(0, 100) || null;
      }

      // Format tags
      let cleanTags = '';
      if (tags && typeof tags === 'string') {
        cleanTags = tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .slice(0, 10)
          .join(',');
      }

      let newThumbnail = existing.thumbnail;
      if (req.file) {
        try {
          const fileBuf = fs.readFileSync(req.file.path);
          const mime = req.file.mimetype || 'image/png';
          newThumbnail = `data:${mime};base64,${fileBuf.toString('base64')}`;
        } catch (readErr) {
          newThumbnail = `/uploads/${req.file.filename}`;
        }
        // Remove previous thumbnail if exists on disk
        if (existing.thumbnail && existing.thumbnail.startsWith('/uploads/')) {
          const oldFilename = existing.thumbnail.replace('/uploads/', '');
          const oldPath = path.join(uploadsDir, oldFilename);
          if (fs.existsSync(oldPath)) {
            try {
              fs.unlinkSync(oldPath);
            } catch (unlinkErr) {
              console.warn('Failed to delete old thumbnail:', unlinkErr);
            }
          }
        }
      }

      // Parameterized update
      const updateStmt = db.prepare(`
        UPDATE modpacks SET
          name = ?,
          short_description = ?,
          long_description = ?,
          thumbnail = ?,
          external_download_link = ?,
          download_mode = ?,
          release_status = ?,
          release_date = ?,
          tags = ?
        WHERE id = ?
      `);

      updateStmt.run(
        name.trim(),
        short_description.trim(),
        long_description.trim(),
        newThumbnail,
        external_download_link.trim(),
        download_mode,
        cleanReleaseStatus,
        cleanReleaseDate,
        cleanTags,
        id
      );

      if (db.saveSnapshot) db.saveSnapshot();

      return res.json({
        success: true,
        message: 'Modpack updated successfully',
        modpackId: id,
      });
    } catch (editErr) {
      console.error('Update modpack error:', editErr);
      return res.status(500).json({ error: 'Failed to update modpack' });
    }
  });
});

// DELETE /api/modpacks/:id - Delete modpack (Admin only)
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid modpack ID' });
    }

    const checkStmt = db.prepare('SELECT owner_id, thumbnail FROM modpacks WHERE id = ?');
    const existing = checkStmt.get(id);

    if (!existing) {
      return res.status(404).json({ error: 'Modpack not found' });
    }

    // Delete thumbnail file if exists
    if (existing.thumbnail && existing.thumbnail.startsWith('/uploads/')) {
      const filename = existing.thumbnail.replace('/uploads/', '');
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkErr) {
          console.warn('Failed to delete thumbnail file:', unlinkErr);
        }
      }
    }

    // Delete modpack from database
    const deleteStmt = db.prepare('DELETE FROM modpacks WHERE id = ?');
    deleteStmt.run(id);

    return res.json({
      success: true,
      message: 'Modpack deleted successfully',
    });
  } catch (err) {
    console.error('Delete modpack error:', err);
    return res.status(500).json({ error: 'Failed to delete modpack' });
  }
});

// GET /api/modpacks/:id/download-status - Get current user's download capability & status
router.get('/:id/download-status', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid modpack ID' });
    }

    const stmt = db.prepare('SELECT id, owner_id, download_mode FROM modpacks WHERE id = ?');
    const pack = stmt.get(id);

    if (!pack) {
      return res.status(404).json({ error: 'Modpack not found' });
    }

    const authUser = getAuthenticatedUser(req);

    // Anonymous visitor
    if (!authUser) {
      return res.json({
        success: true,
        loggedIn: false,
        downloadMode: pack.download_mode,
        canDownload: false,
        requestStatus: 'none',
      });
    }

    const userId = authUser.userId;
    const isOwner = pack.owner_id === userId || authUser.role === 'admin';

    if (isOwner) {
      return res.json({
        success: true,
        loggedIn: true,
        isOwner: true,
        isAdmin: authUser.role === 'admin',
        downloadMode: pack.download_mode,
        canDownload: true,
        requestStatus: 'owner',
      });
    }

    if (pack.download_mode === 'open') {
      return res.json({
        success: true,
        loggedIn: true,
        isOwner: false,
        isAdmin: false,
        downloadMode: 'open',
        canDownload: true,
        requestStatus: 'open',
      });
    }

    // Approval mode: look up request status
    const reqStmt = db.prepare(`
      SELECT status FROM download_requests
      WHERE modpack_id = ? AND requester_id = ?
    `);
    const request = reqStmt.get(id, userId);

    const status = request ? request.status : 'none';
    const canDownload = status === 'approved';

    return res.json({
      success: true,
      loggedIn: true,
      isOwner: false,
      isAdmin: false,
      downloadMode: 'approval',
      requestStatus: status,
      canDownload,
    });
  } catch (err) {
    console.error('Download status error:', err);
    return res.status(500).json({ error: 'Failed to check download status' });
  }
});

// POST /api/modpacks/:id/request-download - Request access to an approval-mode modpack
router.post('/:id/request-download', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid modpack ID' });
    }

    const stmt = db.prepare('SELECT id, owner_id, download_mode, name FROM modpacks WHERE id = ?');
    const pack = stmt.get(id);

    if (!pack) {
      return res.status(404).json({ error: 'Modpack not found' });
    }

    const userId = req.session.userId;

    if (pack.owner_id === userId) {
      return res.status(400).json({ error: 'You are the creator of this modpack and already have access' });
    }

    if (pack.download_mode === 'open') {
      return res.status(400).json({ error: 'This modpack has open access; no approval request is needed' });
    }

    // Check existing request
    const existingStmt = db.prepare(`
      SELECT id, status FROM download_requests
      WHERE modpack_id = ? AND requester_id = ?
    `);
    const existing = existingStmt.get(id, userId);

    if (existing) {
      if (existing.status === 'approved') {
        return res.status(400).json({ error: 'You have already been approved to download this modpack' });
      }
      if (existing.status === 'pending') {
        return res.status(400).json({ error: 'Your download request is already pending creator review' });
      }

      // If previously rejected, allow re-requesting by updating to pending
      const updateStmt = db.prepare(`
        UPDATE download_requests 
        SET status = 'pending', created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      updateStmt.run(existing.id);
      if (db.saveSnapshot) db.saveSnapshot();

      return res.json({
        success: true,
        message: 'Your download request has been re-submitted for review',
        status: 'pending',
      });
    }

    // Insert new request
    const insertStmt = db.prepare(`
      INSERT INTO download_requests (modpack_id, requester_id, status)
      VALUES (?, ?, 'pending')
    `);
    insertStmt.run(id, userId);
    if (db.saveSnapshot) db.saveSnapshot();

    return res.status(201).json({
      success: true,
      message: 'Download request submitted successfully. The creator will review your request.',
      status: 'pending',
    });
  } catch (err) {
    console.error('Request download error:', err);
    return res.status(500).json({ error: 'Failed to submit download request' });
  }
});

// GET /api/modpacks/:id/download - Download route with login & permission check, then 302 redirect
router.get('/:id/download', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).send('Invalid modpack ID');
    }

    const authUser = getAuthenticatedUser(req);

    // 1. Must be logged in
    if (!authUser) {
      return res.redirect(`/login.html?returnUrl=/api/modpacks/${id}/download`);
    }

    const userId = authUser.userId;

    const stmt = db.prepare(`
      SELECT id, owner_id, download_mode, external_download_link 
      FROM modpacks 
      WHERE id = ?
    `);
    const pack = stmt.get(id);

    if (!pack) {
      return res.status(404).send('Modpack not found');
    }

    // Owner or admin can always download
    if (pack.owner_id === userId || authUser.role === 'admin') {
      return res.redirect(302, pack.external_download_link);
    }

    // Open download mode
    if (pack.download_mode === 'open') {
      return res.redirect(302, pack.external_download_link);
    }

    // Approval mode: verify approved status
    const reqStmt = db.prepare(`
      SELECT status FROM download_requests 
      WHERE modpack_id = ? AND requester_id = ?
    `);
    const request = reqStmt.get(id, userId);

    if (!request || request.status !== 'approved') {
      const msg = !request 
        ? 'Download approval required. Please submit a request on the modpack page.'
        : request.status === 'pending'
          ? 'Your download request is currently pending creator approval.'
          : 'Your download request was rejected by the creator.';

      return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Access Denied - MCIntroduce</title><link rel="stylesheet" href="/css/style.css"></head>
        <body style="display:flex; justify-content:center; align-items:center; min-height:100vh;">
          <div class="content-card" style="max-width:500px; text-align:center;">
            <div class="phase-badge">DOWNLOAD ACCESS RESTRICTED</div>
            <h2 style="color:#ffffff; margin: 1rem 0;">Permission Required</h2>
            <p style="color:var(--text-secondary); margin-bottom:1.5rem;">${msg}</p>
            <a href="/modpack.html?id=${id}" class="btn btn-primary">Return to Modpack Page</a>
          </div>
        </body>
        </html>
      `);
    }

    // User is approved -> 302 redirect to external link
    return res.redirect(302, pack.external_download_link);
  } catch (err) {
    console.error('Download route error:', err);
    return res.status(500).send('Internal server error during download');
  }
});

export default router;
