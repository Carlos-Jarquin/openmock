import type { DeviceDef } from '../types'
import Duo, { INNER_ASPECT, OUTER_ASPECT, FINISHES } from './Duo'
import IPhone18Pro, { IP18_ASPECT, IP18_FINISHES, IP18_PX, IP18MAX_ASPECT, IP18MAX_PX, IPhone18ProMaxDevice } from './IPhone18Pro'
import { IPadMini, IPadPro13, IPadPro11, IPMINI_ASPECT, IPMINI_PX, IPPRO13_ASPECT, IPPRO13_PX, IPPRO11_ASPECT, IPPRO11_PX, IPAD_MINI_FINISHES, IPAD_PRO_FINISHES, IPAD_PRO6_FINISHES } from './IPads'
import MacBookPro, { MBP_ASPECT, MBP_FINISHES, MBP } from './MacBookPro'
import IMacG4, { IMAC_ASPECT, IMAC_FINISHES, IMAC } from './IMacG4'
import WatchUltra, { WATCH_ASPECT, WATCH_FINISHES, WATCH } from './WatchUltra'
import AppleTV, { ATV_FINISHES } from './AppleTV'
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
  { id: 'mbp16', label: 'MacBook Pro 16"', screenAspect: MBP_ASPECT, finishes: MBP_FINISHES, defaultFinish: 'spacegrey', nativePx: MBP.px, logoSpot: true, Component: MacBookPro },
  { id: 'imacg4', label: 'iMac G4 20"', screenAspect: IMAC_ASPECT, finishes: IMAC_FINISHES, defaultFinish: 'white', nativePx: IMAC.px, logoSpot: true, Component: IMacG4 },
  { id: 'watchu', label: 'Apple Watch Ultra 4', screenAspect: WATCH_ASPECT, finishes: WATCH_FINISHES, defaultFinish: 'natural', nativePx: WATCH.px, Component: WatchUltra },
  { id: 'atv4k', label: 'Apple TV 4K', screenAspect: 16 / 9, finishes: ATV_FINISHES, defaultFinish: 'black', logoSpot: true, noScreen: true, Component: AppleTV },
  { id: 'phone', label: 'Phone', screenAspect: PHONE_ASPECT, Component: Phone },
  { id: 'browser', label: 'Browser', screenAspect: BROWSER_ASPECT, Component: BrowserFrame },
]
