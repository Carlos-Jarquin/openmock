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

The hand models are the MIT-licensed WebXR "generic-hand" assets (see CREDITS.md), so they ship in `public/hands/`. They are fairly low detail, so close-ups show some faceting.

### Realistic hands

Hand → Appearance → Hand style switches photographic skin between **Realistic** (the default) and **Classic** (the original smooth material). Silhouette and Spectral keep their own materials either way. Realistic is on by default.

Realistic skin is a `MeshPhysicalMaterial` (`src/hands/realisticSkin.ts`), so the orbit camera and the lighting controls (intensity, direction, height, contact shadow, the studio HDRI) still shade the hand. Matte, in Sketch, still strips sheen, clearcoat, specular and the environment reflection. A wrapped diffuse lobe and a thickness backlight stand in for subsurface scatter. Pose occlusion crossfades when the gesture changes.

The maps are baked offline from the same MIT mesh. Blender is not required. `scripts/bake-hands.mjs` poses the hand, ray-traces ambient occlusion for rest, grip, point and flat, and writes:

| File | Contents |
| --- | --- |
| `public/hands/realistic/albedo.webp` | Colour variation. Multiplied by the skin-tone swatch, so the swatches still drive the colour. |
| `normal.webp` | Tangent-space pores, knuckle wrinkles and palm creases. |
| `surface.webp` | Thickness (R), roughness (G), wrist mask (B). |
| `ao.webp` | Rest, grip, point and flat occlusion, one channel each. |
| `pores.webp` | A tileable normal for the forearm. The forearm is a lathe and does not share the hand unwrap. |

Re-bake after changing the script:

```
npm install
npm run bake-hands
```

`sharp` is a dev dependency. The script also writes preview PNGs under `/tmp/hand-preview/`. The mesh is the original generic hand (about 1,360 vertices), so the silhouette stays that resolution; the maps carry the skin detail.

### Photoreal hands (ComfyUI)

"Make hands photoreal" sends the current view to a ComfyUI running on this Mac (port 8188, reached through the dev server at `/comfyui-api`; set `COMFY_URL` to use another address). ComfyUI repaints only the hands with `comfy/hands.json`: Z-Image Turbo (`z_image_turbo_bf16.safetensors`, `qwen_3_4b.safetensors` text encoder, `ae.safetensors` VAE) with the Z-Image Turbo Fun ControlNet Union 2.1 (`model_patches/`), guided by the hand depth map or the OpenPose hand skeleton, inpainting the hand mask only. About 100 s per picture on an M3 Max after the first load.

Openmock then lays the AI hands over the live render. Every pixel outside the hand mask is the original render. Under the old 3D hand it uses a clean plate (the same frame with the hands hidden), and over the phone it only accepts pixels that differ from the plate and read as skin, so the AI can't redraw the screen or the phone. Where the phone sits in front of a finger, the phone wins. "Contact shadows" is optional and is the only setting that darkens phone pixels. Export PNG saves the photoreal picture. Changing anything goes back to the 3D hands.

"Export for AI hands" downloads every pass (beauty, clean plate, hand mask, soft alpha, occlusion, phone silhouette, depth, normals, OpenPose skeleton) and the prompt, to run the workflow by hand.
