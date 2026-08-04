// Purpose: Renders the locked archive destination, provider cards, manual sync panel, filters, and exclusion catalog.

import React, { useMemo, useState } from 'react';

import { formatActivity, formatBytes, formatDateTime, providerStatusLabel, statusLabel } from './formatters.js';
import Icon from './icons.jsx';

function ProviderCard({ provider }) {
  const warning = provider.status !== 'ready';
  const providerClass = provider.provider === 'claude-code' ? 'claude' : provider.provider;
  return (
    <article className={`provider-card${warning ? ' is-warning' : ''}`}>
      <div className="provider-top">
        <div className={`provider-avatar ${providerClass}`} aria-hidden="true">{provider.name.slice(0, 2).toUpperCase()}</div>
        <div className="provider-copy">
          <h3 className="provider-name">{provider.name}</h3>
          <div className="status-line"><span className="status-dot" />{providerStatusLabel(provider.status)}</div>
        </div>
      </div>
      <p className="provider-count">{provider.count}<span>conversations</span></p>
      {warning && <p className="provider-hint">{provider.observations[0] ?? 'The existing archive remains unchanged.'}</p>}
    </article>
  );
}

function ActionPanel({ phase, catalog, lastRun, onSync }) {
  const included = catalog?.items.filter((item) => item.syncState === 'pending'
    && !item.excluded
    && !['unavailable', 'permission-needed'].includes(item.status)).length ?? 0;
  let type = 'ready';
  let title = `Ready to sync ${included} pending conversations`;
  let description = 'Review the pending list, then select Sync Now. Nothing syncs automatically.';
  let metrics = [];

  if (phase === 'cataloging') {
    type = 'syncing';
    title = 'Checking known local provider folders…';
    description = 'This read-only catalog refresh does not write archive files.';
  } else if (phase === 'syncing') {
    type = 'syncing';
    title = `Syncing ${included} included conversations…`;
    description = 'Creating validated Markdown copies in your local archive.';
  } else if (lastRun) {
    type = lastRun.status === 'success' ? 'success' : 'warning';
    title = lastRun.status === 'success' ? 'Sync complete' : 'Archive updated with warnings';
    description = lastRun.status === 'success'
      ? 'Your readable archive is up to date.'
      : 'Successful files were preserved. Conversations still open in their app keep changing while they are read, so they stay Pending for now — sync again once they are inactive.';
    metrics = [
      [lastRun.results.created, 'new'],
      [lastRun.results.replaced, 'updated'],
      [lastRun.results.unchanged, 'unchanged'],
      [lastRun.results.excluded, 'excluded'],
      [lastRun.results.failed, 'failed'],
    ].filter(([value]) => value > 0);
  }

  const panelClass = type === 'success' ? 'action-panel is-success' : type === 'warning' ? 'action-panel is-warning' : 'action-panel';
  const icon = type === 'ready' ? 'sync' : type;
  const isBusy = type === 'syncing';
  // Cataloging and syncing share one busy style, but they are not the same act:
  // cataloging only reads. Labelling it "Syncing…" next to copy that says the
  // refresh writes nothing reads as though the archive is being rewritten.
  const busyLabel = phase === 'cataloging' ? 'Checking…' : 'Syncing…';
  return (
    <div className={panelClass} aria-live="polite">
      <div className="action-icon" aria-hidden="true"><Icon name={icon} /></div>
      <div className="action-copy">
        <h3 className="action-title">{title}</h3>
        <p className="action-description">{description}</p>
        {metrics.length > 0 && (
          <div className="action-metrics">
            {metrics.map(([value, label]) => <span key={label}><strong>{value}</strong> {label}</span>)}
          </div>
        )}
        {isBusy && <div className="progress-track" aria-label="Operation in progress"><div className="progress-bar" /></div>}
      </div>
      <button className="primary-button" type="button" disabled={isBusy || !catalog} onClick={onSync}>
        {isBusy ? busyLabel : 'Sync Now'}
      </button>
    </div>
  );
}

