// Purpose: Renders the approved first-run consent and archive-parent selection experience.

import React from 'react';

import Icon from './icons.jsx';

export default function SetupView({ selectedPath, busy, onChooseFolder, onCompleteSetup }) {
  return (
    <section className="state-view" aria-labelledby="setupTitle">
      <div className="setup-wrap">
        <div className="setup-card">
          <div className="setup-story">
            <span className="setup-kicker">Private by design</span>
            <h2 id="setupTitle">Keep your AI conversations in one readable archive.</h2>
            <p>Capture checks known provider folders read-only, then creates Markdown copies in a folder you choose.</p>
            <div className="provider-checks" aria-label="Supported providers">
              <div className="provider-check"><span>✓</span>Claude Code</div>
              <div className="provider-check"><span>✓</span>Codex</div>
              <div className="provider-check"><span>✓</span>Cursor</div>
            </div>
          </div>

          <div className="setup-form">
            <div className="shield-icon" aria-hidden="true"><Icon name="shield" /></div>
            <h3>Choose your archive folder</h3>
            <p>Nothing is uploaded. Provider files are never changed, moved, or deleted.</p>
            <span className="field-label">Archive location</span>
            <button className="folder-picker" type="button" onClick={onChooseFolder} disabled={busy}>
              <Icon name="archive" />
              <span>
                <strong className="safe-path" title={selectedPath ?? undefined}>{selectedPath ?? 'Choose a folder…'}</strong>
                <small>{selectedPath ? 'GRASPPY Capture Archive will be created here' : 'Select a parent location'}</small>
              </span>
            </button>
            <button className="primary-button setup-submit" type="button" onClick={onCompleteSetup} disabled={!selectedPath || busy}>
              {busy ? 'Setting Up…' : 'Set Up Local Archive'}
            </button>
            <div className="consent-note">
              <Icon name="shield" />
              <span>By continuing, Capture may inspect only the known local folders for the three providers above.</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
