#!/usr/bin/env node
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { projectRoot } from '../src/mcp-tool.mjs';

const [command = 'help', ...args] = process.argv.slice(2);
const launchDir = process.cwd();
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required.');
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`Entire2API 0.2.0 — review-job text adapter

Usage: node /absolute/path/to/Entire2API/bin/entire2api.mjs COMMAND
  login                         Official Entire device login (interactive)
  configure et/PROJECT RUN_ID    Initialize from your existing review run
  start                         Run local HTTP gateway in foreground
  mcp                           Serve entire_ask over stdio (gateway required)
  mcp-config                    Print a portable mcpServers JSON configuration
  register [--scope SCOPE] [--project-dir PATH]
                                Register Claude Code MCP; default local scope
  doctor                        Check local setup and gateway; no paid request

Scopes: local, project, user. Registration never grants tool permissions.
See INSTALL.md for prerequisites and Agent-assisted setup.`);
  } else if (command === 'mcp-config') {
    const { mcpRegistration } = await import('../src/setup.mjs');
    console.log(JSON.stringify({ mcpServers: { entire2api: mcpRegistration() } }, null, 2));
  } else if (command === 'register') {
    const { registerMcp } = await import('../src/setup.mjs');
    const result = await registerMcp(args, launchDir);
    console.log(result.message);
    console.log(`Scope: ${result.scope}; directory: ${result.projectDir}`);
  } else {
    process.chdir(projectRoot);
    if (command === 'mcp') {
      if (args.length) throw new Error('mcp takes no arguments.');
      await import('../src/mcp.mjs');
    } else {
      try { process.loadEnvFile('.env'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (command === 'start') {
        if (args.length) throw new Error('start takes no arguments.');
        await import('../src/main.mjs');
      } else if (command === 'configure') {
        process.argv = [process.execPath, resolve(projectRoot, 'scripts/configure.mjs'), ...args];
        await import('../scripts/configure.mjs');
      } else if (command === 'doctor') {
        const { doctor } = await import('../src/setup.mjs');
        const result = await doctor(); console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exitCode = 1;
      } else if (command === 'login') {
        if (args.length) throw new Error('login takes no arguments.');
        const cli = process.env.ENTIRE_CLI || (process.platform === 'win32' && existsSync(resolve('.tools/entire.exe')) ? resolve('.tools/entire.exe') : 'entire');
        const child = spawn(cli, ['login', '--device'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, ENTIRE_CONFIG_DIR: process.env.ENTIRE_CONFIG_DIR || resolve('.local/entire') } });
        child.on('error', () => { console.error('Official Entire CLI unavailable. Install it first; see INSTALL.md.'); process.exitCode = 1; });
        child.on('exit', code => { process.exitCode = code ?? 1; });
      } else throw new Error('Unknown command. Run with help.');
    }
  }
} catch {
  // Exceptions can originate in credential helpers; never reflect their output.
  process.stderr.write('Entire2API command failed. Check its arguments, setup and existing registrations; see INSTALL.md.\n');
  process.exitCode = 1;
}
