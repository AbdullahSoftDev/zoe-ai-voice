import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '..', 'dist', 'server');
const src = path.join(dir, 'index.js');
const dst = path.join(dir, 'server.js');

if (fs.existsSync(src) && !fs.existsSync(dst)) {
  fs.copyFileSync(src, dst);
  console.log('[fix] Created dist/server/server.js');
} else if (!fs.existsSync(src)) {
  console.error('[fix] ERROR: dist/server/index.js not found');
  process.exit(1);
} else {
  console.log('[fix] dist/server/server.js already exists, skipping');
}