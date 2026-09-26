import express from 'express';
import db from '../db.js';
import { getAuthenticatedUser } from '../auth-helper.js';

const router = express.Router();

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

// GET /api/dashboard/incoming-requests - Owner/Admin incoming download requests
router.get('/incoming-requests', requireAuth, (req, res) => {
  try {
    const ownerId = req.session.userId;
    const isAdmin = req.session.role === 'admin';

    let sql = `
      SELECT 
        r.id AS request_id,
        r.modpack_id,
        m.name AS modpack_name,
        m.thumbnail AS modpack_thumbnail,
        r.requester_id,
        u.username AS requester_username,
        r.status,
        r.created_at
      FROM download_requests r
      JOIN modpacks m ON r.modpack_id = m.id
      JOIN users u ON r.requester_id = u.id
    `;
    const params = [];
    if (!isAdmin) {
      sql += ` WHERE m.owner_id = ? `;
      params.push(ownerId);
    }
    sql += `
      ORDER BY 
        CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
        r.created_at DESC
    `;
    const stmt = db.prepare(sql);
    const requests = stmt.all(...params);

    return res.json({
      success: true,
      requests,
    });
  } catch (err) {
    console.error('Incoming requests error:', err);
    return res.status(500).json({ error: 'Failed to retrieve incoming requests' });
  }
});

// POST /api/dashboard/requests/:id/action - Approve or reject a request (owner or admin)
router.post('/requests/:id/action', requireAuth, (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    if (isNaN(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const { action } = req.body;
    if (action !== 'approved' && action !== 'rejected') {
      return res.status(400).json({ error: "Action must be either 'approved' or 'rejected'" });
    }

    // Verify modpack ownership
    const checkStmt = db.prepare(`
      SELECT r.id, m.owner_id, r.status
      FROM download_requests r
      JOIN modpacks m ON r.modpack_id = m.id
      WHERE r.id = ?
    `);
    const record = checkStmt.get(requestId);

    if (!record) {
      return res.status(404).json({ error: 'Download request not found' });
    }

    const isAdmin = req.session.role === 'admin';
    if (record.owner_id !== req.session.userId && !isAdmin) {
      return res.status(403).json({ error: 'You do not have permission to manage this download request' });
    }

    // Parameterized update
    const updateStmt = db.prepare(`
      UPDATE download_requests
      SET status = ?
      WHERE id = ?
    `);
    updateStmt.run(action, requestId);

    return res.json({
      success: true,
      message: `Download request has been ${action}`,
      requestId,
      status: action,
    });
  } catch (err) {
    console.error('Request action error:', err);
    return res.status(500).json({ error: 'Failed to update download request' });
  }
});

// GET /api/dashboard/my-downloads - Requester's download requests & status
router.get('/my-downloads', requireAuth, (req, res) => {
  try {
    const requesterId = req.session.userId;

    const stmt = db.prepare(`
      SELECT 
        r.id AS request_id,
        r.modpack_id,
        m.name AS modpack_name,
        m.thumbnail AS modpack_thumbnail,
        m.short_description AS modpack_short_description,
        m.download_mode,
        u.username AS owner_username,
        r.status,
        r.created_at
      FROM download_requests r
      JOIN modpacks m ON r.modpack_id = m.id
      JOIN users u ON m.owner_id = u.id
      WHERE r.requester_id = ?
      ORDER BY r.created_at DESC
    `);
    const downloads = stmt.all(requesterId);

    return res.json({
      success: true,
      downloads,
    });
  } catch (err) {
    console.error('My downloads error:', err);
    return res.status(500).json({ error: 'Failed to retrieve your downloads' });
  }
});

// GET /api/dashboard/my-modpacks - User's created modpacks with request counts
router.get('/my-modpacks', requireAuth, (req, res) => {
  try {
    const ownerId = req.session.userId;

    const stmt = db.prepare(`
      SELECT 
        m.id,
        m.name,
        m.short_description,
        m.thumbnail,
        m.download_mode,
        m.release_status,
        m.release_date,
        m.tags,
        m.created_at,
        (SELECT COUNT(*) FROM download_requests r WHERE r.modpack_id = m.id AND r.status = 'pending') AS pending_requests_count,
        (SELECT COUNT(*) FROM download_requests r WHERE r.modpack_id = m.id AND r.status = 'approved') AS approved_requests_count
      FROM modpacks m
      WHERE m.owner_id = ?
      ORDER BY m.created_at DESC
    `);
    const modpacks = stmt.all(ownerId);

    return res.json({
      success: true,
      modpacks,
    });
  } catch (err) {
    console.error('My modpacks error:', err);
    return res.status(500).json({ error: 'Failed to retrieve your modpacks' });
  }
});

export default router;
