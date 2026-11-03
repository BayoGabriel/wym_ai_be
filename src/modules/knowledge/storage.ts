import { promises as fs } from 'fs';
import path from 'path';

const BASE_DIR = path.resolve(process.cwd(), 'storage', 'knowledge');

export async function initStorage() {
  await fs.mkdir(BASE_DIR, { recursive: true });
}

export async function savePdfBuffer(orgId: string, filename: string, buf: Buffer): Promise<string> {
  const safeOrg = orgId.replace(/[^a-zA-Z0-9-_]/g, '_');
  const dir = path.join(BASE_DIR, safeOrg);
  await fs.mkdir(dir, { recursive: true });
  const key = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9-_.]/g, '_')}`;
  const full = path.join(dir, key);
  await fs.writeFile(full, buf);
  return path.relative(BASE_DIR, full).replace(/\\/g, '/');
}

export async function readPdf(key: string): Promise<Buffer> {
  const full = path.join(BASE_DIR, key);
  return fs.readFile(full);
}
