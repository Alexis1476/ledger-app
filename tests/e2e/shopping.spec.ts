import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const dataDir = join(import.meta.dirname, '.data')
const file = () => (existsSync(join(dataDir, 'lists', 'shopping.md')) ? readFileSync(join(dataDir, 'lists', 'shopping.md'), 'utf8') : '')

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/settings')
  await expect(page.getByText('Local folder (development only)')).toBeVisible()
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('shopping list: add several items, tick, clear, saved in lists/shopping.md', async ({ page }, info) => {
  await connect(page)
  const a = `Milk ${info.project.name} ${Date.now()}`
  const b = `Bread ${info.project.name} ${Date.now()}`
  await page.goto('/shopping')
  await page.getByRole('textbox', { name: 'Add an item' }).fill(`${a}, ${b}`)
  await page.keyboard.press('Enter')
  const toBuy = page.getByRole('list', { name: 'To buy' })
  await expect(toBuy.getByRole('checkbox', { name: a })).toBeVisible()
  await expect(toBuy.getByRole('checkbox', { name: b })).toBeVisible()
  await page.screenshot({ path: info.outputPath('shopping.png') })
  await expect.poll(file, { timeout: 10_000 }).toContain(`- [ ] ${a}`)
  expect(file()).toContain(`- [ ] ${b}`)

  // tick one: it moves to the cart
  await toBuy.getByRole('checkbox', { name: a }).click()
  await expect(page.getByRole('list', { name: 'In the cart' }).getByRole('checkbox', { name: a })).toBeVisible()
  await expect.poll(file).toContain(`- [x] ${a}`)

  // remove the other, clear the cart
  await page.getByRole('button', { name: `Remove ${b}` }).click()
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect.poll(file).not.toContain(a)
  expect(file()).not.toContain(b)
  await expect(page.getByRole('status')).toContainText('Saved')
})

test('phone: More opens Scheduled, People, Accounting and Settings', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'bottom bar only on phone')
  await connect(page)
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Shopping' })).toBeVisible()
  await nav.getByRole('button', { name: 'More' }).click()
  const more = page.getByRole('dialog', { name: 'More' })
  for (const name of ['Scheduled', 'People', 'Loans', 'Inventory', 'Accounting', 'Accounts', 'Chart of accounts', 'Settings']) await expect(more.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible()
  await more.getByRole('link', { name: /^Scheduled/ }).click()
  await expect(page).toHaveURL(/\/scheduled$/)
  await expect(page.getByRole('dialog', { name: 'More' })).toHaveCount(0)
})
