import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const dataDir = join(import.meta.dirname, '.data')
const read = (f: string) => readFileSync(join(dataDir, f), 'utf8')
const journals = () =>
  readdirSync(join(dataDir, 'journals'))
    .filter((f) => f.endsWith('.journal'))
    .map((f) => read(`journals/${f}`))
    .join('\n')

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/settings')
  await expect(page.getByText('Local folder (development only)')).toBeVisible()
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('loans: turn an existing transaction into a loan, then record a new one', async ({ page }, info) => {
  // one search per project (they share the data folder); a unique person each run
  const p = info.project.name
  const person = `Friend ${p} ${Date.now() % 100000}`
  const key = person.toLowerCase().replace(/ /g, '-')
  await connect(page)
  await page.goto('/loans')

  await page.getByRole('textbox', { name: 'Find a transaction that was a loan' }).fill(p === 'phone' ? 'coop' : 'migros')
  await page.locator('button[aria-haspopup="dialog"][aria-label]').filter({ hasText: /coop|migros/i }).first().click()
  await page.getByLabel('Person', { exact: true }).fill(person)
  await page.getByRole('radio', { name: 'I lent', exact: true }).click()
  await page.getByRole('button', { name: 'Record as loan' }).click()
  await expect(page.getByText('Recorded as a loan').first()).toBeVisible()

  // the person's account is declared and the posting moved to it (amount unchanged)
  expect(read('accounts.journal')).toMatch(new RegExp(`^account assets:receivables:${key} +; type: A$`, 'm'))
  expect(journals()).toMatch(new RegExp(`\\n    assets:receivables:${key} +\\d+\\.\\d\\d [A-Z]{3}`))
  await expect(page.locator('.md-item').filter({ hasText: person })).toContainText('owes me')
  await page.screenshot({ path: info.outputPath('loans.png'), fullPage: true })

  // a new loan to someone new: the account is created, the entry form opens on it
  const ana = `Ana ${p} ${Date.now() % 100000}`
  const anaKey = ana.toLowerCase().replace(/ /g, '-')
  await page.getByRole('button', { name: 'New loan' }).filter({ visible: true }).first().click()
  await page.getByLabel('Person', { exact: true }).fill(ana)
  await page.getByRole('button', { name: 'Next' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByPlaceholder('0.00').first().fill('10')
  await drawer.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Committed. hledger check is running…').first()).toBeVisible()
  expect(read('accounts.journal')).toContain(`account assets:receivables:${anaKey}`)
  expect(journals()).toMatch(new RegExp(`${ana}[^]*?assets:receivables:${anaKey} +10\\.00`))
})
