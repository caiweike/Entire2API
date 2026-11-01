import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// One gateway process per state directory. Persist receipts before the next
// upstream mutation, so a retry can resume a paid run after a process restart.
export class ReceiptStore {
  constructor(directory) { this.directory = directory; }
  file(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid receipt key');
    return join(this.directory, `${key}.json`);
  }
  async load(key) {
    try { return JSON.parse(await readFile(this.file(key), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async save(key, value) {
    await mkdir(this.directory, { recursive: true });
    const temp = `${this.file(key)}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, this.file(key));
  }
}
