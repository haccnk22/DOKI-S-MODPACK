import app from '../app.js';

export default function handler(req, res) {
  const matchedPath = req.headers['x-matched-path'] || req.headers['x-vercel-matched-path'] || req.headers['x-forwarded-uri'];
  if (matchedPath) {
    req.url = matchedPath;
  } else if (req.query && req.query.all) {
    const subPath = Array.isArray(req.query.all) ? req.query.all.join('/') : req.query.all;
    const queryIndex = req.url.indexOf('?');
    const queryString = queryIndex !== -1 ? req.url.substring(queryIndex) : '';
    req.url = '/api/' + subPath + queryString;
  } else if (!req.url.startsWith('/api') && !req.url.startsWith('/uploads') && !req.url.startsWith('/vendor')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
}
