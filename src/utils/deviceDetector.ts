import { Capacitor } from '@capacitor/core';

/**
 * Tiện ích phát hiện thiết bị và môi trường chạy ứng dụng.
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (Capacitor.isNativePlatform()) return true;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function isTablet(): boolean {
  if (typeof window === 'undefined') return false;
  const isIpad = /iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroidTablet = /Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent);
  return isIpad || isAndroidTablet || (window.innerWidth >= 768 && window.innerWidth <= 1024);
}

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
