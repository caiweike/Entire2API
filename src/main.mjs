import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, gatewayKey } from './config.mjs';
import { EntireClient } from './entire.mjs';
import { ReceiptStore } from './store.mjs';
import { ReviewAdapter } from './adapter.mjs';
import { createGateway } from './server.mjs';

try { process.loadEnvFile('.env'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const state = resolve(process.env.STATE_DIR || '.local/state');
await mkdir(state, { recursive: true });
const lock = resolve(state, 'server.lock');
try { await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
catch (e) {
  if (e.code !== 'EEXIST') throw e;
  const pid = Number(await readFile(lock, 'utf8'));
  let alive = true;
  try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
  if (alive) throw new Error('Another gateway process owns this state directory.');
  await unlink(lock);
  await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
}
try {
  const config = await loadConfig();
  const apiKey = await gatewayKey();
  const log = value => process.stdout.write(JSON.stringify({ time: new Date().toISOString(), ...value }) + '\n');
  const adapter = new ReviewAdapter(config, new EntireClient(), new ReceiptStore(resolve(state, 'receipts')), { onWarning: log });
  const server = createGateway({ adapter, apiKey, models: config.models, onLog: log });
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  server.listen(port, process.env.HOST || '127.0.0.1', () => log({ event: 'listening', host: process.env.HOST || '127.0.0.1', port, mode: 'review-adapter' }));
  const stop = () => { server.shutdown(); setTimeout(() => process.exit(1), 30000).unref(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  server.on('error', () => { log({ event: 'listen_failed' }); stop(); process.exitCode = 1; });
  server.on('close', async () => { await unlink(lock).catch(() => {}); });
} catch (error) { await unlink(lock).catch(() => {}); throw error; }
