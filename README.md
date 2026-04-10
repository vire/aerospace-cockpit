# Aerospace Cockpit

A live web dashboard for [AeroSpace](https://github.com/nikitabobko/AeroSpace) tiling window manager on macOS. Displays your monitors, workspaces, and windows in a dark cockpit-themed UI that updates in real time.

## Features

- Monitors displayed as stacked sections with workspace grids inside
- Occupied workspaces show app icons, names, and window titles
- Focused workspace and window highlighted
- Empty workspaces shown as compact pills
- Auto-refreshes every 1.5 seconds
- Zero dependencies — just Bun + the `aerospace` CLI

## Quick Start

```bash
bunx @vire/aerospace-cockpit
```

Or with npx (requires Bun on PATH):

```bash
npx @vire/aerospace-cockpit
```

Open http://localhost:8888

## Requirements

- [Bun](https://bun.sh) (tested with 1.3.x)
- [AeroSpace](https://github.com/nikitabobko/AeroSpace) installed and running

## Development

```bash
git clone https://github.com/vire/aerospace-cockpit.git
cd aerospace-cockpit
bun install
bun run dev
```

## API

`GET /api/state` returns the full AeroSpace state as JSON — monitors, workspaces, windows, and which is currently focused.

## License

MIT