// Column order matches the grid. Every column sorts; a click sorts ascending,
// a second click flips the direction, shown by the ▲/▼ beside the label.
const SORT_COLUMNS = Object.freeze([
  { key: 'providerName', label: 'Provider' },
  { key: 'shortSessionId', label: 'ID' },
  { key: 'title', label: 'Conversation / project' },
  { key: 'activityAt', label: 'Activity' },
  { key: 'sizeBytes', label: 'Size' },
  { key: 'processedAt', label: 'Processed' },
  { key: 'status', label: 'Sync status' },
  { key: 'excluded', label: 'Exclude' },
]);

function compareItems(left, right, key) {
  const a = left[key];
  const b = right[key];
  if (a === b) return 0;
  // Missing values always sort last so real data stays on top in either direction.
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? -1 : 1;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}

// The source is intact — only the archived copy failed re-validation (or was
// deleted) and gets rewritten on the next sync.
const REARCHIVE_HINT = 'The conversation on your computer is fine. Its archived Markdown copy is outdated or invalid and will be rewritten on the next sync.';

function ConversationRow({ item, busy, onExclusionChange, onOpen }) {
  const isWarning = !['synced', 'new', 'changed'].includes(item.status);
  const stateClass = item.excluded ? 'archive-state is-excluded' : isWarning ? 'archive-state is-warning' : 'archive-state';
  return (
    <div className={`conversation-row${item.excluded ? ' is-excluded' : ''}`}>
      <span className="provider-label"><span className="provider-mini" />{item.providerName}</span>
      <span className="conversation-id" title={item.shortSessionId}>{item.shortSessionId}</span>
      <button
        className="conversation-title conversation-title-button"
        type="button"
        title={item.title ?? undefined}
        disabled={!item.canOpen}
        onClick={() => onOpen(item.sessionKey)}
      >
        {item.title ?? `${item.providerName} conversation`}
      </button>
      <span className="conversation-activity">{formatActivity(item.activityAt)}</span>
      <span className="conversation-size">{formatBytes(item.sizeBytes)}</span>
      <span className="conversation-processed">{formatDateTime(item.processedAt)}</span>
      <span className={stateClass} title={item.status === 'archive-missing' ? REARCHIVE_HINT : undefined}>{statusLabel(item.status, item.excluded)}</span>
      <span className="exclude-cell">
        <input
          className="exclude-checkbox"
          type="checkbox"
          checked={item.excluded}
          disabled={busy}
          onChange={(event) => onExclusionChange(item.sessionKey, event.target.checked)}
          aria-label={`Exclude ${item.title ?? item.providerName} from syncing`}
        />
      </span>
    </div>
  );
}

