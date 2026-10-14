// Live mechanism state per device (MacBook lid, iMac G4 stand): the timeline writes interpolated values here every
// frame and the device reads them in its own frame loop, so playback never goes through React state.
// null: follow the device options.
const live = new Map<string, { tl: number[] | null }>()
export const mechLiveFor = (uid = '') => { let m = live.get(uid); if (!m) live.set(uid, m = { tl: null }); return m }
/** Defaults: lid open 110 degrees; iMac display tilted back 8 degrees, stand at 45% of its height range. */
export const LID0 = 110, TILT0 = 8, RISE0 = 0.45
export const LID_RANGE: [number, number] = [0, 135], TILT_RANGE: [number, number] = [-5, 30]
