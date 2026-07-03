# Source Material Product Cutouts Design

## Goal

After a rough stone is fully polished, extracted products should look like they were cut out of that exact stone, not like generic product icons or unrelated jade textures.

## Scope

- Products created by `extractFromRough` keep source rough visual data needed for deterministic rendering.
- Product canvases render by clipping source-material texture into the product silhouette.
- Supported product kinds stay aligned with the existing ten extraction kits: bracelet, cabochon, plaque, buddha, guanyin, peace buckle, ruyi, fu bean, leaf, and gourd.
- Existing gameplay economics, validation, kit placement, orders, collection, and marketplace behavior stay unchanged.

## Rendering Design

`server.js` attaches a compact `sourceMaterial` object to each generated product. It contains the source rough id, visual traits, windows, placement, and rough display metadata. `public(jade-renderer.js)` uses that object when rendering `data-jade-kind="product"`.

The renderer first paints a stable jade material field derived from the source rough visual, offset by the product placement so different kit positions sample different parts of the rough. It then clips that material into the product silhouette. Bracelet and peace-buckle products use an even-odd path so their center holes remain transparent.

## Testing

The flow smoke test checks that products include source-material fields and that product rendering calls the source-material cutout path. Renderer smoke tests verify that source-material product markup and rendering remain valid. Existing syntax checks and browser flow verification cover integration.
