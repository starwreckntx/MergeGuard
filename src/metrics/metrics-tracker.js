/**
 * Metrics Tracker
 * Measures user behavior signals for readiness scoring
 */
class MetricsTracker {
  constructor(stateManager, logger) {
    this.state = stateManager;
    this.logger = logger;
    
    this.diffStartTime = null;
    this.maxScrollPct = 0;
    this.saveInterval = null;
    this.observers = [];
    this.isTracking = false;
  }

  /**
   * Start tracking metrics
   */
  start() {
    if (this.isTracking) return;
    this.isTracking = true;

    // Track tab switches
    this.observeTabSwitches();

    // Track diff view time and scroll
    this.observeDiffView();

    // Track checks section
    this.observeChecksSection();

    // Periodic save
    this.saveInterval = setInterval(() => this.saveMetrics(), 5000);

    console.log('[PAIS] Metrics tracking started');
  }

  /**
   * Stop tracking metrics
   */
  stop() {
    this.isTracking = false;

    // Save final metrics
    this.saveMetrics();

    // Clear interval
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    // Disconnect observers
    this.observers.forEach(obs => obs.disconnect());
    this.observers = [];

    // Save any pending diff time
    if (this.diffStartTime) {
      const elapsed = Date.now() - this.diffStartTime;
      this.state.addDiffTime(elapsed);
      this.diffStartTime = null;
    }

    console.log('[PAIS] Metrics tracking stopped');
  }

  /**
   * Observe tab switches
   */
  observeTabSwitches() {
    const tabSelectors = [
      '.tabnav-tab',
      '[role="tab"]',
      '.UnderlineNav-item',
      '[data-testid="tab"]'
    ];

    const handleTabClick = (e) => {
      const tab = e.target.closest(tabSelectors.join(', '));
      if (!tab) return;

      const tabName = this.identifyTab(tab);
      if (tabName) {
        this.state.recordTabView(tabName);
        this.logger.logTabViewed(tabName);
      }
    };

    document.addEventListener('click', handleTabClick, false);
    
    // Store cleanup function
    this.observers.push({
      disconnect: () => document.removeEventListener('click', handleTabClick, false)
    });
  }

  /**
   * Identify tab name from element
   * @param {HTMLElement} tabElement 
   * @returns {string|null}
   */
  identifyTab(tabElement) {
    const text = (tabElement.textContent || tabElement.getAttribute('aria-label') || '').toLowerCase();
    
    if (text.includes('conversation') || text.includes('overview')) {
      return 'conversation';
    }
    if (text.includes('files') || text.includes('changed') || text.includes('diff')) {
      return 'files';
    }
    if (text.includes('check') || text.includes('commit')) {
      return 'checks';
    }

    // Check href
    const href = tabElement.getAttribute('href') || '';
    if (href.includes('files')) return 'files';
    if (href.includes('commits')) return 'checks';
    if (href.includes('conversation')) return 'conversation';

    return null;
  }

  /**
   * Observe diff view for time and scroll
   */
  observeDiffView() {
    const diffSelectors = [
      '.file-diff',
      '.diff-view',
      '.js-file-line-container',
      '[data-testid="file-diff"]',
      '.pull-request-tab-content'
    ];

    const diffContainer = document.querySelector(diffSelectors.join(', '));
    if (!diffContainer) return;

    // Visibility observer for time tracking
    const visibilityObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Started viewing diff
          this.diffStartTime = Date.now();
        } else if (this.diffStartTime) {
          // Stopped viewing diff
          const elapsed = Date.now() - this.diffStartTime;
          this.state.addDiffTime(elapsed);
          this.diffStartTime = null;
        }
      });
    }, { threshold: 0.3 });

    visibilityObserver.observe(diffContainer);
    this.observers.push(visibilityObserver);

    // Scroll tracking
    const scrollContainer = diffContainer.closest('.overflow-auto, .js-diff-container') || 
                           diffContainer.parentElement || 
                           window;

    const handleScroll = () => {
      const scrollTop = scrollContainer.scrollTop || window.scrollY || 0;
      const scrollHeight = scrollContainer.scrollHeight || document.documentElement.scrollHeight;
      const clientHeight = scrollContainer.clientHeight || window.innerHeight;
      
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll > 0) {
        const pct = (scrollTop / maxScroll) * 100;
        this.maxScrollPct = Math.max(this.maxScrollPct, pct);
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    
    this.observers.push({
      disconnect: () => scrollContainer.removeEventListener('scroll', handleScroll)
    });
  }

  /**
   * Observe checks section
   */
  observeChecksSection() {
    const checksSelectors = [
      '.merge-status-list',
      '.commit-build-statuses',
      '[data-testid="checks-summary"]',
      '.branch-action-item-icon svg[aria-label*="check"]'
    ];

    const checksSection = document.querySelector(checksSelectors.join(', '));
    if (!checksSection) return;

    // Track if checks section is viewed
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        this.state.recordChecksViewed();
        observer.disconnect(); // Only need to record once
      }
    }, { threshold: 0.2 });

    observer.observe(checksSection);
    this.observers.push(observer);
  }

  /**
   * Save current metrics to state
   */
  saveMetrics() {
    const diffTime = this.getTotalDiffTime();
    
    this.state.updateDiffMetrics({
      diff_time_ms: diffTime,
      diff_scroll_max_pct: this.maxScrollPct
    });

    // Log periodically (not every save)
    if (diffTime > 0 && diffTime % 30000 < 5000) {
      this.logger.logDiffMetrics(diffTime, this.maxScrollPct);
    }
  }

  /**
   * Get total diff time including current session
   * @returns {number} Milliseconds
   */
  getTotalDiffTime() {
    let total = this.state.getDiffTimeAccumulated();
    if (this.diffStartTime) {
      total += Date.now() - this.diffStartTime;
    }
    return total;
  }

  /**
   * Get current scroll percentage
   * @returns {number}
   */
  getScrollPct() {
    return this.maxScrollPct;
  }

  /**
   * Get all current metrics
   * @returns {Object}
   */
  getMetrics() {
    return {
      diff_time_ms: this.getTotalDiffTime(),
      diff_scroll_max_pct: this.maxScrollPct,
      tabs_viewed: this.state.getState()?.tabsViewed || [],
      checks_viewed: this.state.getState()?.checksViewed || false
    };
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MetricsTracker;
}
