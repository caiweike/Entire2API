import { mkdir, writeFile } from 'node:fs/promises';
import { EntireClient, configureFromRun } from '../src/entire.mjs';
import { validateConfig, gatewayKey } from '../src/config.mjs';

try { process.loadEnvFile('.env'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const [project, runId] = process.argv.slice(2);
if (!project || !runId || !/^(et|gh)\/[A-Za-z0-9-]+$/.test(project) || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(runId)) {
  console.error('Usage: npm run configure -- et/project-slug EXISTING_RUN_ID'); process.exit(1);
}
try {
  const [forge, slug] = project.split('/');
  const config = validateConfig(await configureFromRun(new EntireClient(), forge, slug, runId));
  await mkdir('.local', { recursive: true });
  await writeFile('.local/config.json', JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 });
  await gatewayKey();
  console.log('Saved .local/config.json and prepared .local/gateway-key.txt. No new job was started.');
} catch (e) {
  console.error(e.code === 'EEXIST' ? 'Configuration already exists; edit it explicitly instead of overwriting.' : e.message); process.exitCode = 1;
}
