import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw, ArrowDown } from 'lucide-react';

interface PullToRefreshWrapperProps {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  children: React.ReactNode;
}

export const PullToRefreshWrapper: React.FC<PullToRefreshWrapperProps> = ({
  onRefresh,
  disabled = false,
  children,
}) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const PULL_THRESHOLD = 70; // px cần kéo để kích hoạt làm mới

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled || isRefreshing) return;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop || containerRef.current?.scrollTop || 0;
    if (scrollTop <= 5) {
      startYRef.current = e.touches[0].clientY;
      isPullingRef.current = true;
    } else {
      isPullingRef.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPullingRef.current || disabled || isRefreshing) return;
    const currentY = e.touches[0].clientY;
    const distance = currentY - startYRef.current;

    if (distance > 0) {
      // Hiệu ứng kháng lực (resistance) khi kéo
      const dampedDistance = Math.min(distance * 0.45, 120);
      setPullDistance(dampedDistance);
    } else {
      setPullDistance(0);
    }
  };

  const handleTouchEnd = async () => {
    if (!isPullingRef.current || disabled || isRefreshing) return;
    isPullingRef.current = false;

    if (pullDistance >= PULL_THRESHOLD) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD);
      try {
        await onRefresh();
      } catch (err) {
        console.warn('Pull-to-refresh error:', err);
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  };

  return (
    <div
      ref={containerRef}
      className="min-h-screen flex flex-col relative select-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator banner */}
      <div
        className="overflow-hidden transition-all duration-200 ease-out flex items-center justify-center bg-blue-600 text-white font-medium text-xs shadow-inner"
        style={{
          height: isRefreshing ? '48px' : `${pullDistance}px`,
          opacity: pullDistance > 10 || isRefreshing ? 1 : 0,
        }}
      >
        <div className="flex items-center gap-2 py-2">
          {isRefreshing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Đang đồng bộ dữ liệu mới nhất từ Google Drive...</span>
            </>
          ) : pullDistance >= PULL_THRESHOLD ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Thả tay để làm mới ngay...</span>
            </>
          ) : (
            <>
              <ArrowDown className="w-4 h-4 transition-transform duration-150" style={{ transform: `rotate(${pullDistance * 2}deg)` }} />
              <span>Kéo xuống để đồng bộ...</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  );
};
