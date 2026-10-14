// Pure data: iPad mini (A17 Pro), iPad Pro 12.9-inch (6th generation) and iPad Pro 11-inch (M5) measurements,
// in millimetres, from Apple's Dimensional Drawings for each (developer.apple.com/accessories).
// Front coordinates: y from the top edge, x from the left edge seen from the front.
// Back coordinates (bx): x from the left edge of the back view, which is the right side seen from the front.
// Values marked "measured" were scaled off the drawing (about +/-0.5 mm); "assumed" are not in the drawing.

export interface IPadLens { bx: number; y: number; /** visible lens / glass diameter */ d: number }
export interface IPadSpec {
  id: string
  name: string
  px: { w: number; h: number }
  /** cornerR: equivalent circular radius of the drawn continuous-curvature corner (measured). edge: side roundover (assumed). */
  body: { w: number; h: number; t: number; cornerR: number; edge: number }
  active: { w: number; h: number; r: number }
  /** front camera: centre and lens radius; landscape = on the right long edge (seen from the front) */
  frontCam: { x: number; y: number; r: number; extra?: { x: number; y: number; r: number }[] }
  /** camera turret on the back: square spans [from, to] from the top-left corner of the back view, rise above the back */
  turret: { base: [number, number]; top: [number, number]; r: number; rise: number; topRise: number } | null
  /** a round single-lens turret (mini) */
  roundTurret: { bx: number; y: number; d: number; baseD: number; baseRise: number; rise: number } | null
  lenses: IPadLens[]
  lensRing: number
  flash: IPadLens
  lidar: IPadLens | null
  rearAls: IPadLens | null
  rearMic: IPadLens
  /** top button on the top edge: x from the right edge seen from the front to its near end */
  topBtn: { fromRight: number; len: number }
  /** volume buttons: on the right side ('side', y from the top to the near end) or the top edge ('top', x from the left) */
  vol: { where: 'side' | 'top'; up: number; down: number; len: number }
  btn: { w: number; protrude: number }
  /** antenna splits: 'top' x-ranges along the top edge (from the left), 'side' y-ranges on both long sides (from the top) */
  bands: { top: [number, number][]; side: [number, number][] }
  /** speaker hole clusters on the top and bottom edges, x from the left (front view) */
  speakers: { d: number; n: number; top: [number, number][]; bottom: [number, number][] }
  usbc: { w: number; h: number }
  smartConnector: { y: number; pitch: number; d: number; open: number } | null
}

export const IPAD_MINI: IPadSpec = {
  id: 'ipmini', name: 'iPad mini',
  px: { w: 1488, h: 2266 },
  body: { w: 134.75, h: 195.43, t: 6.32, cornerR: 12.0, edge: 0.7 },
  active: { w: 117.06, h: 177.75, r: 5.0 },
  frontCam: { x: 67.37, y: 4.4, r: 1.3 },
  turret: null,
  roundTurret: { bx: 25.39, y: 17.68, d: 11.89, baseD: 15.44, baseRise: 0.23, rise: 1.74 },
  lenses: [{ bx: 25.39, y: 17.68, d: 9.89 }],
  lensRing: 11.89,
  flash: { bx: 25.39, y: 27.62, d: 3.75 },
  lidar: null,
  rearAls: null,
  rearMic: { bx: 25.39, y: 22.39, d: 0.8 },
  // Top view: the top button sits at the camera end, the volume buttons at the other end (drawing, mirrored into front view).
  topBtn: { fromRight: 12.69, len: 17.12 },
  vol: { where: 'top', up: 24.88, down: 12.82, len: 10.06 },
  btn: { w: 2.46, protrude: 0.45 },
  bands: { top: [[54.4, 57.8], [77.0, 79.1]], side: [] },
  speakers: { d: 1.4, n: 8, top: [[17.96, 32.74], [102.0, 116.8]], bottom: [[17.96, 32.74], [102.0, 116.8]] },
  usbc: { w: 8.34, h: 2.6 },
  smartConnector: null,
}

