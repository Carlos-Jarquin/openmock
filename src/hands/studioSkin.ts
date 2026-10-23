// Studio hand. The colour is a Cycles bake of Elena's mesh, graded to a light peach
// with the pores and knuckle cavities washed out (public/hands/elena/studio.webp).
// It does not read the scene lights, the HDRI, or the lighting controls. Matte has
// nothing glossy to remove. The skin-tone swatch still tints the bake. A pale fresnel
// blooms the silhouette, and the wrist cuff fades into a light haze.
import * as THREE from 'three'
import { toneGain, type SkinTone } from './realisticSkin'

export const STUDIO_URL = '/hands/elena/studio.webp?v=5'

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
float studioRim = pow(1.0 - studioNdV, 1.35);
// Pale peach bloom along the silhouette, so the edge goes soft instead of cutting.
gl_FragColor.rgb += vec3(1.0, 0.94, 0.88) * studioRim * 0.26;
gl_FragColor.rgb += vec3(0.98, 0.93, 0.88) * studioRim * studioRim * 0.10;
// The cuff is only the mesh past the wrist. It fades into a light haze, then out.
float cuff = smoothstep(uFadeFrom, uFadeFrom + 0.12, vArm);
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.96, 0.93, 0.90), clamp(cuff * 1.05, 0.0, 0.85));
gl_FragColor.a *= 1.0 - cuff;
if (gl_FragColor.a < 0.02) discard;`,
    )
  }
  mat.customProgramCacheKey = () => 'om-elena-studio-3'
  return mat
}
