// Studio hand. The colour is a Cycles bake of Elena's mesh graded to a light peach
// (public/hands/elena/studio.webp), with pores, creases and nails kept at a lower
// contrast than Realistic. It does not read the scene lights, the HDRI, or the
// lighting controls. A warm rim stands in for light through the thin edges. The
// forearm is the same lathe as Realistic, unlit, and fades out over most of its length.
import * as THREE from 'three'
import { toneGain, type SkinTone } from './realisticSkin'

export const STUDIO_URL = '/hands/elena/studio.webp?v=6'

export function prepareStudioMap(map: THREE.Texture) {
  map.colorSpace = THREE.SRGBColorSpace
  map.flipY = false
  map.needsUpdate = true
}

const STUDIO_HEAD = `attribute float aArm;
varying float vArm;
varying vec3 vStudioN;
varying vec3 vStudioW;
`
const STUDIO_VERT = `#include <project_vertex>
vStudioN = normalize(mat3(modelMatrix) * objectNormal);
vStudioW = (modelMatrix * vec4(transformed, 1.0)).xyz;`

// Warm light through the silhouette, plus a faint haze. One extra pow, no extra pass,
// so the PNG export (a straight copy of the canvas) includes it.
const STUDIO_GLOW = `
float studioNdV = clamp(dot(normalize(vStudioN), normalize(cameraPosition - vStudioW)), 0.0, 1.0);
float studioRim = pow(1.0 - studioNdV, 1.55);
float studioTransmit = pow(1.0 - studioNdV, 2.6);
gl_FragColor.rgb += vec3(1.0, 0.40, 0.18) * studioTransmit * 0.62;
gl_FragColor.rgb += vec3(1.0, 0.70, 0.55) * studioRim * 0.20;
gl_FragColor.rgb += vec3(1.0, 0.94, 0.88) * pow(1.0 - studioNdV, 1.1) * 0.06;
`

export function studioHandMaterial(tone: SkinTone, map: THREE.Texture) {
  const fadeFrom = { value: 0 }
  const fadeSpan = { value: 0.12 }
  const mat = new THREE.MeshBasicMaterial({
    map,
    color: toneGain(tone.color),
    transparent: true,
    depthWrite: true,
    toneMapped: false,
  })
  mat.userData.fadeFrom = fadeFrom
  mat.userData.fadeSpan = fadeSpan
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFadeFrom = fadeFrom
    shader.uniforms.uFadeSpan = fadeSpan
    shader.vertexShader = STUDIO_HEAD + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArm = aArm;')
      .replace('#include <project_vertex>', STUDIO_VERT)
    shader.fragmentShader = `uniform float uFadeFrom;\nuniform float uFadeSpan;\nvarying float vArm;\nvarying vec3 vStudioN;\nvarying vec3 vStudioW;\n` + shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
${STUDIO_GLOW}
float cuff = smoothstep(uFadeFrom, uFadeFrom + uFadeSpan, vArm);
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.96, 0.93, 0.90), clamp(cuff, 0.0, 0.75));
gl_FragColor.a *= 1.0 - cuff;
if (gl_FragColor.a < 0.02) discard;`,
    )
  }
  mat.customProgramCacheKey = () => 'om-elena-studio-5'
  return mat
}

/** Unlit forearm. The tile is lifted toward the peach bake, and it fades over about 14 cm. */
export function studioArmMaterial(tone: SkinTone, map: THREE.Texture) {
  const mat = new THREE.MeshBasicMaterial({
    map,
    color: toneGain(tone.color),
    transparent: true,
    depthWrite: true,
    toneMapped: false,
  })
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = STUDIO_HEAD + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArm = aArm;')
      .replace('#include <project_vertex>', STUDIO_VERT)
    shader.fragmentShader = `varying float vArm;\nvarying vec3 vStudioN;\nvarying vec3 vStudioW;\n` + shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
vec3 armSrc = gl_FragColor.rgb;
float armL = dot(armSrc, vec3(0.30, 0.50, 0.20));
vec3 armChroma = armSrc / max(armL, 1e-3);
float armLift = mix(0.40, armL, 0.32);
gl_FragColor.rgb = armLift * mix(vec3(1.24, 1.02, 0.86), armChroma, 0.36);
${STUDIO_GLOW}
float along = smoothstep(0.06, 1.35, vArm);
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.95, 0.91, 0.88), clamp(along * 0.7, 0.0, 0.72));
gl_FragColor.a *= 1.0 - along;
if (gl_FragColor.a < 0.02) discard;`,
    )
  }
  mat.customProgramCacheKey = () => 'om-elena-studio-arm-2'
  return mat
}
