import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('GitHub Pages workflow', () => {
  it('enables Pages on the first deployment', () => {
    const workflow = readFileSync('.github/workflows/deploy-pages.yml', 'utf8')

    expect(workflow).toMatch(
      /uses:\s*actions\/configure-pages@v5\s+with:\s+enablement:\s*true/,
    )
  })
})
