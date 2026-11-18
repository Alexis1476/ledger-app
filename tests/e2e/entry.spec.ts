import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const dataDir = join(import.meta.dirname, '.data')

/** a notification (toast) title, not the same words elsewhere on the page */
const toast = (page: import('@playwright/test').Page, title: string) =>
  page.getByLabel(/^Notifications/).getByText(title, { exact: true }).first()

test.describe.configure({ mode: 'serial' })

test('connect to the local folder, record an expense, hledger check passes', async ({ page }, info) => {
  const payee = `E2E ${info.project.name} ${Date.now()}`
  await page.goto('/')
  // first start: redirected to settings
  await expect(page).toHaveURL(/\/settings/)
  await expect(page.getByText('Local folder (development only)')).toBeVisible()
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('Balance sheet')).toBeVisible()
  await page.screenshot({ path: info.outputPath('home.png'), fullPage: true })

  // open quick entry
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'New entry' }).last().click()
  else await page.getByRole('button', { name: 'New entry' }).first().click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await drawer.getByPlaceholder('0.00').first().fill('12.35')
  await drawer.getByRole('button', { name: 'Groceries' }).click()
  await drawer.getByPlaceholder('Payee').fill(payee)
  await drawer.getByRole('button', { name: /Journal text/ }).click()
  await expect(drawer.locator('pre')).toContainText('expenses:food:groceries')
  await page.screenshot({ path: info.outputPath('entry.png'), fullPage: true })
  await drawer.getByRole('button', { name: 'Save' }).click()
  await expect(toast(page, 'Saved')).toBeVisible()

  // the file on disk has the transaction, and the CI badge turns green (real hledger, if installed)
  const year = new Date().getFullYear()
  const text = readFileSync(join(dataDir, 'journals', `${year}.journal`), 'utf8')
  expect(text).toContain(payee)
  expect(readFileSync(join(dataDir, 'main.journal'), 'utf8')).toContain(`include journals/${year}.journal`)
  const hledger = process.env.HLEDGER ?? 'hledger'
  let hasHledger = true
  try {
    execFileSync(hledger, ['--version'])
  } catch {
    hasHledger = false
  }
  if (hasHledger) {
    execFileSync(hledger, ['-f', join(dataDir, 'main.journal'), 'check', '--strict', 'ordereddates'])
    await expect(page.getByText('Check passed').filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 })
  }
  await expect(page.getByText(payee).first()).toBeVisible()
  await page.screenshot({ path: info.outputPath('after-save.png'), fullPage: true })
})

