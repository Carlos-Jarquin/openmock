# Realistic hand

Rigged hand by Elena FF (https://sketchfab.com/elenaferfor), licensed under CC BY-SA 4.0, modified.

Source: [Rigged hand](https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e) by [Elena FF](https://sketchfab.com/elenaferfor), CC BY-SA 4.0. The original file is an FBX (`handRig_02.fbx`) with 2048×2048 maps `hand_Co` (colour), `hand_No` (normal), `hand_Ro` (roughness) and `hand_Sp` (specular). It is a single right hand, about 14.5k vertices. The original archive is not in this repository.

## What was changed

OpenMock's grip solver (`src/hands/Hands.tsx`) assumes a flat armature: every bone's parent is the armature, so a bone's local position is the joint, and a pose is an armature-space hinge. The FBX is a Maya hierarchy with a parallel control rig. The Sketchfab glTF conversion of this model is not what ships here; its joints do not drive the skin reliably.

The conversion, done in headless Blender 4 with `automatic_bone_orientation` left off:

1. Keep the deform bones only. Vertex groups are `pulse`, `hand`, and each finger's base / 01 / 02 / 03. The `*_Ctrl*` bones have no weights and are deleted.
2. Unparent every deform bone so its rest matrix stays in armature space. Rename them to the WebXR generic-hand names the solver already uses (`wrist`, `index-finger-phalanx-proximal`, `thumb-metacarpal`, and so on). `pulse` becomes `forearm` and keeps the wrist cuff skinned. It is not a posed joint.
3. Add a tip bone at each distal end (`index-finger-tip`, `thumb-tip`, …). The solver aims those joints. They carry no weights.
4. The thumb has an extra middle phalanx (`thumb_02`, named `thumb-phalanx-intermediate`). The WebXR thumb has three curls and no middle joint. `poseThumb` in `Hands.tsx` shares those curls across the four Elena joints. The metacarpal and the short proximal bone stay near the sculpted rest (they are already bent, and more flexion there candy-wraps the thenar). The intermediate joint takes most of a grip. The nail joint is capped at a gentle bend: the distal skin is almost rigid, and a hard hook there folds the tip into the phone. `followThumbMid` only runs if that pose has not happened yet.
5. Limit skin weights to four influences per vertex (the FBX uses up to seven; glTF skinning here is four).
6. Scale about the wrist so the wrist-to-middle-fingertip length is 178 mm, the same as `public/hands/right.glb`. `HAND_SCALE` then makes Realistic and Classic the same size, and the contact radii still fit.
7. Mirror on X for the left hand. Bone names stay the same. The solver's palm normal flips with the hand side.
8. Export glTF (Y-up, no materials) and compress the buffers with meshopt (`EXT_meshopt_compression`). Normals, UVs and weights are quantized. Positions stay in metres: the grip solver measures the bind pose for the wrist fade and for girth, and a unit-volume position quantization made that fade eat the palm. The app's glTF loader already includes a meshopt decoder, so nothing is fetched from a CDN.

Positive curl still closes toward the palm. That was checked by hinging the middle finger in armature space: the tip moved along the palm normal and the skin stayed continuous.

## Textures

| File | Source | Notes |
| --- | --- | --- |
| `albedo.webp` | `hand_Co.jpeg` | sRGB colour. WebP quality 84. |
| `normal.webp` | `hand_No.png` | Tangent-space normal, OpenGL Y. Lossless WebP. |
| `roughness.webp` | `hand_Ro.jpeg` | Linear roughness, lifted (`min(255, 48 + 0.88 * source)` for texels at or above 20) so the pores stay matte instead of satin. WebP quality 82. |
| `specular.webp` | `hand_Sp.jpeg` | Kept for reference. The hand material does not sample it. |
| `studio.webp` | Cycles bake of this mesh | Fully lit colour for the Studio style. See below. WebP quality 86. |

UVs are the glTF set, so the textures load with `flipY` off. The forearm is still the procedural lathe; it does not share this unwrap, and it uses the albedo's average skin colour instead of a second texture. With the arm on, the tube is widened and tucked up into the cuff, and the hand fades across that overlap (`aArm`), so the flat wrist cut does not leave a hard ring. Crease occlusion is not baked into the Realistic maps. The earlier procedural skin maps read as blotches, so they are not used.

`MeshPhysicalMaterial` (Realistic) samples colour, normal and roughness. Roughness is high, specular is low, clearcoat is off, and the normal map is scaled down, so the skin reads dry under the studio key. A wrapped diffuse lobe and a small warm backlight stay. Matte still clears specular, sheen and the environment reflection.

## Studio

`studio.webp` is a lighting bake of this same mesh, so it is CC BY-SA 4.0 as well. Headless Blender 4 Cycles (CPU, no denoiser) lit the open hand with a large soft key, a gentler fill, a dim back light and a little subsurface, and baked the diffuse illumination without the albedo. That factor is multiplied by `hand_Co` in linear light, centred so a typical skin texel keeps the albedo's colour and saturation. Creases darker than their neighbourhood are deepened, and the broad highlights get a small warm lift. Nothing is clipped to white. One neutral pose is enough: the light is even, so a curled finger does not pick up a hard shadow from the open-hand bake.

In the app, Studio is a `MeshBasicMaterial` (`src/hands/studioSkin.ts`). It does not read the scene lights, the HDRI, or the lighting controls. The skin-tone swatch still tints the bake. A short fresnel stands in for a soft rim. The wrist cuff fades out through the existing `aArm` attribute instead of meeting the forearm tube. Matte has nothing glossy to remove.
