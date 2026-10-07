# Fetch MCP — nullbio fork

![Fetch MCP logo](logo.jpg)

Security-maintained fork of [zcaceres/fetch-mcp](https://github.com/zcaceres/fetch-mcp).
Source, fixes and issue tracking live at [nullbio/fetch-mcp](https://github.com/nullbio/fetch-mcp).

## Install from this fork

Requires Node.js 22.19+ and pnpm 11.25.0. The package is private; use this checkout rather than the upstream npm package.

```bash
git clone https://github.com/nullbio/fetch-mcp.git
cd fetch-mcp
# For repeatable deployment, check out the reviewed commit you intend to run.
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm typecheck
pnpm build
```

Configure your MCP client with the absolute path to this checkout:

```json
{
  "mcpServers": {
    "fetch": {
      "command": "node",
      "args": ["/absolute/path/to/fetch-mcp/dist/index.js"]
    }
  }
}
```

These instructions run this fork's built code directly.

### Claude Code

After building, run this command from the repository directory:

```bash
claude mcp add --scope user --transport stdio fetch-fork -- \
  node "$(pwd)/dist/index.js"
```

The command saves the absolute path to this checkout. User scope makes the server available across your projects, and Claude Code starts the process automatically.

Restart Claude Code, run `/mcp`, and confirm that `fetch-fork` is connected. For example, ask:

> Use fetch-fork's fetch_readable tool to fetch https://en.wikipedia.org/wiki/Model_Context_Protocol and summarize it.

If you previously configured the upstream fetch server, remove its entry to avoid duplicate tools. See the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) for configuration scopes and server management.

### Codex

After building, run this command from the repository directory:

```bash
codex mcp add fetch-fork -- node "$(pwd)/dist/index.js"
```

This registers the server in your user-level Codex configuration. Restart Codex to load it, then use `/mcp` in the terminal UI to check the connection. You can inspect the saved configuration with `codex mcp get fetch-fork`.

Ask Codex to use `fetch-fork` when retrieving URLs. See the [Codex MCP documentation](https://developers.openai.com/codex/mcp) for configuration details.

### Updating an existing installation

After updating this checkout to the reviewed commit you want to run, rebuild it:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm typecheck
pnpm build
```

Restart your MCP client to load the new build. You do not need to register the server again unless you move the checkout.

## Tools

| Tool | Result |
|---|---|
| `fetch_html` | Raw HTML |
| `fetch_markdown` | HTML converted to Markdown |
| `fetch_txt` | Plain text with scripts and styles removed |
| `fetch_json` | Parsed and serialized JSON |
| `fetch_readable` | Main article extracted with Mozilla Readability, as Markdown |
| `fetch_youtube_transcript` | Captions extracted directly from an HTTPS YouTube page |

All tools accept:

| Parameter | Description |
|---|---|
| `url` | Required HTTP or HTTPS URL |
| `headers` | Optional custom request headers; transport overrides such as `Host` are rejected |
| `max_length` | Maximum returned characters; default 5000, zero returns the full bounded response |
| `start_index` | Start at this character index; default 0 |

The transcript tool also accepts `lang` (default `en`), falling back to the first available caption track. It supports `youtube.com`, `www.youtube.com`, `m.youtube.com` and `youtu.be`. If YouTube does not include captions in the page, extraction fails. External downloaders are not invoked.

## CLI

```bash
node dist/cli.js markdown https://example.com
node dist/cli.js readable https://example.com/article
node dist/cli.js youtube 'https://www.youtube.com/watch?v=jNQXAC9IVRw' --lang es
node dist/cli.js html https://example.com --max-length 10000 --start-index 5000
```

Commands: `html`, `markdown`, `readable`, `txt`, `json`, `youtube`.
Flags: `--max-length`, `--start-index`, `--lang`, `--help`, `--version`.

## Security model

- Only public unicast HTTP/HTTPS destinations are permitted. Private, loopback, link-local, multicast, reserved and IPv6 transition addresses are rejected.
- DNS lookup failures fail closed. Every returned address must pass validation, and the socket uses only those validated addresses.
- Redirects are followed manually, validated before connecting, and limited to five. HTTPS downgrades are blocked; custom headers are removed when the origin changes.
- URL credentials and transport header overrides are rejected. Caption URLs must use the supported YouTube hosts and `/api/timedtext`; caller headers are never sent to caption URLs.
- Requests have a total deadline covering DNS, redirects and body reads, a decompressed byte cap, and a limit of eight concurrent network operations per process.
- Per-request proxies and the automatic `yt-dlp` execution path have been removed because they bypassed the network boundary.
- Dependencies are pinned and installed from the committed pnpm lockfile. Tests run on Node with Vitest, matching the production runtime.

Fetched content remains untrusted, including instructions embedded in pages. Clients must treat it as data and retain their own tool approval controls. The network limits do not bound synchronous HTML parsing CPU or process memory; use process/container resource limits for hostile workloads. Egress filtering remains useful for networks that route public addresses to internal services.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `DEFAULT_LIMIT` | `5000` | Default returned characters; zero disables character truncation |
| `MAX_RESPONSE_BYTES` | `10485760` | Maximum decompressed body bytes; must be positive |
| `REQUEST_TIMEOUT_MS` | `30000` | Total network deadline per fetch, including redirects; must be positive |

Invalid numeric configuration fails at startup. Transcript extraction uses one bounded fetch for the page and one for captions.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm dev       # rebuild on source changes
pnpm start     # run the built MCP server
pnpm audit
```

## License

MIT. Original authorship and license notices are preserved in [LICENSE](LICENSE).
