import { beforeEach, describe, expect, it, vi } from 'vitest';

const { secureSet, preferenceSet } = vi.hoisted(() => ({
  secureSet: vi.fn(),
  preferenceSet: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    set: preferenceSet,
    get: vi.fn(),
    remove: vi.fn(),
    keys: vi.fn(),
  },
}));

vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    set: secureSet,
    get: vi.fn(),
    remove: vi.fn(),
  },
}));

import { setSecureItem } from '../secureStorage';

describe('secure credential storage', () => {
  beforeEach(() => {
    secureSet.mockReset();
    preferenceSet.mockReset();
  });

  it('fails closed instead of falling back to Preferences for OAuth credentials', async () => {
    secureSet.mockRejectedValueOnce(new Error('keystore unavailable'));

    await expect(setSecureItem('google_drive_access_token_v4', 'secret')).rejects.toThrow(
      'Secure storage could not save'
    );
    expect(preferenceSet).not.toHaveBeenCalled();
  });
});
