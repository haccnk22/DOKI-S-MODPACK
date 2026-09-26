import app from '../app.js';

export default function handler(req, res) {
  // Normalize URL in Vercel serverless environment
  const matchedPath = req.headers['x-matched-path'] || req.headers['x-vercel-matched-path'] || req.headers['x-forwarded-uri'];

  if (matchedPath && (req.url === '/api/index.js' || req.url === '/api' || req.url === '/api/')) {
    req.url = matchedPath;
  } else if (req.query && req.query.all) {
    const subPath = Array.isArray(req.query.all) ? req.query.all.join('/') : req.query.all;
    const queryIndex = req.url.indexOf('?');
    const queryString = queryIndex !== -1 ? req.url.substring(queryIndex) : '';
    req.url = '/api/' + subPath + queryString;
  }

  return app(req, res);
}
