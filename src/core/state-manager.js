/**
 * Per-PR session state manager
 * Tracks tabs viewed, diff metrics, and checkpoint history
 */
class StateManager {
  constructor(storage) {
    this.storage = storage;
    this.sessionId = this.generateId();
    this.currentState = null;
    this.prId = null;
  }

  /**
   * Generate unique session ID
   * @returns {string}
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Parse PR info from URL
   * @param {string} url - Current URL
   * @returns {Object|null} {owner, repo, prNumber} or null
   */
  parsePRFromURL(url) {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return null;
    
    return {
      owner: match[1],
      repo: match[2],
      prNumber: parseInt(match[3], 10)
    };
  }

  /**
   * Initialize or load state for current PR
   * @param {string} url - Current URL
   * @returns {Object} Session state
   */
  async initialize(url) {
    const prInfo = this.parsePRFromURL(url);
    if (!prInfo) {
      this.currentState = null;
      this.prId = null;
      return null;
    }

    this.prId = `${prInfo.owner}/${prInfo.repo}/${prInfo.prNumber}`;
    
    // Try to load existing state for this PR
    const existing = await this.storage.get(`state:${this.prId}`);
    
    if (existing && this.isValidState(existing)) {
      // Merge with fresh session data
      this.currentState = {
        ...existing,
        sessionId: this.sessionId,
        lastActive: Date.now()
      };
    } else {
      // Create new state
      this.currentState = this.createFreshState(prInfo);
    }

    // Persist
    await this.save();
    
    return this.currentState;
  }

  /**
   * Create fresh state object
   * @param {Object} prInfo - PR information
   * @returns {Object} Fresh state
   */
  createFreshState(prInfo) {
    return {
      prId: this.prId,
      sessionId: this.sessionId,
      prLoadTime: Date.now(),
      lastActive: Date.now(),
      owner: prInfo.owner,
      repo: prInfo.repo,
      prNumber: prInfo.prNumber,
      tabsViewed: [],
      checksViewed: false,
      diffMetrics: {
        diff_time_ms: 0,
        diff_scroll_max_pct: 0
      },
      nudgesShown: {
        proactive: null,
        premerge: null
      },
      checkpointHistory: [],
      version: '1.0.0'
    };
  }

  /**
   * Validate state structure
   * @param {Object} state - State to validate
   * @returns {boolean}
   */
  isValidState(state) {
    return state &&
           state.prId &&
           state.version === '1.0.0' &&
           Array.isArray(state.tabsViewed) &&
           typeof state.diffMetrics === 'object';
  }

  /**
   * Save current state
   * @returns {Promise<void>}
   */
  async save() {
    if (this.currentState && this.prId) {
      this.currentState.lastActive = Date.now();
      await this.storage.set(`state:${this.prId}`, this.currentState);
    }
  }

  /**
   * Get current state
   * @returns {Object|null}
   */
  getState() {
    return this.currentState;
  }

  /**
   * Record tab view
   * @param {string} tab - Tab name (conversation, files, checks)
   * @returns {Promise<void>}
   */
  async recordTabView(tab) {
    if (!this.currentState) return;
    
    if (!this.currentState.tabsViewed.includes(tab)) {
      this.currentState.tabsViewed.push(tab);
      await this.save();
    }
  }

  /**
   * Record checks viewed
   * @returns {Promise<void>}
   */
  async recordChecksViewed() {
    if (!this.currentState) return;
    
    if (!this.currentState.checksViewed) {
      this.currentState.checksViewed = true;
      await this.save();
    }
  }

  /**
   * Add to accumulated diff time
   * @param {number} ms - Milliseconds to add
   * @returns {Promise<void>}
   */
  async addDiffTime(ms) {
    if (!this.currentState) return;
    
    this.currentState.diffMetrics.diff_time_ms += ms;
    await this.save();
  }

  /**
   * Update max scroll percentage
   * @param {number} pct - Percentage (0-100)
   * @returns {Promise<void>}
   */
  async updateScrollMax(pct) {
    if (!this.currentState) return;
    
    this.currentState.diffMetrics.diff_scroll_max_pct = Math.max(
      this.currentState.diffMetrics.diff_scroll_max_pct,
      pct
    );
    await this.save();
  }

  /**
   * Update diff metrics
   * @param {Object} metrics - {diff_time_ms, diff_scroll_max_pct}
   * @returns {Promise<void>}
   */
  async updateDiffMetrics(metrics) {
    if (!this.currentState) return;
    
    this.currentState.diffMetrics = {
      ...this.currentState.diffMetrics,
      ...metrics
    };
    await this.save();
  }

  /**
   * Record nudge shown
   * @param {string} type - 'proactive' or 'premerge'
   * @param {number} tier - Tier level
   * @returns {Promise<void>}
   */
  async recordNudgeShown(type, tier) {
    if (!this.currentState) return;
    
    this.currentState.nudgesShown[type] = {
      timestamp: Date.now(),
      tier: tier
    };
    await this.save();
  }

  /**
   * Record checkpoint
   * @param {string} kind - Checkpoint kind
   * @param {string} result - 'completed' or 'aborted'
   * @returns {Promise<void>}
   */
  async recordCheckpoint(kind, result) {
    if (!this.currentState) return;
    
    this.currentState.checkpointHistory.push({
      timestamp: Date.now(),
      kind: kind,
      result: result
    });
    
    // Keep only last 10 checkpoints
    if (this.currentState.checkpointHistory.length > 10) {
      this.currentState.checkpointHistory.shift();
    }
    
    await this.save();
  }

  /**
   * Check if tab was viewed
   * @param {string} tab - Tab name
   * @returns {boolean}
   */
  hasViewedTab(tab) {
    return this.currentState?.tabsViewed?.includes(tab) || false;
  }

  /**
   * Get time since PR load
   * @returns {number} Milliseconds
   */
  getTimeSinceLoad() {
    if (!this.currentState) return 0;
    return Date.now() - this.currentState.prLoadTime;
  }

  /**
   * Get accumulated diff time
   * @returns {number} Milliseconds
   */
  getDiffTimeAccumulated() {
    return this.currentState?.diffMetrics?.diff_time_ms || 0;
  }

  /**
   * Reset state for new navigation
   * @returns {Promise<void>}
   */
  async reset() {
    this.currentState = null;
    this.prId = null;
    this.sessionId = this.generateId();
  }

  /**
   * Clear all stored states
   * @returns {Promise<void>}
   */
  async clearAll() {
    const all = await this.storage.getAll();
    const stateKeys = Object.keys(all).filter(key => key.startsWith('state:'));
    
    for (const key of stateKeys) {
      await this.storage.remove(key);
    }
    
    await this.reset();
  }

  /**
   * Get missing review items
   * @returns {string[]} Array of missing items
   */
  getMissingItems() {
    if (!this.currentState) return ['Files changed', 'Checks'];
    
    const missing = [];
    
    if (!this.currentState.tabsViewed.includes('files')) {
      missing.push('Files changed');
    }
    
    if (!this.currentState.checksViewed) {
      missing.push('Checks');
    }
    
    return missing;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StateManager;
}
