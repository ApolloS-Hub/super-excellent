/**
 * Secure Store — API key storage abstraction
 *
 * Provides a layer between the app and raw localStorage to:
 * 1. Store API keys separately from general config (not in plain JSON)
 * 2. Obfuscate keys at rest (prevents casual inspection via DevTools)
 * 3. Abstract the storage backend for future upgrade to OS keychain
 *
 * UPGRADE PATH: When Tauri plugin-store or OS keychain is available,
 * replace the encode/decode functions with proper encryption.
 */

const SECURE_KEY_PREFIX = "__se_sk_";

/**
 * Simple obfuscation (NOT encryption — prevents casual exposure only).
 * For real security, upgrade to Tauri secure-store or OS keychain.
 */
function obfuscate(value: string): string {
  // XOR with a fixed pattern + base64
  const key = "SuperExcellent2024";
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    bytes[i] = value.charCodeAt(i) ^ key.charCodeAt(i % key.length);
  }
  return btoa(String.fromCharCode(...bytes));
}

function deobfuscate(encoded: string): string {
  const key = "SuperExcellent2024";
  const decoded = atob(encoded);
  const result: string[] = [];
  for (let i = 0; i < decoded.length; i++) {
    result.push(String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length)));
  }
  return result.join("");
}

/**
 * Store an API key securely
 */
export function setApiKey(provider: string, apiKey: string): void {
  if (!apiKey) {
    localStorage.removeItem(`${SECURE_KEY_PREFIX}${provider}`);
    return;
  }
  localStorage.setItem(`${SECURE_KEY_PREFIX}${provider}`, obfuscate(apiKey));
}

/**
 * Retrieve an API key
 */
export function getApiKey(provider: string): string {
  const encoded = localStorage.getItem(`${SECURE_KEY_PREFIX}${provider}`);
  if (!encoded) return "";
  try {
    return deobfuscate(encoded);
  } catch {
    return "";
  }
}

/**
 * Remove an API key
 */
export function removeApiKey(provider: string): void {
  localStorage.removeItem(`${SECURE_KEY_PREFIX}${provider}`);
}

/**
 * Migrate a plain-text API key from config to secure store.
 * Call this on app startup to migrate existing keys.
 */
export function migrateApiKeyFromConfig(): void {
  try {
    const raw = localStorage.getItem("agent-config");
    if (!raw) return;
    const config = JSON.parse(raw);
    if (config.apiKey && typeof config.apiKey === "string" && config.apiKey.length > 5) {
      const provider = config.provider || "anthropic";
      // Only migrate if not already in secure store
      if (!getApiKey(provider)) {
        setApiKey(provider, config.apiKey);
      }
      // Remove plain key from config
      config.apiKey = "(secure)";
      localStorage.setItem("agent-config", JSON.stringify(config));
    }
  } catch {
    // Don't crash on migration failure
  }
}

/**
 * Get the API key for the current config.
 * Checks secure store first, falls back to config.
 */
export function getActiveApiKey(): string {
  try {
    const raw = localStorage.getItem("agent-config");
    if (!raw) return "";
    const config = JSON.parse(raw);
    const provider = config.provider || "anthropic";
    // Try secure store first
    const secureKey = getApiKey(provider);
    if (secureKey) return secureKey;
    // Fall back to config (pre-migration)
    return config.apiKey && config.apiKey !== "(secure)" ? config.apiKey : "";
  } catch {
    return "";
  }
}
