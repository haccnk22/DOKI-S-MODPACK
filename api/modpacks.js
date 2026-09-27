import app from '../app.js';

export default function handler(req, res) {
  if (!req.url.startsWith('/api') && !req.url.startsWith('/uploads') && !req.url.startsWith('/vendor')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
}