export default function ArchiveView({
  archivePath,
  catalog,
  phase,
  lastRun,
  onSync,
  onExclusionChange,
  onOpenArchive,
  onOpenSession,
}) {
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [sort, setSort] = useState(null);
  const providerOptions = useMemo(() => {
    const names = new Map();
    for (const item of catalog?.items ?? []) names.set(item.provider, item.providerName);
    return [...names.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [catalog]);
  const items = useMemo(() => {
    if (!catalog) return [];
    let list = filter === 'all' ? catalog.items : catalog.items.filter((item) => item.syncState === filter);
    if (providerFilter !== 'all') list = list.filter((item) => item.provider === providerFilter);
    const needle = query.trim().toLowerCase();
    if (needle !== '') {
      list = list.filter((item) => item.shortSessionId?.toLowerCase().includes(needle)
        || item.title?.toLowerCase().includes(needle));
    }
    if (sort) list = [...list].sort((left, right) => compareItems(left, right, sort.key) * sort.dir);
    return list;
  }, [catalog, filter, providerFilter, query, sort]);
  const toggleSort = (key) => {
    setSort((current) => (current?.key === key ? { key, dir: -current.dir } : { key, dir: 1 }));
  };
  const excludedCount = catalog?.items.filter((item) => item.excluded).length ?? 0;
  const isBusy = phase === 'syncing' || phase === 'cataloging';

  return (
    <section className="state-view" aria-label="Archive sync view">
      <div className="section-heading">
        <h2 className="section-title">Archive</h2>
        <span className="section-meta">{lastRun ? `Last sync: ${formatDateTime(lastRun.completedAt)}` : 'Last sync: Never'}</span>
      </div>

      <div className="archive-card">
        <div className="archive-identity">
          <div className="archive-icon" aria-hidden="true"><Icon name="archive" /></div>
          <div>
            <p className="archive-name">GRASPPY Capture Archive</p>
            <p className="archive-caption safe-path" title={archivePath}>{archivePath}</p>
          </div>
        </div>
        <button className="text-button" type="button" disabled title="Archive migration is deferred">Change…</button>
      </div>

      <div className="section-heading">
        <h2 className="section-title">Sources</h2>
        <span className="section-meta">{catalog ? `${catalog.counts.all} conversations found` : 'Checking sources…'}</span>
      </div>
      <div className="provider-grid">
        {catalog?.providers.map((provider) => <ProviderCard key={provider.provider} provider={provider} />)}
      </div>
      <ActionPanel phase={phase} catalog={catalog} lastRun={lastRun} onSync={onSync} />

      <div className="section-heading">
        <h2 className="section-title">Conversations</h2>
        <span className="section-meta">{excludedCount ? `${excludedCount} excluded · remembered for future syncs` : 'No exclusions · choices are remembered'}</span>
      </div>
      <div className="conversation-toolbar">
        <div className="conversation-filters" role="group" aria-label="Filter conversations by sync status">
          {['pending', 'synced', 'all'].map((value) => (
            <button key={value} className="conversation-filter" type="button" onClick={() => setFilter(value)} aria-pressed={filter === value}>
              {value[0].toUpperCase() + value.slice(1)} <span className="filter-count">{catalog?.counts[value] ?? 0}</span>
            </button>
          ))}
        </div>
        <input
          className="conversation-search"
          type="search"
          placeholder="Search ID or name…"
          value={query}
          aria-label="Search conversations by ID or name"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="conversation-provider-filter"
          value={providerFilter}
          aria-label="Filter conversations by platform"
          onChange={(event) => setProviderFilter(event.target.value)}
        >
          <option value="all">All platforms</option>
          {providerOptions.map(([provider, name]) => <option key={provider} value={provider}>{name}</option>)}
        </select>
        <p className="filter-note">Nothing syncs automatically. Synced items return to Pending when their local source changes.</p>
      </div>

      <div className="conversation-card">
        <div className="conversation-head">
          {SORT_COLUMNS.map((column) => (
            <button
              key={column.key}
              className={`conversation-sort${column.key === 'excluded' ? ' exclude-heading' : ''}`}
              type="button"
              aria-label={`Sort by ${column.label}${sort?.key === column.key && sort.dir === 1 ? ', descending' : ', ascending'}`}
              onClick={() => toggleSort(column.key)}
            >
              {column.label}{sort?.key === column.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
            </button>
          ))}
        </div>
        <div>
          {items.map((item) => (
            <ConversationRow
              key={item.sessionKey}
              item={item}
              busy={isBusy}
              onExclusionChange={onExclusionChange}
              onOpen={onOpenSession}
            />
          ))}
          {catalog && items.length === 0 && (
            <div className="conversation-empty"><strong>No {filter} conversations</strong><span>Choose another filter to review the local catalog.</span></div>
          )}
        </div>
      </div>

      <div className="footer-row">
        <button className="secondary-button" type="button" onClick={onOpenArchive}><Icon name="archive" size="16" />Open Archive Folder</button>
        <span className="footer-summary">Showing {items.length} of {catalog?.counts[filter] ?? 0} {filter}{excludedCount ? ` · ${excludedCount} excluded` : ''}</span>
      </div>
    </section>
  );
}
