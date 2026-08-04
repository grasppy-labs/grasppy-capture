# GRASPPY Capture Product Authority

Status: Approved Phase B product authority  
Plan authority: My Plans Part `30194`  
Research authority: My Research Part `30198`

Current implementation target: macOS first, packaged with electron-builder `26.15.7`. Native Windows implementation and support remain later verification gates.

## Product statement

GRASPPY Capture is a free, open-source desktop application that finds locally available Claude Code, Codex, and Cursor conversations and creates readable Markdown copies in one folder chosen by the user.

It works without a GRASPPY account. Discovery, parsing, normalization, rendering, and archive synchronization remain on the user's computer. Capture never modifies the providers' source files and never uploads conversation content.

## The promise

> Your local AI conversations, organized as readable files you control.

Capture helps people own and preserve their AI history. GRASPPY remains the separate product that analyzes, connects, and turns that history into lasting project context.

## Target user

The first release is for people who use one or more local AI coding tools and want a durable archive without manually locating JSONL files or depending on a provider-specific export command.

Primary needs:

- Find every currently available main conversation stored locally by a supported provider.
- Keep one readable archive across providers.
- Update changed conversations without rewriting unchanged files.
- Preserve the last valid archive if a source file is incomplete or conversion fails.
- Retain full provenance so an archive can later be imported into GRASPPY.

## First-release workflow

1. The user opens Capture and sees exactly which known provider locations it intends to inspect.
2. The user gives explicit local-access consent and chooses a parent directory. Capture creates or reuses the standardized `GRASPPY Capture Archive` leaf directory there.
3. Capture checks the known Claude Code, Codex, and Cursor roots read-only.
4. Capture catalogs valid main-session candidates by `(provider, fullSessionId)` without writing archive Markdown.
5. The user reviews the default **Pending** list, may switch between **Pending**, **Synced**, and **All**, and may set remembered per-conversation exclusions.
6. Only when the user selects **Sync Now** does Capture create Markdown for included new sessions, safely replace changed sessions, and skip unchanged or excluded sessions.
7. Capture reports per-provider totals and new, updated, unchanged, unavailable, excluded, skipped, and failed results.
8. The user can open the archive directory or a generated file with the operating system and review local operational history on the **Dashboard**.

No account, network connection, background daemon, or GRASPPY analysis is required.

## Supported providers

### Claude Code

- Default candidate root: `${CLAUDE_CONFIG_DIR || <home>/.claude}/projects`.
- Main-session candidates are top-level full-UUID JSONL files inside provider project directories.
- The filename UUID must agree with valid internal `sessionId` evidence when present.
- Exact workspace paths come from valid records or optional index metadata; encoded project directory names are fallback grouping labels only.
- Nested subagent transcripts remain outside the first release.

### Codex

- Candidate roots include active sessions beneath `<home>/.codex/sessions` and archived sessions beneath `<home>/.codex/archived_sessions`.
- The full UUID in the rollout filename must agree with the first valid `session_meta` identity.
- Active and archived paths with the same full ID represent one logical session with a current storage state.
- `session_index.jsonl` may enrich title or recency but is never discovery authority.

### Cursor

- Verified macOS candidate pattern: `<home>/.cursor/projects/<project-slug>/agent-transcripts/<full-uuid>/<full-uuid>.jsonl`.
- The directory is exactly `agent-transcripts`.
- The full UUID directory and JSONL basename must match.
- Optional Cursor metadata may improve titles, workspace labels, and activity time, but transcript discovery must still work when metadata is absent or unreadable.
- Missing local assistant records are reported as incomplete; Capture never invents content.

Windows provider locations and schemas remain unverified until native Windows evidence and fixtures exist. Capture must not claim Windows support before that gate passes.

## Canonical local-session model

The canonical identity is:

```text
(provider, fullSessionId)
```

The first eight characters are display and search labels only. They must never be used as a unique storage key or an unverified source-file match.

The normalized session contract will carry, at minimum:

- Provider and full session ID.
- Short display ID.
- Source path and provider project key.
- Exact workspace path when verified.
- Title plus title source.
- Activity time plus activity source and confidence.
- Source schema/version observations.
- Ordered user, assistant, tool, image, lifecycle, and supported compaction events.
- Completeness warnings.

Unknown record types are ignored safely and reported as schema observations. Missing fields are never fabricated.

The later browser bridge uses a separate provider-specific stable-identity contract. A browser conversation ID is an opaque verified value and is not required to be a UUID. The strict UUID validator above remains correct for Claude Code, Codex, and Cursor and must not be weakened to accommodate browser platforms.

## Browser bridge identity scope

The audited extension registry contains 13 browser platforms. The initial Native Messaging bridge is eligible for five platforms that already expose a stable conversation identity:

