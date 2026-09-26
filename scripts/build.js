import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const publicVendorDir = path.join(rootDir, 'public', 'vendor', 'three');
const publicUploadsDir = path.join(rootDir, 'public', 'uploads');
const uploadsDir = path.join(rootDir, 'uploads');
const nodeModulesThree = path.join(rootDir, 'node_modules', 'three');

console.log('Running Vercel build asset sync...');

// Ensure Three.js is in public/vendor for static CDN serving
if (fs.existsSync(nodeModulesThree)) {
  fs.mkdirSync(path.join(publicVendorDir, 'build'), { recursive: true });
  fs.mkdirSync(path.join(publicVendorDir, 'examples', 'jsm', 'controls'), { recursive: true });

  const threeSrc = path.join(nodeModulesThree, 'build', 'three.module.js');
  const threeDest = path.join(publicVendorDir, 'build', 'three.module.js');
  if (fs.existsSync(threeSrc)) {
    fs.copyFileSync(threeSrc, threeDest);
  }

  const controlsSrc = path.join(nodeModulesThree, 'examples', 'jsm', 'controls', 'OrbitControls.js');
  const controlsDest = path.join(publicVendorDir, 'examples', 'jsm', 'controls', 'OrbitControls.js');
  if (fs.existsSync(controlsSrc)) {
    fs.copyFileSync(controlsSrc, controlsDest);
  }
}

// Ensure default uploads are copied to public/uploads
fs.mkdirSync(publicUploadsDir, { recursive: true });
if (fs.existsSync(uploadsDir)) {
  const files = fs.readdirSync(uploadsDir);
  for (const file of files) {
    const src = path.join(uploadsDir, file);
    const dest = path.join(publicUploadsDir, file);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
}

console.log('Vercel build asset sync complete.');
