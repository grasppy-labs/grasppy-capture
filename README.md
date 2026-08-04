# GRASPPY Capture

**A local archive for your AI coding conversations.** Capture finds the conversations that Claude Code, Codex, and Cursor already store on your Mac and converts them into clean, readable Markdown files in one folder you own.

Your AI conversations contain real work — decisions, fixes, designs, research. The tools keep them in internal formats (JSONL logs, SQLite databases) that are hard to read and easy to lose. Capture turns that into a permanent, portable, searchable archive.

## What it does

- **Finds conversations automatically** from Claude Code (`~/.claude`), Codex (`~/.codex`), and Cursor — no exports, no copy-paste.
- **Converts each one to validated Markdown** with a stable filename, message markers, and metadata (session ID, timestamps, message counts). Every file is verified against its own format contract before it is written.
- **Nothing syncs without you.** You review the catalog, exclude what you want, and click Sync Now. Writes are atomic — an interrupted sync never leaves a half-written file.
- **Remembers state between launches.** Unchanged conversations are skipped by file stats alone, so a re-scan of a multi-gigabyte history takes seconds.
- **Dashboard** with per-day calendars (when conversations were archived, and when they were last worked on), provider breakdowns, and sync history.

## Local only — verifiably

Capture makes no network requests while cataloging or syncing. Your conversations never leave your machine. The single exception is the **Check for Updates** menu item, which runs only when you click it and sends nothing but a version query to GitHub. This repository exists so you can verify all of that yourself.

## Install

1. Download the latest `.dmg` from [Releases](https://github.com/grasppy-labs/grasppy-capture/releases).
2. Open it and drag **GRASPPY Capture** to Applications.
3. First launch: right-click the app → **Open** (the build is not notarized by Apple; this one-time step tells macOS you trust it).
4. Pick a parent folder for your archive. Capture creates `GRASPPY Capture Archive/` inside it and never writes anywhere else.

Currently macOS (Apple Silicon) only.

## Build from source

```bash
git clone https://github.com/grasppy-labs/grasppy-capture.git
cd grasppy-capture
npm install
npm start          # build the renderer and run the app
npm test           # run the full test suite
npm run dmg:mac    # produce release/GRASPPY Capture-<version>-arm64.dmg
```

## How it works

```
discover  → list conversations from known provider folders (stat-based, fast)
normalize → parse each conversation into a provider-neutral event stream
render    → produce Markdown with balanced fences and role markers
validate  → verify the rendered document against the format contract
write     → atomic write into the archive; the manifest records the result
```

Design details live in [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md), and [NATIVE_MESSAGING_V1.md](NATIVE_MESSAGING_V1.md).

## Contributing

Issues and pull requests are welcome. Changes land only through review and merge by the maintainers. By contributing, you agree that your contributions are licensed under the same GPL-3.0 terms as the project.

## About

Built by **Grasppy Labs** — makers of [Grasppy](https://grasppy.com), the AI Context Workspace. Capture is the free, open-source companion: it gets your conversations out of the tools and into files you own. Grasppy takes them further — analysis, organization, and reuse across every AI tool you use.

## License

[GPL-3.0](LICENSE) · Copyright © 2026 Grasppy Labs LLC. GRASPPY™ is a trademark of Grasppy Labs; this license covers the code, not the name.
