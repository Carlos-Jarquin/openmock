// Photographic skin for the MIT generic-hand mesh. Baked maps (scripts/bake-hands.mjs) carry colour variation,
// pores, creases, thickness and per-pose occlusion. The material stays MeshPhysicalMaterial so orbit, the
// lighting controls, rect area lights, the studio HDRI and Matte keep working. Matte is detected from the
// specularIntensity uniform (Matte sets it to 0): wrap stays, the red backlight drops to about 40%.
import * as THREE from 'three'

export const REALISTIC_URLS = [
  '/hands/realistic/albedo.webp',
  '/hands/realistic/normal.webp',
  '/hands/realistic/surface.webp',
  '/hands/realistic/ao.webp',
  '/hands/realistic/pores.webp',
] as const

/** sRGB albedo; the other maps stay linear. The forearm pore normal tiles, the hand maps do not. */
export function prepareSkinMaps(maps: THREE.Texture[]) {
  const [albedo, normal, surface, ao, pores] = maps
  albedo.colorSpace = THREE.SRGBColorSpace
  for (const t of [normal, surface, ao, pores]) t.colorSpace = THREE.NoColorSpace
  pores.wrapS = pores.wrapT = THREE.RepeatWrapping
  pores.repeat.set(18, 28)
  for (const t of maps) { t.flipY = true; t.needsUpdate = true }
}

/** ao.webp channels: R rest, G grip, B point, A flat. Weights sum to 1. */
export function aoWeights(pose: string, out = new THREE.Vector4()) {
  const w = ((): [number, number, number, number] => {
    switch (pose) {
      case 'right': case 'left': case 'hold': case 'landscape': case 'twohand': case 'bottom': return [0, 1, 0, 0]
      case 'pinch': return [0, 0.7, 0.3, 0]
      case 'tap': case 'swipe': case 'hover': case 'crown': return [0, 0, 1, 0]
      case 'holdtap': return [0, 0.55, 0.45, 0]
      case 'thumb': case 'thumbswipe': case 'type': case 'keys': return [0, 0.85, 0.15, 0]
      case 'zoom': return [0, 0.4, 0.6, 0]
      case 'flat': return [0, 0, 0, 1]
      case 'rest': return [0.65, 0, 0, 0.35]
      case 'wear': return [1, 0, 0, 0]
      default: return [1, 0, 0, 0]
    }
  })()
  return out.set(w[0], w[1], w[2], w[3])
}

const WRAP = 0.28
const SSS = new THREE.Vector3(0.35, 0.08, 0.035)

function patchOnce(src: string, re: RegExp, rep: string, mark: string) {
  const hits = src.match(new RegExp(re.source, 'g'))
  if (!hits || hits.length !== 1) throw new Error(`OpenMock skin shader: expected one match for ${mark}, found ${hits?.length ?? 0}`)
  const out = src.replace(re, rep)
  if (!out.includes(mark)) throw new Error(`OpenMock skin shader: ${mark} patch did not apply`)
  return out
}

/** Wrapped diffuse and a thickness backlight, for both the directional BRDF and rect-area LTC. */
function patchedPars() {
  let src = THREE.ShaderChunk.lights_physical_pars_fragment
  src = patchOnce(
    src,
    /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);/,
    'float skinNdL = dot( geometryNormal, directLight.direction );\n\tfloat dotNL = saturate( skinNdL );',
    'skinNdL',
  )
  src = patchOnce(
    src,
    /reflectedLight\.directDiffuse \+= irradiance \* BRDF_Lambert\( material\.diffuseContribution \) \* \( 1\.0 - F \);/,
    `float skinWrap = saturate( ( skinNdL + uWrap ) / ( 1.0 + uWrap ) );
	reflectedLight.directDiffuse += skinWrap * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
	float skinMatte = mix( 0.4, 1.0, smoothstep( 0.0, 0.08, specularIntensity ) );
	reflectedLight.directDiffuse += uSSS * gThin * skinMatte * saturate( - skinNdL ) * directLight.color * material.diffuseContribution;`,
    'skinMatte',
  )
  src = patchOnce(
    src,
    /reflectedLight\.directDiffuse \+= lightColor \* material\.diffuseContribution \* LTC_Evaluate\( normal, viewDir, position, mat3\( 1\.0 \), rectCoords \);/,
    `vec3 skinLtc = LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * skinLtc;
		float skinMatteR = mix( 0.4, 1.0, smoothstep( 0.0, 0.08, specularIntensity ) );
		reflectedLight.directDiffuse += lightColor * uSSS * gThin * skinMatteR * 0.65 * material.diffuseContribution * LTC_Evaluate( - normal, viewDir, position, mat3( 1.0 ), rectCoords );`,
    'skinMatteR',
  )
  return src
}

const PATCHED_PARS = patchedPars()

