import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'

export const metadata = {
  title: {
    default: 'Grand Line Exchange Docs',
    template: '%s – Grand Line Exchange Docs',
  },
  description:
    'Architecture, data contracts, analytics semantics, and ops runbook for the Grand Line Exchange trading dashboard.',
}

const navbar = <Navbar logo={<b>Grand Line Exchange Docs</b>} />

const footer = (
  <Footer>
    MIT {new Date().getFullYear()} © Grand Line Exchange. This site is
    documentation only — it is not deployed automatically alongside the
    dashboard.
  </Footer>
)

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/caretak3r/grand-line-exchange/tree/main/docs-site"
          footer={footer}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
