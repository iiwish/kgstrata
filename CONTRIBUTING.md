# Contributing

Thanks for looking. kgstrata is still at 0.x, so the API can still change; issues that question the design are as welcome as pull requests.

## Setup

You need Node 22.12 or later and pnpm (the version is in `packageManager` in `package.json`; `corepack enable` picks it up).

```sh
pnpm install
pnpm dev             # demo page, http://localhost:5207
pnpm typecheck       # tsc -b
pnpm test            # vitest
pnpm build           # library: dist/ (js + .d.ts)
pnpm check:pack      # checks the build output and the package contents (run build first)
pnpm build:demo      # demo page: demo/dist/
pnpm build:examples  # type-checks and builds examples/* (run build first)
pnpm check:types-compat  # optional, needs network: type-checks the packed package on several TypeScript × @types/three versions (run build first)
pnpm check:bundlers      # optional, needs network: builds the packed package with Vite, webpack, Rollup, esbuild, Parcel and Next.js (run build first)
```

Before sending a change, run `pnpm typecheck && pnpm test && pnpm build && pnpm check:pack && pnpm build:examples`. CI runs the same commands on Node 22 and 24.

Demo page query parameters: `?lang=zh|en` (the Chinese page shows the Three Kingdoms, the English one the Trojan War), `?data=threekingdoms|troy|shop` (pick a data set; `shop` is the online store), `?layers=2|3` (`2|3|4` with `?data=shop`), `?stress=3000` (synthetic data), `?hero=person` (`?hero=table` with `?data=shop`), `?follow=1`, `?hidden=side` (`?hidden=onto` with `?data=shop`).

## Layout of the repository

- `src/`: the library, and only the library: everything here is built into `dist/` (`vite.config.ts` for the js, `tsconfig.build.json` for the `.d.ts`). The engine does not depend on React. Five entry points: `index.ts` (core, stable), `path/index.ts` (path replay), `diff/index.ts` (version comparison), `headless.ts` (no rendering), `internals.ts` (model, styler and renderer types for take-over plugins; not covered by semver, so anything added there may change in a minor version).
- `src/react/`: React wrapper and panels. Three entry points: `index.ts`, `path.tsx`, `diff.tsx`; plus the optional `styles.css`.
- `demo/`: the demo page (React), with its own `index.html` and `vite.config.ts`. It imports the library by package name (`kgstrata`, `kgstrata/react`…) like any user would; the config's aliases (and `paths` in `tsconfig.json`) point those names at `src/`. Not part of the package.
- `examples/`: small standalone apps, pnpm workspace packages linked to the root's `dist/`.
- `docs/`: documentation. English pages with a `*.zh-CN.md` counterpart. Read `docs/design.md` before changing how things look.
- `tests/`: tests. Library tests use the fixed data in `tests/fixtures/`, not the demo data; `tests/saga.test.ts` and `tests/data.test.ts` cover the demo data (the Three Kingdoms and the Trojan War; the online store).
- `scripts/check-pack.mjs`: checks on the built package. `scripts/compat-types.mjs` (`pnpm check:types-compat`): packs the library, installs it in a temporary directory with TypeScript 5.2 / 5.6 / latest × `@types/three` 0.160 / 0.170 / 0.187 and type-checks every entry with `skipLibCheck: false` under `moduleResolution` `bundler` and `nodenext`. It needs network and takes a few minutes, so it is not part of CI; run it before a release and when you touch exported types. A combination that fails only because `@types/three` itself does not compile with that TypeScript is reported separately (a control file importing only `three` fails too). `scripts/check-bundlers.mjs` (`pnpm check:bundlers`): installs the packed library (strict pnpm) into one small project per bundler (Vite 8 and 6, webpack 5, Rollup with `importMetaAssets()`, esbuild with the `wasm` option, Parcel 2 with `packageExports`, Next.js 16 with Turbopack and with `--webpack`, statically exported), builds each and checks that kgdiff's three `.wasm` files are in the output. With `--serve` it then serves all builds and a summary page that runs each one in an iframe (core, path, headless, version comparison) and lists `ok` / `err` per bundler; open it in a browser. `--only vite8,webpack5` picks bundlers; `--dir <path> --serve --skip-build` serves an earlier build again. It needs network and several minutes; run it before a release and when you touch how the diff entry loads kgdiff.
- `.github/workflows/`: `ci.yml` runs the checks below; `release.yml` publishes to npm when a `v*` tag is pushed; `pages.yml` deploys the demo page to https://iiwish.github.io/kgstrata/ on every push to `main`.

