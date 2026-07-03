# Jade Realistic Renderer Design

## Goal

Upgrade the jade material visuals from icon-like SVG shapes to a more realistic, procedurally generated look while preserving gameplay readability. The first version should make rough stones and slices feel like jade: granular skin, polished windows, translucent body, color roots, cotton, flaws, and cracks.

## Scope

In scope:

- Render rough stones and slice boards with Canvas 2D textures.
- Keep existing gameplay, Socket.IO events, item lifecycle, and server authority.
- Preserve existing cut-line and slice-planning interactions by layering DOM/SVG controls above the rendered jade.
- Use deterministic seeds so the same item renders consistently across rerenders and browser sessions.
- Add lightweight visual parameters to existing `visual` and `board` data where needed.

Out of scope for this pass:

- Database persistence.
- WebGL or Three.js material shaders.
- AI-generated per-item image assets.
- Full mobile interaction redesign.
- Changing item valuation or order rules beyond using existing board data for visuals.

## Recommended Approach

Use a hybrid renderer:

- Canvas 2D draws the jade material body.
- Existing HTML/SVG/DOM controls draw gameplay overlays such as cut angle, bracelet layout, bead layout, plaque layout, and selection markers.
- The server continues to generate item visual data. The client translates that data into deterministic Canvas textures.

This keeps the prototype lightweight while allowing layered, organic texture effects that are hard to achieve with simple SVG.

## Components

### `public/jade-renderer.js`

New front-end module responsible for rendering jade visuals.

Public functions:

- `renderRoughCanvas(item, options)`
- `renderSliceCanvas(slice, options)`
- Optional helper `jadeCanvasMarkup(kind, item, options)` if DOM generation stays string-based.

Responsibilities:

- Generate deterministic pseudo-random values from item seed.
- Draw rough stone silhouettes with skin texture, pores, fog, bands, cracks, and polished windows.
- Draw slice boards with translucent ground, color zones, cotton threads, color roots, dirty spots, and flaws.
- Scale cleanly for card, inventory, and planner sizes.

### `public/main.js`

Update current visual functions without changing gameplay actions:

- Replace `stoneSvg()` output with a Canvas-backed wrapper.
- Replace the material part of `boardSvg()` with a Canvas-backed texture.
- Keep the cut-line planner and slice-planning overlay behavior intact.

### `server.js`

Keep server changes small:

- Extend `makeStoneVisual()` with optional visual traits such as `grain`, `translucency`, `cotton`, `speckles`, and `skinRoughness`.
- Extend `makeSliceBoard()` with optional traits such as `clarity`, `water`, `dirtySpots`, and `cottonThreads`.
- Continue hiding true-quality-only fields from public rough-stone snapshots.

## Rendering Details

### Rough Stone

The rough renderer should layer:

1. Irregular silhouette clipped to the current stone shape.
2. Base skin color from fog type.
3. Low-frequency cloudy variation for natural volume.
4. High-frequency speckles for sand and skin roughness.
5. Optional moss-like green patches for pine flower and python-band hints.
6. Optional polished window with internal jade texture, glossy highlight, and feathered edge.
7. Crack lines with subtle branching and dark cores.
8. Directional highlight and shadow for dimensionality.

### Slice Board

The slice renderer should layer:

1. Irregular slice outline using the existing `outlinePath`.
2. Semi-translucent ground color based on quality score.
3. Blurred green color zones from existing `colorZones`.
4. Cotton as thin cloudy white fibers.
5. Color roots as darker green directional veins.
6. Flaws from existing `flaws`, drawn as fractured lines rather than single straight strokes.
7. Internal glow and edge shadow to imply thickness.

## Data Flow

Server:

```text
makeRoughStone -> visual traits -> publicStone -> Socket.IO state
makeSliceBoard -> board traits -> private player snapshot -> Socket.IO state
```

Client:

```text
state received -> render() -> Canvas wrappers inserted -> jade-renderer paints after DOM update
```

The renderer should be deterministic from item data. It should not depend on wall-clock time for static item appearance.

## Performance

- Canvas sizes should be bounded and responsive, not full-resolution photos.
- Use device-pixel-ratio scaling for sharpness.
- Avoid repainting every frame. Paint only after render updates or relevant item data changes.
- Cache by item id plus a simple visual signature if needed.

## Error Handling

- If Canvas rendering fails, show the current SVG-style fallback or a simple colored jade-colored block with the item name still visible.
- Missing visual fields should fall back to existing defaults.
- Unsupported browser behavior should not block gameplay controls.

## Testing And Verification

Manual verification:

- Start the server with `npm start`.
- Open `http://localhost:3000/`.
- Confirm auction rough stones show realistic skin, hints, windows, and cracks.
- Buy a stone, cut it, cut slices, and confirm slice boards show internal jade texture under planning overlays.
- Confirm cut angle sliders, slice click positioning, layout controls, and split actions still work.
- Check browser console for errors.

Automated/lightweight verification:

- Use a small render smoke test in the browser or in-app browser to confirm canvases exist and have non-empty pixels.
- Verify `npm start` serves the page and browser smoke checks pass. The current project has no test or build script.

## Acceptance Criteria

- Rough stones no longer look like flat SVG icons.
- Slice boards show layered jade material with readable color zones and flaws.
- Existing gameplay flow remains unchanged.
- Rendering is deterministic for the same item data.
- No new heavy dependency is required for the first pass.
