import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const dataDir = join(import.meta.dirname, '.data')
/** every journal of the test data, concatenated */
const journals = () =>
  readdirSync(join(dataDir, 'journals'))
    .filter((f) => f.endsWith('.journal'))
    .map((f) => readFileSync(join(dataDir, 'journals', f), 'utf8'))
    .join('\n')

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/settings')
  await expect(page.getByText('Local folder (development only)')).toBeVisible()
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('inventory: search a purchase to add it, rename it, remove it (the expense stays)', async ({ page }, info) => {
  // any purchase not in the inventory yet (one search per project: they share the data folder)
  await connect(page)
  await page.goto('/inventory')
  await page.getByRole('textbox', { name: 'Search your purchases' }).fill(info.project.name === 'phone' ? 'coop' : 'migros')
  const first = page.getByRole('button', { name: /^Add .+ to the inventory$/ }).first()
  const label = (await first.getAttribute('aria-label'))!
  const payee = /^Add (.+) \(\d{4}-\d{2}-\d{2}\) to the inventory$/.exec(label)![1]
  await first.click()
  await expect(page.getByText('Added to the inventory').first()).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Search your purchases' })).toHaveValue('')
  expect(journals()).toContain(`item:${payee}`)

  // rename to a unique name, then remove: back to a plain expense
  const name = `Thing ${info.project.name} ${Date.now()}`
  await page.getByRole('button', { name: new RegExp(`^${payee}`) }).first().click()
  await page.getByRole('textbox', { name: 'Name' }).fill(name)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved').first()).toBeVisible()
  expect(journals()).toContain(`item:${name}\n`)
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await page.getByRole('button', { name: 'Remove from inventory' }).click()
  await expect(page.getByText('Removed from inventory').first()).toBeVisible()
  expect(journals()).not.toContain(`item:${name}`)
})
