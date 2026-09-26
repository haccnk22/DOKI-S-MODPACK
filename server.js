import express from 'express';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './db.js';
import { getAuthenticatedUser } from './auth-helper.js';
import authRouter from './routes/auth.js';
import modpacksRouter from './routes/modpacks.js';
import dashboardRouter from './routes/dashboard.js';
import pagesRouter from './routes/pages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads and data directories exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Enable trust proxy for Cloud Run and iframe reverse proxy TLS termination
app.set('trust proxy', 1);

// Middleware for parsing JSON and form bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express session setup (dynamic secure cookie for localhost and AI Studio iFrame)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'mcintroduce-craft-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      sameSite: 'none',
      secure: 'auto',
    },
  })
);

// Dynamic cookie sameSite/secure adjuster for iframes vs local development
app.use((req, res, next) => {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (req.session && req.session.cookie) {
    if (isHttps) {
      req.session.cookie.secure = true;
      req.session.cookie.sameSite = 'none';
    } else {
      req.session.cookie.secure = false;
      req.session.cookie.sameSite = 'lax';
    }
  }
  next();
});

// Universal auth middleware: seamlessly populates req.session and req.user from cookie OR Bearer token OR query param
app.use((req, res, next) => {
  const authUser = getAuthenticatedUser(req);
  if (authUser) {
    if (!req.session) req.session = {};
    req.session.userId = authUser.userId;
    req.session.username = authUser.username;
    req.session.role = authUser.role;
    req.user = authUser;
  }
  next();
});

// Serve three.js module from node_modules for frontend import maps
app.use('/node_modules/three', express.static(path.join(__dirname, 'node_modules/three')));

// Serve user uploads
app.use('/uploads', express.static(uploadsDir));

// Mount API routes
app.use('/api/auth', authRouter);
app.use('/api/modpacks/:id/page', pagesRouter);
app.use('/api/modpacks', modpacksRouter);
app.use('/api/dashboard', dashboardRouter);

// Serve static frontend files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MCIntroduce server is running' });
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
