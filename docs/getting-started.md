# Getting started

[简体中文](getting-started.zh-CN.md)

This page takes you from an empty page to a 3D view of two layers, and covers sizing, cleanup and the errors you are most likely to hit.

## Install

```sh
npm install kgstrata three
# or: pnpm add kgstrata three
```

`three` is a peer dependency. The accepted range is `>=0.154.0 <0.200.0`: 0.154 to 0.187 have been run (0.153 fails in the shaders). `d3-force` comes in as a regular dependency.

That is all you need for the core, `kgstrata/path`, `kgstrata/headless` and `kgstrata/react`. Nothing in them loads WebAssembly. A minimal page (the [vanilla example](../examples/vanilla)) builds to about 686 kB of JavaScript including three.js, about 180 kB gzipped.

Optional extras:

| You want | Also install |
|---|---|
| React components (`kgstrata/react`, `kgstrata/react/path`) | `react`, `react-dom` (18 or 19; 18.3 and 19 are tested) |
| Version comparison (`kgstrata/diff`, `kgstrata/react/diff`) | `@kgdiff/core`, `@kgdiff/scene`, `@kgdiff/layout`, `@kgdiff/compute` (`^0.12.3`) |
| TypeScript types for three | `@types/three` (same range as `three`) |

The type declarations are checked with `skipLibCheck: false` on TypeScript 5.2, 5.6 and 7.0 × `@types/three` 0.160, 0.170 and 0.187, with `moduleResolution` `bundler` and `nodenext` (`pnpm check:types-compat` in the repository). TypeScript older than 5.2 has not been tried.

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
- click a node to select it, click empty space to clear (the `select` event says `source: 'pointer'`; `strata.select(id)` takes the same path with `source: 'api'`);
- double-click a node that has children (a table with fields) to expand or collapse it.

## Container size

- The canvas takes the size of the host element (`clientWidth` × `clientHeight`). A host with no height gives you a 1-pixel-tall canvas. Use a fixed height, `inset: 0`, flex or grid.
- The engine checks the host size on every frame, so you do not need to call anything after a resize. While the camera is still at the overview (the user has not moved it), it reframes when the aspect ratio changes.
- `<StrataCanvas>` (React) is a positioned container with `width: 100%; height: 100%; min-height: 320px` by default, so it has a height even when its parent has none; panels go inside it with `position: absolute`.
- If panels cover part of the view, `strata.setInset({ right: 320 })` (any of `top`, `right`, `bottom`, `left`, in CSS pixels) centres the picture in the part that is still visible.
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

## Bundlers

The core entries (`kgstrata`, `/path`, `/headless`, `/react`…) are plain ESM and need no configuration anywhere below. The diff entry pulls in kgdiff, which finds its three `.wasm` files with `new URL('…', import.meta.url)`; that is what differs between bundlers. The table was checked with the packed kgstrata 0.2.0 and kgdiff 0.12.3, each build run in a browser (Vite 6 and 8 also with their dev servers, Next.js with server rendering):

| Bundler | Core | `kgstrata/diff` |
|---|---|---|
| Vite 8 | no configuration | no configuration |
| Vite 6 | no configuration | build: no configuration; dev server: `optimizeDeps.exclude` (below) |
| webpack 5 | no configuration | no configuration (one harmless warning, below) |
| Next.js 16 (Turbopack and `--webpack`) | no configuration; server rendering does not crash | no configuration |
| Rollup | no configuration | add `importMetaAssets()` (below) |
| esbuild | no configuration | `--loader:.wasm=file` and the `wasm` option (below) |
| Parcel 2 | needs `packageExports` (below) | needs `packageExports` |

Safari and Firefox have not been tested.

**Vite 6**, dev server with `kgstrata/diff`:

```ts
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: { exclude: ['@kgdiff/core', '@kgdiff/layout', '@kgdiff/scene', '@kgdiff/compute'] },
})
```

**webpack 5** with `kgstrata/diff` prints `Critical dependency: the request of a dependency is an expression`, from `@kgdiff/compute/dist/loader.js` (a Node-only `import()` that browsers never reach). It is harmless; to silence it:

```js
// webpack.config.js
export default {
  // …
  ignoreWarnings: [{ module: /@kgdiff[\\/]compute/, message: /Critical dependency/ }],
}
```

**Rollup** does not copy files referenced with `new URL(…, import.meta.url)`. Add [`@web/rollup-plugin-import-meta-assets`](https://www.npmjs.com/package/@web/rollup-plugin-import-meta-assets):

```js
// rollup.config.js
import { importMetaAssets } from '@web/rollup-plugin-import-meta-assets'

export default {
  // …
  plugins: [/* node-resolve etc. */ importMetaAssets()],
}
```

**esbuild** does not handle `new URL(…, import.meta.url)` either: by default the page asks for `/wasm/compute.wasm` and gets a 404. Load the `.wasm` files with the `file` loader and hand their URLs to the diff plugin:

```ts
// main.ts
import { Strata } from 'kgstrata'
import { diffPlugin } from 'kgstrata/diff'
import compute from '@kgdiff/compute/compute.wasm'
import layout from '@kgdiff/compute/layout.wasm'
import formats from '@kgdiff/compute/formats.wasm'

const strata = new Strata(document.getElementById('app')!)
const diff = strata.use(diffPlugin({ wasm: { compute, layout, formats } }))
strata.setData(after)
await diff.show(before, after)
```

```ts
// wasm.d.ts, for TypeScript
declare module '*.wasm' {
  const url: string
  export default url
}
```

```sh
esbuild main.ts --bundle --format=esm --outdir=dist --loader:.wasm=file
```

esbuild copies the three files into `dist/` (`compute-<hash>.wasm`…) and the imports are their paths relative to the page, so serve `index.html` from `dist/`. With `--public-path` they become absolute URLs. This needs `@kgdiff/compute` installed (see [plugins.md](plugins.md#version-comparison-kgstratadiff)).

**Parcel 2** does not read `exports` by default, so no subpath (`kgstrata/react`, `kgstrata/diff`…) resolves. Turn it on in your `package.json`:

```json
{
  "@parcel/resolver-default": { "packageExports": true }
}
```

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

Only `kgstrata/diff` and `kgstrata/react/diff` pull in kgdiff, which loads three `.wasm` files (about 1.9 MB together, uncompressed). How each bundler handles them is in [Bundlers](#bundlers). If you never import `kgstrata/diff`, none of this applies: the other entry points contain no WebAssembly and do not import kgdiff, not even its types.

### Large chunk warning

Vite warns about chunks over 500 kB. three.js alone is most of that. Raise `build.chunkSizeWarningLimit` or load the view with a dynamic `import()` if the warning bothers you.

## Next

- [data.md](data.md): the data contract and validation
- [api.md](api.md): every option, method and event
- [react.md](react.md): `<StrataCanvas>` and the panels
- [plugins.md](plugins.md): path replay, version comparison, writing your own plugin