## Module boundaries

Someone who only wants the 3D view should not have to ship kgdiff and its WebAssembly. Someone who only needs the layout should not have to ship three.js. The import graph enforces this:

```
kgstrata/headless          validate, normalize, layout, audit, stage, bridges, locale, theme, types
  ▲                        no three, no kgdiff, no react
  │
kgstrata                   Strata, renderer, plugin contract   (+ three)
  ▲
  ├── kgstrata/internals   buildModel, Styler, renderer types  no kgdiff, no react; not re-exported by kgstrata
  ├── kgstrata/path        pathPlugin                          no kgdiff
  ├── kgstrata/diff        diffPlugin, kgdiff adapter          the only user of @kgdiff/*
  ├── kgstrata/audit       auditPlugin                         no kgdiff
  └── kgstrata/react       StrataCanvas, hooks, panels         (+ react), no kgdiff
        ├── kgstrata/react/path   PathList                     (+ kgstrata/path), no kgdiff
        ├── kgstrata/react/diff   DiffPanel                    (+ kgstrata/diff)
        └── kgstrata/react/audit  AuditPanel                   (+ kgstrata/audit), no kgdiff
```

| Entry (source file) | three | react | kgdiff | path code | diff code |
|---|---|---|---|---|---|
| `kgstrata/headless` (`headless.ts`) | no | no | no | no | no |
| `kgstrata` (`index.ts`) | yes | no | no | no | no |
| `kgstrata/internals` (`internals.ts`) | yes | no | no | no | no |
| `kgstrata/path` (`path/index.ts`) | yes | no | no | yes | no |
| `kgstrata/diff` (`diff/index.ts`) | yes | no | yes | no | yes |
| `kgstrata/audit` (`audit/index.ts`) | yes | no | no | no | no |
| `kgstrata/react` (`react/index.ts`) | yes | yes | no | no | no |
| `kgstrata/react/path` (`react/path.tsx`) | yes | yes | no | yes | no |
| `kgstrata/react/diff` (`react/diff.tsx`) | yes | yes | via `../diff` | no | yes |
| `kgstrata/react/audit` (`react/audit.tsx`) | yes | yes | no | no | no |

Each entry may import the ones above it in the tree. Rules:

- **Only `src/diff/` may import `@kgdiff/*`.** Not the core, not path replay, not headless, not even with `import type` (type imports pull declarations into the `.d.ts` closure too).
- **The import closure of `headless.ts` must not contain `three`** and must not touch `renderer/`.
- The core entry does not import `path/` or `diff/`. Plugins talk to the core only through `StrataPlugin` / `StrataContext`.
- **The six core entries must not import `react`.** `react/index.ts`, `react/path.tsx` and `react/audit.tsx` must not reach kgdiff; `react/diff.tsx` gets it only through `../diff`.

`tests/modules.test.ts` walks the source imports and enforces these rules; `pnpm check:pack` checks them again on the build output (including shared chunks). A new entry point needs entries in both places, in `vite.config.ts`, in `package.json` `exports`, in `scripts/pack-types/check.ts`, and in the alias table in `demo/vite.config.ts` plus `paths` in `tsconfig.json`.

## Dependencies

- `d3-force` is a runtime dependency.
- `three` is a peer dependency; `@kgdiff/*` (`core`, `layout`, `scene`, `compute`), `react`, `react-dom` and `@types/three` are optional peers. `@kgdiff/compute` is also a dependency of `@kgdiff/core`, but `src/diff/` imports it directly (the `wasm` option), so it is listed: with pnpm's strict layout a transitive dependency does not resolve. They are also dev dependencies for development.
- The library build (`vite.config.ts`) treats all of them as external.

## Adding a language

Users can add a language at runtime with `registerLocale` (see `docs/theming-and-i18n.md`); nothing in the library has to change. To ship one as **built in**:

