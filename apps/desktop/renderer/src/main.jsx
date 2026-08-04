// Purpose: Mounts the packaged React application with the exact owner-approved mock-up stylesheet.

import React from 'react';
import { createRoot } from 'react-dom/client';

import 'virtual:grasppy-capture-locked-design.css';
import './application.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