test('income from an owner and an exchange as a transfer', async ({ page }, info) => {
  await page.goto('/settings')
  await expect(page.getByText('Local folder (development only)')).toBeVisible()
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
  const stamp = `${info.project.name} ${Date.now()}`

  // deposit from Sam = income whose source is Sam's family category
  await page.goto('/?new=income')
  let drawer = page.getByRole('dialog')
  await drawer.getByPlaceholder('0.00').first().fill('50')
  await drawer.getByRole('button', { name: 'Sam', exact: true }).click()
  await drawer.getByPlaceholder('Payee').fill(`Deposit ${stamp}`)
  await drawer.getByRole('button', { name: /Journal text/ }).click()
  await expect(drawer.locator('pre')).toContainText('income:transfers:family:sam')
  await drawer.getByRole('button', { name: 'Save' }).click()
  await expect(toast(page, 'Saved')).toBeVisible()

  // exchange = transfer to an account in another currency, with a fee
  await page.goto('/?new=transfer')
  drawer = page.getByRole('dialog')
  await drawer.getByPlaceholder('0.00').first().fill('93.64')
  await drawer.getByRole('combobox').filter({ hasText: 'Account' }).click()
  await page.getByRole('option', { name: 'Neo EUR', exact: true }).click()
  await drawer.getByPlaceholder(/^Received in/).fill('100')
  await drawer.getByRole('button', { name: /^Fee/ }).click() // unfold the fee
  await drawer.getByPlaceholder(/^Fee in/).fill('0.95')
  await drawer.getByPlaceholder('Payee').fill(`Exchange ${stamp}`)
  await drawer.getByRole('button', { name: /Journal text/ }).click()
  await expect(drawer.locator('pre')).toContainText('@@')
  await page.screenshot({ path: info.outputPath('transfer.png'), fullPage: true })
  await drawer.getByRole('button', { name: 'Save' }).click()
  await expect(toast(page, 'Saved')).toBeVisible()

  const text = readFileSync(join(dataDir, 'journals', `${new Date().getFullYear()}.journal`), 'utf8')
  expect(text).toContain(`Deposit ${stamp}`)
  expect(text).toContain(`Exchange ${stamp}`)
  await page.goto('/people')
  await expect(page.getByText('Sam', { exact: true }).first()).toBeVisible()
  await expect(page.getByText("To put back into Sam's pockets")).toBeVisible()
  await page.screenshot({ path: info.outputPath('people.png'), fullPage: true })
})

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/settings')
  await expect(page.getByText('Local folder (development only)')).toBeVisible()
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('payee prefill, split, then edit and undo', async ({ page }, info) => {
  await connect(page)
  const stamp = `${info.project.name} ${Date.now()}`
  const year = new Date().getFullYear()
  const file = () => readFileSync(join(dataDir, 'journals', `${year}.journal`), 'utf8')

  // typing a known payee fills the category (and split, account…) used with it last time
  await page.goto('/?new=expense')
  let drawer = page.getByRole('dialog')
  await drawer.getByPlaceholder('Payee').fill('Bistro')
  await drawer.getByPlaceholder('Payee').blur()
  await expect(drawer.getByText('Restaurants', { exact: true })).toHaveCount(2) // tile + selected category
  await drawer.getByRole('button', { name: 'Cancel' }).click()

  // split 10 for me / 20 for Max
  await page.goto('/?new=expense')
  drawer = page.getByRole('dialog')
  await drawer.getByPlaceholder('0.00').first().fill('30')
  await drawer.getByRole('button', { name: 'Restaurants' }).click()
  await drawer.getByPlaceholder('Payee').fill(`Split ${stamp}`)
  await drawer.getByRole('button', { name: /^Split/ }).click()
  await drawer.getByRole('button', { name: 'Max', exact: true }).click()
  const splitInputs = drawer.locator('input[inputmode="decimal"]:not([placeholder])')
  await splitInputs.nth(0).fill('10.00')
  await splitInputs.nth(1).fill('20.00')
  await page.screenshot({ path: info.outputPath('split.png'), fullPage: true })
  await drawer.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, 'Saved')).toBeVisible()
  expect(file()).toMatch(new RegExp(`Split ${stamp}[^]*?expenses:transfers:family:max +20\.00 CHF`))

  // edit it: change the amount split
  await page.goto('/transactions')
  await page.getByPlaceholder(/Search payee/).fill(`Split ${stamp}`)
  await page.getByText(`Split ${stamp}`).first().click()
  await page.getByRole('button', { name: 'Edit' }).click()
  drawer = page.getByRole('dialog')
  await expect(drawer.getByText('Edit transaction').first()).toBeVisible()
  await expect(drawer.getByPlaceholder('0.00').first()).toHaveValue('30.00')
  await drawer.getByPlaceholder('0.00').first().fill('36')
  await drawer.getByRole('button', { name: 'Split equally' }).click()
  await page.screenshot({ path: info.outputPath('edit.png'), fullPage: true })
  await drawer.getByRole('button', { name: 'Save changes' }).click()
  await expect(toast(page, 'Updated')).toBeVisible()
  expect(file()).toMatch(new RegExp(`Split ${stamp}[^]*?expenses:transfers:family:max +18\.00 CHF`))
  expect(file().match(new RegExp(`Split ${stamp}`, 'g'))).toHaveLength(1)

  // undo right after saving removes the entry again
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0, { timeout: 20_000 }) // older toasts gone
  await page.goto('/?new=expense')
  drawer = page.getByRole('dialog')
  await drawer.getByPlaceholder('0.00').first().fill('1')
  await drawer.getByRole('button', { name: 'Groceries' }).click()
  await drawer.getByPlaceholder('Payee').fill(`Undo ${stamp}`)
  await drawer.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(toast(page, 'Undone')).toBeVisible()
  expect(file()).not.toContain(`Undo ${stamp}`)
})

