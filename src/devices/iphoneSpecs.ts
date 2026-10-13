// Pure data: iPhone 18 Pro and 18 Pro Max measurements, in millimetres, from Apple's
// "iPhone 18 Pro Dimensional Drawings" and "iPhone 18 Pro Max Dimensional Drawings" (both dated 2026-09-09,
// developer.apple.com/accessories/dimensional-drawings). Pixel sizes from apple.com/iphone-18-pro/specs.
// Front coordinates: y from the top edge, x from the left edge seen from the front.
// Back coordinates (bx): x from the left edge of the back view, which is the right side seen from the front.
// Values marked "measured" were scaled off the drawing (about +/-0.3 mm), "assumed" are not in the drawing.

export interface IPhoneSpec {
  id: string
  name: string
  px: { w: number; h: number }
  body: { w: number; h: number; t: number; cornerR: number; edge: number }
  glass: { w: number; h: number }
  active: { w: number; h: number; inset: number }
  island: { w: number; h: number; r: number; cy: number }
  /** front camera lens inside the island: not dimensioned, assumed in the right-hand cap */
  frontCam: { r: number }
  receiver: { w: number; h: number; cy: number }
  /** antenna split bands on both long sides, [from, to] from the top. Measured off the side view. */
  antennaBands: [number, number][]
  plateau: { bottom: number; rise: number; shoulder: number; cornerR: number; bottomR: number; topInset: number; topBottom: number; topR: number }
  backGlass: { top: number; topR: number }
  lens: { d: number; rise: number; at: [number, number][] }
  flash: { bx: number; y: number; d: number }
  sensor: { bx: number; y: number; d: number }
  rearMic: { bx: number; y: number; d: number }
  /** left side seen from the front: centre y and length */
  action: { cy: number; len: number }
  volUp: { cy: number; len: number }
  volDown: { cy: number; len: number }
  /** right side */
  sideBtn: { cy: number; len: number }
  btn: { w: number; protrude: number }
  cameraControl: { cy: number; len: number; w: number; keepW: number; keepLen: number }
  sim: { cy: number; len: number; w: number }
  usbc: { cx: number; w: number; h: number }
  holes: { d: number; x: number[] }
  screws: { d: number; x: number[] }
  logo: { bx: number; cy: number; w: number; h: number }
}

export const IPHONE_18_PRO: IPhoneSpec = {
  id: 'ip18', name: 'iPhone 18 Pro',
  px: { w: 1206, h: 2622 },
  body: { w: 71.85, h: 150.01, t: 8.75, cornerR: 11.82, edge: 2.61 },
  glass: { w: 69.45, h: 147.61 },
  active: { w: 66.57, h: 144.73, inset: 2.64 },
  island: { w: 15.68, h: 6.07, r: 2.93, cy: 7.99 },
  frontCam: { r: 1.45 },
  receiver: { w: 28.85, h: 0.45, cy: 1.37 },
  antennaBands: [[15.47, 16.94], [133.14, 134.61]],
  plateau: { bottom: 43.0, rise: 2.78, shoulder: 5.05, cornerR: 11.81, bottomR: 8.0, topInset: 4.8, topBottom: 42.0, topR: 9.5 },
  backGlass: { top: 58.01, topR: 12.0 },
  lens: { d: 16.58, rise: 2.11, at: [[14.37, 14.37], [14.37, 33.61], [32.49, 23.99]] },
  flash: { bx: 58.03, y: 13.82, d: 6.90 },
  sensor: { bx: 58.03, y: 34.16, d: 6.90 },
  rearMic: { bx: 58.03, y: 23.99, d: 1.15 },
  action: { cy: 34.28, len: 6.90 },
  volUp: { cy: 48.43, len: 11.20 },
  volDown: { cy: 62.63, len: 11.20 },
  sideBtn: { cy: 55.53, len: 17.70 },
  btn: { w: 2.66, protrude: 0.45 },
  cameraControl: { cy: 98.40, len: 17.10, w: 3.03, keepW: 3.40, keepLen: 17.50 },
  sim: { cy: 111.97, len: 19.44, w: 2.56 },
  usbc: { cx: 35.92, w: 9.00, h: 3.14 },
  holes: { d: 1.53, x: [15.40, 17.65, 19.91, 22.16, 24.42, 47.43, 49.69, 51.94, 54.20, 56.45] },
  screws: { d: 1.50, x: [29.00, 42.85] },
  logo: { bx: 36.03, cy: 91.20, w: 16.32, h: 20.04 },
}

export const IPHONE_18_PRO_MAX: IPhoneSpec = {
  id: 'ip18max', name: 'iPhone 18 Pro Max',
  px: { w: 1320, h: 2868 },
  body: { w: 77.98, h: 163.43, t: 8.75, cornerR: 11.96, edge: 2.56 },
  glass: { w: 75.58, h: 161.03 },
  active: { w: 72.86, h: 158.31, inset: 2.56 },
  island: { w: 15.68, h: 6.07, r: 2.93, cy: 7.91 },
  frontCam: { r: 1.45 },
  receiver: { w: 26.58, h: 0.46, cy: 1.37 },
  antennaBands: [[15.47, 16.94], [146.49, 147.96]],
  plateau: { bottom: 43.0, rise: 2.78, shoulder: 5.4, cornerR: 11.70, bottomR: 8.0, topInset: 4.8, topBottom: 42.0, topR: 9.5 },
  backGlass: { top: 58.01, topR: 14.0 },
  lens: { d: 16.58, rise: 2.11, at: [[14.37, 14.37], [14.37, 33.61], [32.49, 23.99]] },
  flash: { bx: 64.16, y: 13.82, d: 6.90 },
  sensor: { bx: 64.16, y: 34.16, d: 6.90 },
  rearMic: { bx: 64.16, y: 23.99, d: 1.15 },
  action: { cy: 34.28, len: 6.90 },
  volUp: { cy: 48.43, len: 11.20 },
  volDown: { cy: 62.63, len: 11.20 },
  sideBtn: { cy: 55.53, len: 17.70 },
  btn: { w: 2.66, protrude: 0.45 },
  cameraControl: { cy: 111.82, len: 17.10, w: 3.03, keepW: 3.40, keepLen: 17.50 },
  sim: { cy: 125.38, len: 19.60, w: 2.56 },
  usbc: { cx: 38.99, w: 9.00, h: 3.14 },
  holes: { d: 1.53, x: [15.40, 17.65, 19.91, 22.16, 24.42, 26.67, 51.30, 53.56, 55.81, 58.07, 60.32, 62.58] },
  screws: { d: 1.50, x: [32.06, 45.91] },
  logo: { bx: 39.10, cy: 97.51, w: 16.32, h: 20.04 },
}
