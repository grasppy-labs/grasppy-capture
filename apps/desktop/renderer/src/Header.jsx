// Purpose: Renders the locked product header, two-view navigation, local-only badge, and theme control.

import React, { useEffect, useRef, useState } from 'react';

import Icon from './icons.jsx';

export default function Header({ configured, view, onViewChange, theme, onThemeChange, onCheckForUpdates, onOpenUserGuide }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [menuOpen]);

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true"><Icon name="brand" /></div>
        <div className="brand-copy">
          <h1 className="brand-title">GRASPPY Capture</h1>
          <p className="brand-subtitle">Local AI conversation archive</p>
        </div>
      </div>

      {configured && (
        <nav className="app-navigation" aria-label="Application views">
          <button className="app-navigation-button" type="button" onClick={() => onViewChange('archive')} aria-pressed={view === 'archive'}>
            <Icon name="archive" /><span>Archive</span>
          </button>
          <button className="app-navigation-button" type="button" onClick={() => onViewChange('dashboard')} aria-pressed={view === 'dashboard'}>
            <Icon name="dashboard" /><span>Dashboard</span>
          </button>
        </nav>
      )}

      <div className="header-actions">
        <span className="local-badge"><Icon name="shield" /><span>Local only</span></span>
        <button
          className="icon-button"
          type="button"
          aria-label="Open the user guide"
          title="User Guide — opens grasppy.com/capture/guide in your browser"
          onClick={onOpenUserGuide}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.2 9.2a2.8 2.8 0 1 1 3.9 2.6c-.8.35-1.1.9-1.1 1.7" />
            <path d="M12 17v.1" />
          </svg>
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} theme`}
          title="Toggle Light and Dark theme"
          onClick={onThemeChange}
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
            </svg>
          )}
        </button>
        <div className="header-menu" ref={menuRef}>
          <button
            className="icon-button"
            type="button"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
          {menuOpen && (
            <div className="header-menu-panel" role="menu">
              <button
                className="header-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onCheckForUpdates();
                }}
              >
                Check for Updates…
              </button>
              <span className="header-menu-note">
                Runs only when you ask. Nothing about your conversations is sent.
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
