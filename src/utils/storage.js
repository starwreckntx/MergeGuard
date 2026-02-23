/**
 * Storage wrapper for Chrome extension storage API
 * Provides promise-based interface with namespacing
 */
class Storage {
  constructor(namespace = 'pais') {
    this.namespace = namespace;
    this.area = chrome.storage.local;
  }

  /**
   * Get a value from storage
   * @param {string} key - Key to retrieve
   * @returns {Promise<any>} Stored value or undefined
   */
  async get(key) {
    const namespacedKey = `${this.namespace}:${key}`;
    const result = await this.area.get(namespacedKey);
    return result[namespacedKey];
  }

  /**
   * Set a value in storage
   * @param {string} key - Key to set
   * @param {any} value - Value to store
   * @returns {Promise<void>}
   */
  async set(key, value) {
    const namespacedKey = `${this.namespace}:${key}`;
    await this.area.set({ [namespacedKey]: value });
  }

  /**
   * Remove a value from storage
   * @param {string} key - Key to remove
   * @returns {Promise<void>}
   */
  async remove(key) {
    const namespacedKey = `${this.namespace}:${key}`;
    await this.area.remove(namespacedKey);
  }

  /**
   * Get all keys with this namespace
   * @returns {Promise<Object>} Object with all namespaced keys
   */
  async getAll() {
    const all = await this.area.get(null);
    const result = {};
    const prefix = `${this.namespace}:`;
    
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(prefix)) {
        result[key.slice(prefix.length)] = value;
      }
    }
    
    return result;
  }

  /**
   * Clear all values with this namespace
   * @returns {Promise<void>}
   */
  async clear() {
    const all = await this.area.get(null);
    const prefix = `${this.namespace}:`;
    const keysToRemove = Object.keys(all).filter(key => key.startsWith(prefix));
    
    if (keysToRemove.length > 0) {
      await this.area.remove(keysToRemove);
    }
  }

  /**
   * Get multiple values at once
   * @param {string[]} keys - Keys to retrieve
   * @returns {Promise<Object>} Object with key-value pairs
   */
  async getMultiple(keys) {
    const namespacedKeys = keys.map(key => `${this.namespace}:${key}`);
    const result = await this.area.get(namespacedKeys);
    
    const unwrapped = {};
    const prefix = `${this.namespace}:`;
    for (const [key, value] of Object.entries(result)) {
      if (key.startsWith(prefix)) {
        unwrapped[key.slice(prefix.length)] = value;
      }
    }
    
    return unwrapped;
  }

  /**
   * Set multiple values at once
   * @param {Object} items - Object with key-value pairs
   * @returns {Promise<void>}
   */
  async setMultiple(items) {
    const namespaced = {};
    for (const [key, value] of Object.entries(items)) {
      namespaced[`${this.namespace}:${key}`] = value;
    }
    await this.area.set(namespaced);
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Storage;
}
