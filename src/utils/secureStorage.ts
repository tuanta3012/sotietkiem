import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

/**
 * Check if the app is running as a native app (iOS/Android)
 */
const isNative = Capacitor.isNativePlatform();

/**
 * Securely store a key-value pair.
 * On native platforms, uses the encrypted SecureStoragePlugin.
 * On web/iframe, falls back to Capacitor Preferences with unencrypted localStorage.
 */
export async function setSecureItem(key: string, value: string): Promise<void> {
  if (isNative) {
    try {
      await SecureStoragePlugin.set({ key, value });
      return;
    } catch (err) {
      console.warn(`[SecureStorage] Failed to set native secure storage for key: ${key}. Falling back to Preferences...`, err);
    }
  }

  // Fallback to Preferences (and also update localStorage just in case)
  try {
    await Preferences.set({ key, value });
    localStorage.setItem(key, value);
  } catch (err) {
    console.error(`[SecureStorage] Failed fallback storage for key: ${key}`, err);
  }
}

/**
 * Retrieve a securely stored value by key.
 * On native platforms, uses the encrypted SecureStoragePlugin.
 * On web/iframe, falls back to Capacitor Preferences and localStorage.
 */
export async function getSecureItem(key: string): Promise<string | null> {
  if (isNative) {
    try {
      const result = await SecureStoragePlugin.get({ key });
      if (result && result.value) {
        return result.value;
      }
    } catch (err) {
      console.info(`[SecureStorage] Key "${key}" not found or failed to read from native secure storage. Trying Preferences fallback...`);
    }
  }

  // Fallback to Preferences/localStorage
  try {
    const prefResult = await Preferences.get({ key });
    if (prefResult && prefResult.value) {
      return prefResult.value;
    }
    return localStorage.getItem(key) || null;
  } catch (err) {
    console.error(`[SecureStorage] Failed fallback retrieval for key: ${key}`, err);
    return null;
  }
}

/**
 * Remove a securely stored key-value pair.
 */
export async function removeSecureItem(key: string): Promise<void> {
  if (isNative) {
    try {
      await SecureStoragePlugin.remove({ key });
      return;
    } catch (err) {
      console.warn(`[SecureStorage] Failed to remove key from native secure storage: ${key}. Trying Preferences fallback...`, err);
    }
  }

  // Fallback
  try {
    await Preferences.remove({ key });
    localStorage.removeItem(key);
  } catch (err) {
    console.error(`[SecureStorage] Failed fallback removal for key: ${key}`, err);
  }
}
