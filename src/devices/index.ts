import type { DeviceDef } from '../types'
import Duo, { INNER_ASPECT, OUTER_ASPECT } from './Duo'
import Phone, { PHONE_ASPECT } from './Phone'
import BrowserFrame, { BROWSER_ASPECT } from './BrowserFrame'
// Add a device: build a component taking DeviceProps and register it here.
export const DEVICES: DeviceDef[] = [
  { id: 'duo', label: 'iPhone Duo', foldable: true, screenAspect: o => (o.screen === 'inner' ? INNER_ASPECT : OUTER_ASPECT), Component: Duo },
  { id: 'phone', label: 'Phone', screenAspect: PHONE_ASPECT, Component: Phone },
  { id: 'browser', label: 'Browser', screenAspect: BROWSER_ASPECT, Component: BrowserFrame },
]
