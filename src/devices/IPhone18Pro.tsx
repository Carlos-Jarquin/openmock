import { memo } from 'react'
import type { DeviceProps } from '../types'
import IPhonePro, { IP18_FINISHES } from './IPhonePro'
import { IPHONE_18_PRO, IPHONE_18_PRO_MAX } from './iphoneSpecs'
// iPhone 18 Pro and 18 Pro Max: thin wrappers over the parametric IPhonePro component.
export { IP18_FINISHES }
export const IP18_PX = IPHONE_18_PRO.px
export const IP18_ASPECT = IP18_PX.w / IP18_PX.h
export const IP18MAX_PX = IPHONE_18_PRO_MAX.px
export const IP18MAX_ASPECT = IP18MAX_PX.w / IP18MAX_PX.h
function IPhone18Pro(p: DeviceProps) { return <IPhonePro spec={IPHONE_18_PRO} {...p} /> }
function IPhone18ProMax(p: DeviceProps) { return <IPhonePro spec={IPHONE_18_PRO_MAX} {...p} /> }
export const IPhone18ProMaxDevice = memo(IPhone18ProMax)
export default memo(IPhone18Pro)
