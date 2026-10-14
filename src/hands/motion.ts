// Hand motion layer. The solver jumps each bone straight to a new pose (a fresh IK solve per frame or per change), which
// reads as stiff. This keeps a displayed pose per bone and springs it toward the solved one: quaternion springs
// (slerp-style, about the shortest axis), slightly underdamped further down each finger so the fingers lag the hand a
// touch and settle with mild follow-through, plus drag from the hand's own turning. When everything has settled the
// display is exactly the solve, so a landed contact stays where the solver put it. Optional idle micro-motion.
import * as THREE from 'three'

export type IdleLevel = 'off' | 'low' | 'medium'
export const IDLE_LEVELS: [IdleLevel, string][] = [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium']]
const IDLE_AMP: Record<IdleLevel, number> = { off: 0, low: 0.035, medium: 0.08 }

interface St { o: THREE.Object3D; tq: THREE.Quaternion; tp: THREE.Vector3; w: THREE.Vector3; v: THREE.Vector3; rest?: THREE.Quaternion; depth: number; phase: number; idle: boolean }
// natural frequency (rad/s) and damping ratio by depth: 0 hand, 1 metacarpal, 2 proximal, 3 middle, 4 distal and tip
const OMEGA = [15, 16, 13, 11.5, 10.5], ZETA = [0.95, 0.9, 0.72, 0.66, 0.62], DRAG = [0, 0.1, 0.22, 0.32, 0.4]
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pw = new THREE.Quaternion(), _e = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3()

const depthOf = (name: string) => name === '' ? 0 : name.endsWith('metacarpal') ? 1 : name.endsWith('proximal') ? 2 : name.endsWith('intermediate') ? 3 : name.includes('distal') || name.endsWith('tip') ? (name.startsWith('thumb') && name.includes('distal') ? 3 : 4) : 1
/** Rotation vector (axis * angle) of q, shortest way round. */
function rotVec(q: THREE.Quaternion, out: THREE.Vector3) {
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
  const s = Math.sqrt(1 - Math.min(1, q.w * q.w)), a = 2 * Math.acos(Math.min(1, q.w))
  return s < 1e-6 ? out.set(q.x * 2, q.y * 2, q.z * 2) : out.set(q.x / s * a, q.y / s * a, q.z / s * a)
}
function fromRotVec(v: THREE.Vector3, out: THREE.Quaternion) { const a = v.length(); return a < 1e-9 ? out.identity() : out.setFromAxisAngle(_d.copy(v).divideScalar(a), a) }

export class HandMotion {
  st: St[] = []
  root: THREE.Object3D | null = null
  arm: THREE.Object3D | null = null
  armRel = new THREE.Matrix4()
  prevRoot = new THREE.Quaternion()
  settled = true
  /** Call right after a solve: the bones now hold the target. Records it and puts the displayed pose back. */
  capture(root: THREE.Object3D, bones: Record<string, THREE.Bone>, rest: Record<string, { q: THREE.Quaternion }>, touching: Set<string>, arm: THREE.Object3D | null, animate: boolean) {
    const fresh = this.root !== root || !animate
    if (fresh) { this.st = []; this.root = root; this.prevRoot.copy(root.quaternion) }
    const list: [THREE.Object3D, string][] = [[root, ''], ...Object.entries(bones).map(([n, b]) => [b, n] as [THREE.Object3D, string])]
    const old = new Map(this.st.map(s => [s.o, s]))
    this.st = list.map(([o, n], i) => {
      const s = old.get(o) ?? { o, tq: new THREE.Quaternion(), tp: new THREE.Vector3(), w: new THREE.Vector3(), v: new THREE.Vector3(), depth: depthOf(n), phase: i * 1.7, idle: false, rest: n ? rest[n]?.q : undefined }
      s.tq.copy(o.quaternion); s.tp.copy(o.position); s.idle = !!n && !touching.has(n.split('-').slice(0, n.startsWith('thumb') ? 1 : 2).join('-'))
      return s
    })
    this.arm = arm
    if (arm) { root.updateMatrix(); arm.updateMatrix(); this.armRel.copy(root.matrix).invert().multiply(arm.matrix) }
    if (!fresh) this.restore()
    this.settled = false
  }
  /** Displayed pose before a solve overwrote it (kept so capture can restore it). */
  snapshot() { for (const s of this.st) { const x = s as St & { dq?: THREE.Quaternion; dp?: THREE.Vector3 }; (x.dq ??= new THREE.Quaternion()).copy(s.o.quaternion); (x.dp ??= new THREE.Vector3()).copy(s.o.position) } }
  restore() { for (const s of this.st) { const x = s as St & { dq?: THREE.Quaternion; dp?: THREE.Vector3 }; if (x.dq) { s.o.quaternion.copy(x.dq); s.o.position.copy(x.dp!) } } }
  /** Returns true when the pose on screen changed this frame. */
  step(dt: number, time: number, idle: IdleLevel): boolean {
    if (!this.root || (this.settled && idle === 'off')) return false
    dt = Math.min(dt, 1 / 30)
    const amp = IDLE_AMP[idle]
    // the hand's own turn this frame, which the fingers resist a little (drag)
    _q.copy(this.prevRoot).invert().premultiply(this.root.quaternion); rotVec(_q, _e); const turn = _e.clone()
    let moving = false
    for (const s of this.st) {
      const k = Math.min(s.depth, 4), om = OMEGA[k], ze = ZETA[k]
      // target, with idle breathing toward the open rest pose for digits that are not touching
      _q2.copy(s.tq)
      if (amp && s.idle && s.rest) _q2.slerp(s.rest, amp * (0.5 + 0.5 * Math.sin(time * 1.3 + s.phase)) * (k / 4))
      // drag: in this bone's parent frame, turn a fraction of the hand's turn back
      if (k > 0 && DRAG[k] && turn.lengthSq() > 1e-10) {
        s.o.parent!.getWorldQuaternion(_pw); this.root.parent ? this.root.parent.getWorldQuaternion(_q) : _q.identity()
        _v.copy(turn).applyQuaternion(_q).applyQuaternion(_pw.invert()).multiplyScalar(-DRAG[k])
        s.o.quaternion.premultiply(fromRotVec(_v, _q))
      }
      // quaternion spring toward the target
      _q.copy(s.o.quaternion).invert().premultiply(_q2); rotVec(_q, _e)
      s.w.addScaledVector(_e, om * om * dt).multiplyScalar(Math.max(0, 1 - 2 * ze * om * dt))
      s.o.quaternion.premultiply(fromRotVec(_v.copy(s.w).multiplyScalar(dt), _q)).normalize()
      // position spring (the hand root mostly; bone offsets barely change)
      _v.copy(s.tp).sub(s.o.position)
      s.v.addScaledVector(_v, om * om * dt).multiplyScalar(Math.max(0, 1 - 2 * ze * om * dt))
      s.o.position.addScaledVector(s.v, dt)
      const err = _e.length() + _v.length() * 20, vel = s.w.length() * 0.05 + s.v.length()
      if (err < 2e-4 && vel < 2e-4 && !amp) { s.o.quaternion.copy(s.tq); s.o.position.copy(s.tp); s.w.set(0, 0, 0); s.v.set(0, 0, 0) } else moving = true
    }
    this.prevRoot.copy(this.root.quaternion)
    if (this.arm) { this.root.updateMatrix(); this.arm.matrix.multiplyMatrices(this.root.matrix, this.armRel); this.arm.matrix.decompose(this.arm.position, this.arm.quaternion, this.arm.scale) }
    this.root.updateMatrixWorld(true)
    this.settled = !moving
    return true
  }
}
