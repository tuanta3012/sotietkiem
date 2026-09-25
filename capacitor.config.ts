import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tietkiemgiadinh.app',
  appName: 'Tiết Kiệm Gia Đình',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_savings',
      iconColor: '#10b981',
      sound: 'beep.wav',
    },
    GoogleAuth: {
      // BẮT BUỘC phải giữ lại các scope truy cập Google Drive & Google Sheets để đồng bộ dữ liệu
      scopes: [
        'profile',
        'email',
        'openid',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets'
      ],
      clientId: '864440372329-fgoo891qp196nvcptmfc7pquofuj8agt.apps.googleusercontent.com',
      serverClientId: '864440372329-fgoo891qp196nvcptmfc7pquofuj8agt.apps.googleusercontent.com',
      forceCodeForRefreshToken: false,
    },
  },
};

export default config;
