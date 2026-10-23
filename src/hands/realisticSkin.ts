// Photographic skin for the Elena FF hand (public/hands/elena). Colour, normal, roughness and
// specular are that model's own maps. The material stays MeshPhysicalMaterial so orbit, the
// lighting controls, rect area lights, the studio HDRI and Matte keep working. Matte is detected
// from the specularIntensity uniform (Matte sets it to 0): wrap stays, the warm backlight drops.
import * as THREE from 'three'

export const ELENA_URLS: string[] = [
  '/hands/elena/albedo.webp',
  '/hands/elena/normal.webp',
  '/hands/elena/roughness.webp',
  '/hands/elena/specular.webp',
]

/** SKIN_TONES.fair. The albedo already is a skin colour, so fair leaves it unchanged and the other swatches scale it. */
const FAIR = new THREE.Color('#dfa98a')

export function toneGain(color: string) {
  const c = new THREE.Color(color)
  return new THREE.Color(
    THREE.MathUtils.clamp(c.r / FAIR.r, 0, 1.7),
    THREE.MathUtils.clamp(c.g / FAIR.g, 0, 1.7),
    THREE.MathUtils.clamp(c.b / FAIR.b, 0, 1.7),
  )
}

/** glTF UVs. TextureLoader's default flip would turn the atlas over. */
export function prepareSkinMaps(maps: THREE.Texture[]) {
  const [albedo, normal, roughness, specular] = maps
  albedo.colorSpace = THREE.SRGBColorSpace
  for (const t of [normal, roughness, specular]) t.colorSpace = THREE.NoColorSpace
  for (const t of maps) { t.flipY = false; t.needsUpdate = true }
}

const WRAP = 0.22
const SSS = new THREE.Vector3(0.2, 0.055, 0.025)

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
  return fragment.replace('#include <lights_physical_pars_fragment>', PATCHED_PARS)
}

type SkinShader = { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> }

function compileSkin(shader: SkinShader, kind: 'hand' | 'arm', uniforms: Record<string, { value: unknown }>) {
  Object.assign(shader.uniforms, uniforms, { uWrap: { value: WRAP }, uSSS: { value: SSS } })
  const head = kind === 'hand'
    ? `uniform float uWrap;
uniform vec3 uSSS;
uniform float uFadeFrom;
uniform float uFadeSpan;
uniform float uMaskAmt;
varying float vArm;
float gThin;
float gMask;
`
    : `uniform float uWrap;
uniform vec3 uSSS;
float gThin;
`
  shader.fragmentShader = head + patchMain(shader.fragmentShader)
  const body = kind === 'hand'
    ? `gThin = 0.48;
	gMask = 1.0;
#include <lights_physical_fragment>`
    : `gThin = 0.62;
#include <lights_physical_fragment>`
  if (!shader.fragmentShader.includes('#include <lights_physical_fragment>')) throw new Error('OpenMock skin shader: light body missing')
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', body)
  if (kind === 'hand') {
    shader.vertexShader = `attribute float aArm;\nvarying float vArm;\n` + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvArm = aArm;')
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
gl_FragColor.a *= mix( 1.0, gMask, uMaskAmt ) * ( 1.0 - smoothstep( uFadeFrom, uFadeFrom + uFadeSpan, vArm ) );
if ( gl_FragColor.a < 0.01 ) discard;`,
    )
  }
}

export interface SkinTone { color: string; sheen: string }

function physical(tone: SkinTone, color: THREE.Color, extra: THREE.MeshPhysicalMaterialParameters) {
  const sheen = new THREE.Color(tone.sheen).lerp(new THREE.Color('#fff1ea'), 0.35)
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    // Dry skin. The roughness map still varies the pores, but a high floor keeps the
    // specular lobe from turning the palm glossy under the studio key.
    roughness: 0.94,
    specularIntensity: 0.14,
    ior: 1.4,
    sheen: 0.16,
    sheenRoughness: 0.7,
    sheenColor: sheen,
    clearcoat: 0,
    clearcoatRoughness: 1,
    ...extra,
  })
}

/** Hand atlas. Colour is the model's albedo, nudged by the skin-tone swatch. */
export function realisticHandMaterial(tone: SkinTone, maps: THREE.Texture[]) {
  const [albedo, normal, roughness] = maps
  const fadeFrom = { value: 0.08 }
  const fadeSpan = { value: 0.11 }
  const maskAmt = { value: 0 }
  const mat = physical(tone, toneGain(tone.color), {
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughnessMap: roughness,
  })
  mat.transparent = true
  mat.depthWrite = true
  mat.userData.fadeFrom = fadeFrom
  mat.userData.fadeSpan = fadeSpan
  mat.userData.maskAmt = maskAmt
  mat.onBeforeCompile = (shader) => compileSkin(shader as SkinShader, 'hand', {
    uFadeFrom: fadeFrom,
    uMaskAmt: maskAmt,
    uFadeSpan: fadeSpan,
  })
  mat.customProgramCacheKey = () => 'om-elena-hand-4'
  return mat
}

/** A tiled patch of the hand atlas, so the forearm lathe is the same skin as the hand. */
export const ARM_URLS: string[] = [
  '/hands/elena/forearm-albedo.webp',
  '/hands/elena/forearm-normal.webp',
  '/hands/elena/forearm-roughness.webp',
]

export function prepareArmMaps(maps: THREE.Texture[]) {
  const [albedo, normal, roughness] = maps
  albedo.colorSpace = THREE.SRGBColorSpace
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping
  for (const t of [normal, roughness]) {
    t.colorSpace = THREE.NoColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
  }
  for (const t of maps) { t.flipY = false; t.needsUpdate = true }
}

/** Forearm lathe. Same physical skin as the hand, sampling a pore tile cut from the atlas. */
export function realisticArmMaterial(tone: SkinTone, maps: THREE.Texture[]) {
  const [albedo, normal, roughness] = maps
  const mat = physical(tone, toneGain(tone.color), {
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughnessMap: roughness,
  })
  mat.onBeforeCompile = (shader) => compileSkin(shader as SkinShader, 'arm', {})
  mat.customProgramCacheKey = () => 'om-elena-arm-2'
  return mat
}
