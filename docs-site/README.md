# Grand Line Exchange Docs

Self-contained Nextra (Next.js) documentation site for the Grand Line
Exchange dashboard. This is a **separate project** from the dashboard —
it has its own `package.json`, its own `node_modules`, and is built and
deployed independently.

## Develop

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Build (static export)

```bash
npm run build   # → docs-site/out/
```

`next.config.mjs` sets `output: 'export'`, so `npm run build` produces a
fully static site — no Node server required to host it.

## `BASE_PATH`

The basePath is read from the `BASE_PATH` environment variable rather than
hardcoded, because it depends on where this ends up deployed (public vs.
private GitHub Pages, or a subpath of the dashboard's existing Pages
site). See [`content/ops-runbook.mdx`](./content/ops-runbook.mdx#base_path)
for the full rule and examples.

## Deploying

This site is **not** auto-deployed. `.github/workflows/docs.yml` builds it
on `workflow_dispatch` only — see that workflow's comments and
`content/ops-runbook.mdx` for why (the dashboard already owns this repo's
GitHub Pages site via `deploy.yml`; a second auto-deploying workflow would
race or overwrite it).

## Structure

```
docs-site/
├── app/
│   ├── layout.tsx              # Nextra theme shell (navbar, footer, page map)
│   └── [[...mdxPath]]/page.tsx # catch-all route rendering content/*.mdx
├── content/
│   ├── _meta.ts                # nav order/labels (single file — no folder-level _meta conflicts)
│   ├── index.mdx
│   ├── quick-start.mdx
│   ├── architecture.mdx
│   ├── data-contracts.mdx
│   ├── analytics.mdx
│   └── ops-runbook.mdx
├── mdx-components.tsx
├── next.config.mjs
└── package.json                 # own dependency tree, does not touch the dashboard's
```
