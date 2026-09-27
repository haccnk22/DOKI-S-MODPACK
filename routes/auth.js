import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { generateToken, getAuthenticatedUser } from '../auth-helper.js';

const router = express.Router();

// Simple in-memory rate limiter for login route
// Tracks failed login attempts per client IP
const loginAttempts = new Map(); // ip -> { count: number, resetAt: number }
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILED_ATTEMPTS = 5;

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };

  if (now > record.resetAt) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    const remainingSeconds = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, remainingSeconds };
  }

  return { allowed: true };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else {
    record.count += 1;
  }
}

function clearFailedLogin(ip) {
  loginAttempts.delete(ip);
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate username
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' });
    }
    const cleanUsername = username.trim();
    if (cleanUsername.length < 3 || cleanUsername.length > 20) {
      return res.status(400).json({ error: 'Username must be between 3 and 20 characters' });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, and dashes' });
    }

    // Validate password
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: 'Password is too long (maximum 128 characters)' });
    }

    // Check if username already taken (case-insensitive) using parameterized SQL
    const checkStmt = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE');
    const existing = checkStmt.get(cleanUsername);
    if (existing) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    // Hash password with bcrypt
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user using parameterized SQL (role defaults to 'user')
    const insertStmt = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
    const result = insertStmt.run(cleanUsername, passwordHash, 'user');
    const userId = Number(result.lastInsertRowid);

    if (db.saveSnapshot) db.saveSnapshot();

    // Set session data
    req.session.userId = userId;
    req.session.username = cleanUsername;
    req.session.role = 'user';

    // Dynamically adjust cookie for HTTPS/iframe vs localhost HTTP
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      req.session.cookie.secure = true;
      req.session.cookie.sameSite = 'none';
    } else {
      req.session.cookie.secure = false;
      req.session.cookie.sameSite = 'lax';
    }

    const token = generateToken(userId);

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Session save error on register:', saveErr);
      }
      return res.status(201).json({
        success: true,
        message: 'Registration successful',
        token,
        user: {
          id: userId,
          username: cleanUsername,
          role: 'user',
        },
      });
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Failed to register account' });
  }
});

// POST /api/auth/login (with rate limiting)
router.post('/login', async (req, res) => {
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  // Check rate limit
  const rateLimitStatus = checkLoginRateLimit(clientIp);
  if (!rateLimitStatus.allowed) {
    return res.status(429).json({
      error: `Too many failed login attempts. Please try again in ${rateLimitStatus.remainingSeconds} seconds.`,
    });
  }

  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = String(username).trim();

    // Query user by username using parameterized SQL
    const userStmt = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
    const user = userStmt.get(cleanUsername);

    if (!user) {
      recordFailedLogin(clientIp);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Verify password hash
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      recordFailedLogin(clientIp);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Clear failed login attempts on successful authentication
    clearFailedLogin(clientIp);

    // Set session data
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role || 'user';

    // Dynamically adjust cookie for HTTPS/iframe vs localhost HTTP
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      req.session.cookie.secure = true;
      req.session.cookie.sameSite = 'none';
    } else {
      req.session.cookie.secure = false;
      req.session.cookie.sameSite = 'lax';
    }

    const token = generateToken(user.id);

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Session save error on login:', saveErr);
      }
      return res.json({
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role || 'user',
        },
      });
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Failed to process login' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ error: 'Failed to log out' });
      }
      res.clearCookie('connect.sid');
      return res.json({ success: true, message: 'Logged out successfully' });
    });
  } else {
    return res.json({ success: true, message: 'Already logged out' });
  }
});

// GET /api/auth/me ("who am I" endpoint)
router.get('/me', (req, res) => {
  const authUser = getAuthenticatedUser(req);
  if (!authUser) {
    return res.json({
      loggedIn: false,
      user: null,
    });
  }

  try {
    // Retrieve fresh user info using parameterized query
    const userStmt = db.prepare('SELECT id, username, role, email, bio, created_at FROM users WHERE id = ?');
    const user = userStmt.get(authUser.userId);

    if (!user) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      res.clearCookie('connect.sid');
      return res.json({
        loggedIn: false,
        user: null,
      });
    }

    return res.json({
      loggedIn: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role || 'user',
        email: user.email || '',
        bio: user.bio || '',
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error('Who am I error:', err);
    return res.status(500).json({ error: 'Failed to retrieve user status' });
  }
});

// PUT /api/auth/profile - Update username, email, and bio
router.put('/profile', (req, res) => {
  const authUser = getAuthenticatedUser(req);
  if (!authUser) return res.status(401).json({ error: 'You must be logged in to update profile' });

  try {
    const { username, email, bio } = req.body;
    const cleanUsername = (username || '').trim();
    const cleanEmail = (email || '').trim();
    const cleanBio = (bio || '').trim();

    if (!cleanUsername || cleanUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long' });
    }

    // Check if new username conflicts with another user
    const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(cleanUsername, authUser.userId);
    if (existing) {
      return res.status(409).json({ error: 'Username is already taken by another user' });
    }

    db.prepare(`
      UPDATE users
      SET username = ?, email = ?, bio = ?
      WHERE id = ?
    `).run(cleanUsername, cleanEmail, cleanBio, authUser.userId);

    if (db.saveSnapshot) db.saveSnapshot();

    // Update session
    if (req.session) {
      req.session.username = cleanUsername;
    }

    const token = generateToken(authUser.userId);

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      token,
      user: {
        id: authUser.userId,
        username: cleanUsername,
        role: authUser.role,
        email: cleanEmail,
        bio: cleanBio,
      },
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /api/auth/password - Change user password
router.put('/password', (req, res) => {
  const authUser = getAuthenticatedUser(req);
  if (!authUser) return res.status(401).json({ error: 'You must be logged in to change password' });

  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(authUser.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const passwordValid = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!passwordValid) {
      return res.status(400).json({ error: 'Incorrect current password' });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, authUser.userId);

    if (db.saveSnapshot) db.saveSnapshot();

    return res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

export default router;
