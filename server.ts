import { $ } from "bun";

// ── Types ──────────────────────────────────────────────────────────────

interface AeroWindow {
  workspace: string;
  monitorId: number;
  appName: string;
  windowTitle: string;
  windowId: number;
  focused: boolean;
}

interface AeroWorkspace {
  name: string;
  monitorId: number;
  empty: boolean;
  focused: boolean;
  windows: AeroWindow[];
}

interface AeroMonitor {
  id: number;
  name: string;
  workspaces: AeroWorkspace[];
}

interface AeroState {
  monitors: AeroMonitor[];
  focusedWorkspace: string | null;
  focusedWindowId: number | null;
  timestamp: number;
  error?: string;
}

// ── Parsing Helpers ────────────────────────────────────────────────────

function parseLines(output: string): string[] {
  return output
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
}

function parseMonitors(output: string): Map<number, AeroMonitor> {
  const monitors = new Map<number, AeroMonitor>();
  for (const line of parseLines(output)) {
    const parts = line.split("|");
    const id = parseInt(parts[0]!, 10);
    const name = parts.slice(1).join("|");
    monitors.set(id, { id, name, workspaces: [] });
  }
  return monitors;
}

function parseWindowLine(line: string): Omit<AeroWindow, "focused"> | null {
  // Format: workspace|monitor-id|app-name|window-title|window-id
  // Window title may contain pipes, so split carefully
  const firstPipe = line.indexOf("|");
  const secondPipe = line.indexOf("|", firstPipe + 1);
  const thirdPipe = line.indexOf("|", secondPipe + 1);
  const lastPipe = line.lastIndexOf("|");

  if (firstPipe === -1 || secondPipe === -1 || thirdPipe === -1 || lastPipe === thirdPipe) {
    return null;
  }

  return {
    workspace: line.slice(0, firstPipe),
    monitorId: parseInt(line.slice(firstPipe + 1, secondPipe), 10),
    appName: line.slice(secondPipe + 1, thirdPipe),
    windowTitle: line.slice(thirdPipe + 1, lastPipe),
    windowId: parseInt(line.slice(lastPipe + 1), 10),
  };
}

function sortWorkspaceName(a: string, b: string): number {
  const aNum = parseInt(a, 10);
  const bNum = parseInt(b, 10);
  const aIsNum = !isNaN(aNum);
  const bIsNum = !isNaN(bNum);

  if (aIsNum && bIsNum) return aNum - bNum;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return a.localeCompare(b);
}

// ── Data Collection ────────────────────────────────────────────────────

