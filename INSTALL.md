# Install Entire2API with your Agent

Read this file before running setup. Repository:
[caiweike/Entire2API](https://github.com/caiweike/Entire2API).

## What you are installing

Two local processes: an HTTP text gateway and a stdio MCP tool named `entire_ask`.
The primary Agent continues using its own tool-capable model. Entire handles short
questions by running a repository review job; it does not become the primary Agent.
New questions consume your Entire review credits and may take minutes.

Every user supplies their own Entire login, review project, repository environment,
and an existing valid review run. There are no shared credentials or public hosted
endpoint. A fresh Entire account without a working review environment is not enough.

## Instructions for the installing Agent

1. Confirm Node.js 24+ and Git are available. Ask which MCP client to configure and
   whether registration should apply to one project or the user's whole account.
   Use an installation directory chosen by the user; do not overwrite another clone.
2. Clone this repository, inspect the source and install locked dependencies:

   ```sh
   git clone https://github.com/caiweike/Entire2API.git
   cd Entire2API
   npm ci --ignore-scripts
   npm test
   ```

   Windows PowerShell may require `npm.cmd` instead of `npm`.

3. Install the official Entire CLI if it is not already available. On **Windows
   x64**, the repository supplies a fixed v0.12.2 installer with SHA-256 verification:

   ```powershell
   .\scripts\install-cli.ps1
   ```

   On macOS/Linux or Windows ARM, use the [official CLI release](https://github.com/entireio/cli/releases/tag/v0.12.2)
   for that platform, verify its published checksum, then make `entire` available on
   PATH or set `ENTIRE_CLI` to its absolute path. The bundled PowerShell installer
   is x64-only. Do not execute an unreviewed remote installation script.

4. Start the official device login and let the user complete it themselves:

   ```sh
   node bin/entire2api.mjs login
   ```

   Do not collect passwords, cookies, access tokens or refresh tokens in chat.
   Keep the default login directory `.local/entire`; the gateway reads the same
   directory. A prior CLI login in another directory is not automatically shared.
   Linux hosts without a keyring may set `ENTIRE_TOKEN_STORE=file` for both login
   and gateway startup; protect the resulting private directory.

5. Ask for the user's Entire **project slug** and a review **run ID** from their own
   working dedicated repository. These are identifiers, not credentials. A run URL
   contains both, for example `https://entire.com/et/PROJECT/REPO/agents/runs?runId=RUN_ID`.
   `PROJECT` is the project segment, not the repository name. Configure:

   ```sh
   node --use-env-proxy bin/entire2api.mjs configure et/PROJECT RUN_ID
   ```

   Replace placeholders. Forge `gh` is also supported if that is the user's project.
   This reads the existing run, pins its target/head and creates a local gateway
   key; it does not submit a new paid job. Existing configuration is never overwritten.

6. Start the gateway in a separate terminal and keep it running:

   ```sh
   node --use-env-proxy bin/entire2api.mjs start
   ```

   If the installing Agent starts a persistent background process, use its host's
   supported process manager, show how to stop it and keep logs under `.local/`.
   On Windows, background helpers must be hidden. Do not stop an unrelated process
   occupying port 8080; choose another port and configure MCP's URL accordingly.

7. Generate MCP configuration with the actual Node and installation paths:

   ```sh
   node bin/entire2api.mjs mcp-config
   ```

   Merge the `entire2api` entry into the chosen client's MCP configuration, preserving
   existing entries. No API key belongs in that configuration. The tool reads its
   own `.local/gateway-key.txt`. Set the tool timeout to at least 300 seconds using
   the client's native setting. Some clients need `type` or `timeout` removed from
   the generated entry and configured in their UI instead.

   For **Claude Code**, the official CLI registration is built in. Choose one:

   ```sh
   # All projects of this OS user:
   node bin/entire2api.mjs register --scope user

   # One chosen project (replace /absolute/project):
   node bin/entire2api.mjs register --scope local --project-dir /absolute/project
   ```

   Quotes are required around paths containing spaces. On Windows use the actual
   Windows project path. Existing same-name registrations fail rather than being
   overwritten; inspect them before changing anything. Restart/reconnect the client
   and check that `entire_ask` appears. Claude Code can inspect it with `/mcp` or
   `claude mcp get entire2api`.

8. Run the non-billing local diagnostic:

   ```sh
   node bin/entire2api.mjs doctor
   ```

   This checks config, the local key and the authenticated model-list endpoint.
   It does not verify upstream balance/login or submit an Entire job. With the user's
   agreement to consume a review job, call `entire_ask` with a short question or run
   `npm run mcp:smoke`. Preserve a `request_id` when retrying identical input.

9. If the user wants automatic delegation, copy the preferences from
   [examples/agent-instructions.md](examples/agent-instructions.md) into the client's
   supported rules file. Merge existing rules; do not silently overwrite them.
   Rules guide the model and do not grant tool permissions.

## Permission failures

Approval is controlled by the Agent host. In Claude Code, use `/permissions` to
approve the specific `mcp__entire2api__entire_ask` tool or resume in Manual mode:

```sh
claude --continue --permission-mode manual
```

If auto mode reports no classifier verdict, the tool may never have run. Do not
retry in a loop, bypass permissions or substitute a direct HTTP call to evade the
block. Ask the user to approve through their host's normal mechanism. Installation
does not change primary providers, models, permission rules or trust settings.

## Data and portability

- Questions enter Entire Agent instructions and remain in its review history;
  repository readers may see them. Use an appropriately restricted dedicated repo.
- Local receipt files retain answers/run IDs for idempotency. Treat `.local` as private.
- `mcp-config` resolves absolute paths at installation time; moving the clone requires
  regenerating and updating the registration. Do not run this from temporary `npx`
  caches, whose removal would discard the private configuration and login context.
- MCP is local stdio. A cloud Agent on another machine cannot execute these paths.
  Remote HTTP MCP hosting/authentication is not implemented.
- MCP environment: `ENTIRE2API_URL` (default `http://127.0.0.1:8080`, loopback root
  origin only), `ENTIRE2API_KEY_FILE` (absolute custom key path), `ENTIRE2API_MODEL`
  (default `entire-codex`). MCP intentionally does not load the general `.env` file;
  set overrides in the client's MCP environment. Gateway configuration uses `.env`.

## Installation completion report

Report the installation directory, chosen MCP client/scope, gateway startup method,
diagnostic result, whether a real paid tool call was tested, and any remaining user
login or host approval step. Never claim an unexecuted tool produced a model answer.
