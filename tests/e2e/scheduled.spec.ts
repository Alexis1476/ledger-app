import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
test('scheduled: a very large amount never pushes Skip / Record out of the row', async ({ page }, info) => {
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  appendFileSync(
    join(import.meta.dirname, '.data', 'journals', 'scheduled.journal'),
    `\n~ monthly from ${soon}  Travel agency | Trip\n    expenses:travel                              12345678.90 COP\n    assets:bank:checking                        -12345678.90 COP\n`
  )
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
  for (const r of ['/scheduled', '/']) {
    await page.goto(r)
    await expect(page.getByText('Travel agency').first()).toBeVisible()
    const out = await page.evaluate(() =>
      [...document.querySelectorAll('.md-item')].flatMap((row) => {
        const box = row.getBoundingClientRect()
        return [...row.querySelectorAll('button, .tabular')].filter((e) => {
          const b = e.getBoundingClientRect()
          return b.width > 0 && (b.right > box.right + 1 || b.left < box.left - 1)
        }).map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 40))
      })
    )
    expect(out, `${info.project.name} ${r}`).toEqual([])
  }
})
