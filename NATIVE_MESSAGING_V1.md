# GRASPPY Capture Native Messaging v1

Status: finalized Capture-side Slice 6 contract for joint extension integration review.

## Boundary

Chrome launches the Capture helper on demand for one explicit **Save to GRASPPY Capture** request. The helper reads one native-message frame, validates and processes it, writes one response, and exits. It is not a daemon, watcher, localhost service, scheduled task, or automatic-sync mechanism.

The extension retains its existing Markdown download fallback. It must return `IDENTITY_UNAVAILABLE` locally and must not invoke the native host when `getStableConversationIdentity()` returns `null`. Capture never substitutes a timestamp, short display ID, normalized-content fingerprint, or content checksum for provider identity.

## Transport limits

- Request framing: Chrome Native Messaging, four-byte unsigned little-endian JSON byte length followed by UTF-8 JSON.
- Maximum complete request frame: **16 MiB** (`16 * 1024 * 1024` bytes), selected as a safety policy from observed export sizes rather than Chrome's host-to-extension response limit.
- Maximum response frame: less than **1 MiB**.
- Oversized requests fail with `PAYLOAD_TOO_LARGE`; the extension keeps download fallback available.
- A browser connection dropped before the request or response completes is a normal abandoned operation. Capture exits without recording it as a processing failure.

## Request

Every field below is required. No additional fields are accepted.

```json
{
  "protocol": "grasppy.capture.native.v1",
  "action": "save_markdown",
  "requestId": "00000000-0000-4000-8000-000000000001",
  "provider": "claude",
  "conversationId": "00000000-0000-4000-8000-000000000002",
  "identityFormat": "uuid",
  "title": "Invented planning conversation",
  "sourceUrl": "https://claude.ai/chat/00000000-0000-4000-8000-000000000002",
  "sourceUpdatedAt": null,
  "filenameHint": "invented-export.md",
  "markdown": "# Invented browser export\n\n## 👤 USER MESSAGE (1)\n\nInvented text.\n"
}
```

Field rules:

| Field | Rule |
|---|---|
| `protocol` | Exact value `grasppy.capture.native.v1`. |
| `action` | Exact value `save_markdown`. |
| `requestId` | Full UUID. The extension should create one UUID for one logical save attempt and reuse it only when retrying that same attempt. |
| `provider` | One of the provider keys in the identity table below. `voila` is not accepted. |
| `conversationId` | Complete stable provider identity. Provider-specific shape and URL agreement are mandatory. |
| `identityFormat` | Exact provider-specific value: `uuid`, `slug`, or `opaque`. |
| `title` | Single-line Unicode text, 1–200 characters, without control characters. |
| `sourceUrl` | HTTPS, at most 2,048 characters, no credentials or non-default port, approved hostname/path, and the same stable identity as `conversationId`. Query strings are not persisted. |
| `sourceUpdatedAt` | RFC 3339 timestamp or `null`. `null` means Capture records the export time with browser-export provenance. |
| `filenameHint` | A basename ending in `.md`, at most 180 characters, or `null`. It cannot be absolute, contain separators, traversal, nulls, or control characters. It is validated but never controls the archive path. |
| `markdown` | Non-empty GRASPPY extension Markdown with sequential user/assistant role markers, non-empty role content, balanced fenced code, and no null byte. It must not claim an existing Capture metadata envelope. |

Unknown fields—including credentials, cookies, account identifiers, local paths, continuation tokens, fingerprints, enrichment data, or arbitrary output paths—are rejected by the exact allowlist.

## Provider identity table

Capture validates both the identifier shape and its location in the approved source URL. The extension remains responsible for live verification that its extracted identity is durable.

| Provider | `identityFormat` | Capture identity rule | Integration status |
|---|---|---|---|
| `claude` | `uuid` | UUID from `claude.ai/chat/{id}` | Existing verified extractor |
| `chatgpt` | `uuid` | UUID from `chatgpt.com/c/{id}` | Existing verified extractor |
| `grok` | `uuid` | 8–128 alphanumeric/hyphen identifier from `grok.com/c/{id}` or `grok.x.ai/c/{id}` | Existing verified extractor |
| `perplexity` | `slug` | 1–128 alphanumeric/hyphen slug from `perplexity.ai/search/{id}` or `/c/{id}` | Existing verified extractor |
| `typingmind` | `opaque` | 1–128 alphanumeric/hyphen/underscore value from `typingmind.com/#chat={id}` | Existing verified extractor |
| `lovable` | `uuid` | UUID from `lovable.dev/projects/{id}` | Pattern complete; live verification pending |
| `deepseek` | `opaque` | 6–128 alphanumeric/hyphen value from an approved `chat.deepseek.com` chat path | Pattern complete; live verification pending |
| `gemini` | `opaque` | 8–128 alphanumeric value from an approved `gemini.google.com` app path | Pattern complete; live verification pending |
| `replit` | `slug` | 2–128 alphanumeric/hyphen/underscore project slug from an approved `replit.com` path | Pattern complete; live verification pending |
| `copilot` | `uuid` | UUID from `github.com/copilot/c/{id}` | Pattern complete; live verification pending |
| `mistral` | `uuid` | UUID from `chat.mistral.ai/chat/{id}` | Pattern complete; live verification pending |
| `bolt` | `slug` | 4–128 alphanumeric/hyphen/underscore slug from `bolt.new/~/{id}` | Pattern complete; live verification pending |

