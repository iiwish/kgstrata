# Examples

[简体中文](#中文)

Four small, self-contained apps. Each has its own `package.json`, `tsconfig.json` and data (four concepts, three tables, six fields).

| Directory | Shows | Extra packages |
|---|---|---|
| [`vanilla`](vanilla) | `new Strata()` + `setData`, no framework, no kgdiff | — |
| [`react`](react) | `<StrataCanvas>` with `<LayerList>` and `<NodeTip>` | `react`, `react-dom`, `@vitejs/plugin-react` |
| [`diff`](diff) | Version comparison with `kgstrata/diff` and a hand-written panel | `@kgdiff/core`, `@kgdiff/scene`, `@kgdiff/layout`, `@kgdiff/compute` |
| [`plugin`](plugin) | Two custom plugins: an overlay (highlight one node type) and a take-over mode (one node and its neighbours), both in [docs/plugins.md](../docs/plugins.md#writing-a-plugin) | — |

## Run inside this repository

The examples are pnpm workspace packages. They depend on `"kgstrata": "workspace:*"`, which links the repository root, and use its **built** output in `dist/`. Build the library first.

```sh
pnpm install            # at the repository root; installs the examples too
pnpm build              # builds dist/
cd examples/vanilla
pnpm dev                # or: pnpm typecheck, pnpm build
```

From the root, `pnpm build:examples` type-checks and builds all four (CI runs this).

## Use one outside this repository

Copy a directory and replace the workspace link with a version range:

```diff
-    "kgstrata": "workspace:*",
+    "kgstrata": "^0.2.0",
```

Then `npm install && npm run dev`. Nothing else in the examples depends on the repository.

---

## 中文

四个独立的小应用，各有自己的 `package.json`、`tsconfig.json` 和数据（四个本体、三张表、六个字段）。

| 目录 | 演示什么 | 另装的包 |
|---|---|---|
| [`vanilla`](vanilla) | `new Strata()` + `setData`，不用框架，不装 kgdiff | — |
| [`react`](react) | `<StrataCanvas>` 加 `<LayerList>`、`<NodeTip>` | `react`、`react-dom`、`@vitejs/plugin-react` |
| [`diff`](diff) | 用 `kgstrata/diff` 对比两版，面板是手写的 | `@kgdiff/core`、`@kgdiff/scene`、`@kgdiff/layout`、`@kgdiff/compute` |
| [`plugin`](plugin) | 自己写的两个插件：一个叠加层（高亮某一类节点），一个接管模式（只看一个节点和它的邻居），都在 [docs/plugins.zh-CN.md](../docs/plugins.zh-CN.md) 里 | — |

在本仓库里跑：示例是 pnpm workspace 的包，依赖写的是 `"kgstrata": "workspace:*"`，链接到仓库根目录，用的是 `dist/` 里**构建好的**产物，所以先构建库。

```sh
pnpm install            # 在仓库根目录；示例的依赖一起装
pnpm build              # 构建 dist/
cd examples/vanilla
pnpm dev                # 或者 pnpm typecheck、pnpm build
```

在根目录跑 `pnpm build:examples` 会对四个示例做类型检查并构建（CI 跑的就是它）。

拿到仓库外面用：把目录拷出去，把 `"kgstrata": "workspace:*"` 换成版本号（比如 `"^0.2.0"`），然后 `npm install && npm run dev`。示例里别的东西都不依赖本仓库。