test('dashboard and account page render in light and dark', async ({ page }, info) => {
  await connect(page)
  await expect(page.getByText('Balance sheet')).toBeVisible()
  await expect(page.getByText('In my accounts', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: /In my accounts/ }).click() // kept for each person / free
  await expect(page.getByText('Free (mine)')).toBeVisible()
  await expect(page.getByText('Income vs expenses')).toBeVisible()
  await expect(page.getByRole('img', { name: /^My money over/ })).toBeVisible()
  // "All" brings back the money kept for people (net worth, their pockets in the list)
  await page.getByRole('radio', { name: 'All' }).click()
  await expect(page.getByRole('img', { name: /^Net worth over/ })).toBeVisible()
  await expect(page.getByText('Sam · Neo EUR').first()).toBeVisible()
  await page.getByRole('radio', { name: 'My money' }).click()
  await expect(page.getByRole('img', { name: /^My money over/ })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Income and expenses per month' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('dashboard-light.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(page.getByText('Balance sheet')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.waitForTimeout(600) // let the chart draw animation finish
  await page.screenshot({ path: info.outputPath('dashboard-dark.png'), fullPage: true })
  // account page: balance chart + history with running balance
  await page.getByRole('link', { name: 'Details of Bank Checking' }).click()
  await expect(page).toHaveURL(/\/accounts\/assets%3Abank%3Achecking/)
  await expect(page.getByRole('img', { name: /^Balance over/ })).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: info.outputPath('account-dark.png'), fullPage: false })
})

test('putting money back into a person pocket lowers the reminder', async ({ page }, info) => {
  await connect(page)
  const stamp = `${info.project.name} ${Date.now()}`
  await page.goto('/people')
  const reminder = page.getByText(/ of 500\.00 CHF put back/)
  const amountOf = (t: string) => Number(t.match(/^([\d'.]+) CHF/)![1].replace(/'/g, ''))
  const before = amountOf(await reminder.innerText())
  await page.goto('/?new=transfer')
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('combobox', { name: 'From account' }).click()
  await page.getByRole('option', { name: 'Neo CHF', exact: true }).click()
  await drawer.getByPlaceholder('0.00').first().fill('20')
  await drawer.getByRole('combobox', { name: 'To account' }).click()
  await page.getByRole('option', { name: 'Sam · Neo CHF', exact: true }).click()
  await drawer.getByPlaceholder('Payee').fill(`Put back ${stamp}`)
  await drawer.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, 'Saved')).toBeVisible()
  const text = readFileSync(join(dataDir, 'journals', `${new Date().getFullYear()}.journal`), 'utf8')
  expect(text).toMatch(new RegExp(`Put back ${stamp}[^]*?assets:sam:neo:chf +20\.00 CHF[^]*?assets:neo:chf +-20\.00 CHF`))
  await page.goto('/people')
  await expect(reminder).toBeVisible()
  expect(amountOf(await reminder.innerText())).toBeCloseTo(before + 20, 2)
})

test('transactions page lists and filters', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByText('Local folder (development only)')).toBeVisible()
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/transactions')
  await page.getByPlaceholder(/Search payee/).fill('Migros')
  await expect(page.getByText(/Migros/).first()).toBeVisible()
})

