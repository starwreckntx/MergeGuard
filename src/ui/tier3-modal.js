/**
 * Tier-3 Checkpoint Modal
 * Non-overridable gate for all merge methods
 */
class Tier3Modal {
  constructor(policy) {
    this.policy = policy;
    this.currentModal = null;
  }

  /**
   * Show Tier-3 modal for checkpoint
   * @param {Object} checkpointInfo - {kind, mergeMethod, intentTiming, element}
   * @returns {Promise<'completed'|'aborted'>}
   */
  async show(checkpointInfo) {
    // Close any existing modal
    this.close();

    const template = this.policy.getTier3Template(checkpointInfo.kind);
    if (!template) {
      console.error('[PAIS] No template for kind:', checkpointInfo.kind);
      return 'aborted';
    }

    const baseBranch = this.detectBaseBranch();
    const config = this.buildConfig(template, checkpointInfo, baseBranch);

    return new Promise((resolve) => {
      this.currentModal = this.createModalElement(config, resolve);
      document.body.appendChild(this.currentModal);
      
      // Focus first checkbox
      const firstCheckbox = this.currentModal.querySelector('.pais-checklist-item input');
      firstCheckbox?.focus();
      
      // Prevent body scroll
      document.body.style.overflow = 'hidden';
    });
  }

  /**
   * Build modal configuration
   * @param {Object} template - Policy template
   * @param {Object} checkpointInfo - Checkpoint info
   * @param {string} baseBranch - Base branch name
   * @returns {Object}
   */
  buildConfig(template, checkpointInfo, baseBranch) {
    const method = checkpointInfo.mergeMethod === 'scheduled' 
      ? 'merge' 
      : (checkpointInfo.mergeMethod || 'merge');

    return {
      title: template.title_template 
        ? template.title_template.replace('{method}', method)
        : template.title,
      subtitle: template.subtitle_template 
        ? template.subtitle_template.replace('{base_branch}', baseBranch)
        : template.subtitle,
      checklist: template.checklist || [],
      confirmationText: template.confirmation_text || 'MERGE',
      kind: checkpointInfo.kind
    };
  }

  /**
   * Detect base branch from page
   * @returns {string}
   */
  detectBaseBranch() {
    // Try multiple selectors for base branch
    const selectors = [
      '.base-ref',
      '[data-testid="base-ref"]',
      '.commit-ref.base-ref',
      '.range-cross-repo-pr .base-ref',
      '[title*="base"] .commit-ref'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent?.trim() || element.getAttribute('title')?.trim();
        if (text) return text;
      }
    }

    // Fallback: look in merge message
    const mergeMsg = document.querySelector('.merge-message, .merge-commit-message');
    if (mergeMsg) {
      const match = mergeMsg.textContent?.match(/into\s+(\S+)/i);
      if (match) return match[1];
    }

    return 'base branch';
  }

  /**
   * Create modal DOM element
   * @param {Object} config - Modal configuration
   * @param {Function} resolve - Promise resolver
   * @returns {HTMLElement}
   */
  createModalElement(config, resolve) {
    const overlay = document.createElement('div');
    overlay.className = 'pais-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pais-tier3-title');

    overlay.innerHTML = `
      <div class="pais-modal pais-tier3">
        <div class="pais-modal-header">
          <h2 id="pais-tier3-title">${this.escapeHtml(config.title)}</h2>
          <p class="pais-subtitle">${this.escapeHtml(config.subtitle)}</p>
        </div>
        <div class="pais-modal-body">
          <div class="pais-checklist">
            <p class="pais-checklist-title">Complete the following:</p>
            ${config.checklist.map((item, i) => `
              <label class="pais-checklist-item">
                <input type="checkbox" data-check-index="${i}" aria-label="${this.escapeHtml(item)}">
                <span>${this.escapeHtml(item)}</span>
              </label>
            `).join('')}
          </div>
          <div class="pais-confirmation">
            <label for="pais-confirm-input">
              Type "<strong>${config.confirmationText}</strong>" to confirm:
            </label>
            <input 
              type="text" 
              id="pais-confirm-input" 
              data-expected="${config.confirmationText}"
              autocomplete="off" 
              autocorrect="off" 
              autocapitalize="off"
              spellcheck="false"
              placeholder="${config.confirmationText}"
            >
          </div>
        </div>
        <div class="pais-modal-footer">
          <button class="pais-btn pais-btn-secondary" data-action="abort">Cancel</button>
          <button class="pais-btn pais-btn-primary" data-action="confirm" disabled>
            Proceed
          </button>
        </div>
      </div>
    `;

    this.attachEventListeners(overlay, config, resolve);
    return overlay;
  }

  /**
   * Attach event listeners to modal
   * @param {HTMLElement} overlay - Modal overlay
   * @param {Object} config - Modal configuration
   * @param {Function} resolve - Promise resolver
   */
  attachEventListeners(overlay, config, resolve) {
    const checkboxes = overlay.querySelectorAll('.pais-checklist-item input[type="checkbox"]');
    const textInput = overlay.querySelector('#pais-confirm-input');
    const confirmBtn = overlay.querySelector('[data-action="confirm"]');
    const abortBtn = overlay.querySelector('[data-action="abort"]');

    const validate = () => {
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      const textValid = textInput.value.trim().toUpperCase() === config.confirmationText.toUpperCase();
      confirmBtn.disabled = !(allChecked && textValid);
    };

    checkboxes.forEach(cb => cb.addEventListener('change', validate));
    textInput.addEventListener('input', validate);

    confirmBtn.addEventListener('click', () => {
      this.close();
      resolve('completed');
    });

    abortBtn.addEventListener('click', () => {
      this.close();
      resolve('aborted');
    });

    // Keyboard handling
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        resolve('aborted');
      }
      if (e.key === 'Enter' && !confirmBtn.disabled && e.target === textInput) {
        e.preventDefault();
        this.close();
        resolve('completed');
      }
    });

    // Click outside to abort
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
        resolve('aborted');
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
  module.exports = Tier3Modal;
}
