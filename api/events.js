import app from '../app.js';

export default function handler(req, res) {
  const matchedPath = req.headers['x-matched-path'] || req.headers['x-vercel-matched-path'] || req.headers['x-forwarded-uri'];
  if (matchedPath) {
    req.url = matchedPath;
  } else if (!req.url.startsWith('/api') && !req.url.startsWith('/events')) {
    req.url = '/api/events' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
}
