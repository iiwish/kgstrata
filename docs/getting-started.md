# Getting started

[简体中文](getting-started.zh-CN.md)

This page takes you from an empty page to a 3D view of two layers, and covers sizing, cleanup and the errors you are most likely to hit.

## Install

```sh
npm install kgstrata three
# or: pnpm add kgstrata three
```

`three` is a peer dependency. The accepted range is `>=0.170.0 <0.200.0`; only `0.187` has been tested. `d3-force` comes in as a regular dependency.

That is all you need for the core, `kgstrata/path`, `kgstrata/headless` and `kgstrata/react`. Nothing in them loads WebAssembly. A minimal page (the [vanilla example](../examples/vanilla)) builds to about 686 kB of JavaScript including three.js, about 180 kB gzipped.

Optional extras:

| You want | Also install |
|---|---|
| React components (`kgstrata/react`, `kgstrata/react/path`) | `react`, `react-dom` (18 or 19; only 19 is tested) |
| Version comparison (`kgstrata/diff`, `kgstrata/react/diff`) | `@kgdiff/core`, `@kgdiff/scene`, `@kgdiff/layout` (`^0.12.1`) |
| TypeScript types for three | `@types/three` (same range as `three`) |

## A minimal page

The engine needs an element with a real width and height. It fills that element with a `<canvas>`.

```html
<div id="graph" style="position: fixed; inset: 0"></div>
<script type="module" src="./main.ts"></script>
```

```ts
// main.ts
import { Strata, type StrataData } from 'kgstrata'

const data: StrataData = {
  version: 2,
  layers: [
    { id: 'onto', name: 'Ontology' },
    { id: 'table', name: 'Tables' },
  ],
  nodes: [
    { id: 'onto:company', layer: 'onto', label: 'Company' },
    { id: 'onto:person', layer: 'onto', label: 'Person' },
    { id: 'tbl:company', layer: 'table', label: 'company', type: 'table' },
    { id: 'tbl:person', layer: 'table', label: 'person', type: 'table' },
  ],
  relations: [
    { source: 'onto:person', target: 'onto:company', type: 'works-for' },
    { source: 'tbl:person', target: 'tbl:company', type: 'fk' },
    { source: 'onto:company', target: 'tbl:company', type: 'maps-to' },
    { source: 'onto:person', target: 'tbl:person', type: 'maps-to' },
  ],
}

const strata = new Strata(document.getElementById('graph')!, { hero: 'onto' })
const issues = strata.setData(data) // [] when the data is clean
```

A relation between two nodes in the same layer stays in that layer. A relation between nodes in different layers is a mapping and is drawn between the planes. The full contract is in [data.md](data.md).

What you can do with the mouse:

- drag to orbit, scroll to zoom;
- hover a node to light its neighbours and the nodes in the same correspondence block;
- click a node to select it, click empty space to clear;
- double-click a node that has children (a table with fields) to expand or collapse it.

## Container size

- The canvas takes the size of the host element (`clientWidth` × `clientHeight`). A host with no height gives you a 1-pixel-tall canvas. Use a fixed height, `inset: 0`, flex or grid.
- The engine checks the host size on every frame, so you do not need to call anything after a resize. While the camera is still at the overview (the user has not moved it), it reframes when the aspect ratio changes.
- If a panel covers the right side of the view, `strata.setInset(px)` centres the picture in the part that is still visible.
- The device pixel ratio is capped at 2.

## Cleanup

Call `dispose()` when the view goes away. It stops the animation loop, frees GPU resources, removes the canvas and drops the WebGL context. Browsers allow only a limited number of live contexts, so a view that is created repeatedly (routes, hot reload, React strict mode) must be disposed.

```ts
strata.dispose()
// Safe to call twice. After dispose, every other method quietly does nothing.
```

With Vite hot reload:

```ts
import.meta.hot?.dispose(() => strata.dispose())
```

`<StrataCanvas>` in `kgstrata/react` does this for you on unmount.

## Common problems

### WebGL is not available

`new Strata()` throws a `StrataError` with `code: 'webgl-unavailable'` when the browser cannot create a WebGL context (disabled, blocklisted GPU, too many contexts). Nothing is attached to the page in that case. The original error is on `error.cause`.

```ts
import { Strata, StrataError } from 'kgstrata'

try {
  const strata = new Strata(host)
  strata.setData(data)
} catch (error) {
  if (error instanceof StrataError && error.code === 'webgl-unavailable') {
    host.textContent = error.message // localized by the `locale` option
  } else {
    throw error
  }
}
```

`<StrataCanvas>` catches this and renders its `fallback` instead.

If the context is lost later (driver reset), the engine stops its loop and emits `contextlost`. When the browser restores the context it re-uploads what it needs, resumes, and emits `contextrestored`.

### `setData` returned issues

`setData` checks the data first. Broken items (duplicate ids, relations to missing nodes, parent cycles) are dropped, everything else is drawn, and the list of issues is returned. Each issue has a stable `code`; see the [issue table](data.md#validation).

### WebAssembly and `kgstrata/diff`

Only `kgstrata/diff` and `kgstrata/react/diff` pull in kgdiff, which loads three `.wasm` files (about 1.9 MB together, uncompressed). They are located with `new URL(..., import.meta.url)`, so the bundler has to leave them alone:

| Bundler | Status |
|---|---|
| Vite 8 | Works with no configuration (dev and build). |
| Vite 6 | Build works with no configuration. The dev server needs the packages excluded from dependency pre-bundling (below). |
| webpack, esbuild, Rollup | Not tested. |

```ts
// vite.config.ts (Vite 6, dev server)
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: { exclude: ['@kgdiff/core', '@kgdiff/layout', '@kgdiff/scene', '@kgdiff/compute'] },
})
```

If you never import `kgstrata/diff`, none of this applies: the other entry points contain no WebAssembly and do not import kgdiff, not even its types.

### Large chunk warning

Vite warns about chunks over 500 kB. three.js alone is most of that. Raise `build.chunkSizeWarningLimit` or load the view with a dynamic `import()` if the warning bothers you.

## Next

- [data.md](data.md): the data contract and validation
- [api.md](api.md): every option, method and event
- [react.md](react.md): `<StrataCanvas>` and the panels
- [plugins.md](plugins.md): path replay, version comparison, writing your own plugin
