/**
 * PAIS GitHub Extension - Main Content Script
 * Proactive AI Safety friction for GitHub PR merges
 */

// Import all modules (in browser, these are loaded via script tags or bundler)
// For Chrome extension, we'll inline the classes or use ES modules

(function() {
  'use strict';

  // ============== UTILITY CLASSES ==============
  
  class Storage {
    constructor(namespace = 'pais') {
      this.namespace = namespace;
      this.area = chrome.storage.local;
    }
    async get(key) {
      const namespacedKey = `${this.namespace}:${key}`;
      const result = await this.area.get(namespacedKey);
      return result[namespacedKey];
    }
    async set(key, value) {
      const namespacedKey = `${this.namespace}:${key}`;
      await this.area.set({ [namespacedKey]: value });
    }
    async remove(key) {
      const namespacedKey = `${this.namespace}:${key}`;
      await this.area.remove(namespacedKey);
    }
  }

  class Logger {
    constructor(storage, bufferSize = 1000) {
      this.storage = storage;
      this.BUFFER_SIZE = bufferSize;
      this.EVENT_VERSION = '1.0.0';
    }
    async getPolicyVersion() {
      try {
        const policy = await this.storage.get('current_policy');
        return policy?.policy_version || 'unknown';
      } catch { return 'unknown'; }
    }
    getExtensionVersion() {
      try { return chrome.runtime.getManifest().version; } catch { return 'unknown'; }
    }
    async log(eventType, payload) {
      const event = {
        v: this.EVENT_VERSION, ts: Date.now(), type: eventType,
        payload: this.redact(payload),
        policy_version: await this.getPolicyVersion(),
        extension_version: this.getExtensionVersion()
      };
      let buffer = await this.storage.get('event_buffer') || [];
      buffer.push(event);
      while (buffer.length > this.BUFFER_SIZE) buffer.shift();
      await this.storage.set('event_buffer', buffer);
      return event;
    }
    redact(payload) {
      const redacted = { ...payload };
      ['diff_text', 'comment_text', 'code_snippet', 'token', 'password'].forEach(f => delete redacted[f]);
      for (const [k, v] of Object.entries(redacted)) {
        if (typeof v === 'string' && v.length > 500) redacted[k] = v.substring(0, 500) + '...';
      }
      return redacted;
    }
    async logPRViewed(repo, prNumber, url) { return this.log('pr_viewed', { repo, pr: prNumber, url }); }
    async logTabViewed(tab) { return this.log('tab_viewed', { tab }); }
    async logDiffMetrics(diffTimeMs, scrollMaxPct) { return this.log('diff_metrics', { diff_time_ms: diffTimeMs, diff_scroll_max_pct: scrollMaxPct }); }
    async logNudgeShown(tier, timing, score, reasons) { return this.log('nudge_shown', { tier, timing, score, reasons }); }
    async logNudgeAction(action, metadata = {}) { return this.log('nudge_action', { action, ...metadata }); }
    async logCheckpointIntercepted(kind, mergeMethod, intentTiming) { return this.log('checkpoint_intercepted', { checkpoint_kind: kind, merge_method: mergeMethod, intent_timing: intentTiming }); }
    async logCheckpointCompleted(timeToCompleteMs) { return this.log('checkpoint_completed', { time_to_complete_ms: timeToCompleteMs }); }
    async logCheckpointAborted() { return this.log('checkpoint_aborted', {}); }
    async logOverrideAcknowledged(tier, reason) { return this.log('override_acknowledged', { tier, reason }); }
  }

  // ============== STATE MANAGEMENT ==============

  class StateManager {
    constructor(storage) {
      this.storage = storage;
      this.sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      this.currentState = null;
      this.prId = null;
    }
    parsePRFromURL(url) {
      // Support GitHub URLs
      const githubMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (githubMatch) {
        return { owner: githubMatch[1], repo: githubMatch[2], prNumber: parseInt(githubMatch[3], 10) };
      }
      // Support local file testing
      if (url.includes('test-page.html') || url.startsWith('file://')) {
        return { owner: 'test-org', repo: 'test-repo', prNumber: 123 };
      }
      return null;
    }
    async initialize(url) {
      const prInfo = this.parsePRFromURL(url);
      if (!prInfo) { this.currentState = null; this.prId = null; return null; }
      this.prId = `${prInfo.owner}/${prInfo.repo}/${prInfo.prNumber}`;
      const existing = await this.storage.get(`state:${this.prId}`);
      this.currentState = existing && this.isValidState(existing) 
        ? { ...existing, sessionId: this.sessionId, lastActive: Date.now() }
        : this.createFreshState(prInfo);
      await this.save();
      return this.currentState;
    }
    createFreshState(prInfo) {
      return {
        prId: this.prId, sessionId: this.sessionId, prLoadTime: Date.now(), lastActive: Date.now(),
        owner: prInfo.owner, repo: prInfo.repo, prNumber: prInfo.prNumber,
        tabsViewed: [], checksViewed: false,
        diffMetrics: { diff_time_ms: 0, diff_scroll_max_pct: 0 },
        nudgesShown: { proactive: null, premerge: null },
        checkpointHistory: [], version: '1.0.0'
      };
    }
    isValidState(state) {
      return state && state.prId && state.version === '1.0.0' && Array.isArray(state.tabsViewed);
    }
    async save() {
      if (this.currentState && this.prId) {
        this.currentState.lastActive = Date.now();
        await this.storage.set(`state:${this.prId}`, this.currentState);
      }
    }
    getState() { return this.currentState; }
    async recordTabView(tab) {
      if (!this.currentState) return;
      if (!this.currentState.tabsViewed.includes(tab)) {
        this.currentState.tabsViewed.push(tab);
        await this.save();
      }
    }
    async recordChecksViewed() {
      if (!this.currentState) return;
      if (!this.currentState.checksViewed) {
        this.currentState.checksViewed = true;
        await this.save();
      }
    }
    async addDiffTime(ms) {
      if (!this.currentState) return;
      this.currentState.diffMetrics.diff_time_ms += ms;
      await this.save();
    }
    async updateDiffMetrics(metrics) {
      if (!this.currentState) return;
      this.currentState.diffMetrics = { ...this.currentState.diffMetrics, ...metrics };
      await this.save();
    }
    async recordNudgeShown(type, tier) {
      if (!this.currentState) return;
      this.currentState.nudgesShown[type] = { timestamp: Date.now(), tier };
      await this.save();
    }
    async recordCheckpoint(kind, result) {
      if (!this.currentState) return;
      this.currentState.checkpointHistory.push({ timestamp: Date.now(), kind, result });
      if (this.currentState.checkpointHistory.length > 10) this.currentState.checkpointHistory.shift();
      await this.save();
    }
    getDiffTimeAccumulated() { return this.currentState?.diffMetrics?.diff_time_ms || 0; }
    async reset() { this.currentState = null; this.prId = null; this.sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`; }
    getMissingItems() {
      if (!this.currentState) return ['Files changed', 'Checks'];
      const missing = [];
      if (!this.currentState.tabsViewed.includes('files')) missing.push('Files changed');
      if (!this.currentState.checksViewed) missing.push('Checks');
      return missing;
    }
  }

  // ============== POLICY ==============

  class PolicyLoader {
    constructor(storage) {
      this.storage = storage;
      this.policy = null;
    }
    async load() {
      const customPolicy = await this.storage.get('custom_policy');
      if (customPolicy) {
        this.policy = customPolicy;
      } else {
        try {
          const response = await fetch(chrome.runtime.getURL('policy.json'));
          this.policy = await response.json();
        } catch (e) {
          this.policy = this.getFallbackPolicy();
        }
      }
      return this.policy;
    }
    get() { return this.policy; }
    getCheckpointMatchers() { return this.policy?.checkpoint_matchers || {}; }
    getNudgeThresholds() { return this.policy?.nudge_thresholds || {}; }
    getUITemplates() { return this.policy?.ui_templates || {}; }
    getTier3Template(kind) { return this.policy?.ui_templates?.tier3?.[kind] || null; }
    getCooldowns() { return this.policy?.cooldowns || {}; }
    classifyCheckpoint(text) {
      const kinds = this.policy?.checkpoint_matchers?.kinds;
      if (!kinds) return null;
      for (const [kind, config] of Object.entries(kinds)) {
        for (const pattern of config.patterns) {
          try { if (new RegExp(pattern, 'i').test(text)) return kind; } catch (e) {}
        }
      }
      return null;
    }
    getFallbackPolicy() {
      return {
        policy_version: '1.0.0-fallback',
        checkpoint_matchers: {
          scope_selector: '.merge-box, [data-testid="mergebox"]',
          kinds: {
            MERGE_NOW: { patterns: ['Confirm merge', 'Merge pull request'], description: 'Immediate merge' },
            AUTO_MERGE_ENABLE: { patterns: ['Enable auto-merge'], description: 'Auto-merge' },
            MERGE_QUEUE_ADD: { patterns: ['Add to merge queue', 'Merge when ready'], description: 'Merge queue' }
          }
        },
        nudge_thresholds: { signals: { files_changed: 0.35, checks_viewed: 0.25, diff_time_target_ms: 60000, diff_time_max: 0.20, scroll_depth: 0.10, conversation_viewed: 0.10, min_time_before_merge_ms: 30000, early_merge_penalty: 0.25 }, tier1_min: 0.70, tier2_min: 0.45 },
        cooldowns: { proactive_nudge_ms: 600000, premerge_reset_after_review_ms: 300000, token_ttl_ms: 5000 },
        ui_templates: { tier3: { MERGE_NOW: { title_template: 'Confirm {method} now', subtitle_template: 'This will merge into {base_branch} immediately.', checklist: ['I visited "Files changed" and reviewed the diff.', 'I checked CI/status checks.', 'I can restate what this merges into.'], confirmation_text: 'MERGE' }, AUTO_MERGE_ENABLE: { title: 'Enable auto-merge', subtitle: 'This will merge automatically when checks pass.', checklist: ['I understand this will merge later.', 'I checked required checks.', 'I will monitor the result.'], confirmation_text: 'MERGE' }, MERGE_QUEUE_ADD: { title: 'Add to merge queue', subtitle: 'This schedules a merge when queue rules allow.', checklist: ['I understand this schedules a merge.', 'I checked this PR is ready.', 'I will monitor the outcome.'], confirmation_text: 'MERGE' } }, tier2: { title: 'Merge readiness check', prompt: 'In one sentence: what are you merging and why now?' }, tier1: { message_template: 'Quick merge check: you haven\'t viewed {items} yet.' } },
        logging: { ring_buffer_size: 1000 },
        privacy: { local_logging_enabled: true }
      };
    }
  }

  class ReadinessCalculator {
    constructor(policy) { this.policy = policy; }
    calculate(state) {
      const signals = this.policy.getNudgeThresholds().signals || {};
      let score = 0; const reasons = []; const positive = [];
      if (state.tabsViewed?.includes('files')) { score += signals.files_changed || 0.35; positive.push('files_changed'); } else { reasons.push('files_not_viewed'); }
      if (state.checksViewed) { score += signals.checks_viewed || 0.25; positive.push('checks_viewed'); } else { reasons.push('checks_not_viewed'); }
      const diffTime = state.diffMetrics?.diff_time_ms || 0;
      const diffTimeScore = Math.min(diffTime / (signals.diff_time_target_ms || 60000), 1) * (signals.diff_time_max || 0.20);
      score += diffTimeScore;
      if (diffTimeScore >= (signals.diff_time_max || 0.20) * 0.9) positive.push('sufficient_diff_time'); else reasons.push('insufficient_diff_time');
      const scrollPct = state.diffMetrics?.diff_scroll_max_pct || 0;
      if (scrollPct >= 50) { score += signals.scroll_depth || 0.10; positive.push('good_scroll_depth'); } else { reasons.push('low_scroll_depth'); }
      if (state.tabsViewed?.includes('conversation')) { score += signals.conversation_viewed || 0.10; positive.push('conversation_viewed'); }
      const timeSinceLoad = Date.now() - (state.prLoadTime || Date.now());
      if (timeSinceLoad < (signals.min_time_before_merge_ms || 30000)) { score -= signals.early_merge_penalty || 0.25; reasons.push('merge_too_fast'); }
      score = Math.max(0, Math.min(1, score));
      const thresholds = this.policy.getNudgeThresholds();
      const tier1Min = thresholds.tier1_min ?? 0.70; const tier2Min = thresholds.tier2_min ?? 0.45;
      let tier; if (score >= tier1Min) tier = 0; else if (score >= tier2Min) tier = 1; else tier = 2;
      return { score: Math.round(score * 100) / 100, tier, reasons, positive, raw: { diff_time_ms: diffTime, scroll_pct: Math.round(scrollPct * 100) / 100, tabs: state.tabsViewed || [], time_since_load: timeSinceLoad } };
    }
  }

  class CooldownManager {
    constructor(storage, policy) { this.storage = storage; this.policy = policy; }
    getCooldowns() { return this.policy.getCooldowns() || { proactive_nudge_ms: 600000, premerge_reset_after_review_ms: 300000, token_ttl_ms: 5000 }; }
    async shouldShowProactiveNudge(prId) {
      const record = await this.storage.get(`nudge_proactive_${prId}`);
      if (!record) return true;
      return (Date.now() - record.timestamp) > (this.getCooldowns().proactive_nudge_ms || 600000);
    }
    async recordProactiveNudge(prId, score) { await this.storage.set(`nudge_proactive_${prId}`, { timestamp: Date.now(), score }); }
    async shouldShowPremergeNudge(prId) {
      const record = await this.storage.get(`nudge_premerge_${prId}`);
      if (!record) return true;
      const lastReview = await this.storage.get(`review_${prId}`);
      if (lastReview && lastReview.timestamp > record.timestamp) return true;
      return false;
    }
    async recordPremergeNudge(prId, tier, action) { await this.storage.set(`nudge_premerge_${prId}`, { timestamp: Date.now(), tier, action }); }
    async recordReview(prId) { await this.storage.set(`review_${prId}`, { timestamp: Date.now() }); }
    async createAllowToken(prId, elementId) { await this.storage.set(`allow_token_${prId}_${elementId}`, { timestamp: Date.now(), ttl: this.getCooldowns().token_ttl_ms || 5000, used: false }); }
    async hasValidToken(prId, elementId) {
      const token = await this.storage.get(`allow_token_${prId}_${elementId}`);
      if (!token || token.used) return false;
      return (Date.now() - token.timestamp) <= token.ttl;
    }
    async consumeToken(prId, elementId) {
      const token = await this.storage.get(`allow_token_${prId}_${elementId}`);
      if (token) { token.used = true; await this.storage.set(`allow_token_${prId}_${elementId}`, token); setTimeout(() => this.storage.remove(`allow_token_${prId}_${elementId}`), 100); }
    }
  }

  // ============== UI COMPONENTS ==============

  class Tier3Modal {
    constructor(policy) { this.policy = policy; this.currentModal = null; }
    async show(checkpointInfo) {
      this.close();
      const template = this.policy.getTier3Template(checkpointInfo.kind);
      if (!template) return 'aborted';
      const baseBranch = this.detectBaseBranch();
      const config = this.buildConfig(template, checkpointInfo, baseBranch);
      return new Promise((resolve) => {
        this.currentModal = this.createModalElement(config, resolve);
        document.body.appendChild(this.currentModal);
        this.currentModal.querySelector('.pais-checklist-item input')?.focus();
        document.body.style.overflow = 'hidden';
      });
    }
    buildConfig(template, checkpointInfo, baseBranch) {
      const method = checkpointInfo.mergeMethod === 'scheduled' ? 'merge' : (checkpointInfo.mergeMethod || 'merge');
      return { title: template.title_template ? template.title_template.replace('{method}', method) : template.title, subtitle: template.subtitle_template ? template.subtitle_template.replace('{base_branch}', baseBranch) : template.subtitle, checklist: template.checklist || [], confirmationText: template.confirmation_text || 'MERGE', kind: checkpointInfo.kind };
    }
    detectBaseBranch() {
      const selectors = ['.base-ref', '[data-testid="base-ref"]', '.commit-ref.base-ref'];
      for (const selector of selectors) { const el = document.querySelector(selector); if (el) return el.textContent?.trim() || 'base branch'; }
      return 'base branch';
    }
    createModalElement(config, resolve) {
      const overlay = document.createElement('div');
      overlay.className = 'pais-modal-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `<div class="pais-modal pais-tier3"><div class="pais-modal-header"><h2>${this.escapeHtml(config.title)}</h2><p class="pais-subtitle">${this.escapeHtml(config.subtitle)}</p></div><div class="pais-modal-body"><div class="pais-checklist"><p class="pais-checklist-title">Complete the following:</p>${config.checklist.map((item, i) => `<label class="pais-checklist-item"><input type="checkbox" data-check-index="${i}"><span>${this.escapeHtml(item)}</span></label>`).join('')}</div><div class="pais-confirmation"><label>Type "<strong>${config.confirmationText}</strong>" to confirm:</label><input type="text" id="pais-confirm-input" data-expected="${config.confirmationText}" autocomplete="off" placeholder="${config.confirmationText}"></div></div><div class="pais-modal-footer"><button class="pais-btn pais-btn-secondary" data-action="abort">Cancel</button><button class="pais-btn pais-btn-primary" data-action="confirm" disabled>Proceed</button></div></div>`;
      this.attachListeners(overlay, config, resolve); return overlay;
    }
    attachListeners(overlay, config, resolve) {
      const checkboxes = overlay.querySelectorAll('.pais-checklist-item input'); const textInput = overlay.querySelector('#pais-confirm-input'); const confirmBtn = overlay.querySelector('[data-action="confirm"]'); const abortBtn = overlay.querySelector('[data-action="abort"]');
      const validate = () => { confirmBtn.disabled = !(Array.from(checkboxes).every(cb => cb.checked) && textInput.value.trim().toUpperCase() === config.confirmationText.toUpperCase()); };
      checkboxes.forEach(cb => cb.addEventListener('change', validate)); textInput.addEventListener('input', validate);
      confirmBtn.addEventListener('click', () => { this.close(); resolve('completed'); }); abortBtn.addEventListener('click', () => { this.close(); resolve('aborted'); });
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); resolve('aborted'); } if (e.key === 'Enter' && !confirmBtn.disabled && e.target === textInput) { e.preventDefault(); this.close(); resolve('completed'); } });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { this.close(); resolve('aborted'); } });
    }
    close() { if (this.currentModal) { this.currentModal.remove(); this.currentModal = null; document.body.style.overflow = ''; } }
    isOpen() { return !!this.currentModal; }
    escapeHtml(text) { if (!text) return ''; const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
  }

  class Tier2Modal {
    constructor(policy) { this.policy = policy; this.currentModal = null; this.template = policy.getUITemplates().tier2 || { title: 'Merge readiness check', prompt: 'In one sentence: what are you merging and why now?' }; }
    async show(readiness) {
      this.close();
      return new Promise((resolve) => { this.currentModal = this.createElement(readiness, resolve); document.body.appendChild(this.currentModal); this.currentModal.querySelector('#pais-tier2-reason')?.focus(); document.body.style.overflow = 'hidden'; });
    }
    createElement(readiness, resolve) {
      const overlay = document.createElement('div'); overlay.className = 'pais-modal-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
      const missingItems = this.formatMissing(readiness.reasons);
      overlay.innerHTML = `<div class="pais-modal pais-tier2"><div class="pais-modal-header"><h2>${this.escapeHtml(this.template.title)}</h2><p class="pais-subtitle">Readiness score: <strong>${Math.round(readiness.score * 100)}%</strong> — Your review signals suggest a quick merge.</p></div><div class="pais-modal-body">${missingItems ? `<div class="pais-missing-items"><p><strong>Missing:</strong> ${this.escapeHtml(missingItems)}</p></div>` : ''}<div class="pais-prompt"><label>${this.escapeHtml(this.template.prompt)}</label><textarea id="pais-tier2-reason" rows="3" placeholder="Describe what this PR does..."></textarea></div></div><div class="pais-modal-footer"><button class="pais-btn pais-btn-secondary" data-action="cancel">Cancel</button><button class="pais-btn pais-btn-primary" data-action="proceed" disabled>Continue to merge</button></div><div class="pais-modal-footer" style="border-top: none; padding-top: 0;"><button class="pais-override" data-action="override">Proceed anyway (acknowledge)</button></div></div>`;
      this.attachListeners(overlay, resolve); return overlay;
    }
    formatMissing(reasons) { const items = []; if (reasons.includes('files_not_viewed')) items.push('Files changed'); if (reasons.includes('checks_not_viewed')) items.push('Checks'); if (reasons.includes('insufficient_diff_time')) items.push('sufficient review time'); if (reasons.includes('low_scroll_depth')) items.push('diff review (scroll)'); return items.join(', ') || null; }
    attachListeners(overlay, resolve) { const textarea = overlay.querySelector('#pais-tier2-reason'); const proceedBtn = overlay.querySelector('[data-action="proceed"]'); const cancelBtn = overlay.querySelector('[data-action="cancel"]'); const overrideBtn = overlay.querySelector('[data-action="override"]'); textarea.addEventListener('input', () => { proceedBtn.disabled = textarea.value.trim().length < 10; }); cancelBtn.addEventListener('click', () => { this.close(); resolve({ action: 'cancel' }); }); proceedBtn.addEventListener('click', () => { this.close(); resolve({ action: 'proceed', reason: textarea.value.trim() }); }); overrideBtn.addEventListener('click', () => { this.close(); resolve({ action: 'override' }); }); overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.close(); resolve({ action: 'cancel' }); } }); overlay.addEventListener('click', (e) => { if (e.target === overlay) { this.close(); resolve({ action: 'cancel' }); } }); }
    close() { if (this.currentModal) { this.currentModal.remove(); this.currentModal = null; document.body.style.overflow = ''; } }
    isOpen() { return !!this.currentModal; }
    escapeHtml(text) { if (!text) return ''; const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
  }

  class Tier1Banner {
    constructor(policy) { this.policy = policy; this.currentBanner = null; this.template = policy.getUITemplates().tier1 || { message_template: 'Quick merge check: you haven\'t viewed {items} yet.' }; }
    show(missingItems, callbacks = {}) {
      this.close(); if (!missingItems?.length) return null;
      this.currentBanner = this.createElement(missingItems, callbacks);
      const container = this.findContainer();
      if (container) container.insertBefore(this.currentBanner, container.firstChild); else document.body.prepend(this.currentBanner);
      return this.currentBanner;
    }
    findContainer() { const selectors = ['.merge-box', '[data-testid="mergebox"]', '.discussion-timeline', '.repository-content']; for (const s of selectors) { const el = document.querySelector(s); if (el) return el.parentElement || el; } return null; }
    createElement(missingItems, callbacks) {
      const banner = document.createElement('div'); banner.className = 'pais-banner pais-tier1'; banner.setAttribute('role', 'status');
      const message = this.template.message_template.replace('{items}', missingItems.join(' / '));
      banner.innerHTML = `<div class="pais-banner-content"><span class="pais-icon">⚡</span><span class="pais-message">${this.escapeHtml(message)}</span><div class="pais-banner-actions">${missingItems.includes('Files changed') ? '<button data-action="open-files" class="pais-btn-small">Open Files changed</button>' : ''}${missingItems.includes('Checks') ? '<button data-action="open-checks" class="pais-btn-small">Open Checks</button>' : ''}<button data-action="proceed" class="pais-proceed">Proceed</button></div><button class="pais-banner-dismiss" data-action="dismiss">×</button></div>`;
      banner.querySelector('[data-action="open-files"]')?.addEventListener('click', () => { this.navigateTo('files'); callbacks.onOpenFiles?.(); }); banner.querySelector('[data-action="open-checks"]')?.addEventListener('click', () => { this.navigateTo('checks'); callbacks.onOpenChecks?.(); }); banner.querySelector('[data-action="proceed"]')?.addEventListener('click', () => { this.close(); callbacks.onProceed?.(); }); banner.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => { this.close(); callbacks.onDismiss?.(); });
      return banner;
    }
    navigateTo(tab) { const map = { files: 'files_changed', checks: 'commits', conversation: 'conversation' }; const tabName = map[tab] || tab; const selectors = [`.tabnav-tab[href*="${tabName}"]`, `a[role="tab"][href*="${tabName}"]`]; for (const s of selectors) { const el = document.querySelector(s); if (el) { el.click(); return; } } const url = new URL(location.href); url.searchParams.set('tab', tabName); history.pushState(null, '', url.toString()); window.dispatchEvent(new PopStateEvent('popstate')); }
    close() { if (this.currentBanner) { this.currentBanner.style.opacity = '0'; this.currentBanner.style.transform = 'translateY(-10px)'; setTimeout(() => { this.currentBanner?.remove(); this.currentBanner = null; }, 200); } }
    isShowing() { return !!this.currentBanner && document.contains(this.currentBanner); }
    escapeHtml(text) { if (!text) return ''; const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
  }

  // ============== CORE MODULES ==============

  class SafeReplay {
    constructor(cooldownManager, prId) { this.cooldowns = cooldownManager; this.prId = prId; this.pending = new WeakSet(); }
    getElementId(el) { if (el.id) return el.id; if (el.dataset.testid) return `testid-${el.dataset.testid}`; const text = el.textContent?.trim().substring(0, 20) || ''; return `${el.tagName}-${el.type || ''}-${text}-${el.getAttribute('name') || ''}`; }
    async hasValidToken(el) { return this.cooldowns.hasValidToken(this.prId, this.getElementId(el)); }
    async consumeToken(el) { return this.cooldowns.consumeToken(this.prId, this.getElementId(el)); }
    async createToken(el) { return this.cooldowns.createAllowToken(this.prId, this.getElementId(el)); }
    isPending(el) { return this.pending.has(el) || el.hasAttribute('data-pais-pending'); }
    markPending(el) { this.pending.add(el); el.setAttribute('data-pais-pending', 'true'); }
    clearPending(el) { this.pending.delete(el); el.removeAttribute('data-pais-pending'); }
    async replay(el) {
      if (this.isPending(el)) return false;
      this.markPending(el);
      try {
        await this.createToken(el);
        if (el.tagName === 'FORM') { if (el.requestSubmit) el.requestSubmit(); else { const e = new Event('submit', { bubbles: true, cancelable: true }); el.dispatchEvent(e); if (!e.defaultPrevented) el.submit(); } }
        else if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') el.click();
        else if (el.tagName === 'A') { const e = new MouseEvent('click', { bubbles: true, cancelable: true, view: window }); el.dispatchEvent(e); if (!e.defaultPrevented && el.href) window.location.href = el.href; }
        else el.click();
        return true;
      } catch (e) { console.error('[PAIS] Replay failed:', e); return false; } finally { this.clearPending(el); }
    }
  }

  class EventInterceptor {
    constructor(policy, state, cooldowns, ui, logger, safeReplay) {
      this.policy = policy; this.state = state; this.cooldowns = cooldowns; this.ui = ui; this.logger = logger; this.safeReplay = safeReplay;
      this.isActive = false;
    }
    start() { if (this.isActive) return; this.isActive = true; document.addEventListener('click', this.clickHandler = (e) => this.handleClick(e), true); document.addEventListener('submit', this.submitHandler = (e) => this.handleSubmit(e), true); document.addEventListener('keydown', this.keydownHandler = (e) => this.handleKeydown(e), true); console.log('[PAIS] Interceptor active'); }
    stop() { this.isActive = false; if (this.clickHandler) document.removeEventListener('click', this.clickHandler, true); if (this.submitHandler) document.removeEventListener('submit', this.submitHandler, true); if (this.keydownHandler) document.removeEventListener('keydown', this.keydownHandler, true); console.log('[PAIS] Interceptor stopped'); }
    async handleClick(e) { if (!this.shouldIntercept()) return; const el = this.findActionable(e.target); if (!el) return; if (await this.safeReplay.hasValidToken(el)) { await this.safeReplay.consumeToken(el); return; } const info = this.classify(el); if (!info) return; e.preventDefault(); e.stopImmediatePropagation(); await this.handleCheckpoint(info, el); }
    async handleSubmit(e) { if (!this.shouldIntercept()) return; const info = this.classifyForm(e.target); if (!info) return; if (await this.safeReplay.hasValidToken(e.target)) { await this.safeReplay.consumeToken(e.target); return; } e.preventDefault(); e.stopImmediatePropagation(); await this.handleCheckpoint(info, e.target); }
    async handleKeydown(e) { if (!this.shouldIntercept() || e.key !== 'Enter') return; const el = document.activeElement; if (!el) return; const info = this.classify(el); if (!info) return; if (await this.safeReplay.hasValidToken(el)) { await this.safeReplay.consumeToken(el); return; } e.preventDefault(); e.stopImmediatePropagation(); await this.handleCheckpoint(info, el); }
    findActionable(target) { const s = ['button[type="submit"]', 'button[type="button"]', 'input[type="submit"]', 'button', 'a[role="button"]', '[data-testid="mergebox-submit-button"]', '[data-testid="auto-merge-button"]']; for (const sel of s) { const el = target.closest(sel); if (el) return el; } if (target.matches?.('button, input[type="submit"], a[role="button"]')) return target; return null; }
    getAccessibleName(el) { return el.getAttribute('aria-label')?.trim() || el.getAttribute('title')?.trim() || el.value?.trim() || el.innerText?.trim() || el.textContent?.trim() || ''; }
    isInScope(el) { const s = this.policy.getCheckpointMatchers().scope_selector; return s ? !!el.closest(s) : true; }
    classify(el) { if (!this.isInScope(el)) return null; const name = this.getAccessibleName(el); if (!name) return null; const kind = this.policy.classifyCheckpoint(name); if (!kind) return null; return { kind, mergeMethod: this.detectMethod(el, kind), intentTiming: kind === 'MERGE_NOW' ? 'now' : 'scheduled', element: el, accessibleName: name }; }
    classifyForm(form) { if (!this.isInScope(form)) return null; if (form.querySelector('input[name="merge"]') || (form.getAttribute('action') || '').includes('merge')) return { kind: 'MERGE_NOW', mergeMethod: this.detectMethod(form, 'MERGE_NOW'), intentTiming: 'now', element: form, accessibleName: 'Merge form' }; return null; }
    detectMethod(el, kind) { if (kind !== 'MERGE_NOW') return 'scheduled'; const box = el.closest('.merge-box, [data-testid="mergebox"], [data-testid="pr-merge-box"]'); if (!box) return 'merge'; const sel = box.querySelector('select[name="merge_method"]'); if (sel) return sel.value; const tab = box.querySelector('.select-menu-item.selected, [aria-selected="true"]'); if (tab) { const t = tab.textContent?.toLowerCase() || ''; if (t.includes('squash')) return 'squash'; if (t.includes('rebase')) return 'rebase'; } const txt = el.textContent?.toLowerCase() || ''; if (txt.includes('squash')) return 'squash'; if (txt.includes('rebase')) return 'rebase'; return 'merge'; }
    async handleCheckpoint(info, el) { await this.logger.logCheckpointIntercepted(info.kind, info.mergeMethod, info.intentTiming); const result = await this.ui.tier3.show(info); if (result === 'completed') { await this.logger.logCheckpointCompleted(0); await this.state.recordCheckpoint(info.kind, 'completed'); await this.safeReplay.replay(el); } else { await this.logger.logCheckpointAborted(); await this.state.recordCheckpoint(info.kind, 'aborted'); } }
    shouldIntercept() { return this.isActive && !this.ui.tier3.isOpen() && !this.ui.tier2.isOpen(); }
  }

  class MetricsTracker {
    constructor(state, logger) { this.state = state; this.logger = logger; this.diffStart = null; this.maxScroll = 0; this.interval = null; this.observers = []; this.isTracking = false; }
    start() { if (this.isTracking) return; this.isTracking = true; this.observeTabs(); this.observeDiff(); this.observeChecks(); this.interval = setInterval(() => this.save(), 5000); console.log('[PAIS] Metrics tracking started'); }
    stop() { this.isTracking = false; this.save(); if (this.interval) { clearInterval(this.interval); this.interval = null; } this.observers.forEach(o => o.disconnect?.()); this.observers = []; if (this.diffStart) { this.state.addDiffTime(Date.now() - this.diffStart); this.diffStart = null; } console.log('[PAIS] Metrics tracking stopped'); }
    observeTabs() { const handler = (e) => { const tab = e.target.closest('.tabnav-tab, [role="tab"], .UnderlineNav-item'); if (!tab) return; const name = this.identifyTab(tab); if (name) { this.state.recordTabView(name); this.logger.logTabViewed(name); } }; document.addEventListener('click', handler, false); this.observers.push({ disconnect: () => document.removeEventListener('click', handler, false) }); }
    identifyTab(el) { const t = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase(); if (t.includes('conversation') || t.includes('overview')) return 'conversation'; if (t.includes('files') || t.includes('changed') || t.includes('diff')) return 'files'; if (t.includes('check') || t.includes('commit')) return 'checks'; const h = el.getAttribute('href') || ''; if (h.includes('files')) return 'files'; if (h.includes('commits')) return 'checks'; if (h.includes('conversation')) return 'conversation'; return null; }
    observeDiff() { const s = ['.file-diff', '.diff-view', '.js-file-line-container', '[data-testid="file-diff"]']; const diff = document.querySelector(s.join(', ')); if (!diff) return; const vis = new IntersectionObserver((es) => { es.forEach(e => { if (e.isIntersecting) this.diffStart = Date.now(); else if (this.diffStart) { this.state.addDiffTime(Date.now() - this.diffStart); this.diffStart = null; } }); }, { threshold: 0.3 }); vis.observe(diff); this.observers.push(vis); const container = diff.closest('.overflow-auto, .js-diff-container') || diff.parentElement || window; const handler = () => { const top = container.scrollTop || window.scrollY || 0; const h = container.scrollHeight || document.documentElement.scrollHeight; const ch = container.clientHeight || window.innerHeight; const max = h - ch; if (max > 0) this.maxScroll = Math.max(this.maxScroll, (top / max) * 100); }; container.addEventListener('scroll', handler, { passive: true }); this.observers.push({ disconnect: () => container.removeEventListener('scroll', handler) }); }
    observeChecks() { const s = ['.merge-status-list', '.commit-build-statuses', '[data-testid="checks-summary"]']; const checks = document.querySelector(s.join(', ')); if (!checks) return; const obs = new IntersectionObserver((es) => { if (es[0].isIntersecting) { this.state.recordChecksViewed(); obs.disconnect(); } }, { threshold: 0.2 }); obs.observe(checks); this.observers.push(obs); }
    save() { const dt = (this.state.getDiffTimeAccumulated() || 0) + (this.diffStart ? Date.now() - this.diffStart : 0); this.state.updateDiffMetrics({ diff_time_ms: dt, diff_scroll_max_pct: this.maxScroll }); }
  }

  // ============== MAIN CONTROLLER ==============

  class PAISController {
    constructor() {
      this.storage = new Storage();
      this.logger = new Logger(this.storage);
      this.state = new StateManager(this.storage);
      this.policy = new PolicyLoader(this.storage);
      this.cooldowns = null;
      this.calculator = null;
      this.ui = {};
      this.interceptor = null;
      this.metrics = null;
      this.safeReplay = null;
      this.isInitialized = false;
    }

    async init() {
      if (this.isInitialized) return;
      console.log('[PAIS] Initializing...');

      // Load policy
      await this.policy.load();
      this.cooldowns = new CooldownManager(this.storage, this.policy);
      this.calculator = new ReadinessCalculator(this.policy);

      // Initialize UI
      this.ui.tier3 = new Tier3Modal(this.policy);
      this.ui.tier2 = new Tier2Modal(this.policy);
      this.ui.tier1 = new Tier1Banner(this.policy);

      // Initialize for current page
      await this.handleNavigation();

      // Listen for navigation
      this.setupNavigationListener();

      this.isInitialized = true;
      console.log('[PAIS] Initialized successfully');
    }

    setupNavigationListener() {
      let lastHref = location.href;
      setInterval(() => {
        if (location.href !== lastHref) {
          lastHref = location.href;
          this.handleNavigation();
        }
      }, 100);

      // Listen for Turbo events
      ['turbo:load', 'turbo:render', 'turbolinks:load'].forEach(evt => {
        document.addEventListener(evt, () => { lastHref = location.href; this.handleNavigation(); }, false);
      });
    }

    async handleNavigation() {
      const isPR = /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/.test(location.href) || 
                   location.href.includes('test-page.html');
      
      if (isPR) {
        // Initialize state for this PR
        await this.state.initialize(location.href);
        const prInfo = this.state.parsePRFromURL(location.href);
        
        if (prInfo) {
          // Log PR view
          await this.logger.logPRViewed(`${prInfo.owner}/${prInfo.repo}`, prInfo.prNumber, location.href);
          
          // Setup components
          this.setupForPR();
        }
      } else {
        // Cleanup
        this.cleanup();
      }
    }

    setupForPR() {
      // Cleanup previous
      this.cleanup();

      // Create safe replay for this PR
      this.safeReplay = new SafeReplay(this.cooldowns, this.state.prId);

      // Setup event interceptor
      this.interceptor = new EventInterceptor(this.policy, this.state, this.cooldowns, this.ui, this.logger, this.safeReplay);
      this.interceptor.start();

      // Start metrics tracking
      this.metrics = new MetricsTracker(this.state, this.logger);
      this.metrics.start();

      // Show proactive nudge if appropriate
      this.showProactiveNudge();
    }

    async showProactiveNudge() {
      // Check cooldown
      const canShow = await this.cooldowns.shouldShowProactiveNudge(this.state.prId);
      if (!canShow) return;

      // Wait a moment for page to settle
      setTimeout(async () => {
        const missing = this.state.getMissingItems();
        if (missing.length === 0) return;

        // Calculate readiness
        const readiness = this.calculator.calculate(this.state.getState());
        
        // Show banner
        this.ui.tier1.show(missing, {
          onOpenFiles: () => this.cooldowns.recordReview(this.state.prId),
          onOpenChecks: () => this.cooldowns.recordReview(this.state.prId),
          onProceed: () => {},
          onDismiss: () => {}
        });

        // Record nudge shown
        await this.state.recordNudgeShown('proactive', readiness.tier);
        await this.cooldowns.recordProactiveNudge(this.state.prId, readiness.score);
        await this.logger.logNudgeShown(readiness.tier, 'proactive', readiness.score, readiness.reasons);
      }, 2000);
    }

    cleanup() {
      this.interceptor?.stop();
      this.metrics?.stop();
      this.ui.tier1?.close();
      this.ui.tier2?.close();
      this.ui.tier3?.close();
    }
  }

  // ============== INITIALIZATION ==============

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const app = new PAISController();
      app.init();
    });
  } else {
    const app = new PAISController();
    app.init();
  }
})();
