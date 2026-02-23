/**
 * Tier-1 Proactive Banner
 * Non-blocking nudge shown on page load
 */
class Tier1Banner {
  constructor(policy) {
    this.policy = policy;
    this.currentBanner = null;
    this.template = policy.getUITemplates().tier1 || {
      message_template: 'Quick merge check: you haven\'t viewed {items} yet.'
    };
  }

  /**
   * Show Tier-1 banner
   * @param {string[]} missingItems - List of missing review items
   * @param {Object} callbacks - {onOpenFiles, onOpenChecks, onProceed, onDismiss}
   * @returns {HTMLElement} Banner element
   */
  show(missingItems, callbacks = {}) {
    // Close any existing banner
    this.close();

    if (!missingItems || missingItems.length === 0) {
      return null;
    }

    this.currentBanner = this.createBannerElement(missingItems, callbacks);
    
    // Inject into page
    const container = this.findContainer();
    if (container) {
      container.insertBefore(this.currentBanner, container.firstChild);
    } else {
      // Fallback: prepend to body
      document.body.prepend(this.currentBanner);
    }

    return this.currentBanner;
  }

  /**
   * Find appropriate container for banner
   * @returns {HTMLElement|null}
   */
  findContainer() {
    const selectors = [
      '.merge-box',
      '[data-testid="mergebox"]',
      '[data-testid="pr-merge-box"]',
      '.discussion-timeline',
      '#partial-discussion-sidebar',
      '.repository-content'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        // Return parent for better placement
        return element.parentElement || element;
      }
    }

    return null;
  }

  /**
   * Create banner DOM element
   * @param {string[]} missingItems - Missing items
   * @param {Object} callbacks - Action callbacks
   * @returns {HTMLElement}
   */
  createBannerElement(missingItems, callbacks) {
    const banner = document.createElement('div');
    banner.className = 'pais-banner pais-tier1';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');

    const itemsText = missingItems.join(' / ');
    const message = this.template.message_template.replace('{items}', itemsText);

    banner.innerHTML = `
      <div class="pais-banner-content">
        <span class="pais-icon" aria-hidden="true">⚡</span>
        <span class="pais-message">${this.escapeHtml(message)}</span>
        <div class="pais-banner-actions">
          ${missingItems.includes('Files changed') ? `
            <button data-action="open-files" class="pais-btn-small">
              Open Files changed
            </button>
          ` : ''}
          ${missingItems.includes('Checks') ? `
            <button data-action="open-checks" class="pais-btn-small">
              Open Checks
            </button>
          ` : ''}
          <button data-action="proceed" class="pais-proceed">
            Proceed
          </button>
        </div>
        <button class="pais-banner-dismiss" data-action="dismiss" aria-label="Dismiss">
          ×
        </button>
      </div>
    `;

    this.attachEventListeners(banner, callbacks);
    return banner;
  }

  /**
   * Attach event listeners
   * @param {HTMLElement} banner - Banner element
   * @param {Object} callbacks - Action callbacks
   */
  attachEventListeners(banner, callbacks) {
    // Open Files changed
    banner.querySelector('[data-action="open-files"]')?.addEventListener('click', () => {
      this.navigateToTab('files');
      callbacks.onOpenFiles?.();
    });

    // Open Checks
    banner.querySelector('[data-action="open-checks"]')?.addEventListener('click', () => {
      this.navigateToTab('checks');
      callbacks.onOpenChecks?.();
    });

    // Proceed
    banner.querySelector('[data-action="proceed"]')?.addEventListener('click', () => {
      this.close();
      callbacks.onProceed?.();
    });

    // Dismiss
    banner.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
      this.close();
      callbacks.onDismiss?.();
    });
  }

  /**
   * Navigate to a tab
   * @param {string} tab - Tab name (files, checks, conversation)
   */
  navigateToTab(tab) {
    const tabMap = {
      'files': 'files_changed',
      'checks': 'commits',  // GitHub uses 'commits' for checks tab sometimes
      'conversation': 'conversation'
    };

    const tabName = tabMap[tab] || tab;
    
    // Try to find and click the tab
    const selectors = [
      `.tabnav-tab[href*="${tabName}"]`,
      `.tabnav-tab:has-text("${tab === 'files' ? 'Files' : tab === 'checks' ? 'Checks' : 'Conversation'}")`,
      `a[role="tab"][href*="${tabName}"]`,
      `[data-tab-item="${tabName}"]`
    ];

    for (const selector of selectors) {
      const tabElement = document.querySelector(selector);
      if (tabElement) {
        tabElement.click();
        return;
      }
    }

    // Fallback: modify URL
    const url = new URL(location.href);
    url.searchParams.set('tab', tabName);
    history.pushState(null, '', url.toString());
    
    // Trigger navigation event
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  /**
   * Close banner
   */
  close() {
    if (this.currentBanner) {
      // Fade out animation
      this.currentBanner.style.opacity = '0';
      this.currentBanner.style.transform = 'translateY(-10px)';
      this.currentBanner.style.transition = 'opacity 0.2s, transform 0.2s';
      
      setTimeout(() => {
        this.currentBanner?.remove();
        this.currentBanner = null;
      }, 200);
    }
  }

  /**
   * Check if banner is showing
   * @returns {boolean}
   */
  isShowing() {
    return !!this.currentBanner && document.contains(this.currentBanner);
  }

  /**
   * Update banner content
   * @param {string[]} missingItems - Updated missing items
   */
  update(missingItems) {
    if (!this.isShowing()) return;

    if (missingItems.length === 0) {
      this.close();
      return;
    }

    // Re-render with new content
    const itemsText = missingItems.join(' / ');
    const message = this.template.message_template.replace('{items}', itemsText);
    
    const messageEl = this.currentBanner.querySelector('.pais-message');
    if (messageEl) {
      messageEl.textContent = message;
    }
  }

  /**
   * Escape HTML for safe insertion
   * @param {string} text 
   * @returns {string}
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Tier1Banner;
}
