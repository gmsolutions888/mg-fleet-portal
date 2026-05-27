// Lightweight inline icon library — no external icon dependency.
// Usage: <Icon name="car" className="w-5 h-5" />

const PATHS = {
  car: 'M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1v1a1 1 0 0 1-2 0v-1H7v1a1 1 0 0 1-2 0v-1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h1zm2 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM7.5 10h9l-1-3h-7l-1 3z',
  check: 'M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z',
  tool: 'M22 19l-6.5-6.5a5 5 0 0 0-6.7-6.7l3.2 3.2-2 2-3.2-3.2a5 5 0 0 0 6.7 6.7L20 22l2-3z',
  warn: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  user: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4 0-10 2-10 6v2h20v-2c0-4-6-6-10-6z',
  calendar: 'M6 2v2H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-2V2h-2v2H8V2H6zm0 6h12v12H6V8z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5 3 .8-1.3-4.3-2.6V7z',
  search: 'M10 4a6 6 0 1 0 3.7 10.7l4.3 4.3 1.4-1.4-4.3-4.3A6 6 0 0 0 10 4zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  walk: 'M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2V23h2v-8.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7',
  backlog: 'M19 3h-4.2A3 3 0 0 0 12 1a3 3 0 0 0-2.8 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-2 15l-4-4 1.4-1.4L10 15.2l7.6-7.6L19 9l-9 9z',
  scheduled: 'M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 18H5V10h14v11zm0-13H5V5h14v3zM8 13h3v3H8zm5 0h3v3h-3z',
  print: 'M19 8h-1V3H6v5H5a2 2 0 0 0-2 2v6h4v4h10v-4h4v-6a2 2 0 0 0-2-2zM8 5h8v3H8V5zm8 14H8v-4h8v4zm4-6h-2v-2H6v2H4v-3h16v3z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  star: 'M12 17.3l6.2 3.7-1.6-7.1 5.4-4.7-7.2-.6L12 2 9.2 8.6 2 9.2l5.4 4.7-1.6 7.1z',
  doc: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z',
  phone: 'M20 15.5c-1.2 0-2.5-.2-3.6-.6l-.2-.1a1 1 0 0 0-1 .2l-2.2 2.2a15.1 15.1 0 0 1-6.6-6.6l2.2-2.2a1 1 0 0 0 .2-1l-.1-.2A11.4 11.4 0 0 1 8.1 4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3.1a1 1 0 0 0-1-1z',
  bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 1 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z',
  home: 'M12 3l-9 9h3v8h5v-5h2v5h5v-8h3l-9-9z',
  grid: 'M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z',
  receipt: 'M19 3l-1.5 1.5L16 3l-1.5 1.5L13 3l-1.5 1.5L10 3 8.5 4.5 7 3 5.5 4.5 4 3v18l1.5-1.5L7 21l1.5-1.5L10 21l1.5-1.5L13 21l1.5-1.5L16 21l1.5-1.5L19 21V3zm-4 14H7v-2h8v2zm2-4H7v-2h10v2zm0-4H7V7h10v2z',
  branch: 'M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z',
}

export default function Icon({ name, className = 'w-4 h-4', fill = 'currentColor' }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg viewBox="0 0 24 24" className={className} fill={fill} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
