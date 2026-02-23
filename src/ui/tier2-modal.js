/**
 * Tier-2 Nudge Modal
 * Blocking but overridable with explicit acknowledgment
 */
class Tier2Modal {
  constructor(policy) {
    this.policy = policy;
    this.currentModal = null;
    this.template = policy.getUITemplates().tier2 || {
      title: 'Merge readiness check',
      prompt: 'In one sentence: what are you merging and why now?'
    };
  }

  /**
   * Show Tier-2 modal
   * @param {Object} readiness - Readiness calculation result
   * @returns {Promise<{action: 'proceed'|'override'|'cancel', reason?: string}>}
   */
  async show(readiness) {
    // Close any existing modal
    this.close();

    return new Promise((resolve) => {
      this.currentModal = this.createModalElement(readiness, resolve);
      document.body.appendChild(this.currentModal);
      
      // Focus textarea
      const textarea = this.currentModal.querySelector('#pais-tier2-reason');
      textarea?.focus();
      
      // Prevent body scroll
      document.body.style.overflow = 'hidden';
    });
  }

  /**
   * Create modal DOM element
   * @param {Object} readiness - Readiness calculation
   * @param {Function} resolve - Promise resolver
   * @returns {HTMLElement}
   */
  createModalElement(readiness, resolve) {
    const overlay = document.createElement('div');
    overlay.className = 'pais-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pais-tier2-title');

    const missingItems = this.formatMissingItems(readiness.reasons);
    const scorePercent = Math.round(readiness.score * 100);

    overlay.innerHTML = `
      <div class="pais-modal pais-tier2">
        <div class="pais-modal-header">
          <h2 id="pais-tier2-title">${this.escapeHtml(this.template.title)}</h2>
          <p class="pais-subtitle">
            Readiness score: <strong>${scorePercent}%</strong> — 
            Your review signals suggest a quick merge.
          </p>
        </div>
        <div class="pais-modal-body">
          ${missingItems ? `
            <div class="pais-missing-items">
              <p><strong>Missing:</strong> ${this.escapeHtml(missingItems)}</p>
            </div>
          ` : ''}
          <div class="pais-prompt">
            <label for="pais-tier2-reason">${this.escapeHtml(this.template.prompt)}</label>
            <textarea 
              id="pais-tier2-reason" 
              rows="3" 
              placeholder="Describe what this PR does and why you're merging now..."
              minlength="10"
            ></textarea>
          </div>
        </div>
        <div class="pais-modal-footer">
          <button class="pais-btn pais-btn-secondary" data-action="cancel">Cancel</button>
          <button class="pais-btn pais-btn-primary" data-action="proceed" disabled>
            Continue to merge
          </button>
        </div>
        <div class="pais-modal-footer" style="border-top: none; padding-top: 0;">
          <button class="pais-override" data-action="override">
            Proceed anyway (acknowledge)
          </button>
        </div>
      </div>
    `;

    this.attachEventListeners(overlay, resolve);
    return overlay;
  }

  /**
   * Format missing items for display
   * @param {string[]} reasons - Missing item reasons
   * @returns {string|null}
   */
  formatMissingItems(reasons) {
    const items = [];
    
    if (reasons.includes('files_not_viewed')) {
      items.push('Files changed');
    }
    if (reasons.includes('checks_not_viewed')) {
      items.push('Checks');
    }
    if (reasons.includes('insufficient_diff_time')) {
      items.push('sufficient review time');
    }
    if (reasons.includes('low_scroll_depth')) {
      items.push('diff review (scroll)');
    }
    if (reasons.includes('merge_too_fast')) {
      items.push('time since page load');
    }

    return items.length > 0 ? items.join(', ') : null;
  }

  /**
   * Attach event listeners
   * @param {HTMLElement} overlay - Modal overlay
   * @param {Function} resolve - Promise resolver
   */
  attachEventListeners(overlay, resolve) {
    const textarea = overlay.querySelector('#pais-tier2-reason');
    const proceedBtn = overlay.querySelector('[data-action="proceed"]');
    const cancelBtn = overlay.querySelector('[data-action="cancel"]');
    const overrideBtn = overlay.querySelector('[data-action="override"]');

    // Enable proceed button when sufficient text entered
    textarea.addEventListener('input', () => {
      const length = textarea.value.trim().length;
      proceedBtn.disabled = length < 10;
    });

    cancelBtn.addEventListener('click', () => {
      this.close();
      resolve({ action: 'cancel' });
    });

    proceedBtn.addEventListener('click', () => {
      const reason = textarea.value.trim();
      this.close();
      resolve({ action: 'proceed', reason });
    });

    overrideBtn.addEventListener('click', () => {
      this.close();
      resolve({ action: 'override' });
    });

    // Keyboard handling
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        resolve({ action: 'cancel' });
      }
    });

    // Click outside to cancel
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
        resolve({ action: 'cancel' });
      }
    });
  }

  /**
   * Close current modal
   */
  close() {
    if (this.currentModal) {
      this.currentModal.remove();
      this.currentModal = null;
      document.body.style.overflow = '';
    }
  }

  /**
   * Check if modal is open
   * @returns {boolean}
   */
  isOpen() {
    return !!this.currentModal;
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
  module.exports = Tier2Modal;
}
