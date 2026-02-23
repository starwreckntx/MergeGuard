/**
 * Event Interceptor
 * Captures merge-related user actions and applies friction
 */
class EventInterceptor {
  constructor(policy, stateManager, cooldownManager, uiController, logger, safeReplay) {
    this.policy = policy;
    this.state = stateManager;
    this.cooldowns = cooldownManager;
    this.ui = uiController;
    this.logger = logger;
    this.safeReplay = safeReplay;
    
    this.isActive = false;
    this.clickHandler = null;
    this.submitHandler = null;
    this.keydownHandler = null;
  }

  /**
   * Start intercepting events
   */
  start() {
    if (this.isActive) return;
    this.isActive = true;

    // Capture-phase listeners for early interception
    this.clickHandler = (e) => this.handleClick(e);
    this.submitHandler = (e) => this.handleSubmit(e);
    this.keydownHandler = (e) => this.handleKeydown(e);

    document.addEventListener('click', this.clickHandler, true);
    document.addEventListener('submit', this.submitHandler, true);
    document.addEventListener('keydown', this.keydownHandler, true);

    console.log('[PAIS] Event interceptor active');
  }

  /**
   * Stop intercepting events
   */
  stop() {
    this.isActive = false;

    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
    }
    if (this.submitHandler) {
      document.removeEventListener('submit', this.submitHandler, true);
    }
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
    }

    console.log('[PAIS] Event interceptor stopped');
  }

  /**
   * Handle click events
   * @param {MouseEvent} event 
   */
  async handleClick(event) {
    if (!this.shouldIntercept()) return;

    const element = this.findActionableElement(event.target);
    if (!element) return;

    // Check for one-shot allow token (replay)
    if (await this.safeReplay.hasValidToken(element)) {
      await this.safeReplay.consumeToken(element);
      return; // Let it proceed
    }

    // Classify the action
    const actionInfo = this.classifyAction(element);
    if (!actionInfo) return;

    // This is a checkpoint action - intercept it
    event.preventDefault();
    event.stopImmediatePropagation();

    // Handle based on checkpoint kind
    await this.handleCheckpoint(actionInfo, element);
  }

  /**
   * Handle form submissions
   * @param {SubmitEvent} event 
   */
  async handleSubmit(event) {
    if (!this.shouldIntercept()) return;

    const form = event.target;
    
    // Check if this is a merge-related form
    const actionInfo = this.classifyForm(form);
    if (!actionInfo) return;

    // Check for token
    if (await this.safeReplay.hasValidToken(form)) {
      await this.safeReplay.consumeToken(form);
      return;
    }

    // Intercept
    event.preventDefault();
    event.stopImmediatePropagation();

    await this.handleCheckpoint(actionInfo, form);
  }

  /**
   * Handle keyboard events (Enter key)
   * @param {KeyboardEvent} event 
   */
  async handleKeydown(event) {
    if (!this.shouldIntercept()) return;
    if (event.key !== 'Enter') return;

    const element = document.activeElement;
    if (!element) return;

    // Check if active element is a merge button
    const actionInfo = this.classifyAction(element);
    if (!actionInfo) return;

    // Check for token
    if (await this.safeReplay.hasValidToken(element)) {
      await this.safeReplay.consumeToken(element);
      return;
    }

    // Intercept
    event.preventDefault();
    event.stopImmediatePropagation();

    await this.handleCheckpoint(actionInfo, element);
  }

  /**
   * Find actionable element from event target
   * @param {HTMLElement} target 
   * @returns {HTMLElement|null}
   */
  findActionableElement(target) {
    const selectors = [
      'button[type="submit"]',
      'button[type="button"]',
      'input[type="submit"]',
      'button',
      'a[role="button"]',
      '[data-testid="mergebox-submit-button"]',
      '[data-testid="auto-merge-button"]',
      '.merge-box-button'
    ];

    for (const selector of selectors) {
      const element = target.closest(selector);
      if (element) return element;
    }

    // Check if target itself is actionable
    if (target.matches?.('button, input[type="submit"], a[role="button"]')) {
      return target;
    }

    return null;
  }

  /**
   * Get accessible name of element
   * @param {HTMLElement} element 
   * @returns {string}
   */
  getAccessibleName(element) {
    const sources = [
      () => element.getAttribute('aria-label'),
      () => element.getAttribute('title'),
      () => element.value,
      () => element.innerText,
      () => element.textContent,
      () => element.placeholder
    ];

    for (const source of sources) {
      const value = source();
      if (value?.trim()) return value.trim();
    }

    return '';
  }

  /**
   * Check if element is within merge box scope
   * @param {HTMLElement} element 
   * @returns {boolean}
   */
  isInScope(element) {
    const scopeSelector = this.policy.getCheckpointMatchers().scope_selector;
    if (!scopeSelector) return true;

    return !!element.closest(scopeSelector);
  }

  /**
   * Classify action to checkpoint kind
   * @param {HTMLElement} element 
   * @returns {Object|null}
   */
  classifyAction(element) {
    if (!this.isInScope(element)) return null;

    const name = this.getAccessibleName(element);
    if (!name) return null;

    const kind = this.policy.classifyCheckpoint(name);
    if (!kind) return null;

    return {
      kind: kind,
      mergeMethod: this.detectMergeMethod(element, kind),
      intentTiming: kind === 'MERGE_NOW' ? 'now' : 'scheduled',
      element: element,
      accessibleName: name
    };
  }

  /**
   * Classify form submission
   * @param {HTMLFormElement} form 
   * @returns {Object|null}
   */
  classifyForm(form) {
    if (!this.isInScope(form)) return null;

    // Check form action or hidden inputs
    const action = form.getAttribute('action') || '';
    const mergeInput = form.querySelector('input[name="merge"]');
    
    if (mergeInput || action.includes('merge')) {
      return {
        kind: 'MERGE_NOW',
        mergeMethod: this.detectMergeMethod(form, 'MERGE_NOW'),
        intentTiming: 'now',
        element: form,
        accessibleName: 'Merge form'
      };
    }

    return null;
  }

  /**
   * Detect merge method from UI state
   * @param {HTMLElement} element 
   * @param {string} kind 
     * @returns {string}
   */
  detectMergeMethod(element, kind) {
    if (kind !== 'MERGE_NOW') {
      return 'scheduled';
    }

    // Find merge box
    const mergeBox = element.closest('.merge-box, [data-testid="mergebox"], [data-testid="pr-merge-box"]');
    if (!mergeBox) return 'unknown';

    // Check select dropdown
    const select = mergeBox.querySelector('select[name="merge_method"]');
    if (select) {
      return select.value; // 'merge', 'squash', 'rebase'
    }

    // Check selected tab/button
    const selectedTab = mergeBox.querySelector('.select-menu-item.selected, [aria-selected="true"]');
    if (selectedTab) {
      const text = selectedTab.textContent?.toLowerCase() || '';
      if (text.includes('squash')) return 'squash';
      if (text.includes('rebase')) return 'rebase';
      if (text.includes('merge')) return 'merge';
    }

    // Check button text
    const buttonText = element.textContent?.toLowerCase() || '';
    if (buttonText.includes('squash')) return 'squash';
    if (buttonText.includes('rebase')) return 'rebase';

    return 'merge';
  }

  /**
   * Handle checkpoint interception
   * @param {Object} actionInfo 
   * @param {HTMLElement} element 
   */
  async handleCheckpoint(actionInfo, element) {
    // Log interception
    await this.logger.logCheckpointIntercepted(
      actionInfo.kind,
      actionInfo.mergeMethod,
      actionInfo.intentTiming
    );

    // Show appropriate Tier-3 modal
    const result = await this.ui.tier3.show(actionInfo);

    if (result === 'completed') {
      // Log completion
      await this.logger.logCheckpointCompleted(0);
      await this.state.recordCheckpoint(actionInfo.kind, 'completed');

      // Replay the action
      await this.safeReplay.replay(element);
    } else {
      // Log abortion
      await this.logger.logCheckpointAborted();
      await this.state.recordCheckpoint(actionInfo.kind, 'aborted');
    }
  }

  /**
   * Check if interception should occur
   * @returns {boolean}
   */
  shouldIntercept() {
    // Don't intercept if extension is disabled
    if (!this.isActive) return false;

    // Don't intercept if modal is already open
    if (this.ui.tier3?.isOpen()) return false;
    if (this.ui.tier2?.isOpen()) return false;

    return true;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EventInterceptor;
}
