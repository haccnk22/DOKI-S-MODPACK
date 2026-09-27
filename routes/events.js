import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db, { cleanThumbnail } from '../db.js';
import { getAuthenticatedUser } from '../auth-helper.js';
import { uploadsDir } from '../paths.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const randomName = 'event_' + crypto.randomBytes(16).toString('hex') + ext;
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
      cb(new Error('Only image files (PNG, JPG, WEBP, GIF) are allowed'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

function requireAdmin(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'You must be logged in to perform this action' });
  }
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Permission denied: Only admins can manage community events' });
  }
  if (!req.session) req.session = {};
  req.session.userId = user.userId;
  req.session.username = user.username;
  req.session.role = user.role;
  req.user = user;
  next();
}

// GET /api/events - List all community events
router.get('/', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT 
        e.id,
        e.creator_id,
        u.username AS creator_username,
        e.title,
        e.thumbnail,
        e.event_date,
        e.prize,
        e.link_url,
        e.description,
        e.created_at
      FROM events e
      JOIN users u ON e.creator_id = u.id
      ORDER BY e.created_at DESC
    `);
    const rawEvents = stmt.all();
    const events = rawEvents.map(e => ({
      ...e,
      thumbnail: cleanThumbnail(e.thumbnail),
    }));

    return res.json({ success: true, events });
  } catch (err) {
    console.error('List events error:', err);
    return res.status(500).json({ error: 'Failed to retrieve community events' });
  }
});

// GET /api/events/:id - Single event details
router.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid event ID' });

    const stmt = db.prepare(`
      SELECT e.*, u.username AS creator_username
      FROM events e
      JOIN users u ON e.creator_id = u.id
      WHERE e.id = ?
    `);
    const event = stmt.get(id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    event.thumbnail = cleanThumbnail(event.thumbnail);

    const user = getAuthenticatedUser(req);
    const isAdmin = !!(user && user.role === 'admin');

    return res.json({ success: true, event, isAdmin });
  } catch (err) {
    console.error('Get event error:', err);
    return res.status(500).json({ error: 'Failed to retrieve event details' });
  }
});

// POST /api/events - Admin creates a new event
router.post('/', requireAdmin, (req, res) => {
  upload.single('thumbnail')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      const { title, event_date, prize, link_url, description } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Event title is required' });
      }
      if (!event_date || !event_date.trim()) {
        return res.status(400).json({ error: 'Event date is required' });
      }
      if (!description || !description.trim()) {
        return res.status(400).json({ error: 'Event description is required' });
      }

      let thumbnailStr = null;
      if (req.file) {
        const fileBuf = fs.readFileSync(req.file.path);
        const mime = req.file.mimetype || 'image/png';
        thumbnailStr = `data:${mime};base64,${fileBuf.toString('base64')}`;
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }

      const stmt = db.prepare(`
        INSERT INTO events (creator_id, title, thumbnail, event_date, prize, link_url, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        req.user.userId,
        title.trim(),
        thumbnailStr,
        event_date.trim(),
        (prize || '').trim(),
        (link_url || '').trim(),
        description.trim()
      );

      if (db.saveSnapshot) db.saveSnapshot();

      return res.status(201).json({
        success: true,
        message: 'Community event created successfully',
        eventId: Number(result.lastInsertRowid),
      });
    } catch (dbErr) {
      console.error('Create event error:', dbErr);
      return res.status(500).json({ error: 'Failed to create event' });
    }
  });
});

// PUT /api/events/:id - Admin updates an event
router.put('/:id', requireAdmin, (req, res) => {
  upload.single('thumbnail')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid event ID' });

      const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Event not found' });

      const { title, event_date, prize, link_url, description } = req.body;

      if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
      if (!event_date || !event_date.trim()) return res.status(400).json({ error: 'Event date is required' });
      if (!description || !description.trim()) return res.status(400).json({ error: 'Description is required' });

      let newThumbnail = existing.thumbnail;
      if (req.file) {
        const fileBuf = fs.readFileSync(req.file.path);
        const mime = req.file.mimetype || 'image/png';
        newThumbnail = `data:${mime};base64,${fileBuf.toString('base64')}`;
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }

      db.prepare(`
        UPDATE events
        SET title = ?, thumbnail = ?, event_date = ?, prize = ?, link_url = ?, description = ?
        WHERE id = ?
      `).run(
        title.trim(),
        newThumbnail,
        event_date.trim(),
        (prize || '').trim(),
        (link_url || '').trim(),
        description.trim(),
        id
      );

      if (db.saveSnapshot) db.saveSnapshot();

      return res.json({ success: true, message: 'Event updated successfully' });
    } catch (dbErr) {
      console.error('Update event error:', dbErr);
      return res.status(500).json({ error: 'Failed to update event' });
    }
  });
});

// DELETE /api/events/:id - Admin deletes an event
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid event ID' });

    db.prepare('DELETE FROM events WHERE id = ?').run(id);
    if (db.saveSnapshot) db.saveSnapshot();

    return res.json({ success: true, message: 'Event deleted successfully' });
  } catch (err) {
    console.error('Delete event error:', err);
    return res.status(500).json({ error: 'Failed to delete event' });
  }
});

export default router;