| Browser platform | Verified identity shape |
|---|---|
| Claude | UUID from the conversation URL |
| ChatGPT | UUID from the conversation URL |
| Grok | UUID-like stable conversation value |
| Perplexity | Alphanumeric conversation slug |
| TypingMind | Alphanumeric conversation value |

Gemini, DeepSeek, Replit, GitHub Copilot, Mistral, Bolt, and Lovable require separately verified live URL rules before direct Capture saving is enabled. Voila has no dedicated conversation URL because it overlays arbitrary pages and is excluded from direct **Save to GRASPPY Capture** support. Existing download and cloud-import behavior remains unaffected.

The extension must reject its timestamp fallback locally as `IDENTITY_UNAVAILABLE` and must never transmit that fallback to Capture. Capture cannot distinguish a plausible timestamp-shaped fallback from a real opaque provider ID. Slice 6 must therefore use an exact provider allowlist and provider-specific identity validation, while preserving the extension's local download fallback.

## Markdown archive contract

Capture produces the role-marker structure already accepted by GRASPPY:

```text
# Markdown Export - <Provider>

**URL:** <local provider/session reference>
**Exported:** <local display time and timezone>
**Messages:** <message count>
**Session ID:** <full UUID>
**Short ID:** <first eight characters>
**Source Format:** <provider JSONL description>
**Conversation Turns:** <turn count>

---

## 👤 USER MESSAGE (1)
...

---

## 🤖 AI RESPONSE (2)
...
```

Each file also carries the versioned Capture envelope `GRASPPY Capture Format: 1` plus Provider, full Session ID, Source Updated, Exported, Messages, and Conversation Turns metadata. Capture-normalized files are ready for GRASPPY import; they are not already GRASPPY-enriched.

Message numbers are sequential across role blocks. A turn begins with a user message and includes following assistant content until the next user message. A locally incomplete conversation may have a user-only final turn and must carry a completeness warning.

The renderer escapes unsafe raw HTML placeholders while preserving ordinary Markdown and fenced code. Output validation checks the metadata, role-marker sequence, declared and actual counts, full session identity, non-empty content, null bytes, and balanced fenced-code structure before replacement.

## Archive synchronization contract

The archive directory contains Markdown, not Capture's operational state. A small versioned JSON manifest lives in the operating system's application-data directory and contains ordinary file bookkeeping only:

- Provider and full session ID.
- Source path, modification time, and size.
- Output path and format version.
- Last successful export time.

The default recommendation is modification time plus size only; provider records determine conversation truth. Whether standard SHA-256 source checks are necessary remains unresolved. Capture must not implement them unless the owner approves them after Phase B evidence demonstrates a need. Normalized-content fingerprints and intelligent deduplication are never part of Capture.

The operational manifest also stores the remembered exclusion flag, last successful Markdown size and processing time, and completed-run history required by the approved Dashboard. Exclusion is a user preference keyed by `(provider, fullSessionId)`, not a sync truth state. It never deletes a source or archive file.

Slice 4 uses the following stable filename convention:

```text
<provider>--<sanitized-title-or-project>--<fullSessionId>.md
```

The readable label is normalized with Unicode NFKC, filesystem-hostile and control characters become hyphens, whitespace becomes hyphens, repeated hyphens collapse, leading and trailing dots/spaces/hyphens are removed, and the label is limited to 72 characters. Empty labels and exact Windows reserved device names fall back to `conversation`. The complete canonical UUID remains in both the filename and metadata. Once created, the manifest's validated output path wins on later updates, so title and source-update changes cannot rename the archive file.

Operational-manifest schema version 1 preserves every completed manual run and performs no automatic pruning or silent migration. A future retention or migration policy requires an explicit schema change, preservation evidence, consultant review, and owner approval; until then, existing history remains intact.

Safe replacement is mandatory:

1. Render to a same-directory temporary file.
2. Validate the complete temporary output.
3. Replace the destination only after validation succeeds.
4. Preserve the previous valid Markdown on any conversion or replacement failure.
5. Report a missing source as unavailable; never delete its archive.

Capture never deletes, moves, renames, repairs, truncates, or writes provider files.

## Privacy and network behavior

- All transcript content stays local.
- Discovery scans known provider roots only, never the whole disk.
- Provider access is read-only and explained before first use.
- Full local paths are sensitive and remain local.
- The renderer receives no unrestricted filesystem or Node access.
- No telemetry, analytics, crash upload, account, cloud storage, API, or automatic update is included in the MVP.
- If the owner approves an optional GRASPPY website link, it opens only the approved HTTPS origin and sends no conversation content or path metadata.

## Relationship to GRASPPY

