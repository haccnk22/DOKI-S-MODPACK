import crypto from 'crypto';
import db from './db.js';

const SECRET = process.env.SESSION_SECRET || 'mcintroduce-craft-secret-key-2026';

/**
 * Creates a signed HMAC token for authentication in iframe/cookie-restricted environments.
 * Format: userId.timestamp.hmac
 */
export function generateToken(userId) {
  const timestamp = Date.now();
  const hmac = crypto.createHmac('sha256', SECRET).update(`${userId}:${timestamp}`).digest('hex');
  return `${userId}.${timestamp}.${hmac}`;
}

export function createAuthToken(userId, username) {
  return generateToken(userId);
}

/**
 * Verifies an HMAC authentication token.
 * Returns { userId, username, role } if valid and not expired (7 days), null otherwise.
 */
export function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;

  try {
    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;

    const [userIdStr, timestampStr, hmac] = parts;
    const userId = parseInt(userIdStr, 10);
    const timestamp = parseInt(timestampStr, 10);

    if (isNaN(userId) || isNaN(timestamp)) return null;

    // Max age: 7 days
    const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - timestamp > MAX_AGE) return null;

    const expectedHmac = crypto.createHmac('sha256', SECRET).update(`${userId}:${timestamp}`).digest('hex');
    const hmacBuf = Buffer.from(hmac);
    const expectedBuf = Buffer.from(expectedHmac);

    if (hmacBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(hmacBuf, expectedBuf)) return null;

    // Fetch user from DB to verify user exists and get fresh role/username
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
    if (!user) return null;

    return {
      userId: user.id,
      username: user.username,
      role: user.role || 'user',
    };
  } catch (err) {
    console.error('Token verification error:', err);
    return null;
  }
}

/**
 * Extracts authenticated user from Authorization header, query parameter, or session cookie.
 */
export function getAuthenticatedUser(req) {
  // 1. Authorization Bearer check (vital for iframes where 3rd-party cookies are blocked)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const verified = verifyAuthToken(token);
    if (verified) {
      return verified;
    }
  }

  // 2. Query parameter check (vital for direct <a> navigation and download redirects)
  if (req.query && req.query.auth_token) {
    const verified = verifyAuthToken(req.query.auth_token);
    if (verified) {
      return verified;
    }
  }

  // 3. Session check
  if (req.session && req.session.userId) {
    try {
      const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.session.userId);
      if (user) {
        return {
          userId: user.id,
          username: user.username,
          role: user.role || 'user',
        };
      }
    } catch (dbErr) {
      console.error('Session user DB lookup error:', dbErr);
    }
  }

  return null;
}
