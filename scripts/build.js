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

console.log('Running robust Vercel asset build and sync...');

// Helper for safe copy
function safeCopy(src, dest) {
  try {
    if (fs.existsSync(src)) {
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(src, dest);
    }
  } catch (err) {
    console.warn(`Warning: safeCopy failed for ${src} -> ${dest}:`, err.message);
  }
}

// 1. Copy full Three.js build files (three.core.js, three.module.js, etc.)
try {
  if (fs.existsSync(nodeModulesThree)) {
    const threeBuild = path.join(nodeModulesThree, 'build');
    const destBuild = path.join(publicVendorDir, 'build');
    fs.mkdirSync(destBuild, { recursive: true });

    if (fs.existsSync(threeBuild)) {
      for (const file of fs.readdirSync(threeBuild)) {
        const src = path.join(threeBuild, file);
        const dest = path.join(destBuild, file);
        if (fs.statSync(src).isFile()) {
          safeCopy(src, dest);
        }
      }
    }

    // Copy OrbitControls and all controls
    const controlsSrc = path.join(nodeModulesThree, 'examples', 'jsm', 'controls');
    const controlsDest = path.join(publicVendorDir, 'examples', 'jsm', 'controls');
    if (fs.existsSync(controlsSrc)) {
      fs.mkdirSync(controlsDest, { recursive: true });
      for (const file of fs.readdirSync(controlsSrc)) {
        const src = path.join(controlsSrc, file);
        const dest = path.join(controlsDest, file);
        if (fs.statSync(src).isFile()) {
          safeCopy(src, dest);
        }
      }
    }
  }
} catch (e) {
  console.warn('Three.js build sync notice:', e.message);
}

// 2. Ensure upload directories exist
try {
  fs.mkdirSync(publicUploadsDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  if (fs.existsSync(uploadsDir)) {
    for (const file of fs.readdirSync(uploadsDir)) {
      const src = path.join(uploadsDir, file);
      const dest = path.join(publicUploadsDir, file);
      if (fs.statSync(src).isFile()) {
        safeCopy(src, dest);
      }
    }
  }
} catch (e) {
  console.warn('Uploads sync notice:', e.message);
}

// 3. Ensure panorama_5.png is present in both uploads directories
try {
  const possiblePanoramas = [
    path.join(publicUploadsDir, 'panorama_5.png'),
    path.join(uploadsDir, 'panorama_5.png'),
    path.join(rootDir, 'public', 'panorama_5.png')
  ];
  let foundPanorama = null;
  for (const p of possiblePanoramas) {
    if (fs.existsSync(p)) {
      foundPanorama = p;
      break;
    }
  }
  if (foundPanorama) {
    safeCopy(foundPanorama, path.join(publicUploadsDir, 'panorama_5.png'));
    safeCopy(foundPanorama, path.join(uploadsDir, 'panorama_5.png'));
  }
} catch (e) {
  console.warn('Panorama sync notice:', e.message);
}

console.log('Vercel asset sync completed successfully.');
