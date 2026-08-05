# GRASPPY Capture Design Authority

> **Build-phase specification (August 2026), kept for history.** The shipped app has
> evolved past this document. Incremental cataloging, the update checker, the
> dashboard calendars, and several renderer fixes came later. For current behavior
> see [README.md](README.md) and the [user guide](https://grasppy.com/capture/guide).


Status: Owner-approved and locked for Phase B implementation  
Plan authority: My Plans Part `30194`  
Research authority: My Research Part `30198`

This document defines the approved first-release desktop experience. The visual authority is `design/grasppy-capture-mockup.html`, together with My Plans Part `30194`, Addendum Chapter `30332`. Its layout and styling are locked under `AGENTS.md`; implementation must not improvise visual changes.

## Design intent

Capture should feel calm, local, and trustworthy. It should show what it can read, what it wrote, and what failed without exposing technical JSONL details by default.

The experience is one primary window with two views, **Archive** and **Dashboard**, and one primary write action: **Sync Now**. Setup is a first-run state, not a third view. Provider complexity remains visible enough for trust but does not become a setup wizard for paths the app already knows.

## Visual foundation

Capture borrows the established GRASPPY visual language without copying GRASPPY application components:

- System font stack; no custom font dependency.
- Slate page and card surfaces in Light and Dark themes.
- Blue for primary actions.
- Amber for Capture identity and attention states.
- Emerald for successful results and red for failures.
- Rounded cards, minimal shadows, and clear borders.
- Every color has an equivalent Dark-theme token.

Proposed tokens:

| Purpose | Light | Dark |
|---|---|---|
| Window background | `#f1f5f9` | `#0f172a` |
| Card background | `#ffffff` | `#1e293b` |
| Primary text | `#1e293b` | `#ffffff` |
| Secondary text | `#64748b` | `#94a3b8` |
| Border | `#e2e8f0` | `#334155` |
| Primary action | `#2563eb` | `#2563eb` |
| Capture accent | `#f59e0b` | `#f59e0b` |
| Success | `#10b981` | `#10b981` |
| Failure | `#ef4444` | `#ef4444` |

Typography uses 20px bold for the window title, 18px bold for card titles, 14px for body and controls, and 12px for supporting status. Proposed spacing is based on 8px increments, with 24px page/card padding and 8-12px radii.

## Window behavior

- Proposed normal size: 1040 × 720 pixels.
- Proposed compact minimum: 760 × 600 pixels.
- Main content scrolls vertically when required; header and primary action remain reachable.
- Long paths use middle truncation visually while the full local path remains available to assistive technology. A path-copy action is deferred.
- The interface does not assume mobile or tablet use; it must remain usable with keyboard and screen magnification.

These dimensions and responsive behaviors are approved. Changes require owner authorization.

## Approved Archive structure

The Archive view follows the approved mock-up exactly:

1. Header with product identity, **Archive** and **Dashboard** navigation, local-only badge, and Light/Dark control.
2. Archive destination card using the standardized `GRASPPY Capture Archive` leaf under the user-selected parent.
3. Claude Code, Codex, and Cursor source cards.
4. Ready, Syncing, Success, or Warning action panel with **Sync Now** when no run is active.
5. Conversation toolbar with **Pending**, **Synced**, and **All** filters. Pending is the default.
6. Scalable conversation catalog with Provider, Conversation / project, Activity, **Size**, Processed, Sync status, and Exclude.
7. **Open Archive Folder** as the secondary action.

The list is a local catalog preview, not a content viewer. Selecting a row opens generated Markdown only when a valid archive exists; raw provider files are never opened for editing by Capture.

## First-run state

The same window presents a focused first-run card instead of the catalog:

```text
┌──────────────────────────────────────────────────────────────────────┐
│  Keep your local AI conversations in one readable archive           │
│                                                                      │
│  Capture checks only these known locations, read-only:               │
│  ✓ Claude Code     ✓ Codex     ✓ Cursor                              │
│                                                                      │
│  Nothing is uploaded. Provider files are never changed.              │
│                                                                      │
│  Archive location                                                    │
│  [ Choose a parent folder…                                         ] │
│                                                                      │
│                                      [ Set Up Local Archive ]         │
└──────────────────────────────────────────────────────────────────────┘
```

The confirmation button remains disabled until a parent folder is selected and the consent copy is visible. Capture creates or reuses the `GRASPPY Capture Archive` leaf there. It does not ask users to manually locate provider JSONLs during the default flow.

## Information hierarchy

1. Product identity and theme.
2. Archive destination and local-only promise.
3. Provider reachability and conversation totals.
4. Primary **Sync Now** action.
5. Current run state or most recent result.
6. Pending/Synced/All filters and conversation catalog.
7. Secondary open-folder action and concise warnings.

No GRASPPY promotional panel competes with the local archive workflow. If the owner later approves a website link, it belongs in the overflow/About surface and sends no content.

## Provider status cards

Each provider card shows only:

- Provider name and icon treatment.
- `Ready`, `Not found`, `Permission needed`, `Unsupported schema`, or `Partial metadata`.
- Count of valid local main-session candidates.
- A concise help action only when intervention is possible.

Provider cards do not display full sensitive source paths. A diagnostic-details panel is deferred unless the owner explicitly approves it for the MVP.

## Synchronization states

| State | Primary presentation | Allowed action |
|---|---|---|
| No archive | First-run card | Choose archive directory |
| Cataloging | Indeterminate 4px progress bar and current provider | Observe progress; dedicated cancellation is deferred |
| Ready | Candidate total and **Sync Now** | Start synchronization |
| Syncing | Progress by processed candidate; per-provider count | Observe progress; dedicated cancellation is deferred |
| Success | New/updated/unchanged totals in emerald summary | Open archive or file |
| Partial failure | Successful totals plus failure summary | Run a later normal sync; dedicated retry-failures is deferred |
| Permission denied | Exact provider and recovery instruction | Re-grant or continue with other providers |
| Unsupported schema | Provider/version and safe failure message | Review safe reason; diagnostic export is deferred |
| Source unavailable | Existing archive remains; source labeled unavailable | Dismiss or reconnect provider root |
| Archive unavailable | No write attempted | Re-select archive directory |

Errors are isolated per session. A failed session never turns the entire successful batch into an ambiguous failure.

## Result summary

After each run, the primary action panel becomes a result summary:

```text
Sync complete
3 new · 4 updated · 42 unchanged · 1 unavailable · 2 failed

[Open Archive Folder]  [Review 2 failures]
```

Failure details include provider, short display ID, safe reason code, and recovery guidance. They never expose stack traces, raw conversation content, credentials, or unnecessary full paths.

## Deferred interaction features

The following are outside the MVP unless the owner explicitly approves them:

- Cancellation controls for cataloging or synchronization.
- A dedicated retry-failures action.
- Diagnostic export.
- Diagnostic-details panels.
- Copy actions for source or archive paths.

The baseline MVP may show safe status and failure summaries and may perform a later ordinary sync. These capabilities do not imply the deferred dedicated interactions above.

## Recent conversation rows

Columns at normal width:

- Provider.
- Safe title or verified project/workspace label.
- Activity time and source-derived warning where necessary.
- Size of the last successful Markdown export, or `—` when none exists.
- Processed time of the last successful Markdown export, or `Not yet`.
- Sync status.
- Exclude checkbox.

Compact width reflows the same information into a multi-line row. It must not remove Size, Processed, status, or Exclude. Full UUIDs remain authoritative in generated metadata and internal identity but do not dominate the list; dedicated details and copy actions are deferred.

Exclusion is a remembered preference keyed by `(provider, fullSessionId)`. It is available for review before a run, omitted from the fixed **Sync Now** run set when checked, and disabled while the relevant run is active. An excluded conversation remains Pending when its source changes until the user clears the exclusion.

Title fallback order:

1. Verified provider metadata.
2. Locally derived first meaningful user text only after content parsing is already requested.
3. `<Provider> session <short-id>`.

Capture never claims **Latest** from mtime alone when the provider offers better internal or metadata evidence.

## Approved Dashboard structure

Dashboard is the second primary view. It contains no transcript analysis and introduces no telemetry. It displays:

- Files checked in the last completed manual sync, with new, updated, and unchanged totals.
- Bytes written in the last sync.
- Current Markdown file count and total archive size.
- Provider breakdown by file count and archive size.
- A selectable calendar of completed manual syncs showing files processed, bytes written, and provider count.
- Recent completed manual runs with completion time, result totals, files checked, and bytes written.

All values derive from the local operational manifest and validated archive files. The approved card order, calendar presentation, provider breakdown, sync-history table, themes, and compact behavior match the HTML mock-up.

## Keyboard and accessibility contract

- Logical tab order follows the visual hierarchy.
- Every action is available without a pointer.
- Visible focus rings meet theme contrast requirements.
- Status is conveyed by text and icon, never color alone.
- Progress changes use polite live announcements; failures use an assertive summary once.
- Provider icons and state icons have accessible names.
- Truncated paths expose the complete value to assistive technology.
- Motion is limited to progress feedback and respects reduced-motion settings.
- Default body text remains at least 14px; no essential information relies on 12px text alone.

## Secure Electron boundary

The React renderer is unprivileged:

- `contextIsolation: true`.
- `nodeIntegration: false`.
- Renderer sandbox enabled where compatible.
- No raw `ipcRenderer` exposure.
- No remote web content in privileged windows.
- Provider text is rendered as text, never unsanitized HTML.
- A restrictive Content Security Policy allows only packaged local assets.

The preload exposes a small, typed API with intent-level operations such as:

```text
getArchiveStatus()
selectArchiveDirectory()
catalogProviders()
syncArchive()
openArchiveDirectory()
openArchivedSession(sessionKey)
subscribeToProgress(callback)
```

The renderer never submits an arbitrary filesystem path to an open or write operation. It uses opaque session keys returned by the main process. The main process validates every request, resolves paths inside registered provider/archive roots, rejects traversal and symlink escapes, and verifies the IPC sender.

Before release, packaging must flip appropriate Electron fuses, including disabling unused Node/inspect entry points and enabling ASAR integrity controls when compatible. Exact fuse values are a Phase E security decision and must be tested before code signing.

Electron security authority: [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), and [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses).

## Filesystem consent

Capture should explain access before cataloging. Direct distribution is approved for the initial implementation. The app operates with the signed-in user's ordinary filesystem permissions and explicit archive-folder selection. Mac App Store sandboxing and security-scoped bookmarks are not part of the initial build.

The archive directory is always user-selected. Provider roots use verified defaults plus approved advanced overrides; Capture never requests Full Disk Access for the known-folder MVP.

## Locked and unresolved design decisions

Locked:

- Mock-up visual language and information hierarchy.
- Archive and Dashboard navigation.
- Light/Dark in-app control.
- 1040 × 720 normal and 760 × 600 compact behavior.
- Inline safe warnings, filters, Size, Processed, status, and Exclude presentation.
- Direct-distribution first-run model.

Still owner-controlled:

- Final product icon and final trademark/legal treatment.
- Optional GRASPPY website link and placement.
- Dashboard treatment of future browser-delivered providers after the extension identity audit.
- Any promotion of cancellation, retry-failures, diagnostic, path-copy, automatic synchronization, or background-service interactions into the MVP.

React and Electron implementation is authorized only to reproduce this locked design. Any visual deviation requires owner approval.
