// Inline SVG icons for the HUD (stroke-based, coloured by CSS).
const svg = (body, vb = '0 0 40 40') => `<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  move: svg('<path d="M20 5v30M5 20h30M20 5l-5 5M20 5l5 5M20 35l-5-5M20 35l5-5M5 20l5-5M5 20l5 5M35 20l-5-5M35 20l-5 5"/>'),
  hold: svg('<rect x="10" y="9" width="7" height="22" rx="1"/><rect x="23" y="9" width="7" height="22" rx="1"/>'),
  roe: svg('<circle cx="20" cy="20" r="11"/><path d="M20 4v8M20 28v8M4 20h8M28 20h8"/><circle cx="20" cy="20" r="1.5"/>'),
  cover: svg('<circle cx="17" cy="9" r="3.5"/><path d="M16 14l-4 8 7 2 3 9M16 14l6 5 6-2M12 22l-5 10M8 32h24"/>'),
  run: svg('<circle cx="24" cy="7" r="3.5"/><path d="M22 12l-5 9 6 4-2 9M22 12l7 6 5-2M17 21l-7 4M6 34h6"/>'),
  flashlight: svg('<path d="M8 25l10-10 7 7-10 10zM18 15l4-4 7 7-4 4M25 11l4-4M29 15l5-2M27 9l2-5"/>'),
  stim: svg('<path d="M9 31l13-13M18 14l8 8M22 10l8 8M26 14l6-6M29 6l5 5M12 28l-5 5M14 22l4 4"/>'),
  turn: svg('<path d="M28 32V16a8 8 0 0 0-16 0v6M12 22l-5-5M12 22l5-5"/>'),
  grenade: svg('<ellipse cx="19" cy="25" rx="9" ry="10"/><path d="M15 15v-4h8v4M23 11l7 5M11 25h16M19 15v20"/><circle cx="12" cy="9" r="3"/>'),
  flare: svg('<path d="M9 33l13-13 4 4-13 13zM27 16l3-3M30 21l4-1M24 12l1-4M29 11l3-3"/>'),
  // Two sentry guns on tripods, one each side.
  defend: svg('<path d="M4 33l4-8 4 8M8 25v-5M5 20h8l3-2h3M28 33l4-8 4 8M32 25v-5M35 20h-8l-3-2h-3"/>'),
  rifle: svg('<path d="M4 18h54l4-3h8v4h-6v4H44l-4 9h-9l2-9h-8l-3 5h-8l2-5H4z" fill="#c9cfc4" stroke="none"/><path d="M40 23h-6l-1 6h5z" fill="#6a1f1a" stroke="none"/>', '0 0 72 36'),
  bullets: svg('<path d="M12 30V14l3-6 3 6v16zM20 30V14l3-6 3 6v16zM28 30V14l3-6 3 6v16z" fill="#c9b27a" stroke="none"/>'),
};

/** Helmet portrait tinted with the marine's squad colour; red visor lenses. */
export function portrait(tint, index) {
  const crest = ['M29 6h6v10h-6z', 'M22 8l10-4 10 4-2 6H24z', 'M30 4h4v12h-4z', 'M26 7h12v5H26z'][index % 4];
  return `<svg viewBox="0 0 64 64">
    <defs><linearGradient id="hg${index}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d6b41"/><stop offset="1" stop-color="#2d3620"/></linearGradient></defs>
    <rect width="64" height="64" fill="#121615"/>
    <path d="M6 64c2-12 10-16 26-16s24 4 26 16z" fill="#1c211a"/>
    <path d="M4 60c0-8 6-12 12-12h32c6 0 12 4 12 12" fill="${tint}" opacity=".85"/>
    <path d="M14 30c0-14 8-22 18-22s18 8 18 22v10c0 6-6 10-18 10S14 46 14 40z" fill="url(#hg${index})" stroke="#0a0c0a" stroke-width="1.5"/>
    <path d="${crest}" fill="${tint}"/>
    <path d="M17 27h30l-2 7H19z" fill="#0c0f0d"/>
    <rect x="20" y="28.5" width="9" height="4" fill="#ff3a24"/><rect x="35" y="28.5" width="9" height="4" fill="#ff3a24"/>
    <rect x="20" y="28.5" width="9" height="4" fill="#ff8060" opacity=".5" filter="blur(1px)"/>
    <path d="M26 38h12v8H26z" fill="#1b2016"/><path d="M28 40h8M28 42.5h8M28 45h8" stroke="#56603f" stroke-width="1"/>
  </svg>`;
}
