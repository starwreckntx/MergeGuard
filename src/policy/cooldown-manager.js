/**
 * Cooldown manager for nudges
 * Prevents spam by tracking when nudges were last shown
 */
class CooldownManager {
  constructor(storage, policy) {
    this.storage = storage;
    this.policy = policy;
  }

  /**
   * Get cooldown durations from policy
   * @returns {Object}
   */
  getCooldowns() {
    return this.policy.getCooldowns() || {
      proactive_nudge_ms: 600000,      // 10 minutes
      premerge_reset_after_review_ms: 300000,  // 5 minutes
      token_ttl_ms: 5000
    };
  }

  /**
   * Check if proactive nudge should be shown
   * @param {string} prId - PR identifier
   * @returns {Promise<boolean>}
   */
  async shouldShowProactiveNudge(prId) {
    const key = `nudge_proactive_${prId}`;
    const record = await this.storage.get(key);
    
    if (!record) {
      return true; // Never shown before
    }

    const cooldowns = this.getCooldowns();
    const elapsed = Date.now() - record.timestamp;
    
    return elapsed > (cooldowns.proactive_nudge_ms || 600000);
  }

  /**
   * Record that proactive nudge was shown
   * @param {string} prId - PR identifier
   * @param {number} score - Current readiness score
   * @returns {Promise<void>}
   */
  async recordProactiveNudge(prId, score) {
    const key = `nudge_proactive_${prId}`;
    await this.storage.set(key, {
      timestamp: Date.now(),
      score: score
    });
  }

  /**
   * Check if pre-merge nudge should be shown
   * @param {string} prId - PR identifier
   * @returns {Promise<boolean>}
   */
  async shouldShowPremergeNudge(prId) {
    const key = `nudge_premerge_${prId}`;
    const record = await this.storage.get(key);
    
    if (!record) {
      return true; // Never shown before
    }

    // Check if user reviewed after last dismissal
    const reviewKey = `review_${prId}`;
    const lastReview = await this.storage.get(reviewKey);
    
    if (lastReview && lastReview.timestamp > record.timestamp) {
      return true; // User reviewed after last nudge, reset cooldown
    }

    return false; // Don't re-show immediately after dismiss
  }

  /**
   * Record that pre-merge nudge was shown
   * @param {string} prId - PR identifier
   * @param {number} tier - Tier level shown
   * @param {string} action - Action taken (proceed, dismiss, override)
   * @returns {Promise<void>}
   */
  async recordPremergeNudge(prId, tier, action) {
    const key = `nudge_premerge_${prId}`;
    await this.storage.set(key, {
      timestamp: Date.now(),
      tier: tier,
      action: action
    });
  }

  /**
   * Record that user performed meaningful review
   * @param {string} prId - PR identifier
   * @returns {Promise<void>}
   */
  async recordReview(prId) {
    const key = `review_${prId}`;
    await this.storage.set(key, {
      timestamp: Date.now()
    });
  }

  /**
   * Record one-shot allow token
   * @param {string} prId - PR identifier
   * @param {string} elementId - Element identifier
   * @returns {Promise<void>}
   */
  async createAllowToken(prId, elementId) {
    const key = `allow_token_${prId}_${elementId}`;
    const cooldowns = this.getCooldowns();
    
    await this.storage.set(key, {
      timestamp: Date.now(),
      ttl: cooldowns.token_ttl_ms || 5000,
      used: false
    });
  }

  /**
   * Check if allow token is valid
   * @param {string} prId - PR identifier
   * @param {string} elementId - Element identifier
   * @returns {Promise<boolean>}
   */
  async hasValidToken(prId, elementId) {
    const key = `allow_token_${prId}_${elementId}`;
    const token = await this.storage.get(key);
    
    if (!token) return false;
    if (token.used) return false;
    
    const elapsed = Date.now() - token.timestamp;
    if (elapsed > token.ttl) return false;
    
    return true;
  }

  /**
   * Mark token as used
   * @param {string} prId - PR identifier
   * @param {string} elementId - Element identifier
   * @returns {Promise<void>}
   */
  async consumeToken(prId, elementId) {
    const key = `allow_token_${prId}_${elementId}`;
    const token = await this.storage.get(key);
    
    if (token) {
      token.used = true;
      await this.storage.set(key, token);
      
      // Schedule cleanup
      setTimeout(() => {
        this.storage.remove(key);
      }, 100);
    }
  }

  /**
   * Clear all cooldowns for a PR
   * @param {string} prId - PR identifier
   * @returns {Promise<void>}
   */
  async clearForPR(prId) {
    const keys = [
      `nudge_proactive_${prId}`,
      `nudge_premerge_${prId}`,
      `review_${prId}`
    ];
    
    for (const key of keys) {
      await this.storage.remove(key);
    }
  }

  /**
   * Get cooldown status for debugging
   * @param {string} prId - PR identifier
   * @returns {Promise<Object>}
   */
  async getStatus(prId) {
    const [proactive, premerge, review] = await Promise.all([
      this.storage.get(`nudge_proactive_${prId}`),
      this.storage.get(`nudge_premerge_${prId}`),
      this.storage.get(`review_${prId}`)
    ]);

    const cooldowns = this.getCooldowns();
    const now = Date.now();

    return {
      proactive: proactive ? {
        lastShown: proactive.timestamp,
        ago: now - proactive.timestamp,
        remaining: Math.max(0, (cooldowns.proactive_nudge_ms || 600000) - (now - proactive.timestamp)),
        canShow: await this.shouldShowProactiveNudge(prId)
      } : { canShow: true },
      premerge: premerge ? {
        lastShown: premerge.timestamp,
        ago: now - premerge.timestamp,
        tier: premerge.tier,
        action: premerge.action,
        canShow: await this.shouldShowPremergeNudge(prId)
      } : { canShow: true },
      lastReview: review?.timestamp
    };
  }

  /**
   * Clean up expired cooldowns across all PRs
   * @returns {Promise<number>} Number of items cleaned
   */
  async cleanup() {
    const all = await this.storage.getAll();
    const now = Date.now();
    const cooldowns = this.getCooldowns();
    const expiredKeys = [];

    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith('nudge_') && !key.startsWith('allow_token_')) {
        continue;
      }

      const maxAge = key.startsWith('nudge_proactive') 
        ? cooldowns.proactive_nudge_ms 
        : (key.startsWith('allow_token_') ? cooldowns.token_ttl_ms : 86400000); // 1 day default

      if (now - value.timestamp > maxAge * 2) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      await this.storage.remove(key);
    }

    return expiredKeys.length;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CooldownManager;
}
