import type { ComponentType } from 'react'
import type * as THREE from 'three'
export type DeviceId = 'ip18' | 'duo' | 'phone' | 'browser'
export type Finish = string
export interface LogoArt { mask: THREE.Texture; aspect: number }
export interface DeviceOptions { fold: number; screen: 'inner' | 'outer'; finish: Finish; logo: LogoArt | null; logoSize: number; logoTint: string; simTray: boolean }
export interface DeviceProps { texture: THREE.Texture | null; mediaAspect: number; opts: DeviceOptions }
export interface DeviceDef { id: DeviceId; label: string; screenAspect: number | ((o: DeviceOptions) => number); foldable?: boolean; finishes?: Record<string, { label: string }>; defaultFinish?: string; nativePx?: { w: number; h: number }; logoSpot?: boolean; Component: ComponentType<DeviceProps> }
