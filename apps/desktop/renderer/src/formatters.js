// Purpose: Formats content-free local archive metrics and timestamps for the approved desktop views.

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
}

export function formatDateTime(timestamp, emptyValue = 'Not yet') {
  if (!timestamp) return emptyValue;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function formatActivity(timestamp, emptyValue = 'Unavailable') {
  if (!timestamp) return emptyValue;
  const value = new Date(timestamp);
  const elapsedMinutes = Math.floor((Date.now() - value.getTime()) / 60_000);
  if (elapsedMinutes >= 0 && elapsedMinutes < 60) return `${Math.max(1, elapsedMinutes)} min ago`;
  if (elapsedMinutes < 1_440) return `${Math.max(1, Math.floor(elapsedMinutes / 60))} hr ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(value);
}

export function statusLabel(status, excluded = false) {
  if (excluded) return 'Excluded';
  const labels = {
    synced: 'Synced',
    new: 'Pending',
    changed: 'Pending',
    incomplete: 'Incomplete',
    // The source is fine and unchanged — the archived COPY failed re-validation
    // (or was deleted) and will be rewritten on the next sync. "Missing" read as
    // data loss to the owner, which is the opposite of what this state means.
    'archive-missing': 'Needs re-archive',
    'permission-needed': 'Permission needed',
    unavailable: 'Unavailable',
  };
  return labels[status] ?? 'Pending';
}

export function providerStatusLabel(status) {
  const labels = {
    ready: 'Ready',
    'not-found': 'Not found',
    'permission-needed': 'Permission needed',
    'unsupported-schema': 'Unsupported schema',
  };
  return labels[status] ?? status;
}
