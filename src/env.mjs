// Minimal .env loader (no dependency). Import this FIRST so the constants in
// server.mjs read the right values. Real env vars always win over the file.
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), '.env');
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
