import express from 'express';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import { rootDir, publicDir, uploadsDir, staticUploadsDir } from './paths.js';
import db from './db.js';
import { getAuthenticatedUser } from './auth-helper.js';
import authRouter from './routes/auth.js';
import modpacksRouter from './routes/modpacks.js';
import dashboardRouter from './routes/dashboard.js';
import pagesRouter from './routes/pages.js';
import eventsRouter from './routes/events.js';

const app = express();

// Enable trust proxy for Cloud Run, Vercel, and reverse proxies
app.set('trust proxy', 1);

// Middleware for parsing JSON and form bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express session setup
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

// Dynamic cookie sameSite/secure adjuster for iframes vs standard browsers
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

// Universal auth middleware
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

// Serve three.js module from vendor and node_modules
app.use('/vendor/three', express.static(path.join(publicDir, 'vendor/three')));
app.use('/node_modules/three', express.static(path.join(rootDir, 'node_modules/three')));

// Comprehensive upload file serving from static, public, and serverless tmp locations
const serveUploadFile = (req, res) => {
  const filename = path.basename(req.params.filename || '');
  if (!filename) return res.status(404).send('Not found');
  const candidates = [
    path.join(uploadsDir, filename),
    path.join(publicDir, 'uploads', filename),
    path.join(staticUploadsDir, filename),
    path.join(publicDir, filename),
    path.join(publicDir, 'images', filename),
    path.join('/tmp', 'mcintroduce', 'uploads', filename),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return res.sendFile(candidate);
    }
  }
  return res.status(404).send('Upload file not found');
};

app.get('/uploads/:filename', serveUploadFile);
app.get('/api/uploads/:filename', serveUploadFile);
app.use('/uploads', express.static(uploadsDir));
app.use('/uploads', express.static(path.join(publicDir, 'uploads')));
if (uploadsDir !== staticUploadsDir && fs.existsSync(staticUploadsDir)) {
  app.use('/uploads', express.static(staticUploadsDir));
}

// Mount API routes (supporting both with and without /api prefix for proxy resilience)
app.use(['/api/auth', '/auth'], authRouter);
app.use(['/api/modpacks/:id/page', '/modpacks/:id/page'], pagesRouter);
app.use(['/api/modpacks', '/modpacks'], modpacksRouter);
app.use(['/api/dashboard', '/dashboard-api'], dashboardRouter);
app.use(['/api/events', '/events-api'], eventsRouter);

// Health check endpoint
app.get(['/api/health', '/health'], (req, res) => {
  res.json({ status: 'ok', message: "Doki's Modpacks server is running" });
});

// Serve static frontend files from /public
app.use(express.static(publicDir));

export default app;
