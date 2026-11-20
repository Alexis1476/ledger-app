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

test('accounts & categories: add an account in a new currency with a balance, add a category', async ({ page }, info) => {
  const n = `${info.project.name} ${Date.now() % 100000}`
  const name = `Revolut ${n}`
  const key = `assets:revolut-${n.toLowerCase().replace(/ /g, '-')}`
  await connect(page)
  await page.goto('/accounts')

  await page.getByRole('button', { name: 'Add an account' }).filter({ visible: true }).first().click()
  await page.getByRole('textbox', { name: 'Account name' }).fill(name)
  await page.getByRole('combobox', { name: 'Currency' }).click()
  await page.getByRole('option', { name: 'Other…' }).click()
  await page.getByRole('textbox', { name: 'Currency code' }).fill('gbp')
  await page.getByRole('textbox', { name: 'Balance today' }).fill('100')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Account added').first()).toBeVisible()

  expect(read('accounts.journal')).toMatch(new RegExp(`^account ${key} {2,}; type: C, currency: GBP, label: ${name}$`, 'm'))
  expect(read('commodities.journal')).toMatch(/^commodity 1000\.00 GBP$/m)
  expect(journals()).toMatch(new RegExp(`Opening balance \\| ${name}[^]*?${key} +100\\.00 GBP[^]*?equity:opening +-100\\.00 GBP`))
  await expect(page.locator('.md-item').filter({ hasText: name })).toContainText('100.00 GBP')
  await expect(page.getByRole('link', { name: `Details of ${name}` })).toBeVisible()
})

test('chart of accounts: add a category in a group, edit it (name, group, archived), add a new group', async ({ page }, info) => {
  const n = `${info.project.name} ${Date.now() % 100000}`
  const slugN = n.toLowerCase().replace(/ /g, '-')
  await connect(page)
  await page.goto('/chart')
  const expenses = page.getByRole('tree', { name: 'Expenses' })
  await expect(expenses.getByRole('treeitem', { name: /Food/ }).first()).toBeVisible()

  // a category in the Food group (the + on the group row)
  const coffee = `Coffee ${n}`
  await page.getByRole('button', { name: 'Add a category in Food' }).click()
  await page.getByRole('textbox', { name: 'Category name' }).fill(coffee)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Category added').first()).toBeVisible()
  expect(read('accounts.journal')).toMatch(new RegExp(`^account expenses:food:coffee-${slugN} {2,}; type: X, label: ${coffee}$`, 'm'))
  await expect(expenses.getByRole('button', { name: new RegExp(`^${coffee}`) })).toBeVisible()

  // edit it: new name, moved to Leisure (renamed everywhere), archived
  await expenses.getByRole('button', { name: new RegExp(`^${coffee}`) }).click()
  await page.getByRole('textbox', { name: 'Category name (edit)' }).fill(`Café ${n}`)
  await page.getByRole('combobox', { name: 'Move to group' }).click()
  await page.getByRole('option', { name: 'Leisure', exact: true }).click()
  await page.getByRole('switch', { name: /Archived/ }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Category saved').first()).toBeVisible()
  const accounts = read('accounts.journal')
  expect(accounts).not.toContain(`expenses:food:coffee-${slugN}`)
  expect(accounts).toMatch(new RegExp(`^account expenses:leisure:coffee-${slugN} {2,}; type: X, label: Café ${n}, archived: yes$`, 'm'))

  // a category in a new group, from the page's + button
  await page.getByRole('button', { name: 'New category' }).filter({ visible: true }).first().click()
  await page.getByRole('textbox', { name: 'Category name' }).fill(`Vet ${n}`)
  await page.getByRole('combobox', { name: 'Group' }).click()
  await page.getByRole('option', { name: 'New group…' }).click()
  await page.getByRole('textbox', { name: 'New group name' }).fill(`Animals ${n}`)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Category added').first()).toBeVisible()
  const after = read('accounts.journal')
  expect(after).toMatch(new RegExp(`^account expenses:animals-${slugN} {2,}; type: X, label: Animals ${n}$`, 'm'))
  expect(after).toMatch(new RegExp(`^account expenses:animals-${slugN}:vet-${slugN} {2,}; type: X, label: Vet ${n}$`, 'm'))
  await expect(expenses.getByRole('treeitem', { name: new RegExp(`Animals ${n}`) }).first()).toBeVisible()
  await page.screenshot({ path: info.outputPath('chart.png'), fullPage: true })
})

test('accounts: a pocket inside an existing bank', async ({ page }, info) => {
  const n = `${info.project.name} ${Date.now() % 100000}`
  const name = `Insurance ${n}`
  const key = `assets:bank:insurance-${n.toLowerCase().replace(/ /g, '-')}`
  await connect(page)
  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Show the pockets of Bank' }).click()
  await page.getByRole('button', { name: 'Add a pocket to Bank' }).click()
  const dialog = page.getByRole('dialog', { name: 'New account' })
  await expect(dialog.getByRole('combobox', { name: 'Bank' })).toContainText('Bank')
  await dialog.getByRole('textbox', { name: 'Account name' }).fill(name)
  await expect(dialog.getByText(`Shown as Bank ${name}`)).toBeVisible()
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Account added').first()).toBeVisible()

  // a leaf under the bank, named after it, in the bank's currency
  expect(read('accounts.journal')).toMatch(new RegExp(`^account ${key} {2,}; type: C, currency: CHF, label: Bank ${name}$`, 'm'))
  await expect(page.locator('.md-item').filter({ hasText: `Bank ${name}` })).toBeVisible()
})
