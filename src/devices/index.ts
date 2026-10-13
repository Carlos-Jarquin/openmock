import type { DeviceDef } from '../types'
import Duo, { INNER_ASPECT, OUTER_ASPECT, FINISHES } from './Duo'
import IPhone18Pro, { IP18_ASPECT, IP18_FINISHES, IP18_PX, IP18MAX_ASPECT, IP18MAX_PX, IPhone18ProMaxDevice } from './IPhone18Pro'
import Phone, { PHONE_ASPECT } from './Phone'
import BrowserFrame, { BROWSER_ASPECT } from './BrowserFrame'
// Add a device: build a component taking DeviceProps and register it here.
export const DEVICES: DeviceDef[] = [
  { id: 'ip18', label: 'iPhone 18 Pro', screenAspect: IP18_ASPECT, finishes: IP18_FINISHES, defaultFinish: 'silver', nativePx: IP18_PX, logoSpot: true, Component: IPhone18Pro },
  { id: 'ip18max', label: 'iPhone 18 Pro Max', screenAspect: IP18MAX_ASPECT, finishes: IP18_FINISHES, defaultFinish: 'silver', nativePx: IP18MAX_PX, logoSpot: true, Component: IPhone18ProMaxDevice },
  { id: 'duo', label: 'iPhone Duo', foldable: true, finishes: FINISHES, defaultFinish: 'night', logoSpot: true, screenAspect: o => (o.screen === 'inner' ? INNER_ASPECT : OUTER_ASPECT), Component: Duo },
  { id: 'phone', label: 'Phone', screenAspect: PHONE_ASPECT, Component: Phone },
  { id: 'browser', label: 'Browser', screenAspect: BROWSER_ASPECT, Component: BrowserFrame },
]
