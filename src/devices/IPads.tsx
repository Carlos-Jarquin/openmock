import { memo } from 'react'
import type { DeviceProps } from '../types'
import IPad, { IPAD_MINI_FINISHES, IPAD_PRO_FINISHES, IPAD_PRO6_FINISHES } from './IPad'
import { IPAD_MINI, IPAD_PRO_11, IPAD_PRO_129 } from './ipadSpecs'
// iPad mini, iPad Pro 12.9" and iPad Pro 11": thin wrappers over the parametric IPad component.
export { IPAD_MINI_FINISHES, IPAD_PRO_FINISHES, IPAD_PRO6_FINISHES }
export const IPMINI_PX = IPAD_MINI.px, IPPRO13_PX = IPAD_PRO_129.px, IPPRO11_PX = IPAD_PRO_11.px
export const IPMINI_ASPECT = IPMINI_PX.w / IPMINI_PX.h
export const IPPRO13_ASPECT = IPPRO13_PX.w / IPPRO13_PX.h
export const IPPRO11_ASPECT = IPPRO11_PX.w / IPPRO11_PX.h
export const IPadMini = memo((p: DeviceProps) => <IPad spec={IPAD_MINI} {...p} />)
export const IPadPro13 = memo((p: DeviceProps) => <IPad spec={IPAD_PRO_129} {...p} />)
export const IPadPro11 = memo((p: DeviceProps) => <IPad spec={IPAD_PRO_11} {...p} />)
