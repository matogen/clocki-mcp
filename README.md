# clocki-mcp

An [MCP](https://modelcontextprotocol.io) server for the Clocki time-tracking REST API
(`https://<host>/api/v1`, documented at `https://<host>/api-docs`). It lets an MCP client
such as Claude Code list and log time entries and drive the timer.

## Tools

| Tool | What it does |
|---|---|
| `list_entries` | Time entries in a period, filterable by client, project, user or text. Paginated. |
| `create_entries` | Create 1–500 entries; overlaps, locked periods and permissions are reported per item. |
| `list_users`, `list_projects`, `list_clients` | Reference data with ids, with an optional name filter. |
| `get_timer` | The running timer, or `{running: false}`. |
| `start_timer`, `stop_timer`, `cancel_timer` | Start, stop (logs an entry) or discard the timer. |
| `resume_timer` | Resume a previous task as a new running timer. |
| `chain_timer`, `resume_chain_timer` | Snap the timer start to the end of your previous entry. |

Dates are `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS` in the workspace timezone, or ISO 8601
with an offset.

## Setup

Requires Node 18 or later.

```bash
git clone https://github.com/matogen/clocki-mcp.git
cd clocki-mcp
npm ci
```

Configuration is by environment variable:

| Variable | Required | Default |
|---|---|---|
| `CLOCKI_API_KEY` | yes | — your personal Clocki API key |
| `CLOCKI_BASE_URL` | no | `https://cwd.clocki.net` |

The key is sent as `X-Api-Key`; the `Authorization` header is stripped upstream on the
Clocki host.

### Claude Code

```bash
claude mcp add clocki --scope user \
  -e CLOCKI_API_KEY=<your key> \
  -e CLOCKI_BASE_URL=https://cwd.clocki.net \
  -- node /absolute/path/to/clocki-mcp/index.js
```

Or add it to the `mcpServers` section of an MCP client config:

```json
{
  "mcpServers": {
    "clocki": {
      "command": "node",
      "args": ["/absolute/path/to/clocki-mcp/index.js"],
      "env": {
        "CLOCKI_API_KEY": "<your key>",
        "CLOCKI_BASE_URL": "https://cwd.clocki.net"
      }
    }
  }
}
```

Each developer uses their own API key. Never commit a key to this repository.

## Checking it starts

```bash
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | CLOCKI_API_KEY=dummy node index.js
```

This lists the tools without calling the Clocki API.
