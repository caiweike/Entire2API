import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createEntireMcpServer } from './mcp-server.mjs';

// stdout belongs exclusively to MCP; npm banners, prompts and credentials must
// never be written here. Use this file directly with an absolute Node command.
try { serveStdio(() => createEntireMcpServer()); }
catch { process.stderr.write('Entire2API MCP startup failed; check its local endpoint configuration.\n'); process.exitCode = 1; }
