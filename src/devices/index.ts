import type { DeviceDef } from '../types'
import Duo, { INNER_ASPECT, OUTER_ASPECT, FINISHES } from './Duo'
import IPhone18Pro, { IP18_ASPECT, IP18_FINISHES, IP18_PX, IP18MAX_ASPECT, IP18MAX_PX, IPhone18ProMaxDevice } from './IPhone18Pro'
import { IPadMini, IPadPro13, IPadPro11, IPMINI_ASPECT, IPMINI_PX, IPPRO13_ASPECT, IPPRO13_PX, IPPRO11_ASPECT, IPPRO11_PX, IPAD_MINI_FINISHES, IPAD_PRO_FINISHES, IPAD_PRO6_FINISHES } from './IPads'
import Phone, { PHONE_ASPECT } from './Phone'
import BrowserFrame, { BROWSER_ASPECT } from './BrowserFrame'
// Add a device: build a component taking DeviceProps and register it here.
export const DEVICES: DeviceDef[] = [
  { id: 'ip18', label: 'iPhone 18 Pro', screenAspect: IP18_ASPECT, finishes: IP18_FINISHES, defaultFinish: 'silver', nativePx: IP18_PX, logoSpot: true, Component: IPhone18Pro },
  { id: 'ip18max', label: 'iPhone 18 Pro Max', screenAspect: IP18MAX_ASPECT, finishes: IP18_FINISHES, defaultFinish: 'silver', nativePx: IP18MAX_PX, logoSpot: true, Component: IPhone18ProMaxDevice },
  { id: 'duo', label: 'iPhone Duo', foldable: true, finishes: FINISHES, defaultFinish: 'night', logoSpot: true, screenAspect: o => (o.screen === 'inner' ? INNER_ASPECT : OUTER_ASPECT), Component: Duo },
  { id: 'ipmini', label: 'iPad mini', screenAspect: IPMINI_ASPECT, finishes: IPAD_MINI_FINISHES, defaultFinish: 'spacegrey', nativePx: IPMINI_PX, logoSpot: true, Component: IPadMini },
  { id: 'ippro11', label: 'iPad Pro 11"', screenAspect: IPPRO11_ASPECT, finishes: IPAD_PRO_FINISHES, defaultFinish: 'silver', nativePx: IPPRO11_PX, logoSpot: true, Component: IPadPro11 },
  { id: 'ippro13', label: 'iPad Pro 12.9"', screenAspect: IPPRO13_ASPECT, finishes: IPAD_PRO6_FINISHES, defaultFinish: 'silver', nativePx: IPPRO13_PX, logoSpot: true, Component: IPadPro13 },
  { id: 'phone', label: 'Phone', screenAspect: PHONE_ASPECT, Component: Phone },
  { id: 'browser', label: 'Browser', screenAspect: BROWSER_ASPECT, Component: BrowserFrame },
]
