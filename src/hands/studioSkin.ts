// Studio hand. The colour is a Cycles bake of Elena's mesh under soft, even lights
// (public/hands/elena/studio.webp), so this material does not read the scene lights,
// the HDRI, or the lighting controls. Matte has nothing glossy to remove. The skin-tone
// swatch still tints the bake. A short fresnel stands in for the airbrushed rim, and the
// wrist fades out through the cuff instead of meeting a forearm tube.
import * as THREE from 'three'
import { toneGain, type SkinTone } from './realisticSkin'

export const STUDIO_URL = '/hands/elena/studio.webp'

export function prepareStudioMap(map: THREE.Texture) {
  map.colorSpace = THREE.SRGBColorSpace
  map.flipY = false
  map.needsUpdate = true
}

export function studioHandMaterial(tone: SkinTone, map: THREE.Texture) {
  const fadeFrom = { value: 0 }
  const mat = new THREE.MeshBasicMaterial({
    map,
    color: toneGain(tone.color),
    transparent: true,
    depthWrite: true,
    toneMapped: false,
  })
  mat.userData.fadeFrom = fadeFrom
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFadeFrom = fadeFrom
    shader.vertexShader = `attribute float aArm;\nvarying float vArm;\nvarying vec3 vStudioN;\nvarying vec3 vStudioW;\n` + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArm = aArm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vStudioN = normalize(mat3(modelMatrix) * objectNormal);
vStudioW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )
    shader.fragmentShader = `uniform float uFadeFrom;\nvarying float vArm;\nvarying vec3 vStudioN;\nvarying vec3 vStudioW;\n` + shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
float studioNdV = clamp(dot(normalize(vStudioN), normalize(cameraPosition - vStudioW)), 0.0, 1.0);
gl_FragColor.rgb += vec3(1.0, 0.95, 0.91) * pow(1.0 - studioNdV, 2.6) * 0.06;
gl_FragColor.a *= 1.0 - smoothstep(uFadeFrom, uFadeFrom + 0.1, vArm);
if (gl_FragColor.a < 0.02) discard;`,
    )
  }
  mat.customProgramCacheKey = () => 'om-elena-studio-1'
  return mat
}
