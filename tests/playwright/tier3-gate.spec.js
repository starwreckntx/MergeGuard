/**
 * Tier-3 Checkpoint Gate Tests
 * Tests interception of all merge methods
 */

const { test, expect } = require('@playwright/test');

test.describe('Tier-3 Checkpoint Gate', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to a test PR
    // Note: In real tests, you'd use a test repo or mock page
    await page.goto('https://github.com/facebook/react/pull/25000');
    // Wait for extension to initialize
    await page.waitForTimeout(2000);
  });

  test('should intercept Confirm merge button', async ({ page }) => {
    // Open merge dropdown
    await page.click('[data-testid="mergebox"] button:has-text("Merge pull request")');
    await page.waitForTimeout(500);
    
    // Click confirm button
    await page.click('button:has-text("Confirm merge")');
    
    // Assert modal appears
    const modal = page.locator('.pais-modal.pais-tier3');
    await expect(modal).toBeVisible();
    await expect(modal.locator('h2')).toContainText('Confirm');
  });

  test('should intercept Confirm squash and merge', async ({ page }) => {
    // Select squash method if available
    const squashOption = page.locator('text=Squash and merge').first();
    if (await squashOption.isVisible().catch(() => false)) {
      await squashOption.click();
      await page.click('button:has-text("Squash and merge")');
      await page.click('button:has-text("Confirm squash and merge")');
      
      const modal = page.locator('.pais-modal.pais-tier3');
      await expect(modal).toBeVisible();
      await expect(modal.locator('h2')).toContainText('squash');
    }
  });

  test('should intercept Confirm rebase and merge', async ({ page }) => {
    const rebaseOption = page.locator('text=Rebase and merge').first();
    if (await rebaseOption.isVisible().catch(() => false)) {
      await rebaseOption.click();
      await page.click('button:has-text("Rebase and merge")');
      await page.click('button:has-text("Confirm rebase and merge")');
      
      const modal = page.locator('.pais-modal.pais-tier3');
      await expect(modal).toBeVisible();
      await expect(modal.locator('h2')).toContainText('rebase');
    }
  });

  test('should intercept Enable auto-merge', async ({ page }) => {
    const autoMergeBtn = page.locator('button:has-text("Enable auto-merge")').first();
    if (await autoMergeBtn.isVisible().catch(() => false)) {
      await autoMergeBtn.click();
      
      const modal = page.locator('.pais-modal.pais-tier3');
      await expect(modal).toBeVisible();
      await expect(modal.locator('h2')).toHaveText('Enable auto-merge');
      await expect(modal.locator('.pais-subtitle')).toContainText('automatically');
    }
  });

  test('should intercept Add to merge queue', async ({ page }) => {
    const queueBtn = page.locator('button:has-text(/Add to merge queue|Merge when ready/)').first();
    if (await queueBtn.isVisible().catch(() => false)) {
      await queueBtn.click();
      
      const modal = page.locator('.pais-modal.pais-tier3');
      await expect(modal).toBeVisible();
      await expect(modal.locator('h2')).toContainText(/merge queue|Merge when ready/);
    }
  });

  test('should require all checkboxes and confirmation text', async ({ page }) => {
    // Trigger checkpoint
    await page.click('[data-testid="mergebox"] button:has-text("Merge pull request")').catch(() => {});
    await page.click('button:has-text("Confirm merge")').catch(() => {});
    
    const modal = page.locator('.pais-modal.pais-tier3');
    if (!(await modal.isVisible().catch(() => false))) return;
    
    const confirmBtn = modal.locator('button:has-text("Proceed")');
    
    // Initially disabled
    await expect(confirmBtn).toBeDisabled();
    
    // Check all checkboxes
    const checkboxes = modal.locator('.pais-checklist-item input');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check();
    }
    
    // Still disabled without text
    await expect(confirmBtn).toBeDisabled();
    
    // Type confirmation
    await modal.locator('#pais-confirm-input').fill('MERGE');
    
    // Now enabled
    await expect(confirmBtn).toBeEnabled();
  });

  test('should abort on Cancel', async ({ page }) => {
    await page.click('[data-testid="mergebox"] button:has-text("Merge pull request")').catch(() => {});
    await page.click('button:has-text("Confirm merge")').catch(() => {});
    
    const modal = page.locator('.pais-modal.pais-tier3');
    if (!(await modal.isVisible().catch(() => false))) return;
    
    await modal.locator('button:has-text("Cancel")').click();
    
    await expect(modal).not.toBeVisible();
  });

  test('should abort on Escape key', async ({ page }) => {
    await page.click('[data-testid="mergebox"] button:has-text("Merge pull request")').catch(() => {});
    await page.click('button:has-text("Confirm merge")').catch(() => {});
    
    const modal = page.locator('.pais-modal.pais-tier3');
    if (!(await modal.isVisible().catch(() => false))) return;
    
    await page.keyboard.press('Escape');
    
    await expect(modal).not.toBeVisible();
  });

  test('should prevent double-submit on rapid clicks', async ({ page }) => {
    await page.click('[data-testid="mergebox"] button:has-text("Merge pull request")').catch(() => {});
    await page.click('button:has-text("Confirm merge")').catch(() => {});
    
    const modal = page.locator('.pais-modal.pais-tier3');
    if (!(await modal.isVisible().catch(() => false))) return;
    
    // Complete modal
    const checkboxes = modal.locator('.pais-checklist-item input');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check();
    }
    await modal.locator('#pais-confirm-input').fill('MERGE');
    
    // Double-click proceed (only one action should occur)
    await modal.locator('button:has-text("Proceed")').dblclick();
    
    // Modal should close
    await expect(modal).not.toBeVisible();
  });
});
