import { expect, test } from '@playwright/test'

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/settings')
  await expect(page.getByText('Local folder (development only)')).toBeVisible()
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
}
const TITLES = ['Summary', 'Spending by category', 'Income vs expenses', 'Net worth over time', 'Spending over time']
const headings = (page: import('@playwright/test').Page) => page.locator('section h2').allInnerTexts()

test('insights: period, chart type, hide and reorder, remembered after a reload', async ({ page }) => {
  await connect(page)
  await page.goto('/insights')
  await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible()
  expect(await headings(page)).toEqual(TITLES)
  await expect(page.getByRole('img', { name: 'Income and expenses per month' })).toBeVisible()

  // the period applies to the page: the summary names it
  await page.getByRole('combobox', { name: 'Period' }).click()
  await page.getByRole('option', { name: 'Last 12 months' }).click()
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Summary' }) }).getByText(/^Last 12 months · /)).toBeVisible()

  // chart type: spending as a donut
  const types = page.getByRole('radiogroup', { name: 'Spending by category: chart type' })
  await types.getByRole('radio', { name: 'Donut' }).click()
  await expect(types.getByRole('radio', { name: 'Donut' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('img', { name: /^Spending by category: / })).toBeVisible()

  // customize: hide the net worth chart, move the spending over time to the top
  await page.getByRole('button', { name: 'Customize' }).click()
  const sheet = page.getByRole('dialog', { name: 'Customize' })
  await sheet.getByRole('switch', { name: 'Show Net worth over time' }).click()
  for (let i = 0; i < 4; i++) await sheet.getByRole('button', { name: 'Move Spending over time up' }).click()
  await sheet.getByRole('button', { name: 'Done' }).click()
  const mine = ['Spending over time', 'Summary', 'Spending by category', 'Income vs expenses']
  await expect.poll(() => headings(page)).toEqual(mine)

  // remembered on this device
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Spending over time' })).toBeVisible()
  expect(await headings(page)).toEqual(mine)
  await expect(page.getByRole('combobox', { name: 'Period' })).toContainText('Last 12 months')
  await expect(page.getByRole('radiogroup', { name: 'Spending by category: chart type' }).getByRole('radio', { name: 'Donut' })).toHaveAttribute('aria-checked', 'true')

  // reset brings everything back
  await page.getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('dialog', { name: 'Customize' }).getByRole('button', { name: 'Reset' }).click()
  await page.getByRole('dialog', { name: 'Customize' }).getByRole('button', { name: 'Done' }).click()
  await expect.poll(() => headings(page)).toEqual(TITLES)
})

test('insights: tapping a group focuses the page on it, and every chart still makes sense', async ({ page }) => {
  await connect(page)
  await page.goto('/insights')
  await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Income and expenses per month' })).toBeVisible()

  // a group with several categories: Leisure
  await page.getByRole('button', { name: 'Focus on Leisure' }).click()
  await expect(page.getByRole('heading', { name: 'Spending on Leisure' })).toBeVisible()
  const summary = page.locator('section', { has: page.getByRole('heading', { name: 'Spending on Leisure' }) })
  for (const t of ['Spent', 'Per month', 'Share', 'Change']) await expect(summary.getByText(t, { exact: true })).toBeVisible()
  await expect(summary.getByText('Savings rate')).toHaveCount(0)
  // income and net worth step aside; spending per month replaces income vs expenses
  await expect(page.getByRole('heading', { name: 'Spending per month' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Spending per month' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Net worth over time' })).toHaveCount(0)
  await expect(page.getByText('Net worth is not shown while a category is filtered', { exact: false })).toBeVisible()
  // the breakdown is by category now: a row opens its transactions
  await expect(page.getByRole('radiogroup', { name: 'Spending by', exact: true })).toHaveCount(0)
  await expect(page.getByText('Tap a category to see its transactions.')).toBeVisible()

  // removing the filter brings the whole picture back
  await page.getByRole('button', { name: 'Remove filter Leisure' }).click()
  await expect.poll(() => headings(page)).toEqual(TITLES)
})

test('insights: a category filter narrows the spending, and can be removed', async ({ page }) => {
  await connect(page)
  await page.goto('/insights')
  const spending = page.locator('section', { has: page.getByRole('heading', { name: 'Spending by category' }) })
  await expect(spending.getByText('Total', { exact: true })).toBeVisible()
  const rows = () => spending.locator('ul > li').count()
  const before = await rows()
  expect(before).toBeGreaterThan(1)

  await page.getByRole('button', { name: 'Filters' }).click()
  const sheet = page.getByRole('dialog', { name: 'Filters' })
  await sheet.getByText('Any category').click()
  await page.getByRole('option', { name: 'Food (all)' }).click()
  await page.keyboard.press('Escape') // closes the list of choices
  if (await sheet.isVisible()) await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(sheet).toHaveCount(0)
  await expect.poll(rows).toBe(1)
  await expect(spending.locator('ul > li').first()).toContainText('Groceries') // the breakdown goes down to the categories

  await page.getByRole('button', { name: 'Remove filter Food' }).click()
  await expect.poll(rows).toBe(before)
})
