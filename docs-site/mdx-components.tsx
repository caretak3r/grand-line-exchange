import { useMDXComponents as getDocsMDXComponents } from 'nextra-theme-docs'
import { Callout, Cards } from 'nextra/components'
import type { MDXComponents } from 'mdx/types'

const docsComponents = getDocsMDXComponents({
  Callout,
  Cards,
})

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...docsComponents,
    ...components,
  }
}
