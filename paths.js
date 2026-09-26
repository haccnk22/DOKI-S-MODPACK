import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const isVercel = Boolean(process.env.VERCEL);

export const rootDir = __dirname;
export const publicDir = path.join(__dirname, 'public');
export const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, 'data');
export const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, 'uploads');
export const staticUploadsDir = path.join(__dirname, 'uploads');

// Ensure directories exist
try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} catch (e) {
  console.warn('Data dir creation notice:', e.message);
}

try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  console.warn('Uploads dir creation notice:', e.message);
}

// If in Vercel, copy initial seeded uploads from codebase into /tmp/uploads if missing
if (isVercel && fs.existsSync(staticUploadsDir)) {
  try {
    const files = fs.readdirSync(staticUploadsDir);
    for (const file of files) {
      const src = path.join(staticUploadsDir, file);
      const dest = path.join(uploadsDir, file);
      if (!fs.existsSync(dest) && fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dest);
      }
    }
  } catch (err) {
    console.warn('Vercel initial uploads copy notice:', err.message);
  }
}
