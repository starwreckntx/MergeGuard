/**
 * Privacy-minimized audit logger
 * Uses ring buffer for local storage
 */
class Logger {
  constructor(storage, bufferSize = 1000) {
    this.storage = storage;
    this.BUFFER_SIZE = bufferSize;
    this.EVENT_VERSION = '1.0.0';
  }

  /**
   * Get current policy version
   * @returns {Promise<string>}
   */
  async getPolicyVersion() {
    try {
      const policy = await this.storage.get('current_policy');
      return policy?.policy_version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Log an event
   * @param {string} eventType - Type of event
   * @param {Object} payload - Event data
   * @returns {Promise<Object>} Logged event
   */
  async log(eventType, payload) {
    const event = {
      v: this.EVENT_VERSION,
      ts: Date.now(),
      type: eventType,
      payload: this.redact(payload),
      policy_version: await this.getPolicyVersion(),
      extension_version: this.getExtensionVersion()
    };

    // Get current buffer
    let buffer = await this.storage.get('event_buffer') || [];
    
    // Add event
    buffer.push(event);
    
    // Maintain ring buffer size
    while (buffer.length > this.BUFFER_SIZE) {
      buffer.shift();
    }
    
    // Save buffer
    await this.storage.set('event_buffer', buffer);
    
    return event;
  }

  /**
   * Get extension version
   * @returns {string}
   */
  getExtensionVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Redact sensitive fields from payload
   * @param {Object} payload - Raw payload
   * @returns {Object} Redacted payload
   */
  redact(payload) {
    // Clone to avoid mutation
    const redacted = { ...payload };
    
    // Always remove sensitive fields
    const sensitiveFields = [
      'diff_text',
      'comment_text',
      'code_snippet',
      'patch_content',
      'file_content',
      'token',
      'password',
      'api_key',
      'secret'
    ];
    
    for (const field of sensitiveFields) {
      delete redacted[field];
    }
    
    // Truncate long strings
    for (const [key, value] of Object.entries(redacted)) {
      if (typeof value === 'string' && value.length > 500) {
        redacted[key] = value.substring(0, 500) + '... [truncated]';
      }
    }
    
    return redacted;
  }

  // Event-specific logging methods

  async logPRViewed(repo, prNumber, url) {
    return this.log('pr_viewed', { repo, pr: prNumber, url });
  }

  async logTabViewed(tab) {
    return this.log('tab_viewed', { tab });
  }

  async logDiffMetrics(diffTimeMs, scrollMaxPct) {
    return this.log('diff_metrics', { 
      diff_time_ms: diffTimeMs, 
      diff_scroll_max_pct: Math.round(scrollMaxPct * 100) / 100
    });
  }

  async logNudgeShown(tier, timing, score, reasons) {
    return this.log('nudge_shown', { 
      tier, 
      timing, 
      score: Math.round(score * 100) / 100, 
      reasons 
    });
  }

  async logNudgeAction(action, metadata = {}) {
    return this.log('nudge_action', { action, ...metadata });
  }

  async logMergeAttempted(surface) {
    return this.log('merge_attempted', { surface });
  }

  async logCheckpointIntercepted(kind, mergeMethod, intentTiming) {
    return this.log('checkpoint_intercepted', { 
      checkpoint_kind: kind, 
      merge_method: mergeMethod, 
      intent_timing: intentTiming 
    });
  }

  async logCheckpointCompleted(timeToCompleteMs) {
    return this.log('checkpoint_completed', { 
      time_to_complete_ms: timeToCompleteMs 
    });
  }

  async logCheckpointAborted() {
    return this.log('checkpoint_aborted', {});
  }

  async logOverrideAcknowledged(tier, reason) {
    return this.log('override_acknowledged', { tier, reason });
  }

  /**
   * Export logs as JSON file
   * @returns {Promise<void>}
   */
  async export() {
    const buffer = await this.storage.get('event_buffer') || [];
    
    const exportData = {
      export_timestamp: Date.now(),
      export_date: new Date().toISOString(),
      extension_version: this.getExtensionVersion(),
      event_count: buffer.length,
      events: buffer
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
      type: 'application/json' 
    });
    
    const url = URL.createObjectURL(blob);
    
    await chrome.downloads.download({
      url: url,
      filename: `pais-log-${Date.now()}.json`,
      saveAs: true
    });
  }

  /**
   * Clear all logs
   * @returns {Promise<void>}
   */
  async clear() {
    await this.storage.remove('event_buffer');
  }

  /**
   * Get recent events
   * @param {number} count - Number of events to retrieve
   * @returns {Promise<Array>}
   */
  async getRecent(count = 100) {
    const buffer = await this.storage.get('event_buffer') || [];
    return buffer.slice(-count);
  }

  /**
   * Get events by type
   * @param {string} type - Event type
   * @returns {Promise<Array>}
   */
  async getByType(type) {
    const buffer = await this.storage.get('event_buffer') || [];
    return buffer.filter(e => e.type === type);
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Logger;
}
