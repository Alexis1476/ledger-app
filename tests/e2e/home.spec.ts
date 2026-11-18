import { expect, test } from '@playwright/test'

test('home: the My money / All buttons stay in place when switching', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
  const group = page.getByRole('radiogroup', { name: 'Show' })
  await expect(group).toBeVisible()
  // the page's blocks rise into place when it opens: measure once that entry animation is over
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  const before = await group.boundingBox()
  await group.getByRole('radio', { name: 'All' }).click()
  await expect(group.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true')
  await page.waitForTimeout(800) // the text under the buttons has changed length
  expect(await group.boundingBox()).toEqual(before)
  await group.getByRole('radio', { name: 'My money' }).click()
  await page.waitForTimeout(800)
  expect(await group.boundingBox()).toEqual(before)
})

test('home accounts: the eye opens an account, the arrow shows or hides the pockets of a bank', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
  const accounts = page.locator('section[aria-labelledby="acc-h"]')
  // a bank with several pockets: its button folds and unfolds them, nothing else happens
  const hide = accounts.getByRole('button', { name: 'Hide the pockets of Bank' })
  await expect(accounts.getByText('Bank Checking')).toBeVisible()
  await hide.click()
  await expect(accounts.getByText('Bank Checking')).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  await accounts.getByRole('button', { name: 'Show the pockets of Bank' }).click()
  await expect(accounts.getByText('Bank Checking')).toBeVisible()
  // the row itself does nothing; the eye opens the account
  await accounts.getByText('Bank Checking').click()
  await expect(page).toHaveURL(/\/$/)
  await accounts.getByRole('link', { name: 'Details of Bank Checking' }).click()
  await expect(page).toHaveURL(/\/accounts\/assets%3Abank%3Achecking$/)
})

test('home accounts: the eye of a bank opens all its pockets as one account', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Connect & load' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.locator('section[aria-labelledby="acc-h"]').getByRole('link', { name: 'Details of Cash', exact: true }).click()
  await expect(page).toHaveURL(/\/accounts\/assets%3Acash$/)
  await expect(page.getByText(/^\d+ pockets · total in CHF$/)).toBeVisible()
  // its pockets, each with its own details
  const pockets = page.locator('section[aria-labelledby="pockets-h"]')
  await expect(pockets.getByRole('link', { name: 'Details of Cash EUR' })).toBeVisible()
  await pockets.getByRole('link', { name: 'Details of Cash EUR' }).click()
  await expect(page).toHaveURL(/\/accounts\/assets%3Acash%3Aeur$/)
})
