import { Capacitor } from '@capacitor/core';

/**
 * Nhận diện thiết bị có phải là điện thoại màn hình nhỏ hay không.
 * - Trả về false đối với Laptop, Desktop, Máy tính bảng (Tablet màn hình rộng >= 768px).
 * - Trả về true đối với Điện thoại di động (Android / iOS / Mobile web < 768px).
 */
export function isMobilePhone(): boolean {
  if (typeof window === 'undefined') return false;

  // Nếu độ rộng màn hình từ 768px trở lên (Tablet, Laptop, PC), coi là màn hình lớn
  if (window.innerWidth >= 768) {
    return false;
  }

  // Nếu đang chạy trong app native Android / iOS với màn hình nhỏ
  if (Capacitor.isNativePlatform()) {
    return true;
  }

  // Kiểm tra User Agent điện thoại di động
  const isMobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  return isMobileUA || window.innerWidth < 768;
}
