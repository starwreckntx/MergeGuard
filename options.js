/**
 * PAIS Guard Options Page
 */

document.addEventListener('DOMContentLoaded', async () => {
  const storage = chrome.storage.local;
  const NS = 'pais:';

  // Elements
  const statEvents = document.getElementById('stat-events');
  const statCheckpoints = document.getElementById('stat-checkpoints');
  const statNudges = document.getElementById('stat-nudges');
  const statPolicy = document.getElementById('stat-policy');
  const eventList = document.getElementById('event-list');
  const policyEditor = document.getElementById('policy-editor');
  
  // Buttons
  document.getElementById('btn-refresh').addEventListener('click', loadStats);
  document.getElementById('btn-export').addEventListener('click', exportLogs);
  document.getElementById('btn-clear').addEventListener('click', clearLogs);
  document.getElementById('btn-save-policy').addEventListener('click', savePolicy);
  document.getElementById('btn-reset-policy').addEventListener('click', resetPolicy);
  document.getElementById('btn-validate').addEventListener('click', validatePolicy);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-clear-all').addEventListener('click', clearAllData);
  document.getElementById('btn-reset-extension').addEventListener('click', resetExtension);

  // Load initial data
  await loadStats();
  await loadPolicy();
  await loadSettings();

  async function loadStats() {
    const all = await storage.get(null);
    const events = all[`${NS}event_buffer`] || [];
    
    // Calculate stats
    const checkpoints = events.filter(e => e.type === 'checkpoint_completed').length;
    const nudges = events.filter(e => e.type === 'nudge_shown').length;
    const policy = events.length > 0 ? events[events.length - 1].policy_version : 'Not loaded';
    
    statEvents.textContent = events.length;
    statCheckpoints.textContent = checkpoints;
    statNudges.textContent = nudges;
    statPolicy.textContent = policy;
    
    // Render event list
    if (events.length === 0) {
      eventList.innerHTML = '<p style="text-align: center; color: #6a737d;">No events recorded yet</p>';
    } else {
      const recent = events.slice(-20).reverse();
      eventList.innerHTML = recent.map(e => `
        <div class="event-item">
          <span class="event-time">${new Date(e.ts).toLocaleTimeString()}</span>
          <span class="event-type">${e.type}</span>
          ${e.payload ? `<code>${JSON.stringify(e.payload).substring(0, 100)}</code>` : ''}
        </div>
      `).join('');
    }
  }

  async function loadPolicy() {
    try {
      const response = await fetch(chrome.runtime.getURL('policy.json'));
      const defaultPolicy = await response.json();
      
      const customPolicy = await storage.get(`${NS}custom_policy`);
      const policy = customPolicy || defaultPolicy;
      
      policyEditor.value = JSON.stringify(policy, null, 2);
    } catch (e) {
      policyEditor.value = 'Error loading policy: ' + e.message;
    }
  }

  async function loadSettings() {
    const settings = await storage.get(`${NS}settings`);
    if (settings) {
      document.getElementById('enable-proactive').checked = settings.enable_proactive !== false;
      document.getElementById('enable-premerge').checked = settings.enable_premerge !== false;
      document.getElementById('cooldown-proactive').value = settings.cooldown_proactive || 10;
    }
  }

  async function exportLogs() {
    const events = await storage.get(`${NS}event_buffer`) || [];
    const exportData = {
      export_timestamp: Date.now(),
      export_date: new Date().toISOString(),
      extension_version: chrome.runtime.getManifest().version,
      event_count: events.length,
      events: events
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    await chrome.downloads.download({
      url: url,
      filename: `pais-logs-${Date.now()}.json`,
      saveAs: true
    });
    
    showStatus('policy-status', 'Logs exported successfully', true);
  }

  async function clearLogs() {
    await storage.remove(`${NS}event_buffer`);
    await loadStats();
    showStatus('policy-status', 'Logs cleared', true);
  }

  async function savePolicy() {
    try {
      const policy = JSON.parse(policyEditor.value);
      await storage.set({ [`${NS}custom_policy`]: policy });
      showStatus('policy-status', 'Policy saved successfully', true);
      await loadStats();
    } catch (e) {
      showStatus('policy-status', 'Invalid JSON: ' + e.message, false);
    }
  }

  async function resetPolicy() {
    await storage.remove(`${NS}custom_policy`);
    await loadPolicy();
    showStatus('policy-status', 'Policy reset to default', true);
  }

  function validatePolicy() {
    try {
      const policy = JSON.parse(policyEditor.value);
      const required = ['checkpoint_matchers', 'nudge_thresholds', 'ui_templates'];
      const missing = required.filter(f => !policy[f]);
      
      if (missing.length > 0) {
        showStatus('policy-status', 'Missing required fields: ' + missing.join(', '), false);
      } else {
        showStatus('policy-status', 'Policy structure is valid', true);
      }
    } catch (e) {
      showStatus('policy-status', 'Invalid JSON: ' + e.message, false);
    }
  }

  async function saveSettings() {
    const settings = {
      enable_proactive: document.getElementById('enable-proactive').checked,
      enable_premerge: document.getElementById('enable-premerge').checked,
      cooldown_proactive: parseInt(document.getElementById('cooldown-proactive').value, 10)
    };
    
    await storage.set({ [`${NS}settings`]: settings });
    showStatus('settings-status', 'Settings saved', true);
  }

  async function clearAllData() {
    if (!confirm('Are you sure you want to clear all data? This cannot be undone.')) return;
    
    const all = await storage.get(null);
    const keysToRemove = Object.keys(all).filter(k => k.startsWith(NS));
    await storage.remove(keysToRemove);
    
    await loadStats();
    showStatus('policy-status', 'All data cleared', true);
  }

  async function resetExtension() {
    if (!confirm('WARNING: This will reset the extension to factory defaults. All custom policies and logs will be lost. Continue?')) return;
    
    const all = await storage.get(null);
    await storage.remove(Object.keys(all));
    
    await loadStats();
    await loadPolicy();
    await loadSettings();
    showStatus('policy-status', 'Extension reset to defaults', true);
  }

  function showStatus(elementId, message, isSuccess) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.className = 'status ' + (isSuccess ? 'success' : 'error');
    setTimeout(() => { el.className = 'status'; }, 3000);
  }
});
