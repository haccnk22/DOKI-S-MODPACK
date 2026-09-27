import app from '../app.js';

export default function handler(req, res) {
  const originalUrl = 
    req.headers['x-matched-path'] || 
    req.headers['x-forwarded-uri'] || 
    req.headers['x-vercel-original-url'] || 
    req.url;

  if (originalUrl && !originalUrl.includes('/api/index.js')) {
    req.url = originalUrl;
  } else if (!req.url.startsWith('/api') && !req.url.startsWith('/uploads') && !req.url.startsWith('/vendor')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }

  return app(req, res);
}
