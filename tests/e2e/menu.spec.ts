import { expect, test } from '@playwright/test'

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/settings')
  await expect(page.getByText('Local folder (development only)')).toBeVisible()
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
}

/** the computed color of an icon inside an element */
const iconColor = (el: import('@playwright/test').Locator) => el.locator('.iconify, [class*="i-lucide"]').first().evaluate((e) => getComputedStyle(e).color)

test('menu: sections, and each entry has its own color (light and dark)', async ({ page }, info) => {
  await connect(page)
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.evaluate((s) => document.documentElement.classList.toggle('dark', s === 'dark'), scheme)
    if (info.project.name === 'phone') {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' }).click()
      const more = page.getByRole('dialog', { name: 'More' })
      for (const section of ['Daily', 'People', 'My things', 'Accounting', 'App']) await expect(more.getByRole('heading', { name: section })).toBeVisible()
      const loans = await iconColor(more.getByRole('link', { name: /^Loans/ }))
      const chart = await iconColor(more.getByRole('link', { name: /^Chart of accounts/ }))
      expect(loans).not.toBe(chart)
      expect(loans).not.toMatch(/^rgb\((100|113|148), /) // not the grey of a muted icon
      await page.screenshot({ path: info.outputPath(`more-${scheme}.png`) })
      await page.keyboard.press('Escape')
    } else {
      const side = page.locator('nav, aside').filter({ has: page.getByRole('link', { name: 'Chart of accounts' }) }).first()
      const home = await iconColor(side.getByRole('link', { name: 'Home' }))
      const loans = await iconColor(side.getByRole('link', { name: 'Loans' }))
      expect(home).not.toBe(loans)
      await page.screenshot({ path: info.outputPath(`sidebar-${scheme}.png`) })
    }
  }
})