async function getAeroState(): Promise<AeroState> {
  try {
    const [monitorsOut, allWsOut, nonEmptyWsOut, windowsOut, focusedOut] =
      await Promise.all([
        $`aerospace list-monitors --format '%{monitor-id}|%{monitor-name}'`.text(),
        $`aerospace list-workspaces --monitor all --format '%{workspace}|%{monitor-id}'`.text(),
        $`aerospace list-workspaces --monitor all --empty no --format '%{workspace}|%{monitor-id}'`.text(),
        $`aerospace list-windows --all --format '%{workspace}|%{monitor-id}|%{app-name}|%{window-title}|%{window-id}'`.text(),
        $`aerospace list-windows --focused --format '%{workspace}|%{monitor-id}|%{app-name}|%{window-title}|%{window-id}'`.text(),
      ]);

    // Parse monitors
    const monitors = parseMonitors(monitorsOut);

    // Parse non-empty workspace set
    const nonEmptySet = new Set<string>();
    for (const line of parseLines(nonEmptyWsOut)) {
      nonEmptySet.add(line.split("|")[0]!);
    }

    // Parse focused window
    let focusedWorkspace: string | null = null;
    let focusedWindowId: number | null = null;
    const focusedLines = parseLines(focusedOut);
    if (focusedLines.length > 0) {
      const parsed = parseWindowLine(focusedLines[0]!);
      if (parsed) {
        focusedWorkspace = parsed.workspace;
        focusedWindowId = parsed.windowId;
      }
    }

    // Parse all windows
    const windowsByWorkspace = new Map<string, AeroWindow[]>();
    for (const line of parseLines(windowsOut)) {
      const parsed = parseWindowLine(line);
      if (!parsed) continue;
      const win: AeroWindow = {
        ...parsed,
        focused: parsed.windowId === focusedWindowId,
      };
      const existing = windowsByWorkspace.get(parsed.workspace) || [];
      existing.push(win);
      windowsByWorkspace.set(parsed.workspace, existing);
    }

    // Build workspaces and assign to monitors
    for (const line of parseLines(allWsOut)) {
      const parts = line.split("|");
      const wsName = parts[0]!;
      const monitorId = parseInt(parts[1]!, 10);
      const ws: AeroWorkspace = {
        name: wsName,
        monitorId,
        empty: !nonEmptySet.has(wsName),
        focused: wsName === focusedWorkspace,
        windows: windowsByWorkspace.get(wsName) || [],
      };
      const monitor = monitors.get(monitorId);
      if (monitor) {
        monitor.workspaces.push(ws);
      }
    }

    // Sort workspaces within each monitor
    for (const monitor of monitors.values()) {
      monitor.workspaces.sort((a, b) => sortWorkspaceName(a.name, b.name));
    }

    // Sort monitors by ID
    const sortedMonitors = [...monitors.values()].sort((a, b) => a.id - b.id);

    return {
      monitors: sortedMonitors,
      focusedWorkspace,
      focusedWindowId,
      timestamp: Date.now(),
    };
  } catch (err) {
    return {
      monitors: [],
      focusedWorkspace: null,
      focusedWindowId: null,
      timestamp: Date.now(),
      error: `Failed to query aerospace: ${err}`,
    };
  }
}

