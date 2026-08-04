// Purpose: Renders the approved content-free archive metrics, calendar, provider breakdown, and recent runs.

import React, { useMemo, useState } from 'react';

import { formatBytes, formatDateTime } from './formatters.js';
import Icon from './icons.jsx';

function MetricCard({ label, value, detail, icon }) {
  return (
    <article className="metric-card">
      <div className="metric-label"><span>{label}</span><Icon name={icon} /></div>
      <p className="metric-value">{value}</p>
      <p className="metric-detail">{detail}</p>
    </article>
  );
}

function levelFor(count) {
  if (count >= 10) return 4;
  if (count >= 6) return 3;
  if (count >= 3) return 2;
  return count > 0 ? 1 : 0;
}

const CALENDAR_MODES = Object.freeze([
  { key: 'synced', label: 'Synced', caption: 'Conversations by the day they were archived.' },
  { key: 'activity', label: 'Last updated', caption: 'Conversations by the day they were last worked on.' },
]);

// Native tooltip listing the day's conversations by short id and name.
function dayTooltip(row) {
  if (!row) return undefined;
  const lines = row.entries.slice(0, 15).map((entry) => `${entry.shortId} · ${entry.label}`);
  if (row.entries.length > lines.length) lines.push(`…and ${row.entries.length - lines.length} more`);
  return lines.join('\n');
}

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function Calendar({ sessionCalendars }) {
  const [mode, setMode] = useState('synced');
  const rows = sessionCalendars?.[mode] ?? [];
  const latestDate = rows.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  // Month browsing is per-mode-agnostic: null means "latest month with data".
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(null);

  const model = useMemo(() => {
    const latest = new Date(`${latestDate}T12:00:00`);
    const shown = new Date(latest.getFullYear(), latest.getMonth() - monthOffset, 1, 12);
    const year = shown.getFullYear();
    const month = shown.getMonth();
    const activity = new Map(rows.filter((row) => row.date.startsWith(monthKey(year, month)))
      .map((row) => [row.date, row]));
    return {
      year,
      month,
      days: new Date(year, month + 1, 0).getDate(),
      firstWeekday: new Date(year, month, 1).getDay(),
      activity,
      monthTotal: [...activity.values()].reduce((sum, row) => sum + row.count, 0),
      label: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(shown),
    };
  }, [latestDate, rows, monthOffset]);

  const selected = selectedDate ? model.activity.get(selectedDate) : null;
  const cells = [];
  for (let blank = 0; blank < model.firstWeekday; blank += 1) {
    cells.push(<span className="calendar-day is-empty" aria-hidden="true" key={`blank-${blank}`} />);
  }
  for (let day = 1; day <= model.days; day += 1) {
    const date = `${monthKey(model.year, model.month)}-${String(day).padStart(2, '0')}`;
    const row = model.activity.get(date);
    const level = levelFor(row?.count ?? 0);
    cells.push(
      <button
        className={`calendar-day${level ? ` has-activity level-${level}` : ''}`}
        type="button"
        key={date}
        title={dayTooltip(row)}
        aria-pressed={selectedDate === date}
        aria-label={`${date}, ${row?.count ?? 0} conversations`}
        onClick={() => setSelectedDate(selectedDate === date ? null : date)}
      >
        <strong>{day}</strong><span>{row ? `${row.count} conv` : '—'}</span>
      </button>,
    );
  }

  const activeMode = CALENDAR_MODES.find((entry) => entry.key === mode);
  return (
    <article className="analytics-card">
      <div className="analytics-card-header">
        <div><h3 className="analytics-card-title">Conversations by calendar</h3><p className="analytics-card-caption">{activeMode.caption} Hover a day for its conversation IDs.</p></div>
        <div className="calendar-modes" role="group" aria-label="Calendar view mode">
          {CALENDAR_MODES.map((entry) => (
            <button
              className="conversation-filter"
              type="button"
              key={entry.key}
              aria-pressed={mode === entry.key}
              onClick={() => { setMode(entry.key); setSelectedDate(null); }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <div className="calendar-month-bar">
        <button className="calendar-nav-button" type="button" aria-label="Previous month" onClick={() => { setMonthOffset(monthOffset + 1); setSelectedDate(null); }}>‹</button>
        <span className="calendar-month-label">{model.label} · {model.monthTotal} conversation{model.monthTotal === 1 ? '' : 's'}</span>
        <button className="calendar-nav-button" type="button" aria-label="Next month" disabled={monthOffset === 0} onClick={() => { setMonthOffset(Math.max(0, monthOffset - 1)); setSelectedDate(null); }}>›</button>
      </div>
      <div className="calendar-weekdays" aria-hidden="true"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
      <div className="activity-calendar" aria-label={`${model.label} conversation calendar`}>{cells}</div>
      <p className="calendar-selection">
        {selected ? (
          <>
            <strong>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${selectedDate}T12:00:00`))}</strong>
            {` · ${selected.count} conversation${selected.count === 1 ? '' : 's'}: `}
            {selected.entries.slice(0, 4).map((entry) => entry.label).join(' · ')}
            {selected.entries.length > 4 ? ` · +${selected.entries.length - 4} more` : ''}
          </>
        ) : (
          <>Select a day to list its conversations.</>
        )}
      </p>
    </article>
  );
}

function ProviderBreakdown({ providers }) {
  const maximumSize = Math.max(1, ...providers.map((provider) => provider.sizeBytes));
  return (
    <article className="analytics-card">
      <div className="analytics-card-header"><div><h3 className="analytics-card-title">Archive by provider</h3><p className="analytics-card-caption">Markdown files and storage currently in the archive.</p></div></div>
      <div className="provider-breakdown">
        {providers.map((provider) => {
          const name = provider.provider === 'claude-code' ? 'Claude Code' : provider.provider[0].toUpperCase() + provider.provider.slice(1);
          const ratio = Math.round((provider.sizeBytes / maximumSize) * 10);
          const providerClass = provider.provider === 'claude-code' ? 'claude' : provider.provider;
          return (
            <div className="breakdown-row" key={provider.provider}>
              <div className="breakdown-labels"><span className="breakdown-provider"><span className="provider-mini" />{name}</span><span className="breakdown-value">{provider.fileCount} files · {formatBytes(provider.sizeBytes)}</span></div>
              <div className="breakdown-track"><div className={`breakdown-fill ${providerClass} ratio-${ratio}`} /></div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export default function DashboardView({ dashboard }) {
  const lastRun = dashboard?.lastSync;
  const results = lastRun?.results;
  const lastDetail = results
    ? `${results.created} new · ${results.replaced} updated · ${results.unchanged} unchanged`
    : 'No completed sync yet';
  const periodDate = dashboard?.calendar.at(-1)?.date;
  const period = periodDate
    ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${periodDate}T12:00:00`))
    : 'No activity yet';

  return (
    <section className="state-view" aria-labelledby="analyticsTitle">
      <div className="analytics-header">
        <div><h2 className="analytics-title" id="analyticsTitle">Archive activity</h2><p className="analytics-description">A local summary of completed Markdown exports and archive growth.</p></div>
        <span className="analytics-period"><Icon name="calendar" />{period}</span>
      </div>

      <div className="metric-grid" aria-label="Archive summary">
        <MetricCard label="Files in last sync" value={lastRun?.filesChecked ?? 0} detail={lastDetail} icon="file" />
        <MetricCard label="Written last sync" value={formatBytes(lastRun?.bytesWritten ?? 0)} detail={lastRun ? `Completed ${formatDateTime(lastRun.completedAt)}` : 'No completed sync yet'} icon="storage" />
        <MetricCard label="Markdown files" value={dashboard?.currentArchive.fileCount ?? 0} detail="Across local providers" icon="file" />
        <MetricCard label="Total archive size" value={formatBytes(dashboard?.currentArchive.sizeBytes ?? 0)} detail="Readable Markdown only" icon="storage" />
      </div>

      <div className="analytics-grid">
        <Calendar sessionCalendars={dashboard?.sessionCalendars} />
        <ProviderBreakdown providers={dashboard?.providers ?? []} />
      </div>

      <div className="section-heading"><h2 className="section-title">Recent syncs</h2><span className="section-meta">Completed manual runs</span></div>
      <div className="sync-history">
        <div className="sync-history-head" aria-hidden="true"><span>Completed</span><span>Result</span><span>Files checked</span><span>Written</span></div>
        {(dashboard?.recentRuns ?? []).slice(0, 20).map((run) => (
          <div className="sync-history-row" key={run.runId}>
            <strong>{formatDateTime(run.completedAt)}</strong>
            <span className="history-result"><span className="history-success">{run.results.created} new</span><span>{run.results.replaced} updated</span><span>{run.results.unchanged} unchanged</span></span>
            <span>{run.filesChecked} files</span><span>{formatBytes(run.bytesWritten)}</span>
          </div>
        ))}
        {dashboard && dashboard.recentRuns.length === 0 && <div className="conversation-empty"><strong>No completed syncs</strong><span>Your manual sync history will appear here.</span></div>}
      </div>
    </section>
  );
}
