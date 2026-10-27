#!/usr/bin/env node
// MCP server for the Clocki time-tracking REST API (https://<host>/api-docs).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.CLOCKI_BASE_URL || "https://cwd.clocki.net").replace(/\/+$/, "");
const API_KEY = process.env.CLOCKI_API_KEY;

if (!API_KEY) {
  console.error("CLOCKI_API_KEY is not set");
  process.exit(1);
}

async function api(method, path, { query, body } = {}) {
  const url = new URL(`${BASE_URL}/api/v1${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  // The Authorization header is stripped upstream on this host, so use the
  // documented X-Api-Key fallback.
  const headers = { "X-Api-Key": API_KEY, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

function result({ status, ok, data }) {
  // 207 (partial batch create) is still informative, not a hard error.
  const isError = !ok && status !== 207;
  const payload = isError ? { status, ...(typeof data === "object" && data ? data : { error: data }) } : data;
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

function filterByName(res, search) {
  if (!search || !res.ok || !Array.isArray(res.data?.data)) return res;
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = res.data.data.filter((row) => {
    const hay = Object.values(row).join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  return { ...res, data: { ...res.data, data: rows } };
}

const datetime = z
  .string()
  .describe("Date (YYYY-MM-DD) or datetime (YYYY-MM-DD HH:MM:SS) in the workspace timezone, or ISO 8601 with offset");

const server = new McpServer({ name: "clocki", version: "1.0.0" });

// --- Entries ---------------------------------------------------------------

server.registerTool(
  "list_entries",
  {
    title: "List time entries",
    description:
      "List visible time entries within a period (your own, plus those on projects/clients you can read; admins see all). Paginated.",
    inputSchema: {
      from: datetime.describe("Start of the period (inclusive)"),
      to: datetime.describe("End of the period (inclusive)"),
      client_id: z.number().int().optional().describe("Only this client"),
      project_id: z.number().int().optional().describe("Only this project"),
      user_id: z.number().int().optional().describe("Only this user (within your scope)"),
      q: z.string().optional().describe("Free-text search; space-separated terms are ANDed"),
      order: z.enum(["start", "-start", "end", "-end", "created", "-created"]).optional().describe("Sort order (default -start)"),
      page: z.number().int().min(1).optional().describe("1-based page number"),
      page_size: z.number().int().optional().describe("Rows per page, clamped to 100-2000 (default 100)"),
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => result(await api("GET", "/entries", { query: args }))
);

const entrySchema = z.object({
  project_id: z.number().int().describe("A project you can log to"),
  description: z.string().max(10000).optional(),
  start: datetime.describe("Start datetime"),
  end: datetime.describe("End datetime (>= start)"),
  user_id: z.number().int().optional().describe("Log for another user (needs read&write on their work). Defaults to you."),
});

server.registerTool(
  "create_entries",
  {
    title: "Create time entries",
    description:
      "Create one or more time entries (max 500). Validation (overlaps, locked periods, permissions) is reported per item.",
    inputSchema: {
      entries: z.array(entrySchema).min(1).max(500),
    },
  },
  async ({ entries }) =>
    result(await api("POST", "/entries", { body: entries.length === 1 ? entries[0] : { entries } }))
);

// --- Reference data --------------------------------------------------------

const searchArg = {
  search: z.string().optional().describe("Optional client-side filter on name (space-separated terms ANDed, case-insensitive)"),
};

server.registerTool(
  "list_users",
  {
    title: "List users",
    description: "Users visible to you, with their ids.",
    inputSchema: searchArg,
    annotations: { readOnlyHint: true },
  },
  async ({ search }) => result(filterByName(await api("GET", "/users"), search))
);

server.registerTool(
  "list_projects",
  {
    title: "List projects",
    description: "Projects visible to you, with ids and their client.",
    inputSchema: searchArg,
    annotations: { readOnlyHint: true },
  },
  async ({ search }) => result(filterByName(await api("GET", "/projects"), search))
);

server.registerTool(
  "list_clients",
  {
    title: "List clients",
    description: "Clients visible to you, with their ids.",
    inputSchema: searchArg,
    annotations: { readOnlyHint: true },
  },
  async ({ search }) => result(filterByName(await api("GET", "/clients"), search))
);

// --- Timer -----------------------------------------------------------------

server.registerTool(
  "get_timer",
  {
    title: "Get running timer",
    description: "Your current running timer, or {running:false}.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => result(await api("GET", "/timer"))
);

server.registerTool(
  "start_timer",
  {
    title: "Start timer",
    description: "Start a timer. Fails (409) if one is already running.",
    inputSchema: {
      project_id: z.number().int().optional(),
      description: z.string().optional(),
    },
  },
  async (args) => result(await api("POST", "/timer/start", { body: args }))
);

server.registerTool(
  "stop_timer",
  {
    title: "Stop timer",
    description:
      "Stop the running timer and log it as an entry. Uses the given project_id/description, else those on the timer (both required to stop).",
    inputSchema: {
      project_id: z.number().int().optional(),
      description: z.string().optional(),
    },
  },
  async (args) => result(await api("POST", "/timer/stop", { body: args }))
);

server.registerTool(
  "cancel_timer",
  {
    title: "Cancel timer",
    description: "Discard the running timer without logging it.",
    inputSchema: {},
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  async () => result(await api("POST", "/timer/cancel"))
);

const resumeArgs = {
  project_id: z.number().int().describe("A project you may log to"),
  description: z.string(),
};

server.registerTool(
  "resume_timer",
  {
    title: "Resume task",
    description:
      "Resume a previous task as a new running timer. A complete running timer is stopped and logged first; an incomplete one is rejected.",
    inputSchema: resumeArgs,
  },
  async (args) => result(await api("POST", "/timer/resume", { body: args }))
);

server.registerTool(
  "chain_timer",
  {
    title: "Chain timer",
    description: "Snap the timer start to your previous entry's end (starts a timer if none is running).",
    inputSchema: {},
  },
  async () => result(await api("POST", "/timer/chain"))
);

server.registerTool(
  "resume_chain_timer",
  {
    title: "Resume and chain",
    description: "Resume a previous task and chain its start to your previous entry's end.",
    inputSchema: resumeArgs,
  },
  async (args) => result(await api("POST", "/timer/resume-chain", { body: args }))
);

await server.connect(new StdioServerTransport());