function patchMain(fragment: string) {
  if (!fragment.includes('#include <lights_physical_pars_fragment>')) throw new Error('OpenMock skin shader: physical light chunk missing')
  let out = fragment.replace('#include <lights_physical_pars_fragment>', PATCHED_PARS)
  const td = 'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;'
  if (!out.includes(td)) throw new Error('OpenMock skin shader: totalDiffuse missing')
  out = out.replace(td, 'vec3 totalDiffuse = ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse ) * gCavity;')
  return out
}

type SkinShader = { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> }

function compileSkin(shader: SkinShader, kind: 'hand' | 'arm', uniforms: Record<string, { value: unknown }>) {
  Object.assign(shader.uniforms, uniforms, { uWrap: { value: WRAP }, uSSS: { value: SSS } })
  const handHead = `uniform float uWrap;
uniform vec3 uSSS;
uniform vec4 uAOMix;
uniform float uFadeFrom;
uniform float uMaskAmt;
uniform sampler2D tSurface;
uniform sampler2D tAO;
varying float vArm;
float gThin;
float gMask;
float gCavity;
`
  const armHead = `uniform float uWrap;
uniform vec3 uSSS;
float gThin;
float gCavity;
`
  shader.fragmentShader = (kind === 'hand' ? handHead : armHead) + patchMain(shader.fragmentShader)
  const handBody = `gThin = 0.55;
	gMask = 1.0;
	gCavity = 1.0;
#ifdef USE_MAP
	{
		vec4 surf = texture2D( tSurface, vMapUv );
		gThin = surf.r;
		gMask = surf.b;
		vec4 aoTex = texture2D( tAO, vMapUv );
		gCavity = mix( 1.0, dot( aoTex, uAOMix ), 0.55 );
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.0, 0.86, 0.82 ), ( 1.0 - gThin ) * 0.16 );
	}
#endif
#include <lights_physical_fragment>`
  const armBody = `gThin = 0.75;
	gCavity = 1.0;
#include <lights_physical_fragment>`
  if (!shader.fragmentShader.includes('#include <lights_physical_fragment>')) throw new Error('OpenMock skin shader: light body missing')
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', kind === 'hand' ? handBody : armBody)
  if (kind === 'hand') {
    shader.vertexShader = `attribute float aArm;\nvarying float vArm;\n` + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvArm = aArm;')
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
gl_FragColor.a *= mix( 1.0, gMask, uMaskAmt ) * ( 1.0 - smoothstep( uFadeFrom, 0.19, vArm ) );
if ( gl_FragColor.a < 0.01 ) discard;`,
    )
  }
}

export interface SkinTone { color: string; sheen: string }

function physical(tone: SkinTone, extra: THREE.MeshPhysicalMaterialParameters) {
  const sheen = new THREE.Color(tone.sheen).lerp(new THREE.Color('#fff3ec'), 0.45)
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tone.color),
    metalness: 0,
    specularIntensity: 0.26,
    ior: 1.4,
    sheen: 0.46,
    sheenRoughness: 0.58,
    sheenColor: sheen,
    clearcoat: 0.045,
    clearcoatRoughness: 0.5,
    ...extra,
  })
}

/** Hand atlas: albedo × skin tone, tangent normal, roughness in surface.g, pose AO, wrist mask in surface.b. */
export function realisticHandMaterial(tone: SkinTone, maps: THREE.Texture[]) {
  const [albedo, normal, surface, ao] = maps
  const aoMix = new THREE.Vector4(1, 0, 0, 0)
  const fadeFrom = { value: 0.08 }
  const maskAmt = { value: 0 }
  const mat = physical(tone, {
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 1,
    roughnessMap: surface,
  })
  mat.transparent = true
  mat.depthWrite = true
  mat.userData.aoMix = aoMix
  mat.userData.fadeFrom = fadeFrom
  mat.userData.maskAmt = maskAmt
  mat.onBeforeCompile = (shader) => compileSkin(shader as SkinShader, 'hand', {
    uAOMix: { value: aoMix },
    uFadeFrom: fadeFrom,
    uMaskAmt: maskAmt,
    tSurface: { value: surface },
    tAO: { value: ao },
  })
  mat.customProgramCacheKey = () => 'om-skin-hand-3'
  return mat
}

/** Forearm: the lathe unwrap does not match the hand atlas, so it gets the tiled pore normal and a constant thickness. */
export function realisticArmMaterial(tone: SkinTone, pores: THREE.Texture) {
  const mat = physical(tone, {
    normalMap: pores,
    normalScale: new THREE.Vector2(0.035, 0.035),
    roughness: 0.58,
  })
  mat.onBeforeCompile = (shader) => compileSkin(shader as SkinShader, 'arm', {})
  mat.customProgramCacheKey = () => 'om-skin-arm-4'
  return mat
}
