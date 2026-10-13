import { memo, useMemo } from 'react'
import { RoundedBox } from '@react-three/drei'
import type { DeviceProps } from '../types'
import { fitTexture, screenGeometry } from './shared'
const W = 2.4, BAR = 0.12, SH = 1.4, D = 0.03
export const BROWSER_ASPECT = W / SH
function BrowserFrame({ texture, mediaAspect }: DeviceProps) {
  const geo = useMemo(() => screenGeometry(W - 0.002, SH, 0.0005), [])
  useMemo(() => fitTexture(texture, mediaAspect, BROWSER_ASPECT), [texture, mediaAspect])
  const H = SH + BAR
  return (
    <group>
      <RoundedBox args={[W + 0.01, H + 0.01, D]} radius={0.012} smoothness={4} castShadow>
        <meshStandardMaterial color="#e9e9ec" roughness={0.6} />
      </RoundedBox>
      <mesh position={[0, H / 2 - BAR / 2, D / 2 + 0.001]}>
        <planeGeometry args={[W, BAR]} />
        <meshBasicMaterial color="#f3f3f5" />
      </mesh>
      {['#ff5f57', '#febc2e', '#28c840'].map((c, i) => (
        <mesh key={c} position={[-W / 2 + 0.07 + i * 0.055, H / 2 - BAR / 2, D / 2 + 0.002]}>
          <circleGeometry args={[0.018, 24]} /><meshBasicMaterial color={c} />
        </mesh>
      ))}
      <RoundedBox args={[0.9, 0.06, 0.002]} radius={0.0009} position={[0, H / 2 - BAR / 2, D / 2 + 0.002]}>
        <meshBasicMaterial color="#e2e2e6" />
      </RoundedBox>
      <mesh geometry={geo} position={[0, -BAR / 2, D / 2 + 0.002]}>
        {texture ? <meshBasicMaterial key="tex" color="#ffffff" map={texture} toneMapped={false} /> : <meshBasicMaterial color="#ffffff" />}
      </mesh>
    </group>
  )
}
export default memo(BrowserFrame)
