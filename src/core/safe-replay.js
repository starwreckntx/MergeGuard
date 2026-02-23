/**
 * Safe Replay Mechanism
 * Prevents double-submits after checkpoint completion
 */
class SafeReplay {
  constructor(cooldownManager, prId) {
    this.cooldownManager = cooldownManager;
    this.prId = prId;
    this.pendingElements = new WeakSet();
  }

  /**
   * Create allow token for element
   * @param {HTMLElement} element - Element to allow
   * @returns {Promise<string>} Token ID
   */
  async createToken(element) {
    const elementId = this.getElementId(element);
    await this.cooldownManager.createAllowToken(this.prId, elementId);
    return elementId;
  }

  /**
   * Check if element has valid allow token
   * @param {HTMLElement} element - Element to check
   * @returns {Promise<boolean>}
   */
  async hasValidToken(element) {
    const elementId = this.getElementId(element);
    return await this.cooldownManager.hasValidToken(this.prId, elementId);
  }

  /**
   * Consume (invalidate) token for element
   * @param {HTMLElement} element - Element
   * @returns {Promise<void>}
   */
  async consumeToken(element) {
    const elementId = this.getElementId(element);
    await this.cooldownManager.consumeToken(this.prId, elementId);
  }

  /**
   * Get unique identifier for element
   * @param {HTMLElement} element 
   * @returns {string}
   */
  getElementId(element) {
    // Use existing ID or generate one
    if (element.id) return element.id;
    
    // Use data attributes
    if (element.dataset.testid) return `testid-${element.dataset.testid}`;
    if (element.dataset.action) return `action-${element.dataset.action}`;
    
    // Generate based on position and content
    const text = element.textContent?.trim().substring(0, 20) || '';
    const tag = element.tagName;
    const type = element.type || '';
    
    return `${tag}-${type}-${text}-${element.getAttribute('name') || ''}`;
  }

  /**
   * Replay the original action safely
   * @param {HTMLElement} element - Element to replay
   * @returns {Promise<boolean>} Success
   */
  async replay(element) {
    // Prevent double replay
    if (this.isPending(element)) {
      console.warn('[PAIS] Replay already pending for element');
      return false;
    }

    this.markPending(element);

    try {
      // Create token before replay
      await this.createToken(element);

      // Replay based on element type
      if (element.tagName === 'FORM') {
        this.replayForm(element);
      } else if (element.tagName === 'BUTTON' || element.tagName === 'INPUT') {
        this.replayButton(element);
      } else if (element.tagName === 'A') {
        this.replayAnchor(element);
      } else {
        // Generic click
        element.click();
      }

      return true;
    } catch (error) {
      console.error('[PAIS] Replay failed:', error);
      return false;
    } finally {
      this.clearPending(element);
    }
  }

  /**
   * Replay form submission
   * @param {HTMLFormElement} form 
   */
  replayForm(form) {
    // Use requestSubmit if available (modern, triggers submit event)
    if (form.requestSubmit) {
      const submitter = form.querySelector('button[type="submit"], input[type="submit"]');
      form.requestSubmit(submitter);
    } else {
      // Fallback: dispatch submit event
      const submitEvent = new Event('submit', {
        bubbles: true,
        cancelable: true
      });
      form.dispatchEvent(submitEvent);
      
      // If not prevented, actually submit
      if (!submitEvent.defaultPrevented) {
        form.submit();
      }
    }
  }

  /**
   * Replay button click
   * @param {HTMLButtonElement|HTMLInputElement} button 
   */
  replayButton(button) {
    // Use native click
    button.click();
  }

  /**
   * Replay anchor click
   * @param {HTMLAnchorElement} anchor 
   */
  replayAnchor(anchor) {
    // Simulate full click event
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: 0,
      detail: 1
    });
    
    anchor.dispatchEvent(clickEvent);
    
    // If not prevented and has href, navigate
    if (!clickEvent.defaultPrevented && anchor.href) {
      window.location.href = anchor.href;
    }
  }

  /**
   * Mark element as having pending replay
   * @param {HTMLElement} element 
   */
  markPending(element) {
    this.pendingElements.add(element);
    element.setAttribute('data-pais-pending', 'true');
  }

  /**
   * Clear pending status
   * @param {HTMLElement} element 
   */
  clearPending(element) {
    this.pendingElements.delete(element);
    element.removeAttribute('data-pais-pending');
  }

  /**
   * Check if element has pending replay
   * @param {HTMLElement} element 
   * @returns {boolean}
   */
  isPending(element) {
    return this.pendingElements.has(element) || 
           element.hasAttribute('data-pais-pending');
  }

  /**
   * Create and trigger synthetic event
   * @param {HTMLElement} target 
   * @param {string} type - Event type
   * @param {Object} options - Event options
   */
  dispatchEvent(target, type, options = {}) {
    const event = new Event(type, {
      bubbles: true,
      cancelable: true,
      ...options
    });
    target.dispatchEvent(event);
    return event;
  }

  /**
   * Verify replay safety (for testing)
   * @param {HTMLElement} element 
   * @returns {Object} Safety status
   */
  verifySafety(element) {
    return {
      hasToken: this.hasValidToken(element),
      isPending: this.isPending(element),
      elementId: this.getElementId(element),
      tagName: element.tagName,
      disabled: element.disabled,
      hidden: element.hidden
    };
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SafeReplay;
}
