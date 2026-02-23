/**
 * Policy loader and validator
 * Loads policy.json and provides access to configuration
 */
class PolicyLoader {
  constructor(storage) {
    this.storage = storage;
    this.policy = null;
    this.defaultPolicyUrl = chrome.runtime.getURL('policy.json');
  }

  /**
   * Load policy from storage or default
   * @returns {Promise<Object>} Loaded policy
   */
  async load() {
    // Try to get custom policy from storage
    const customPolicy = await this.storage.get('custom_policy');
    
    if (customPolicy) {
      this.policy = customPolicy;
    } else {
      // Load default policy
      this.policy = await this.loadDefaultPolicy();
    }

    // Validate
    if (!this.validate(this.policy)) {
      console.warn('[PAIS] Policy validation failed, using default');
      this.policy = await this.loadDefaultPolicy();
    }

    return this.policy;
  }

  /**
   * Load default policy from extension
   * @returns {Promise<Object>}
   */
  async loadDefaultPolicy() {
    try {
      const response = await fetch(this.defaultPolicyUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('[PAIS] Failed to load default policy:', error);
      // Return hardcoded fallback
      return this.getFallbackPolicy();
    }
  }

  /**
   * Get fallback policy (hardcoded minimal config)
   * @returns {Object}
   */
  getFallbackPolicy() {
    return {
      policy_version: '1.0.0-fallback',
      checkpoint_matchers: {
        scope_selector: '.merge-box, [data-testid="mergebox"]',
        kinds: {
          MERGE_NOW: {
            patterns: ['Confirm merge', 'Merge pull request'],
            description: 'Immediate merge'
          },
          AUTO_MERGE_ENABLE: {
            patterns: ['Enable auto-merge'],
            description: 'Auto-merge'
          },
          MERGE_QUEUE_ADD: {
            patterns: ['Add to merge queue', 'Merge when ready'],
            description: 'Merge queue'
          }
        }
      },
      nudge_thresholds: {
        signals: {
          files_changed: 0.35,
          checks_viewed: 0.25,
          diff_time_target_ms: 60000,
          diff_time_max: 0.20,
          scroll_depth: 0.10,
          conversation_viewed: 0.10,
          min_time_before_merge_ms: 30000,
          early_merge_penalty: 0.25
        },
        tier1_min: 0.70,
        tier2_min: 0.45
      },
      cooldowns: {
        proactive_nudge_ms: 600000,
        premerge_reset_after_review_ms: 300000,
        token_ttl_ms: 5000
      },
      ui_templates: {
        tier3: {
          MERGE_NOW: {
            title_template: 'Confirm {method} now',
            subtitle_template: 'This will merge into {base_branch} immediately.',
            checklist: [
              'I visited "Files changed" and reviewed the diff.',
              'I checked CI/status checks.',
              'I can restate what this merges into.'
            ],
            confirmation_text: 'MERGE'
          },
          AUTO_MERGE_ENABLE: {
            title: 'Enable auto-merge',
            subtitle: 'This will merge automatically when checks pass.',
            checklist: [
              'I understand this will merge later.',
              'I checked required checks.',
              'I will monitor the result.'
            ],
            confirmation_text: 'MERGE'
          },
          MERGE_QUEUE_ADD: {
            title: 'Add to merge queue',
            subtitle: 'This schedules a merge when queue rules allow.',
            checklist: [
              'I understand this schedules a merge.',
              'I checked this PR is ready.',
              'I will monitor the outcome.'
            ],
            confirmation_text: 'MERGE'
          }
        },
        tier2: {
          title: 'Merge readiness check',
          prompt: 'In one sentence: what are you merging and why now?'
        },
        tier1: {
          message_template: 'Quick merge check: you haven\'t viewed {items} yet.'
        }
      },
      logging: {
        ring_buffer_size: 1000
      },
      privacy: {
        local_logging_enabled: true
      }
    };
  }

  /**
   * Validate policy structure
   * @param {Object} policy - Policy to validate
   * @returns {boolean}
   */
  validate(policy) {
    if (!policy) return false;
    if (!policy.checkpoint_matchers) return false;
    if (!policy.checkpoint_matchers.kinds) return false;
    if (!policy.nudge_thresholds) return false;
    if (!policy.ui_templates) return false;
    
    return true;
  }

  /**
   * Get current policy
   * @returns {Object|null}
   */
  get() {
    return this.policy;
  }

  /**
   * Get checkpoint matchers
   * @returns {Object}
   */
  getCheckpointMatchers() {
    return this.policy?.checkpoint_matchers || {};
  }

  /**
   * Get nudge thresholds
   * @returns {Object}
   */
  getNudgeThresholds() {
    return this.policy?.nudge_thresholds || {};
  }

  /**
   * Get UI templates
   * @returns {Object}
   */
  getUITemplates() {
    return this.policy?.ui_templates || {};
  }

  /**
   * Get Tier-3 template for checkpoint kind
   * @param {string} kind - Checkpoint kind
   * @returns {Object|null}
   */
  getTier3Template(kind) {
    return this.policy?.ui_templates?.tier3?.[kind] || null;
  }

  /**
   * Get cooldown settings
   * @returns {Object}
   */
  getCooldowns() {
    return this.policy?.cooldowns || {};
  }

  /**
   * Check if a button text matches a checkpoint kind
   * @param {string} text - Button text
   * @param {string} kind - Checkpoint kind
   * @returns {boolean}
   */
  matchesCheckpoint(text, kind) {
    const patterns = this.policy?.checkpoint_matchers?.kinds?.[kind]?.patterns;
    if (!patterns) return false;

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(text)) return true;
      } catch (e) {
        console.warn('[PAIS] Invalid regex pattern:', pattern);
      }
    }

    return false;
  }

  /**
   * Classify a button text to checkpoint kind
   * @param {string} text - Button text
   * @returns {string|null} Checkpoint kind or null
   */
  classifyCheckpoint(text) {
    const kinds = this.policy?.checkpoint_matchers?.kinds;
    if (!kinds) return null;

    for (const [kind, config] of Object.entries(kinds)) {
      for (const pattern of config.patterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(text)) return kind;
        } catch (e) {
          console.warn('[PAIS] Invalid regex pattern:', pattern);
        }
      }
    }

    return null;
  }

  /**
   * Set custom policy
   * @param {Object} policy - New policy
   * @returns {Promise<void>}
   */
  async setCustomPolicy(policy) {
    if (this.validate(policy)) {
      await this.storage.set('custom_policy', policy);
      this.policy = policy;
    } else {
      throw new Error('Invalid policy structure');
    }
  }

  /**
   * Reset to default policy
   * @returns {Promise<void>}
   */
  async resetToDefault() {
    await this.storage.remove('custom_policy');
    this.policy = await this.loadDefaultPolicy();
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PolicyLoader;
}
