import nextra from 'nextra'

const withNextra = nextra({
  defaultShowCopyCode: true,
  search: { codeblocks: false },
})

// GitHub Pages basePath is NOT constant: public project pages need
// '/<repo>', but private Pages and user/org pages serve from '/' and must
// omit basePath entirely (setting it on a private deploy breaks every
// internal href and _next/* asset URL). Rather than hardcode either case,
// this reads BASE_PATH from the environment — see docs-site/README.md and
// the "Deploying" page under content/ops-runbook.mdx for the full rule.
const basePath = process.env.BASE_PATH || ''

export default withNextra({
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  ...(basePath ? { basePath } : {}),
})