// ── HTML Template ──────────────────────────────────────────────────────

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Aerospace Cockpit</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #0a0e17;
    color: #e2e8f0;
    font-family: "JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, monospace;
    font-size: 13px;
    line-height: 1.5;
    padding: 20px;
    min-height: 100vh;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #1e293b;
  }

  h1 {
    font-size: 18px;
    font-weight: 600;
    color: #94a3b8;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #64748b;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ef4444;
    transition: background 0.3s;
  }

  .status-dot.connected {
    background: #22c55e;
    box-shadow: 0 0 6px #22c55e88;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .error-banner {
    background: #1c0a0a;
    border: 1px solid #7f1d1d;
    color: #fca5a5;
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 12px;
  }

  .monitors {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .monitor {
    flex: 1;
    min-width: 0;
    background: #111827;
    border: 1px solid #1e293b;
    border-radius: 12px;
    padding: 16px;
  }

  .monitor-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid #1e293b;
  }

  .monitor-icon {
    width: 20px;
    height: 14px;
    border: 2px solid #64748b;
    border-radius: 2px;
    position: relative;
  }

  .monitor-icon::after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%);
    width: 10px;
    height: 3px;
    background: #64748b;
    border-radius: 0 0 2px 2px;
  }

  .monitor-name {
    font-size: 14px;
    font-weight: 600;
    color: #cbd5e1;
  }

  .monitor-id {
    font-size: 11px;
    color: #475569;
    margin-left: auto;
  }

  .workspaces {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }

  .workspace {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 12px;
    transition: border-color 0.3s, box-shadow 0.3s;
  }

  .workspace.focused {
    border-color: #38bdf8;
    box-shadow: 0 0 12px #38bdf822, inset 0 0 12px #38bdf808;
  }

  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .workspace-name {
    font-size: 16px;
    font-weight: 700;
    color: #e2e8f0;
  }

  .workspace.focused .workspace-name {
    color: #38bdf8;
  }

  .window-count {
    font-size: 11px;
    color: #64748b;
    background: #1e293b;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .window-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .window-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 6px;
    transition: background 0.2s;
  }

  .window-row.focused {
    background: #38bdf80a;
    border-left: 2px solid #38bdf8;
    padding-left: 6px;
  }

  .app-icon {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
  }

  .app-name {
    font-weight: 600;
    color: #cbd5e1;
    white-space: nowrap;
    font-size: 12px;
  }

  .window-title {
    color: #64748b;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }

  .empty-workspaces {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .empty-workspaces-label {
    font-size: 11px;
    color: #334155;
    width: 100%;
    margin-bottom: 2px;
  }

  .empty-pill {
    font-size: 11px;
    color: #475569;
    background: #0f172a;
    border: 1px solid #1e293b;
    padding: 2px 8px;
    border-radius: 4px;
  }
</style>
</head>
<body>
<header>
  <h1>Aerospace Cockpit</h1>
  <div class="status">
    <span id="status-text">connecting...</span>
    <span class="status-dot" id="status-dot"></span>
  </div>
</header>
<div id="dashboard"></div>
<script>
const POLL_INTERVAL = 1500;
const APP_COLORS = {};
const COLOR_PALETTE = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#06b6d4','#3b82f6','#8b5cf6','#ec4899','#f43f5e',
  '#84cc16','#6366f1','#a855f7','#d946ef','#0ea5e9',
];
let colorIndex = 0;

function getAppColor(appName) {
  if (!APP_COLORS[appName]) {
    APP_COLORS[appName] = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
    colorIndex++;
  }
  return APP_COLORS[appName];
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let lastJson = '';

function render(state) {
  const json = JSON.stringify(state);
  if (json === lastJson) return;
  lastJson = json;

  const dashboard = document.getElementById('dashboard');

  if (state.error) {
    dashboard.innerHTML = '<div class="error-banner">' + escapeHtml(state.error) + '</div>';
    return;
  }

  let html = '<div class="monitors">';

  for (const monitor of state.monitors) {
    const occupied = monitor.workspaces.filter(w => !w.empty);
    const empty = monitor.workspaces.filter(w => w.empty);

    html += '<div class="monitor">';
    html += '<div class="monitor-header">';
    html += '<div class="monitor-icon"></div>';
    html += '<span class="monitor-name">' + escapeHtml(monitor.name) + '</span>';
    html += '<span class="monitor-id">#' + monitor.id + '</span>';
    html += '</div>';

    if (occupied.length > 0) {
      html += '<div class="workspaces">';
      for (const ws of occupied) {
        html += '<div class="workspace' + (ws.focused ? ' focused' : '') + '">';
        html += '<div class="workspace-header">';
        html += '<span class="workspace-name">' + escapeHtml(ws.name) + '</span>';
        html += '<span class="window-count">' + ws.windows.length + ' window' + (ws.windows.length !== 1 ? 's' : '') + '</span>';
        html += '</div>';
        html += '<div class="window-list">';
        for (const win of ws.windows) {
          const color = getAppColor(win.appName);
          const initial = win.appName.charAt(0).toUpperCase();
          html += '<div class="window-row' + (win.focused ? ' focused' : '') + '">';
          html += '<div class="app-icon" style="background:' + color + '">' + initial + '</div>';
          html += '<span class="app-name">' + escapeHtml(win.appName) + '</span>';
          html += '<span class="window-title">' + escapeHtml(win.windowTitle) + '</span>';
          html += '</div>';
        }
        html += '</div></div>';
      }
      html += '</div>';
    }

    if (empty.length > 0) {
      html += '<div class="empty-workspaces">';
      html += '<span class="empty-workspaces-label">empty</span>';
      for (const ws of empty) {
        html += '<span class="empty-pill">' + escapeHtml(ws.name) + '</span>';
      }
      html += '</div>';
    }

    html += '</div>';
  }

  html += '</div>';
  dashboard.innerHTML = html;
}

async function poll() {
  try {
    const res = await fetch('/api/state');
    const state = await res.json();
    render(state);
    document.getElementById('status-dot').className = 'status-dot connected';
    document.getElementById('status-text').textContent = 'live';
  } catch {
    document.getElementById('status-dot').className = 'status-dot';
    document.getElementById('status-text').textContent = 'disconnected';
  }
  setTimeout(poll, POLL_INTERVAL);
}

poll();
</script>
</body>
</html>`;

// ── Server ─────────────────────────────────────────────────────────────

Bun.serve({
  port: 8888,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response(HTML_PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/api/state") {
      const state = await getAeroState();
      return Response.json(state);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log("Aerospace Cockpit running at http://localhost:8888");
