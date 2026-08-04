// Purpose: Coordinates the approved Setup, Archive, and Dashboard views through the narrow preload API.

import React, { useCallback, useEffect, useState } from 'react';

import ArchiveView from './ArchiveView.jsx';
import DashboardView from './DashboardView.jsx';
import Header from './Header.jsx';
import SetupView from './SetupView.jsx';

function unwrap(response) {
  if (response?.success) return response.data;
  throw new Error(response?.error ?? 'The desktop operation could not be completed.');
}

export default function App() {
  const api = window.captureDesktop;
  const [theme, setTheme] = useState(() => window.localStorage.getItem('capture-theme') ?? 'light');
  const [view, setView] = useState('archive');
  const [configured, setConfigured] = useState(false);
  const [archivePath, setArchivePath] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [message, setMessage] = useState('Starting GRASPPY Capture…');
  const [error, setError] = useState(null);

  const refreshCatalog = useCallback(async () => {
    setPhase('cataloging');
    setError(null);
    try {
      const data = unwrap(await api.catalogProviders());
      setCatalog(data.catalog);
      setDashboard(data.dashboard);
      setLastRun(data.dashboard.lastSync);
      setPhase('ready');
    } catch (operationError) {
      setPhase('warning');
      setError(operationError.message);
    }
  }, [api]);

  useEffect(() => {
    if (!api) {
      setPhase('warning');
      setError('The secure desktop bridge is unavailable.');
      return undefined;
    }
    const unsubscribe = api.subscribeToProgress((progress) => {
      setMessage(progress.message);
      if (progress.phase) setPhase(progress.phase);
    });
    void (async () => {
      try {
        const status = unwrap(await api.getArchiveStatus());
        setConfigured(status.configured);
        if (status.configured) {
          setArchivePath(status.archivePath);
          setDashboard(status.dashboard);
          setLastRun(status.dashboard.lastSync);
          // Paint what is already archived before the scan starts; a full
          // provider rescan takes minutes and an empty table reads as data loss.
          if (status.catalog) setCatalog(status.catalog);
          await refreshCatalog();
        } else {
          setPhase('ready');
        }
      } catch (operationError) {
        setPhase('warning');
        setError(operationError.message);
      }
    })();
    return unsubscribe;
  }, [api, refreshCatalog]);

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    window.localStorage.setItem('capture-theme', nextTheme);
    setTheme(nextTheme);
  }

  async function chooseFolder() {
    setError(null);
    try {
      const selection = unwrap(await api.selectArchiveDirectory());
      setSelectedPath(selection.selected ? selection.displayPath : null);
    } catch (operationError) {
      setError(operationError.message);
    }
  }

  async function completeSetup() {
    setPhase('cataloging');
    setError(null);
    try {
      const status = unwrap(await api.completeSetup());
      setConfigured(true);
      setArchivePath(status.archivePath);
      setDashboard(status.dashboard);
      setView('archive');
      await refreshCatalog();
    } catch (operationError) {
      setPhase('warning');
      setError(operationError.message);
    }
  }

  async function syncArchive() {
    setPhase('syncing');
    setError(null);
    try {
      const data = unwrap(await api.syncArchive());
      setCatalog(data.catalog);
      setDashboard(data.dashboard);
      setLastRun(data.run);
      setPhase(data.run.status === 'success' ? 'success' : 'warning');
      if (data.failures.length > 0) setError(`${data.failures.length} conversation${data.failures.length === 1 ? '' : 's'} could not be processed.`);
    } catch (operationError) {
      setPhase('warning');
      setError(operationError.message);
    }
  }

  async function setExclusion(sessionKey, excluded) {
    setError(null);
    try {
      const data = unwrap(await api.setSessionExclusion(sessionKey, excluded));
      if (data.catalog) setCatalog(data.catalog);
    } catch (operationError) {
      setError(operationError.message);
    }
  }

  async function checkForUpdates() {
    setError(null);
    try {
      unwrap(await api.checkForUpdates());
    } catch (operationError) {
      setError(operationError.message);
    }
  }

  async function openUserGuide() {
    setError(null);
    try {
      unwrap(await api.openUserGuide());
    } catch (operationError) {
      setError(operationError.message);
    }
  }

  async function openArchive() {
    try {
      unwrap(await api.openArchiveDirectory());
    } catch (operationError) {
      setError(operationError.message);
    }
  }

  async function openSession(sessionKey) {
    try {
      unwrap(await api.openArchivedSession(sessionKey));
    } catch (operationError) {
      setError(operationError.message);
    }
  }

  const isBusy = phase === 'loading' || phase === 'cataloging' || phase === 'syncing';
  return (
    <section className="preview-frame capture-window" data-theme={theme} aria-label="GRASPPY Capture application">
      <div className="app-shell">
        <Header
          configured={configured}
          view={view}
          onViewChange={setView}
          theme={theme}
          onThemeChange={toggleTheme}
          onCheckForUpdates={checkForUpdates}
          onOpenUserGuide={openUserGuide}
        />
        <div className="app-content">
          {!configured ? (
            <SetupView selectedPath={selectedPath} busy={isBusy} onChooseFolder={chooseFolder} onCompleteSetup={completeSetup} />
          ) : view === 'archive' ? (
            <ArchiveView
              archivePath={archivePath}
              catalog={catalog}
              phase={phase}
              lastRun={lastRun}
              onSync={syncArchive}
              onExclusionChange={setExclusion}
              onOpenArchive={openArchive}
              onOpenSession={openSession}
            />
          ) : (
            <DashboardView dashboard={dashboard} />
          )}
          {error && <div className="toast is-visible" role="alert">{error}</div>}
          <div className="screen-reader-status" role="status" aria-live="polite">{message}</div>
        </div>
      </div>
    </section>
  );
}
