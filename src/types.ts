import type { ReactElement } from 'react'
import type * as THREE from 'three'
export type DeviceId = 'duo' | 'phone' | 'browser'
export type Finish = 'night' | 'star'
export interface LogoArt { mask: THREE.Texture; aspect: number }
export interface DeviceOptions { fold: number; screen: 'inner' | 'outer'; finish: Finish; logo: LogoArt | null; logoSize: number; logoTint: string }
export interface DeviceProps { texture: THREE.Texture | null; mediaAspect: number; opts: DeviceOptions }
export interface DeviceDef { id: DeviceId; label: string; screenAspect: number | ((o: DeviceOptions) => number); foldable?: boolean; Component: (p: DeviceProps) => ReactElement }
