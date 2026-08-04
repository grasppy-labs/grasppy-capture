// Purpose: Provides the approved lightweight line icons used throughout the locked Capture interface.

import React from 'react';

const ICON_PATHS = Object.freeze({
  archive: [<path key="a" d="M3 7.5h7l2 2h9v9.5H3z" />, <path key="b" d="M3 7.5V5h7l2 2h7" />],
  brand: [<path key="a" d="M7 4.5h8.5L19 8v11.5H7z" />, <path key="b" d="M15.5 4.5V8H19M4 8.5v11h11" />, <path key="c" d="M10 12h6M10 15h6" />],
  calendar: [<path key="a" d="M5 3v3M19 3v3M4 8h16M4 5h16v16H4z" />],
  dashboard: [<path key="a" d="M4 19V9M10 19V5M16 19v-7M22 19V3" />, <path key="b" d="M2 19h22" />],
  file: [<path key="a" d="M5 4h10l4 4v12H5zM15 4v4h4" />, <path key="b" d="m9 14 2 2 4-5" />],
  shield: [<path key="a" d="M12 3 5 6v5c0 4.6 2.7 8 7 10 4.3-2 7-5.4 7-10V6z" />, <path key="b" d="m9 12 2 2 4-5" />],
  storage: [<ellipse key="a" cx="12" cy="5" rx="8" ry="3" />, <path key="b" d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />],
  success: [<circle key="a" cx="12" cy="12" r="9" />, <path key="b" d="m8 12 2.5 2.5L16 9" />],
  sync: [<path key="a" d="M20 7h-5V2" />, <path key="b" d="M20 7a8 8 0 1 0 1.1 8" />],
  warning: [<path key="a" d="M12 3 2.8 20h18.4z" />, <path key="b" d="M12 9v5M12 17.5v.1" />],
});

export default function Icon({ name, className, size, label }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
    >
      {ICON_PATHS[name] ?? ICON_PATHS.file}
    </svg>
  );
}
