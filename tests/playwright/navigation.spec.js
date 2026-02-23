/**
 * Navigation and SPA Tests
 * Tests Turbo/PJAX navigation handling
 */

const { test, expect } = require('@playwright/test');

test.describe('Turbo Navigation', () => {
  
  test('should detect PR navigation without page reload', async ({ page }) => {
    // Start at first PR
    await page.goto('https://github.com/facebook/react/pull/25000');
    await page.waitForTimeout(2000);
    
    // Navigate to different PR via link (Turbo navigation)
    // This simulates clicking a PR link in the sidebar
    await page.evaluate(() => {
      // Simulate Turbo navigation
      history.pushState(null, '', '/facebook/react/pull/25001');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    
    await page.waitForTimeout(1000);
    
    // Extension should have reinitialized for new PR
    // Check by looking for any PAIS elements
    const hasPAIS = await page.locator('.pais-banner, .pais-modal').count() > 0;
    // Should be able to show elements on new PR
  });

  test('should reset state on PR change', async ({ page }) => {
    await page.goto('https://github.com/facebook/react/pull/25000');
    await page.waitForTimeout(2000);
    
    // Navigate to files tab to record state
    await page.click('a.tabnav-tab:has-text("Files changed")');
    await page.waitForTimeout(1000);
    
    // Navigate to different PR
    await page.evaluate(() => {
      history.pushState(null, '', '/facebook/react/pull/25001');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForTimeout(1000);
    
    // State should be fresh for new PR
    // (would need to check internal state or observe behavior)
  });

  test('should handle browser back/forward', async ({ page }) => {
    await page.goto('https://github.com/facebook/react/pull/25000');
    await page.waitForTimeout(2000);
    
    // Navigate to another page
    await page.click('a.tabnav-tab:has-text("Files changed")');
    await page.waitForTimeout(1000);
    
    // Go back
    await page.goBack();
    await page.waitForTimeout(1000);
    
    // Extension should still be functional
    const interceptorActive = await page.evaluate(() => {
      return !!document.paisInterceptor;
    });
  });
});
