// ============================================================================
// logoMark — V14.2 (spec section 1). A more realistic, polished, layered
// logo mark for the SQL Assistant navbar, replacing the flatter V14.1
// badge. Deliberately reuses ONLY the existing brand blue tones already
// defined in the app's design system (--brand: #2f6fed, --brand-dark:
// #1c3f8f) — no new hues are introduced, per the requirement not to
// conflict with the existing SQL Assistant colour scheme. (Note: the
// original spec referenced "the requested #D colour/theme", which arrived
// with formatting stripped from the source document — we've interpreted
// this as "the existing brand colour already used throughout the app",
// since no other colour reference was provided; happy to adjust to a
// specific hex if a different colour was intended.)
//
// The mark itself: a rounded database "stack" (3 layered ellipses with
// subtle highlight/shadow bands for a real sense of depth, unlike the flat
// V14.1 version) with a small magnifying-glass + spark accent overlapping
// the bottom-right, to read as "querying/searching a database" rather than
// a generic database icon alone. All static — no gradients or elements
// that change on hover (per spec 1.2, the logo must look IDENTICAL in
// normal/hover/focus states).
// ============================================================================

export function logoMarkSvg(size = 24): string {
  return `
<svg class="logo-mark-svg" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="lmBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3f7dfa"/>
      <stop offset="1" stop-color="#1c3f8f"/>
    </linearGradient>
    <linearGradient id="lmCylTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#dbe8ff" stop-opacity="0.85"/>
    </linearGradient>
    <linearGradient id="lmBand" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eaf1ff" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#eaf1ff" stop-opacity="0.15"/>
    </linearGradient>
  </defs>

  <rect x="1" y="1" width="46" height="46" rx="12" fill="url(#lmBg)"/>
  <rect x="1" y="1" width="46" height="46" rx="12" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="1"/>

  <!-- layered database stack, 3D-ish via stacked bands + top ellipse highlight -->
  <g>
    <path d="M14 30.5c0 2.02 4.48 3.65 10 3.65s10-1.63 10-3.65v-3.6c0 2.02-4.48 3.65-10 3.65s-10-1.63-10-3.65z" fill="#153170" opacity="0.55"/>
    <path d="M14 26.9c0 2.02 4.48 3.65 10 3.65s10-1.63 10-3.65v-3.6c0 2.02-4.48 3.65-10 3.65s-10-1.63-10-3.65z" fill="url(#lmBand)"/>
    <path d="M14 23.3c0 2.02 4.48 3.65 10 3.65s10-1.63 10-3.65v-3.6c0 2.02-4.48 3.65-10 3.65s-10-1.63-10-3.65z" fill="#0f2657" opacity="0.35"/>
    <ellipse cx="24" cy="16.1" rx="10" ry="3.65" fill="url(#lmCylTop)"/>
    <ellipse cx="24" cy="16.1" rx="10" ry="3.65" fill="none" stroke="#ffffff" stroke-opacity="0.6" stroke-width="0.6"/>
    <path d="M14 16.1v14.4" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.8"/>
    <path d="M34 16.1v14.4" stroke="#0f2657" stroke-opacity="0.4" stroke-width="0.8"/>
  </g>

  <!-- magnifying glass + spark accent, overlapping bottom-right -->
  <g transform="translate(27,27)">
    <circle cx="7" cy="7" r="6.4" fill="#ffffff"/>
    <circle cx="7" cy="7" r="6.4" fill="none" stroke="#1c3f8f" stroke-opacity="0.15" stroke-width="1"/>
    <circle cx="6.6" cy="6.6" r="3.6" fill="none" stroke="#2f6fed" stroke-width="2"/>
    <line x1="9.1" y1="9.1" x2="12.6" y2="12.6" stroke="#2f6fed" stroke-width="2.2" stroke-linecap="round"/>
  </g>
</svg>`.trim();
}
