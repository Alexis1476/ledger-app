import { expect, test, type Page } from '@playwright/test'

/**
 * Layout guard: no element of the entry form may scroll sideways, on phone and desktop,
 * for every entry type (horizontal scrollbars are a layout bug here).
 */
async function connect(page: Page) {
  await page.goto('/settings')
  await expect(page.getByText('Local folder (development only)')).toBeVisible()
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
}

/** Elements inside `root` whose content is wider than their box and that can scroll or clip. */
async function horizontalOverflow(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return ['root not found']
    const out: string[] = []
    for (const el of [root, ...root.querySelectorAll('*')] as HTMLElement[]) {
      const cs = getComputedStyle(el)
      const scrolls = cs.overflowX === 'auto' || cs.overflowX === 'scroll'
      if (el.scrollWidth > el.clientWidth + 1 && (scrolls || el === root)) {
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} ${el.scrollWidth}>${el.clientWidth}`)
      }
    }
    // the page itself must never scroll sideways
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`page ${document.documentElement.scrollWidth}>${window.innerWidth}`)
    return out
  }, selector)
}

for (const kind of ['expense', 'income', 'transfer'] as const) {
  test(`entry form (${kind}) has no horizontal scroll`, async ({ page }, info) => {
    await connect(page)
    await page.goto(`/?new=${kind}`)
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await drawer.getByPlaceholder('0.00').first().fill('1234.56')
    if (kind !== 'transfer') {
      // the currency (flag + code) is shown in full, never as "C…"
      const cur = drawer.getByRole('combobox', { name: 'Currency' })
      await expect(cur).toContainText(/^(CHF|EUR|USD|COP)$/)
      const cut = await cur.evaluate((el) => [...el.querySelectorAll('span')].some((s) => s.scrollWidth > s.clientWidth + 1))
      expect(cut).toBe(false)
      await cur.screenshot({ path: info.outputPath('currency.png') })
    }
    // unfold everything that can be unfolded
    for (const name of [/^(Split|Fee)/, /note, status/i, /Journal text/]) {
      const b = drawer.getByRole('button', { name })
      if (await b.count()) await b.first().click()
    }
    await page.screenshot({ path: info.outputPath(`form-${kind}.png`), fullPage: true })
    expect(await horizontalOverflow(page, '[role="dialog"]')).toEqual([])
  })
}

test('pages have no horizontal scroll', async ({ page }) => {
  await connect(page)
  for (const path of ['/', '/transactions', '/shopping', '/accounts', '/chart', '/loans', '/inventory', '/people', '/scheduled', '/accounting', '/settings', '/accounts/assets%3Abank%3Achecking']) {
    await page.goto(path)
    await page.waitForTimeout(400)
    expect(await horizontalOverflow(page, 'body'), path).toEqual([])
  }
})

test('form: one control height, no field labels, payee suggestions from 3 characters', async ({ page }) => {
  await connect(page)
  await page.goto('/?new=expense')
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('button', { name: /^Split/ }).click()
  await drawer.getByRole('button', { name: /note, status/i }).click()
  // every input, select, chip and action button of the form has the same height
  const heights = await drawer.evaluate((root) =>
    [...root.querySelectorAll('input:not([aria-label="Amount"]):not([role="switch"]), button[role="combobox"], [role="group"] button, footer button, form > div > button')]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => Math.round(el.getBoundingClientRect().height))
  )
  expect(heights.length).toBeGreaterThan(10)
  expect(new Set(heights)).toEqual(new Set([56])) // 56dp, the Material text field height
  // no visible field labels in the form
  expect(await drawer.locator('form label:not([for*="switch"])').filter({ hasNotText: 'Pending' }).count()).toBe(0)
  // payee: no list before 3 characters, then at most 6 matching suggestions
  const payee = drawer.getByPlaceholder('Payee')
  await payee.fill('Co')
  await expect(drawer.getByRole('listbox', { name: 'Payee suggestions' })).toHaveCount(0)
  await payee.fill('Coo')
  const list = drawer.getByRole('listbox', { name: 'Payee suggestions' })
  await expect(list).toBeVisible()
  const n = await list.getByRole('option').count()
  expect(n).toBeGreaterThan(0)
  expect(n).toBeLessThanOrEqual(6)
  for (const t of await list.getByRole('option').allInnerTexts()) expect(t.toLowerCase()).toContain('coo')
  await list.getByRole('option').first().getByRole('button').click()
  await expect(list).toHaveCount(0)
})
