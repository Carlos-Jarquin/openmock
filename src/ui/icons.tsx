// Openmock's own line icons: 18px, 1.4px stroke, currentColor. Decorative unless given a title.
const P: Record<string, string> = {
  devices: 'M4 3.5h6.5a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1ZM11.5 6H14a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-2.5',
  media: 'M3 4h12v10H3zM3 11.5l3.2-3 2.6 2.4 2-1.8L15 12.5M11.5 7.2a.9.9 0 1 0 0-.01',
  preset: 'M3 3h5v5H3zM10 3h5v5h-5zM3 10h5v5H3zM10 10h5v5h-5z',
  style: 'M9 2.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M9 2.5v13',
  background: 'M3 3h12v12H3zM3 9.5L9.5 3M3 15L15 3M8.5 15L15 8.5',
  camera: 'M2.5 5.5h3l1.2-2h4.6l1.2 2h3v9h-13zM9 7.5a2.6 2.6 0 1 0 0 5.2a2.6 2.6 0 1 0 0-5.2',
  lighting: 'M9 6a3 3 0 1 0 0 6a3 3 0 1 0 0-6M9 1.8v1.8M9 14.4v1.8M1.8 9h1.8M14.4 9h1.8M3.9 3.9l1.3 1.3M12.8 12.8l1.3 1.3M3.9 14.1l1.3-1.3M12.8 5.2l1.3-1.3',
  effects: 'M9 2.5l1.4 4.1 4.1 1.4-4.1 1.4L9 13.5l-1.4-4.1L3.5 8l4.1-1.4zM14 12.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z',
  photoreal: 'M3 15L11.5 6.5M10 5l3 3M12.5 2.5v2M14.5 4.5h-2M15.5 1.5l-1 1M6 2.5v1.6M5.2 3.3h1.6',
  model: 'M5.5 1.8h7a1.2 1.2 0 0 1 1.2 1.2v12a1.2 1.2 0 0 1-1.2 1.2h-7A1.2 1.2 0 0 1 4.3 15V3a1.2 1.2 0 0 1 1.2-1.2ZM7.8 3.8h2.4',
  finish: 'M9 2.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M4.4 13.6L13.6 4.4',
  screen: 'M3 3.5h12v9H3zM6.5 15.5h5M7.5 6.2v4l3.2-2z',
  statusbar: 'M3 4h12M3 8h12M3 12h7M12.5 12.5v1.5M14.5 11v3',
  fold: 'M9 4v11M9 4L3.5 2.5v11L9 15M9 4l5.5-1.5v11L9 15',
  hand: 'M6.5 9V3.8a1.1 1.1 0 0 1 2.2 0V8.5M8.7 8V2.9a1.1 1.1 0 0 1 2.2 0V8.5M10.9 8.5V4a1.1 1.1 0 0 1 2.2 0v6a5 5 0 0 1-5 5H8a4.2 4.2 0 0 1-3.4-1.8L2.4 10a1.1 1.1 0 0 1 1.8-1.3L6.5 11',
  search: 'M8 3a5 5 0 1 0 0 10a5 5 0 1 0 0-10M11.6 11.6L15.5 15.5',
  orbit: 'M9 6.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M1.8 9c0-2 3.2-3.6 7.2-3.6s7.2 1.6 7.2 3.6-3.2 3.6-7.2 3.6c-1.6 0-3-.3-4.2-.7M3.4 10.6l1.4 1.3-1.5 1.1',
  pan: 'M9 2v14M2 9h14M9 2L7 4M9 2l2 2M9 16l-2-2M9 16l2-2M2 9l2-2M2 9l2 2M16 9l-2-2M16 9l-2 2',
  reset: 'M3.5 9a5.5 5.5 0 1 0 1.6-3.9M3.5 2.8v2.6h2.6',
  pin: 'M7 2.5h4M8 2.5v4.2L5.5 9.5h7L10 6.7V2.5M9 9.5V15.5',
  close: 'M4.5 4.5l9 9M13.5 4.5l-9 9',
  up: 'M4.5 11L9 6.5l4.5 4.5',
  down: 'M4.5 7L9 11.5 13.5 7',
  play: 'M6 4v10l8-5z',
  pause: 'M6.5 4v10M11.5 4v10',
  plus: 'M9 4v10M4 9h10',
  copy: 'M6.5 6.5h8v8h-8zM3.5 11.5v-8h8',
  trash: 'M3.5 5h11M7 5V3.5h4V5M5 5l.7 9.5h6.6L13 5',
  pencil: 'M3.5 14.5l.7-3 8-8 2.3 2.3-8 8zM10.8 4.9l2.3 2.3',
  eyeoff: 'M1.8 9S4.5 4 9 4s7.2 5 7.2 5-2.7 5-7.2 5S1.8 9 1.8 9ZM9 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4M2.5 2.5l13 13',
  move: 'M9 2v14M2 9h14M9 2 7 4M9 2l2 2M9 16l-2-2M9 16l2-2M2 9l2-2M2 9l2 2M16 9l-2-2M16 9l-2 2',
  eye: 'M1.8 9S4.5 4 9 4s7.2 5 7.2 5-2.7 5-7.2 5S1.8 9 1.8 9ZM9 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
}
export type IconName = keyof typeof P
export function Icon({ name, size = 18, title }: { name: IconName | string; size?: number; title?: string }) {
  return <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>{title && <title>{title}</title>}<path d={P[name] ?? P.preset} /></svg>
}
