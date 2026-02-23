/**
 * Readiness score calculator
 * Computes review readiness based on user behavior signals
 */
class ReadinessCalculator {
  constructor(policy) {
    this.policy = policy;
  }

  /**
   * Calculate readiness score from state
   * @param {Object} state - Session state
   * @returns {Object} {score, tier, reasons, positive, raw}
   */
  calculate(state) {
    const signals = this.policy.getNudgeThresholds().signals || {};
    
    let score = 0;
    const reasons = [];
    const positive = [];

    // Positive signals
    
    // Files changed tab viewed (+0.35)
    if (state.tabsViewed?.includes('files')) {
      score += signals.files_changed || 0.35;
      positive.push('files_changed');
    } else {
      reasons.push('files_not_viewed');
    }

    // Checks viewed (+0.25)
    if (state.checksViewed) {
      score += signals.checks_viewed || 0.25;
      positive.push('checks_viewed');
    } else {
      reasons.push('checks_not_viewed');
    }

    // Diff time (scaled 0-0.20)
    const diffTime = state.diffMetrics?.diff_time_ms || 0;
    const diffTimeTarget = signals.diff_time_target_ms || 60000;
    const diffTimeMax = signals.diff_time_max || 0.20;
    const diffTimeScore = Math.min(diffTime / diffTimeTarget, 1) * diffTimeMax;
    score += diffTimeScore;
    
    if (diffTimeScore >= diffTimeMax * 0.9) {
      positive.push('sufficient_diff_time');
    } else {
      reasons.push('insufficient_diff_time');
    }

    // Scroll depth (+0.10 if >= 50%)
    const scrollPct = state.diffMetrics?.diff_scroll_max_pct || 0;
    if (scrollPct >= 50) {
      score += signals.scroll_depth || 0.10;
      positive.push('good_scroll_depth');
    } else {
      reasons.push('low_scroll_depth');
    }

    // Conversation tab viewed (+0.10)
    if (state.tabsViewed?.includes('conversation')) {
      score += signals.conversation_viewed || 0.10;
      positive.push('conversation_viewed');
    }

    // Negative signals
    
    // Early merge penalty (-0.25 if < 30s after load)
    const timeSinceLoad = Date.now() - (state.prLoadTime || Date.now());
    const minTime = signals.min_time_before_merge_ms || 30000;
    if (timeSinceLoad < minTime) {
      score -= signals.early_merge_penalty || 0.25;
      reasons.push('merge_too_fast');
    }

    // Clamp score to [0, 1]
    score = Math.max(0, Math.min(1, score));

    // Determine tier
    const thresholds = this.policy.getNudgeThresholds();
    const tier1Min = thresholds.tier1_min ?? 0.70;
    const tier2Min = thresholds.tier2_min ?? 0.45;

    let tier;
    if (score >= tier1Min) {
      tier = 0; // No nudge needed
    } else if (score >= tier2Min) {
      tier = 1; // Tier 1 banner
    } else {
      tier = 2; // Tier 2 blocking modal
    }

    return {
      score: Math.round(score * 100) / 100,
      tier,
      reasons,
      positive,
      raw: {
        diff_time_ms: diffTime,
        scroll_pct: Math.round(scrollPct * 100) / 100,
        tabs: state.tabsViewed || [],
        time_since_load: timeSinceLoad
      }
    };
  }

  /**
   * Quick check if user is ready to merge
   * @param {Object} state - Session state
   * @returns {boolean}
   */
  isReady(state) {
    const result = this.calculate(state);
    return result.tier === 0;
  }

  /**
   * Get missing items for Tier-1 banner
   * @param {Object} state - Session state
   * @returns {string[]}
   */
  getMissingItems(state) {
    const missing = [];
    
    if (!state.tabsViewed?.includes('files')) {
      missing.push('Files changed');
    }
    
    if (!state.checksViewed) {
      missing.push('Checks');
    }
    
    return missing;
  }

  /**
   * Get score breakdown for debugging
   * @param {Object} state - Session state
   * @returns {Object}
   */
  getBreakdown(state) {
    const signals = this.policy.getNudgeThresholds().signals || {};
    const breakdown = [];

    // Files changed
    const filesViewed = state.tabsViewed?.includes('files');
    breakdown.push({
      signal: 'files_changed',
      value: filesViewed ? (signals.files_changed || 0.35) : 0,
      max: signals.files_changed || 0.35,
      achieved: filesViewed
    });

    // Checks viewed
    breakdown.push({
      signal: 'checks_viewed',
      value: state.checksViewed ? (signals.checks_viewed || 0.25) : 0,
      max: signals.checks_viewed || 0.25,
      achieved: state.checksViewed
    });

    // Diff time
    const diffTime = state.diffMetrics?.diff_time_ms || 0;
    const diffTimeTarget = signals.diff_time_target_ms || 60000;
    const diffTimeMax = signals.diff_time_max || 0.20;
    const diffTimeScore = Math.min(diffTime / diffTimeTarget, 1) * diffTimeMax;
    breakdown.push({
      signal: 'diff_time',
      value: diffTimeScore,
      max: diffTimeMax,
      current: diffTime,
      target: diffTimeTarget,
      achieved: diffTime >= diffTimeTarget
    });

    // Scroll depth
    const scrollPct = state.diffMetrics?.diff_scroll_max_pct || 0;
    breakdown.push({
      signal: 'scroll_depth',
      value: scrollPct >= 50 ? (signals.scroll_depth || 0.10) : 0,
      max: signals.scroll_depth || 0.10,
      current: scrollPct,
      achieved: scrollPct >= 50
    });

    // Conversation
    const convViewed = state.tabsViewed?.includes('conversation');
    breakdown.push({
      signal: 'conversation_viewed',
      value: convViewed ? (signals.conversation_viewed || 0.10) : 0,
      max: signals.conversation_viewed || 0.10,
      achieved: convViewed
    });

    // Penalties
    const timeSinceLoad = Date.now() - (state.prLoadTime || Date.now());
    const minTime = signals.min_time_before_merge_ms || 30000;
    if (timeSinceLoad < minTime) {
      breakdown.push({
        signal: 'early_merge_penalty',
        value: -(signals.early_merge_penalty || 0.25),
        applied: true
      });
    }

    return breakdown;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReadinessCalculator;
}
