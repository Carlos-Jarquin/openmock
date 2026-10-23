# Realistic hand

Rigged hand by Elena FF (https://sketchfab.com/elenaferfor), licensed under CC BY-SA 4.0, modified.

Source: [Rigged hand](https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e) by [Elena FF](https://sketchfab.com/elenaferfor), CC BY-SA 4.0. The original file is an FBX (`handRig_02.fbx`) with 2048×2048 maps `hand_Co` (colour), `hand_No` (normal), `hand_Ro` (roughness) and `hand_Sp` (specular). It is a single right hand, about 14.5k vertices. The original archive is not in this repository.

## What was changed

OpenMock's grip solver (`src/hands/Hands.tsx`) assumes a flat armature: every bone's parent is the armature, so a bone's local position is the joint, and a pose is an armature-space hinge. The FBX is a Maya hierarchy with a parallel control rig. The Sketchfab glTF conversion of this model is not what ships here; its joints do not drive the skin reliably.

The conversion, done in headless Blender 4 with `automatic_bone_orientation` left off:

1. Keep the deform bones only. Vertex groups are `pulse`, `hand`, and each finger's base / 01 / 02 / 03. The `*_Ctrl*` bones have no weights and are deleted.
2. Unparent every deform bone so its rest matrix stays in armature space. Rename them to the WebXR generic-hand names the solver already uses (`wrist`, `index-finger-phalanx-proximal`, `thumb-metacarpal`, and so on). `pulse` becomes `forearm` and keeps the wrist cuff skinned. It is not a posed joint.
3. Add a tip bone at each distal end (`index-finger-tip`, `thumb-tip`, …). The solver aims those joints. They carry no weights.
4. The thumb has an extra middle phalanx (`thumb_02`, named `thumb-phalanx-intermediate`). The WebXR thumb has no middle joint, so the solver does not curl it on its own. `followThumbMid` in `Hands.tsx` poses it with the proximal bone. The distal bone still bends the tip, and the skin stays in one piece. Re-rigging the weights onto three thumb bones would have thrown away that joint.
5. Limit skin weights to four influences per vertex (the FBX uses up to seven; glTF skinning here is four).
6. Scale about the wrist so the wrist-to-middle-fingertip length is 178 mm, the same as `public/hands/right.glb`. `HAND_SCALE` then makes Realistic and Classic the same size, and the contact radii still fit.
7. Mirror on X for the left hand. Bone names stay the same. The solver's palm normal flips with the hand side.
8. Export glTF (Y-up, no materials) and compress with meshopt (`EXT_meshopt_compression` + `KHR_mesh_quantization`). The app's glTF loader already includes a meshopt decoder, so nothing is fetched from a CDN to decode the mesh. Position quantization is undone by the inverse bind matrices; rest-pose skinning lands on the original vertex positions.

Positive curl still closes toward the palm. That was checked by hinging the middle finger in armature space: the tip moved along the palm normal and the skin stayed continuous.

## Textures

| File | Source | Notes |
| --- | --- | --- |
| `albedo.webp` | `hand_Co.jpeg` | sRGB colour. WebP quality 84. |
| `normal.webp` | `hand_No.png` | Tangent-space normal, OpenGL Y. Lossless WebP. |
| `roughness.webp` | `hand_Ro.jpeg` | Linear roughness. WebP quality 82. |
| `specular.webp` | `hand_Sp.jpeg` | Lifted with `0.22 + 0.78 * source` so the nearly black skin texels still read as satin. WebP quality 80. |

UVs are the glTF set, so the textures load with `flipY` off. The forearm is still the procedural lathe; it does not share this unwrap, and it uses the albedo's average skin colour instead of a second texture. Crease occlusion is not baked. The earlier procedural skin maps read as blotches, so they are not used.

`MeshPhysicalMaterial` samples these maps, with a wrapped diffuse lobe, a small warm backlight, and a light sheen. Matte still clears specular, sheen, clearcoat and the environment reflection.
