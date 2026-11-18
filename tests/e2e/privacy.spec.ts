import { expect, test } from '@playwright/test'

test('privacy: hide amounts blurs the money, is remembered, and can be undone', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
  const blur = () => page.locator('.tabular').first().evaluate((e) => getComputedStyle(e).filter)
  await expect(page.locator('.tabular').first()).toBeVisible()
  expect(await blur()).toBe('none')

  await page.getByRole('button', { name: 'Hide amounts' }).filter({ visible: true }).first().click()
  await expect.poll(blur).toContain('blur')
  // the entry form stays readable
  await page.getByRole('button', { name: 'New entry' }).filter({ visible: true }).first().click()
  const amount = page.getByRole('dialog').getByLabel('Amount')
  await amount.fill('12.50')
  expect(await amount.evaluate((e) => getComputedStyle(e).filter)).toBe('none')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.locator('.tabular').first()).toBeVisible()
  await expect.poll(blur).toContain('blur')

  await page.getByRole('button', { name: 'Show amounts' }).filter({ visible: true }).first().click()
  await expect.poll(blur).toBe('none')
})
