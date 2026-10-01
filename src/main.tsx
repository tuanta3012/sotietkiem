import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { ToastProvider } from './context/ToastContext.tsx';
import { enforceFreshInstallCleanState } from './utils/freshInstallGuard';
import './index.css';

async function bootstrap() {
  // Đảm bảo dọn dẹp triệt để dữ liệu khôi phục ngoài ý muốn từ Google One snapshot khi cài mới APK
  await enforceFreshInstallCleanState();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ErrorBoundary>
    </StrictMode>
  );
}

bootstrap();
