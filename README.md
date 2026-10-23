# Openmock

An open-source, browser-based studio for putting screenshots and screen recordings on 3D devices.

## Run

```
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## What it does (v1)

- Import an image or video with the file picker, drag and drop, or paste (Cmd+V). Videos play looped and muted.
- Devices: iPhone Duo (default; unofficial model from Apple's published specs, with fold angle, inner or outer screen, Night Sky or Star White), plus a generic phone and a browser window, all built in code.
- Native screen sizes: inner 2670 × 1878 px, outer 1398 × 2034 px. Add more in `src/devices/index.ts`.
- Camera: tilt, rotate, zoom, pan and reset.
- Background: solid colour, two-colour gradient with angle, or transparent.
- Lighting: intensity, direction, height and a soft contact shadow.
- Export PNG at 1x, 2x or 4x (longest edge capped at 4096 px), with transparency when it's on.

## Roadmap

- v2: focus areas that drive a camera move, depth of field, video export.
- Later: templates, effects (grain, bloom), more devices, an MCP server so AI tools can drive it.

## Licence

MIT. See `LICENSE` and `CREDITS.md`.

## Your own logo

Put your own logo at public/local/logo.svg; it is never committed. A logo.png works too. It loads into the logo spot on the iPhone 18 Pro and iPhone Duo, and the Logo control can still replace or clear it.

## Hands

The Hands section adds 3D hands holding the iPhone 18 Pro or 18 Pro Max: right hand, left hand, two hands (turns the phone sideways) and Present (held at the corner). Pick a skin tone, or Off to hide them. The hands move with the phone, so any camera angle works.

Each pose places the hand next to the phone, rests the palm on it, then bends each finger joint by joint until the skin touches the phone body, which is built from the phone's real measurements. That way the grip fits both sizes. Pose data lives in `src/hands/Hands.tsx`.

Classic hands are the MIT-licensed WebXR "generic-hand" assets (see CREDITS.md), in `public/hands/`. They are fairly low detail, so close-ups show some faceting. Realistic hands are a separate model, licensed CC BY-SA 4.0, in `public/hands/elena/`.

### Realistic hands

Hand → Appearance → Hand style switches between **Realistic** (the default), **Studio**, and **Classic** (the original generic-hand and its smooth material). Silhouette and Spectral keep their own materials either way. Realistic is on by default.

Realistic skin is a `MeshPhysicalMaterial` (`src/hands/realisticSkin.ts`) on Elena FF's mesh, so the orbit camera and the lighting controls (intensity, direction, height, contact shadow, the studio HDRI) still shade the hand. The roughness map is lifted, specular is low, clearcoat is off and the normal map is softened, so the skin stays dry and matte with a little warmth. Matte, in Sketch, still strips sheen, specular and the environment reflection. A wrapped diffuse lobe and a small warm backlight stand in for subsurface scatter. The skin-tone swatches scale the albedo: Fair leaves the texture as painted, and the other swatches shift it.

Studio (`src/hands/studioSkin.ts`) uses the same mesh with a Cycles bake of soft studio light (`public/hands/elena/studio.webp`). The material is unlit on purpose: scene lights, the HDRI and the lighting controls do not shade it. The wrist cuff fades into the background instead of growing a forearm. The skin-tone swatch still tints the bake.

The mesh is "Rigged hand" by Elena FF, about 15.5k vertices and 29k triangles after triangulation. In Blender the deform bones were unparented onto a flat armature (OpenMock poses each joint in armature space), renamed to the WebXR generic-hand bone names, and scaled so the wrist-to-middle-fingertip length matches the classic asset (178 mm). Control bones were dropped; they carried no skin weights. The thumb's extra middle phalanx is posed on its own: most of a grip's curl goes to the intermediate and distal joints, and the short base bones stay near the sculpted rest so the knuckle does not collapse. Elena's fingers are thicker than the generic hand, so the contact spheres and the phone grips for that mesh are separate. Classic poses are unchanged. A left hand is the right hand mirrored on X, with the same bone names. See `public/hands/elena/README.md` for the conversion steps, the bake, and the CC BY-SA terms.

The model's sculpted nails are the ones you see. Procedural nail plates stay on Classic only, so they are not stacked on top of the sculpt.

| File | Contents |
| --- | --- |
| `public/hands/elena/right.glb`, `left.glb` | Meshopt-compressed glTF, flat skeleton, 27 joints. |
| `albedo.webp` | The model's colour map. |
| `normal.webp` | The model's tangent-space normal map. |
| `roughness.webp` | The model's roughness map, lifted so the skin stays matte. |
| `specular.webp` | The model's specular map. Shipped for reference; the material does not sample it. |
| `studio.webp` | Cycles bake of this mesh under soft studio light. CC BY-SA, because it is derived from the model. |

### Photoreal hands (ComfyUI)

"Make hands photoreal" sends the current view to a ComfyUI running on this Mac (port 8188, reached through the dev server at `/comfyui-api`; set `COMFY_URL` to use another address). ComfyUI repaints only the hands with `comfy/hands.json`: Z-Image Turbo (`z_image_turbo_bf16.safetensors`, `qwen_3_4b.safetensors` text encoder, `ae.safetensors` VAE) with the Z-Image Turbo Fun ControlNet Union 2.1 (`model_patches/`), guided by the hand depth map or the OpenPose hand skeleton, inpainting the hand mask only. About 100 s per picture on an M3 Max after the first load.

Openmock then lays the AI hands over the live render. Every pixel outside the hand mask is the original render. Under the old 3D hand it uses a clean plate (the same frame with the hands hidden), and over the phone it only accepts pixels that differ from the plate and read as skin, so the AI can't redraw the screen or the phone. Where the phone sits in front of a finger, the phone wins. "Contact shadows" is optional and is the only setting that darkens phone pixels. Export PNG saves the photoreal picture. Changing anything goes back to the 3D hands.

"Export for AI hands" downloads every pass (beauty, clean plate, hand mask, soft alpha, occlusion, phone silhouette, depth, normals, OpenPose skeleton) and the prompt, to run the workflow by hand.