export const IPAD_PRO_129: IPadSpec = {
  id: 'ippro13', name: 'iPad Pro 12.9"',
  px: { w: 2048, h: 2732 },
  body: { w: 215.0, h: 280.66, t: 6.40, cornerR: 13.5, edge: 0.7 },
  active: { w: 196.61, h: 262.27, r: 5.5 },
  frontCam: { x: 107.5, y: 4.6, r: 1.3, extra: [{ x: 94.0, y: 4.6, r: 0.9 }, { x: 100.75, y: 4.6, r: 0.9 }, { x: 114.25, y: 4.6, r: 0.6 }] },
  turret: { base: [3.95, 34.31], top: [5.73, 32.54], r: 8.0, rise: 0.78, topRise: 0.12 },
  roundTurret: null,
  lenses: [{ bx: 13.12, y: 13.12, d: 8.83 }, { bx: 13.12, y: 25.14, d: 8.83 }],
  lensRing: 11.4,
  flash: { bx: 25.91, y: 11.02, d: 3.75 },
  lidar: { bx: 25.62, y: 19.1, d: 7.44 },
  rearAls: null,
  rearMic: { bx: 25.91, y: 27.07, d: 2.9 },
  topBtn: { fromRight: 12.72, len: 11.96 },
  vol: { where: 'side', up: 19.54, down: 31.60, len: 10.06 },
  btn: { w: 2.46, protrude: 0.45 },
  bands: { top: [[73.0, 74.5], [141.5, 143.0]], side: [] },
  speakers: { d: 1.76, n: 10, top: [[43.28, 66.37], [148.63, 171.72]], bottom: [[43.28, 66.37], [148.63, 171.72]] },
  usbc: { w: 8.34, h: 2.6 },
  smartConnector: { y: 10.32, pitch: 4.87, d: 3.40, open: 3.90 },
}

export const IPAD_PRO_11: IPadSpec = {
  id: 'ippro11', name: 'iPad Pro 11"',
  px: { w: 1668, h: 2420 },
  body: { w: 177.51, h: 249.70, t: 5.268, cornerR: 13.7, edge: 0.6 },
  active: { w: 160.13, h: 232.32, r: 5.5 },
  // M5: the front camera is on the landscape (right, long) edge, detail F, centred at 124.85.
  frontCam: { x: 177.51 - 4.35, y: 124.85, r: 1.3, extra: [{ x: 177.51 - 4.35, y: 116.20, r: 0.8 }, { x: 177.51 - 4.35, y: 133.50, r: 0.8 }] },
  turret: { base: [4.35, 35.72], top: [6.63, 33.44], r: 7.5, rise: 0.95, topRise: 0.09 },
  roundTurret: null,
  lenses: [{ bx: 14.03, y: 14.03, d: 10.83 }],
  lensRing: 13.2,
  flash: { bx: 26.82, y: 20.04, d: 6.70 },
  lidar: { bx: 14.03, y: 27.02, d: 8.41 },
  rearAls: { bx: 26.82, y: 11.93, d: 3.60 },
  rearMic: { bx: 26.82, y: 27.98, d: 1.72 },
  topBtn: { fromRight: 13.98, len: 12.06 },
  vol: { where: 'side', up: 19.33, down: 31.39, len: 10.06 },
  btn: { w: 2.26, protrude: 0.4 },
  bands: { top: [], side: [[22.17, 23.17], [226.53, 227.53]] },
  speakers: { d: 1.6, n: 14, top: [[35.07, 65.49], [112.02, 142.44]], bottom: [[35.07, 65.49], [112.02, 142.44]] },
  usbc: { w: 8.34, h: 2.6 },
  smartConnector: { y: 12.0, pitch: 5.27, d: 3.40, open: 4.26 },
}
