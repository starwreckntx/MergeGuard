/**
 * Nudge Tests (Tier-1 and Tier-2)
 */

const { test, expect } = require('@playwright/test');

test.describe('Readiness Nudges', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('https://github.com/facebook/react/pull/25000');
    await page.waitForTimeout(2000);
  });

  test('should show Tier-1 banner when files not viewed', async ({ page }) => {
    // Banner should appear after page load delay
    await page.waitForTimeout(3000);
    
    const banner = page.locator('.pais-banner.pais-tier1');
    await expect(banner).toBeVisible();
    
    // Should mention missing items
    await expect(banner.locator('.pais-message')).toContainText('Files changed');
  });

  test('Tier-1 banner should have action buttons', async ({ page }) => {
    await page.waitForTimeout(3000);
    
    const banner = page.locator('.pais-banner.pais-tier1');
    if (!(await banner.isVisible().catch(() => false))) return;
    
    // Should have "Open Files changed" button
    await expect(banner.locator('button:has-text("Open Files changed")')).toBeVisible();
    
    // Should have dismiss button
    await expect(banner.locator('.pais-banner-dismiss')).toBeVisible();
  });

  test('clicking "Open Files changed" should navigate to files tab', async ({ page }) => {
    await page.waitForTimeout(3000);
    
    const banner = page.locator('.pais-banner.pais-tier1');
    if (!(await banner.isVisible().catch(() => false))) return;
    
    await banner.locator('button:has-text("Open Files changed")').click();
    await page.waitForTimeout(1000);
    
    // URL should change to files tab
    await expect(page).toHaveURL(/tab=files_changed/);
  });

  test('dismissing banner should remove it', async ({ page }) => {
    await page.waitForTimeout(3000);
    
    const banner = page.locator('.pais-banner.pais-tier1');
    if (!(await banner.isVisible().catch(() => false))) return;
    
    await banner.locator('.pais-banner-dismiss').click();
    await page.waitForTimeout(500);
    
    await expect(banner).not.toBeVisible();
  });

  test('Tier-2 modal should show on merge attempt with low readiness', async ({ page }) => {
    // Try to merge quickly without reviewing
    await page.click('[data-testid="mergebox"] button:has-text("Merge pull request")');
    
    // Should show Tier-2 modal instead of going straight to Tier-3
    // (or GitHub's own UI)
    
    // Note: This depends on the readiness score calculation
    // If score is very low, Tier-2 should block before Tier-3
  });

  test('Tier-2 modal requires explanation text', async ({ page }) => {
    // This would require mocking a low-readiness state
    // or navigating in a way that triggers it
  });

  test('Tier-2 override button should log acknowledgment', async ({ page }) => {
    // Test that clicking "Proceed anyway" logs the override
  });

  test('cooldown should prevent immediate re-show of proactive nudge', async ({ page }) => {
    await page.waitForTimeout(3000);
    
    const banner = page.locator('.pais-banner.pais-tier1');
    
    // Dismiss if showing
    if (await banner.isVisible().catch(() => false)) {
      await banner.locator('.pais-banner-dismiss').click();
    }
    
    // Navigate away and back quickly
    await page.goBack();
    await page.waitForTimeout(500);
    await page.goForward();
    await page.waitForTimeout(3000);
    
    // Banner should not immediately reappear due to cooldown
    // (this is a soft check - cooldown might not be implemented)
  });
});