test('accounting page: balance sheet, income statement, cash flow', async ({ page }) => {
  await connect(page)
  await page.goto('/accounting')
  await expect(page.getByRole('heading', { name: /^Assets/ })).toBeVisible()
  await expect(page.getByText('Liabilities + equity + result')).toBeVisible()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.getByText('Sam · Neo EUR')).toBeVisible()
  await page.getByRole('tab', { name: /Income statement/ }).click()
  await expect(page.getByRole('heading', { name: /^Revenues/ })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('income.png'), fullPage: true })
  await expect(page.getByText(/^Net result/)).toBeVisible()
  await page.getByRole('tab', { name: /Cash flow/ }).click()
  await expect(page.getByText(/^Net change in cash/)).toBeVisible()
  await page.getByRole('tab', { name: /Balance sheet/ }).click()
  await page.screenshot({ path: test.info().outputPath('accounting.png'), fullPage: true })
})

test('scheduled payment: create (first one recorded), skip the next, edit, delete', async ({ page }, info) => {
  await connect(page)
  const stamp = `Sched ${info.project.name} ${Date.now()}`
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const sched = () => readFileSync(join(dataDir, 'journals', 'scheduled.journal'), 'utf8')
  const year = () => readFileSync(join(dataDir, 'journals', `${d.getFullYear()}.journal`), 'utf8')

  await page.goto('/scheduled')
  await page.getByRole('button', { name: 'New scheduled payment' }).filter({ visible: true }).first().click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('combobox', { name: 'Repeat' })).toContainText('Monthly')
  await drawer.getByPlaceholder('0.00').first().fill('20')
  await drawer.getByRole('button', { name: 'Groceries', exact: true }).click()
  await drawer.getByPlaceholder('Payee').fill(stamp)
  await page.screenshot({ path: test.info().outputPath('schedule-form.png') })
  await drawer.getByRole('button', { name: /Journal text \(journals\/scheduled\.journal\)/ }).click()
  await expect(drawer.locator('pre')).toContainText(`~ monthly from ${today}  ${stamp}`)
  await drawer.getByRole('button', { name: 'Schedule', exact: true }).click()
  await expect(toast(page, 'Scheduled')).toBeVisible()
  expect(sched()).toMatch(new RegExp(`~ monthly from ${today}  ${stamp}  ; via:app, id:\\w+`))
  // the first payment (today) is recorded and linked to the schedule
  expect(year()).toMatch(new RegExp(`${today} \\* ${stamp}  ; via:app, id:\\w+, [^\\n]*schedule:\\w+[^\\n]*planned:${today}`))

  // the next one is due within 30 days: skip it
  const row = page.getByRole('button', { name: new RegExp(`^Skip ${stamp}`) })
  await expect(row).toBeVisible()
  await row.click()
  await expect(toast(page, 'Skipped')).toBeVisible()
  expect(sched()).toMatch(new RegExp(`${stamp}  ; [^\\n]*skip:\\d{4}-\\d{2}-\\d{2}`))
  await expect(page.getByRole('button', { name: new RegExp(`^Skip ${stamp}`) })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('scheduled.png'), fullPage: true })

  // edit the amount, then delete (two taps)
  await page.getByRole('button', { name: new RegExp(stamp) }).first().click()
  await expect(drawer.getByText('Edit scheduled payment').first()).toBeVisible()
  await drawer.getByPlaceholder('0.00').first().fill('25')
  await drawer.getByRole('button', { name: 'Save changes' }).click()
  await expect(toast(page, 'Schedule updated')).toBeVisible()
  expect(sched()).toMatch(new RegExp(`${stamp}[^]*?25\\.00 CHF`))
  await page.getByRole('button', { name: new RegExp(stamp) }).first().click()
  await drawer.getByRole('button', { name: 'Delete' }).click()
  await drawer.getByRole('button', { name: 'Tap again to delete' }).click()
  await expect(toast(page, 'Schedule deleted')).toBeVisible()
  expect(sched()).not.toContain(stamp)
  expect(year()).toContain(stamp) // the recorded payment stays
})
