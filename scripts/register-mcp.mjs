import { registerMcp } from '../src/setup.mjs';
try {
  const result = await registerMcp(process.argv.slice(2));
  console.log(result.message);
  console.log(`Scope: ${result.scope}; directory: ${result.projectDir}`);
} catch {
  console.error('Registration failed. Check that Claude Code is installed, the target directory exists, and no same-name server is already registered. Use --scope local|project|user and --project-dir PATH.');
  process.exitCode = 1;
}
