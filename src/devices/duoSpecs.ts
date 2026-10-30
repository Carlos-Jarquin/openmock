// iPhone Duo measurements, in millimetres, from Apple's "iPhone Duo Dimensional Drawings"
// (8 pages, dated 2026-09-09, title block "iPhone Duo"). Read from the drawing views (pdftoppm
// renders), not from text extraction alone. Scale in the model: 1 unit = 100 mm.
//
// Sheet numbers are the drawing's "SHT n OF 7" (PDF page n+1; PDF page 1 is the cover).
// Front of the closed phone: outer display, hinge on the left (x = 0 at the hinge exterior).
// Open product: inner display, origin at the lower-left exterior.
// Values marked "assumed" are not dimensioned; "keepout" is an accessory keep-out, not the part.

export const DUO = {
  px: {
    inner: { w: 2670, h: 1878 },
    outer: { w: 1398, h: 2034 },
  },
  /** Open, inner-display side. Sheet 4 front view: 164.60 product width, 117.80 product length. */
  open: { w: 164.60, h: 117.80 },
  /** Closed, outer-display side. Sheet 1 front view: 84.10 product width, 117.80 product length. */
  closed: { w: 84.10, h: 117.80 },
  /**
   * Each half's product thickness 5.48 (sheet 1 side view, 2x 5.48 PRODUCT THICKNESS).
   * Closed stack 11.30 PRODUCT THICKNESS (sheet 1). The model's gap is chosen so
   * 2 * (t + gap) = 11.30 with the existing hinge axis at the screen-side of each half.
   */
  t: 5.48,
  closedT: 11.30,
  /** Sheet 1 Detail E / hinge corner: exterior of the closed hinge sits 1.80 past the hinge axis (2x 1.80). */
  hingeOverhang: 1.80,
  /**
   * Free-corner profile, sheet 1 Detail A (all four free corners). Last labelled point is 17.31 mm
   * from the top and 17.30 mm from the free edge; used as the rounded-rect radius (continuous
   * corner; not a true circular arc).
   */
  cornerR: 17.31,
  /** Hinge-corner profile, sheet 1 Detail AY: blend extends 3.72 mm from the top/bottom face. */
  hingeCornerR: 3.72,
  /**
   * Edge chamfer, sheet 1 Detail B (free-edge side profile): 2.74 all around to the start of the
   * flat on the top side of the product. Used as the slab bevel / edge fillet.
   */
  edge: 2.74,
  inner: {
    /** Sheet 4: 3.45 exterior of product to display active area. */
    inset: 3.45,
    /** 164.60 - 2*3.45, 117.80 - 2*3.45. */
    active: { w: 157.70, h: 110.90 },
  },
  outer: {
    /** Sheet 1 front: 1.33 all around, exterior of housing to cover glass (free, top and bottom). */
    glassInset: 1.33,
    /** Sheet 1: 4.13 exterior of hinge to display active area. */
    hingeToActive: 4.13,
    /** Sheet 1: 4.16 exterior of hinge to start of flat. */
    hingeToFlat: 4.16,
    /** Sheet 1: 2.71 all around, exterior of housing to display active area (free/top/bottom). */
    activeInset: 2.71,
    /** Sheet 1: 3.06 all around, exterior of housing to max case occlusion. */
    occlusion: 3.06,
    /** Sheet 1: display active area 77.17 x 112.28; glass 79.93 x 115.04. */
    active: { w: 77.17, h: 112.28 },
    glass: { w: 79.93, h: 115.04 },
  },
  /** Outer front camera, sheet 1 front and sheet 3 Detail M. Centres from the closed hinge (left) and the top. */
  outerCam: { x: 73.39, y: 10.62, keepout: 6.07, lens: 2.98 },
  /**
   * Inner front camera, sheet 4. x from the left exterior of the open product; y from the top.
   * Ø4.32 is the keepout base; the under-display disc is drawn at that size.
   */
  innerCam: { x: 107.25, y: 15.80, d: 4.32 },
  /** Volume buttons on the top edge, sheet 1 front. x is centre from the closed hinge; 2x 10.88 = two buttons of 10.88. */
  vol: {
    downX: 44.35,
    upX: 57.73,
    len: 10.88,
    protrude: 0.45,
  },
  /**
   * Free-edge controls, sheet 1 side view (right side of the closed front). y is centre from the top.
   * 2x 9.34 and 2x 8.55 are half-lengths about the button centreline.
   */
  sideBtn: { cy: 42.87, len: 18.68, protrude: 0.45 },
  cameraControl: { cy: 84.97, len: 17.10, crystal: 15.67, protrude: 0.075 },
  btn: { w: 2.66, protrude: 0.45 },
  /** USB-C on the bottom of the outer-display half, sheet 1 Detail C. x from the hinge. */
  usbc: { x: 42.70, w: 8.59, h: 3.24 },
  /** Bottom speaker holes, sheet 1 Detail C. 8x Ø1.53 ports in two groups of four. */
  speakers: { d: 1.53, x: [17.78, 20.03, 22.29, 24.54, 60.85, 63.10, 65.36, 67.61] },
  /** Bottom screws, sheet 1 Detail C. 4x Ø1.50 (2x 35.35 and 2x 50.04, both halves). */
  screws: { d: 1.50, x: [35.35, 50.04] },
  /** Bottom mics, sheet 1 Detail C. */
  mics: { x: [38.42, 46.99] },
  /**
   * Rear camera plateau. Centres and diameters from sheet 1 Detail D (closed back, free edge on
   * the left) and the side-view rise (3.64 back plate to plateau, 5.72 back plate to rear camera
   * glass). The visible bump is a horizontal stadium with fully rounded ends, as in Apple's
   * product photo; Detail D's 60.58 / 69.37 figures are accessory keep-outs, not the island.
   * bx / y are from the free edge and the top of the closed back.
   */
  plateau: {
    /** Camera 1 and 2 centres, Ø16.20. */
    lens: { d: 16.20, at: [[15.25, 15.25], [32.98, 15.25]] as [number, number][] },
    flash: { bx: 49.58, y: 19.70, d: 3.75 },
    /** Visible slot from the photo and Detail D's 3.32 length; Ø1.50 on the sheet is a keep-out. */
    mic: { bx: 49.58, y: 10.95, w: 3.32, h: 1.05 },
    /**
     * Stadium: left edge 4.94 (Detail D), height 24.20 so the Ø16.20 lenses sit on the
     * centreline at y = 15.25, right end a semicircle about the flash/mic column (49.58).
     */
    w: 56.74,
    h: 24.20,
    bx: 33.31,
    cy: 15.25,
    rise: 3.64,
    glass: 5.72,
  },
  /** Sheet 1 back: logo 16.29 x 20.00, centre 41.40 from the bottom. */
  logo: { w: 16.29, h: 20.00, fromBottom: 41.40 },
  /** Sheet 1 top edge: receiver / front mic slot. Length 13.14, opening 0.25; along-edge position not clearly dimensioned. */
  receiver: { len: 13.14, h: 0.25 },
} as const

/** Gap between the closed halves' screen faces, so 2 * (t + gap) equals the 11.30 mm closed stack. */
export const DUO_GAP_MM = DUO.closedT / 2 - DUO.t

/** Half-width from the hinge axis to the free edge (open product width / 2). */
export const DUO_HALF_W_MM = DUO.open.w / 2
