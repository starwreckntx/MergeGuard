/**
 * Navigation detector for GitHub's Turbo/SPA navigation
 * Handles URL changes and DOM mutations
 */
class NavigationDetector {
  constructor(callback) {
    this.lastHref = location.href;
    this.callback = callback;
    this.observer = null;
    this.urlCheckInterval = null;
    this.isRunning = false;
  }

  /**
   * Start detecting navigation
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Method 1: Poll for URL changes (Turbo doesn't always fire popstate)
    this.urlCheckInterval = setInterval(() => this.checkUrlChange(), 100);

    // Method 2: Listen for Turbo events
    this.listenToTurbo();

    // Method 3: Intercept history API
    this.interceptHistory();

    // Method 4: MutationObserver for DOM changes
    this.setupMutationObserver();

    // Initial detection
    this.onNavigate('initial');
  }

  /**
   * Stop detecting navigation
   */
  stop() {
    this.isRunning = false;
    
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
      this.urlCheckInterval = null;
    }
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /**
   * Check if URL has changed
   */
  checkUrlChange() {
    if (location.href !== this.lastHref) {
      this.lastHref = location.href;
      this.onNavigate('url_change');
    }
  }

  /**
   * Listen for Turbo-specific events
   */
  listenToTurbo() {
    const turboEvents = [
      'turbo:load',
      'turbo:render',
      'turbo:visit',
      'turbolinks:load',
      'pjax:end'
    ];

    for (const eventName of turboEvents) {
      document.addEventListener(eventName, () => {
        this.lastHref = location.href;
        this.onNavigate(eventName);
      }, false);
    }
  }

  /**
   * Intercept history API methods
   */
  interceptHistory() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    const self = this;

    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      setTimeout(() => self.checkUrlChange(), 0);
    };

    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      setTimeout(() => self.checkUrlChange(), 0);
    };

    // Listen for popstate (back/forward buttons)
    window.addEventListener('popstate', () => {
      this.lastHref = location.href;
      this.onNavigate('popstate');
    }, false);
  }

  /**
   * Set up MutationObserver for DOM changes
   */
  setupMutationObserver() {
    // Find the best container to observe
    const container = document.querySelector('[data-turbo-body]') || 
                      document.querySelector('turbo-frame') ||
                      document.querySelector('main') || 
                      document.body;

    if (!container) return;

    this.observer = new MutationObserver((mutations) => {
      if (this.isSignificantChange(mutations)) {
        this.onNavigate('dom_change');
      }
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label', 'data-testid', 'hidden']
    });
  }

  /**
   * Determine if mutations indicate a significant change
   * @param {MutationRecord[]} mutations 
   * @returns {boolean}
   */
  isSignificantChange(mutations) {
    const significantSelectors = [
      '.merge-box',
      '[data-testid="mergebox"]',
      '[data-testid="pr-merge-box"]',
      '.merge-message',
      '.file-diff',
      '.diff-view',
      '#partial-discussion-header'
    ];

    for (const mutation of mutations) {
      // Check added nodes
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node;
          
          // Check if it's a significant element
          for (const selector of significantSelectors) {
            if (element.matches?.(selector) || element.querySelector?.(selector)) {
              return true;
            }
          }
        }
      }

      // Check if merge-related attributes changed
      const target = mutation.target;
      if (target?.matches?.('.merge-box, [data-testid="mergebox"]')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Handle navigation event
   * @param {string} reason - Reason for navigation
   */
  onNavigate(reason) {
    const isPRPage = this.isPRPage();
    
    this.callback({
      type: 'navigate',
      reason: reason,
      url: location.href,
      isPRPage: isPRPage
    });
  }

  /**
   * Check if current page is a PR page
   * @returns {boolean}
   */
  isPRPage() {
    return /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/.test(location.href);
  }

  /**
   * Check if URL changed to/from PR page
   * @returns {Object|null} Change info or null
   */
  checkPRTransition() {
    const wasPR = /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/.test(this.lastHref);
    const isPR = this.isPRPage();

    if (!wasPR && isPR) {
      return { type: 'enter_pr', url: location.href };
    }
    if (wasPR && !isPR) {
      return { type: 'leave_pr', url: location.href };
    }
    if (wasPR && isPR) {
      // Check if different PR
      const oldMatch = this.lastHref.match(/pull\/(\d+)/);
      const newMatch = location.href.match(/pull\/(\d+)/);
      if (oldMatch && newMatch && oldMatch[1] !== newMatch[1]) {
        return { type: 'switch_pr', url: location.href };
      }
      return { type: 'same_pr', url: location.href };
    }
    
    return null;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NavigationDetector;
}
