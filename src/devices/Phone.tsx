import { memo, useMemo } from 'react'
import { RoundedBox } from '@react-three/drei'
import type { DeviceProps } from '../types'
import { fitTexture, screenGeometry } from './shared'
// Procedural phone, original geometry (no third-party model).
const W = 0.78, H = 1.62, D = 0.085, SW = 0.73, SH = 1.57
export const PHONE_ASPECT = SW / SH
function Phone({ texture, mediaAspect }: DeviceProps) {
  const geo = useMemo(() => screenGeometry(SW, SH, 0.1), [])
  useMemo(() => fitTexture(texture, mediaAspect, PHONE_ASPECT), [texture, mediaAspect])
  return (
    <group>
      <RoundedBox args={[W, H, D]} radius={0.04} smoothness={6} castShadow>
        <meshStandardMaterial color="#2a2b2f" metalness={0.8} roughness={0.3} />
      </RoundedBox>
      <mesh position={[0, 0, D / 2 + 0.0005]}>
        <planeGeometry args={[W - 0.02, H - 0.02]} />
        <meshStandardMaterial color="#050506" roughness={0.2} />
      </mesh>
      <mesh geometry={geo} position={[0, 0, D / 2 + 0.001]}>
        {texture ? <meshBasicMaterial key="tex" color="#ffffff" map={texture} toneMapped={false} /> : <meshBasicMaterial color="#1c1d22" />}
      </mesh>
      <RoundedBox args={[0.2, 0.058, 0.004]} radius={0.0019} position={[0, SH / 2 - 0.06, D / 2 + 0.003]}>
        <meshBasicMaterial color="#000" />
      </RoundedBox>
      {[0.32, 0.18, 0.08].map((y, i) => (
        <RoundedBox key={i} args={[0.012, i === 0 ? 0.06 : 0.1, 0.03]} radius={0.005} position={[-W / 2 - 0.003, y + 0.2, 0]}>
          <meshStandardMaterial color="#2a2b2f" metalness={0.8} roughness={0.3} />
        </RoundedBox>
      ))}
    </group>
  )
}
export default memo(Phone)