Voila is structurally excluded because its overlay can run on arbitrary pages without a durable conversation URL. The local extension error is `IDENTITY_UNAVAILABLE`; download and existing GRASPPY workflows remain available.

## Success response

```json
{
  "protocol": "grasppy.capture.native.v1",
  "requestId": "00000000-0000-4000-8000-000000000001",
  "success": true,
  "result": {
    "disposition": "created",
    "provider": "claude",
    "conversationId": "00000000-0000-4000-8000-000000000002",
    "bytesWritten": 2048,
    "processedAt": "2026-08-03T08:00:00.000Z"
  }
}
```

`result.disposition` is:

- `created`: no prior archive file existed for the canonical provider identity;
- `replaced`: a prior valid archive file was atomically replaced; or
- `unchanged`: the same `requestId` was replayed for the same provider identity and Capture returned the previous successful result without rewriting the archive.

Capture performs no content-fingerprint or normalized-content comparison to produce `unchanged`. A new request ID for an existing conversation produces `replaced` after complete validation.

The response never contains the archive path, output filename, local application-data path, source Markdown, title, source URL, or extension credentials.

## Error response

```json
{
  "protocol": "grasppy.capture.native.v1",
  "requestId": "00000000-0000-4000-8000-000000000001",
  "success": false,
  "error": {
    "code": "CAPTURE_UNCONFIGURED",
    "message": "Choose an archive folder in GRASPPY Capture before saving from the browser."
  }
}
```

`requestId` is `null` when framing or JSON validation fails before a trustworthy request ID is available.

Stable host error codes:

- `MALFORMED_MESSAGE`
- `PAYLOAD_TOO_LARGE`
- `UNSUPPORTED_PROTOCOL`
- `UNSUPPORTED_ACTION`
- `INVALID_REQUEST`
- `INVALID_REQUEST_ID`
- `INVALID_PROVIDER`
- `IDENTITY_UNAVAILABLE`
- `IDENTITY_INVALID`
- `SOURCE_URL_INVALID`
- `FILENAME_HINT_INVALID`
- `MARKDOWN_INVALID`
- `CALLER_NOT_ALLOWED`
- `HOST_NOT_REGISTERED`
- `HOST_BUSY`
- `REQUEST_ID_CONFLICT`
- `CAPTURE_UNCONFIGURED`
- `ARCHIVE_UNAVAILABLE`
- `ARCHIVE_WRITE_FAILED`
- `INTERNAL_ERROR`

## Registration and caller verification

The native host name is `com.grasppy.capture`. Registration creates a Chrome native-host manifest with one or more exact origins of the form `chrome-extension://{32-character-id}/`. Chrome extension IDs must match `[a-p]{32}`. Wildcards, arbitrary origins, missing IDs, and a placeholder origin are rejected.

The same exact origins are stored in Capture's local native-host configuration for runtime caller verification. The owner-confirmed production extension ID is `fahnmknkikpekcndanobhapondbncefm`. Any fixed development ID must also be supplied explicitly. The current extension manifest does not contain a fixed `key`, so an unpacked development ID must be provided from the actual Chrome installation rather than guessed.

The host manifest contains the absolute path to the packaged helper launcher, but neither the request nor response exposes it. Registration never stores or transmits the configured archive path.

## Archive and operational history

Capture chooses a stable contained filename from provider, sanitized title, and full stable identity. The filename hint is never authoritative. Incoming Markdown is wrapped in the versioned Capture metadata envelope, revalidated after its temporary write, and atomically renamed inside the configured `GRASPPY Capture Archive` directory. Existing valid output is preserved on validation or write failure; symlink and containment violations fail safely.

Browser-delivered session bookkeeping and manual-save history are content-free and stored outside the archive in Capture application data. Browser providers are not added to the locked desktop Dashboard during Slice 6; that owner-controlled product decision remains open for a later approved design/manifest integration.
