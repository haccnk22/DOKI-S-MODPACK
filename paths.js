import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect if running in serverless environment or read-only filesystem (Vercel, AWS Lambda, Cloud Run read-only, etc.)
export const isServerless = Boolean(
  process.env.VERCEL ||
  process.env.VERCEL_ENV ||
  process.env.NOW_REGION ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT ||
  __dirname.startsWith('/var/task') ||
  __dirname.includes('/var/task') ||
  __dirname.startsWith('/tmp')
);

// On serverless platforms like Vercel, ONLY /tmp (os.tmpdir()) is writable
const writableBase = isServerless ? path.join(os.tmpdir(), 'mcintroduce') : __dirname;

export const rootDir = __dirname;
export const publicDir = path.join(__dirname, 'public');
export const dataDir = path.join(writableBase, 'data');
export const uploadsDir = path.join(writableBase, 'uploads');
export const staticUploadsDir = path.join(__dirname, 'uploads');

// Safely ensure writable directories exist without crashing on read-only environments
try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} catch (e) {
  console.warn('Notice: Primary data directory creation fallback to os.tmpdir():', e.message);
}

try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  console.warn('Notice: Primary uploads directory creation fallback to os.tmpdir():', e.message);
}

// Copy seed uploads from codebase to writable uploads dir if missing
if (isServerless && fs.existsSync(staticUploadsDir) && fs.existsSync(uploadsDir)) {
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
