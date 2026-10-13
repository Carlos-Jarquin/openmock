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
