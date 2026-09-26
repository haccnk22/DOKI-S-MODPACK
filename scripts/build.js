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

// 1. Copy full Three.js build files (three.core.js, three.module.js, etc.)
if (fs.existsSync(nodeModulesThree)) {
  const threeBuild = path.join(nodeModulesThree, 'build');
  const destBuild = path.join(publicVendorDir, 'build');
  fs.mkdirSync(destBuild, { recursive: true });

  if (fs.existsSync(threeBuild)) {
    for (const file of fs.readdirSync(threeBuild)) {
      const src = path.join(threeBuild, file);
      const dest = path.join(destBuild, file);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dest);
      }
    }
  }

  // Copy OrbitControls and controls directory
  const controlsSrc = path.join(nodeModulesThree, 'examples', 'jsm', 'controls');
  const controlsDest = path.join(publicVendorDir, 'examples', 'jsm', 'controls');
  if (fs.existsSync(controlsSrc)) {
    fs.mkdirSync(controlsDest, { recursive: true });
    for (const file of fs.readdirSync(controlsSrc)) {
      const src = path.join(controlsSrc, file);
      const dest = path.join(controlsDest, file);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dest);
      }
    }
  }
}

// 2. Copy all default uploads
fs.mkdirSync(publicUploadsDir, { recursive: true });
if (fs.existsSync(uploadsDir)) {
  for (const file of fs.readdirSync(uploadsDir)) {
    const src = path.join(uploadsDir, file);
    const dest = path.join(publicUploadsDir, file);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
}

// 3. Ensure panorama_5.png is synced
const publicPanorama = path.join(rootDir, 'public', 'panorama_5.png');
if (fs.existsSync(publicPanorama)) {
  fs.copyFileSync(publicPanorama, path.join(publicUploadsDir, 'panorama_5.png'));
  fs.copyFileSync(publicPanorama, path.join(uploadsDir, 'panorama_5.png'));
}

console.log('Build asset sync complete.');