1. In `src/locale.ts`, add the code to `BuiltinLocale`.
2. Add a table typed `Record<MessageKey, string>` next to `ZH_CN`, translating every key of the English table. The compiler rejects a table with a missing key. Keep every `{placeholder}`.
3. Add it to `MESSAGES`.
4. Extend `tests/locale.test.ts` (all keys present, placeholders preserved, codes unchanged).
5. Version comparison descriptions are written by kgdiff, whose `Locale` is `'en' | 'zh-CN'` today; `builtinLocaleOf` maps other languages to one of those. A new language in kgdiff needs a change in [kgdiff](https://github.com/iiwish/kgdiff) first.
6. Mention the language in `docs/theming-and-i18n.md` (and its Chinese counterpart) and in `CHANGELOG.md`.

## Running the examples

The examples use the built library, so build first:

```sh
pnpm install
pnpm build
pnpm build:examples          # all of them: tsc --noEmit + vite build
cd examples/react && pnpm dev   # one of them, with a dev server
```

When you change a public API, update the examples and the docs in the same change. The plugin example (`examples/plugin/src/highlight-type.ts`) is also quoted in full in `docs/plugins.md` and `docs/plugins.zh-CN.md`; keep the three in sync.

## Documentation

- Every page in `docs/` exists in English (`name.md`) and Simplified Chinese (`name.zh-CN.md`). Change both.
- Code samples import from package names (`kgstrata`, `kgstrata/react`, …), never from `src/`.
- Option names, events, error codes and issue codes in the docs must exist in the source. Check them when you rename something.
- Be concrete and plain. State limits plainly.

## Code style

Relative imports inside `src/` carry the `.js` extension (`import { resolve } from './resolve.js'`, `from '../diff/index.js'`). The `.d.ts` files keep these paths as written, and TypeScript projects using `"module": "NodeNext"` reject extensionless ones. `tests/modules.test.ts` and `pnpm check:pack` both check this.

Never index a plain object with a string that comes from the data (ids, types, layer or grouping ids): `constructor` or `__proto__` would read the prototype. Use a `Map`, an `Object.create(null)` record, or `Object.hasOwn`.

Comments explain why, not what the code does.

- **Public API: JSDoc in English.** Everything users see in their editor must match the English docs: JSDoc (`/** … */`) on what `kgstrata`, `kgstrata/headless`, `kgstrata/path`, `kgstrata/diff` and `kgstrata/react*` export, on public members of exported classes and on option fields. `pnpm check:pack` fails when a public `.d.ts` (the list `PUBLIC_DTS` in `scripts/check-pack.mjs`) contains a Han character, comments included; a new public file goes into that list.
- **Implementation: comments in Simplified Chinese.** Comments inside function bodies, on non-exported code, and on private members. On a private member of a public class use `//`, not `/** */`: TypeScript copies JSDoc of private members into the `.d.ts`. `kgstrata/internals` (not covered by semver) may keep Chinese JSDoc.
- **Declarations must work with older toolchains.** Annotate members whose inferred type would carry type arguments that older versions do not know: `readonly scene: Scene = new Scene()`, not an inferred `Scene<Object3DEventMap>` (not generic in `@types/three` < 0.184); `world: Float32Array`, not an inferred `Float32Array<ArrayBuffer>` (TypeScript ≥ 5.7). `check:pack` rejects both patterns.

## Releasing

Releases are cut from `main` with a tag; the workflow does the rest.

1. Make sure the checks pass locally, including the optional ones: `pnpm typecheck && pnpm test && pnpm build && pnpm check:pack && pnpm build:demo && pnpm build:examples && pnpm check:types-compat`, and `pnpm check:bundlers --serve` with every row `ok` on its page.
2. Set `version` in `package.json` to the new `x.y.z` (for 0.x, breaking changes bump `y`).
3. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, add a new empty `## [Unreleased]` above it, and update the links at the bottom (`[Unreleased]: …compare/vx.y.z...HEAD`, `[x.y.z]: …releases/tag/vx.y.z`).
4. Commit (`Release x.y.z`), push to `main`, then tag and push the tag: `git tag vx.y.z && git push origin vx.y.z`.
5. `.github/workflows/release.yml` runs on the `v*` tag. It checks that the tag matches `version` and that `CHANGELOG.md` has a non-empty `## [x.y.z]` section (the release fails before publishing otherwise), runs `typecheck` and `test`, publishes to npm with provenance (`prepublishOnly` runs `build` and `check:pack` again), and then creates the GitHub Release `vx.y.z` with that CHANGELOG section as its notes (`gh release create`, using the workflow's `GITHUB_TOKEN` with `contents: write`).

Publishing uses npm trusted publishing (OIDC) when it is set up for the package on npmjs.com (GitHub Actions, repository `iiwish/kgstrata`, workflow `release.yml`), and otherwise the `NPM_TOKEN` secret in the repository; `release.yml` says how to switch. If publishing fails, no GitHub Release is created; fix the cause, delete the tag (`git push --delete origin vx.y.z`) and push it again. If only the Release step failed, create it by hand with the same section.

`publishConfig.registry` pins publishing to the public npm registry, so a mirror configured in your global `.npmrc` does not matter.