| Open-source Capture | Proprietary GRASPPY |
|---|---|
| Provider discovery | Content fingerprinting and intelligent deduplication |
| Provider JSONL normalization | Import identity reconciliation and incremental append decisions |
| GRASPPY-compatible Markdown rendering | AI enrichment, prompts, entities, topics, decisions, and relationships |
| Basic local archive bookkeeping | Sources, artifacts, Executive, Technical, Outline, and EoC outputs |
| Local totals and file access | Cross-conversation intelligence, workspaces, collaboration, and automation |

Markdown compatibility is the first integration boundary. Capture does not call GRASPPY and GRASPPY does not need to change during the standalone MVP.

A later proprietary GRASPPY folder connector may import Capture-normalized Markdown from the archive. That connector is separate GRASPPY work and is not implemented in this repository.

## Explicit first-release scope

- macOS and Windows desktop application, with Windows gated by native verification.
- Local discovery for Claude Code, Codex, and Cursor.
- One standardized `GRASPPY Capture Archive` directory under a user-selected parent location.
- Read-only catalog refresh plus manual **Sync Now**; no automatic synchronization.
- Archive and Dashboard views in one window.
- Pending, Synced, and All filters; remembered per-conversation exclusions.
- Provider totals and a scalable conversation list with Activity, Size, Processed, Sync status, and Exclude fields.
- Local last-sync metrics, archive totals, provider breakdown, calendar activity, and recent manual-run history.
- Safe incremental Markdown generation.
- Open archive directory and open generated file actions.
- Light and Dark appearance.
- Keyboard-accessible empty, scanning, success, partial-failure, permission, and unavailable states.
- A separately gated, user-initiated Chrome Native Messaging bridge for the five initially verified browser platforms that can place extension-generated Markdown into the same configured archive without revealing its path.

## Out of scope

- GRASPPY fingerprinting, intelligent deduplication, import reconciliation, prompts, or enrichment.
- Sources, artifacts, Executive, Technical, Outline, or EoC generation inside Capture.
- Accounts, cloud storage, automatic upload, collaboration, paid API calls, or hidden telemetry.
- Automatic GRASPPY import or an **Analyze in GRASPPY** workflow.
- Background watching, menu-bar service, launch at login, and automatic updates.
- Full-text or semantic search.
- Cursor SQLite as a required dependency; metadata enrichment is optional and deferred.
- Claude subagent or companion-artifact export.
- Linux and providers beyond Claude Code, Codex, and Cursor.
- Provider-session deletion, editing, renaming, restoration, or repair.
- Dedicated cancellation, retry-failures, diagnostic export, diagnostic-details, and path-copy features, unless the owner explicitly approves any of them for the MVP.

## Product acceptance gates

The first release is not complete until:

- Native macOS and Windows evidence confirms supported provider roots and schemas.
- Full IDs remain canonical through discovery, output, and manifest storage.
- Independently anonymized, owner-approved fixtures cover every supported schema version.
- Active and malformed files fail safely without destroying a previous export.
- Generated Markdown remains human-readable and imports into GRASPPY.
- The app makes no outbound request during discovery or synchronization.
- Electron renderer isolation and narrow IPC have been verified.
- Manual-only behavior, persisted exclusions, catalog filters, per-file Size/Processed values, and Dashboard aggregates reconcile with operational state.
- The Chrome bridge, when included, uses an on-demand exact-origin native host, stable verified provider identity, bounded untrusted input, atomic writes, and no path disclosure or persistent daemon.
- Clean-clone tests, builds, native packages, license review, privacy/security documentation, and public-history audit pass.
- The owner approves publication, license, trademark treatment, signing, design, and any source relicensing.

## Phase B implementation gates

Phase B was explicitly approved after consultant acceptance of the imported addendum. Before each coding slice, the implementer must:

1. Confirm the Capture working directory and preserve unrelated local files.
2. Compare the relevant My Code map's recorded Git commit with repository `HEAD` and inspect `git status --short`; re-scan when source drift is not represented.
3. Re-read the dependency map and relevant file records before creating or modifying source.
4. Add a one-line purpose header comment or docstring to every new source file.
5. Keep GRASPPY read-only and use clean-room implementation unless the owner separately approves an exact extraction and relicensing record.

Capture keeps `*.jsonl` ignored. A narrow allowlist for independently anonymized public fixtures may be added only after explicit owner approval.

## Decisions reserved for the owner

- Public software license and trademark wording.
- Any extraction or relicensing of GRASPPY-owned source.
- Final product icon and final trademark treatment.
- Optional GRASPPY website link.
- Official GitHub organization and repository.
- Apple and Windows signing credentials.
- Whether Phase B evidence justifies standard SHA-256 source checks; the default remains modification time plus size only.
- Native-message payload ceiling, development origin allowlist, and Dashboard treatment of browser-delivered providers.
