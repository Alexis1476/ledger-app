import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const dataDir = join(import.meta.dirname, '.data')
const config = () => JSON.parse(readFileSync(join(dataDir, 'app.config.json'), 'utf8'))
const journals = () =>
  readdirSync(join(dataDir, 'journals'))
    .map((f) => readFileSync(join(dataDir, 'journals', f), 'utf8'))
    .join('\n')

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('budgets: add one on a group, see it on Home, change it, remove it', async ({ page }) => {
  await connect(page)
  await page.goto('/budgets')
  await page.getByRole('button', { name: 'New budget' }).filter({ visible: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New budget' })
  await dialog.getByText('Choose a category or a group').click()
  await page.getByRole('option', { name: 'Dining (all)' }).click()
  await dialog.getByRole('textbox', { name: 'Per month' }).fill('200')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Budget added').first()).toBeVisible()
  expect(config().budgets).toEqual({ 'expenses:dining': '200.00' })

  const row = page.getByRole('button', { name: /^Dining: .* of 200\.00 CHF$/ })
  await expect(row).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Dining' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Budgets' })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Dining' })).toBeVisible()

  await page.goto('/budgets')
  await row.click()
  const edit = page.getByRole('dialog', { name: 'Edit budget' })
  await edit.getByRole('textbox', { name: 'Per month' }).fill('250')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Budget saved').first()).toBeVisible()
  expect(config().budgets).toEqual({ 'expenses:dining': '250.00' })

  await page.getByRole('button', { name: /^Dining: / }).click()
  await page.getByRole('dialog', { name: 'Edit budget' }).getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('Budget removed').first()).toBeVisible()
  expect(config().budgets).toEqual({})
  await expect(page.getByText('No budget yet')).toBeVisible()
})

test('accounts: correct a balance to what the bank shows', async ({ page }, info) => {
  await connect(page)
  await page.goto('/accounts/assets%3Abank%3Asavings')
  await page.getByRole('button', { name: 'Correct balance' }).click()
  const dialog = page.getByRole('dialog', { name: 'Correct the balance' })
  const target = info.project.name === 'phone' ? '12345.60' : '23456.70'
  await dialog.getByRole('textbox', { name: 'Balance on the bank' }).fill(target)
  await expect(dialog.getByText('Difference', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Correct' }).click()
  await expect(page.getByText('Balance corrected').first()).toBeVisible()

  // the difference against equity:adjustments, and the account now shows the bank's balance
  expect(journals()).toMatch(/Balance correction \| Bank Savings[^]*?assets:bank:savings +-?\d+\.\d\d CHF[^]*?equity:adjustments +-?\d+\.\d\d CHF/)
  const shown = Number(target).toLocaleString('de-CH', { minimumFractionDigits: 2 }).replace(/’/g, "'")
  await expect(page.getByText(`${shown} CHF`).first()).toBeVisible()
})
