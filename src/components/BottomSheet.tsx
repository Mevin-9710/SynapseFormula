import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  zIndexClass?: string;
}

/**
 * Reusable mobile-first Bottom Sheet (5.6):
 * - Drag handle at top with swipe-down to close
 * - Max-height 85dvh with internal scroll and overscroll-behavior-y: contain
 * - Single .glass-chrome blur layer (never nested backdrop-filter)
 * - Respects env(safe-area-inset-bottom, 0px)
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  headerRight,
  footer,
  children,
  zIndexClass = 'z-50',
}) => {
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDragOffsetY(0);
      dragStartYRef.current = null;
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartYRef.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    const delta = e.clientY - dragStartYRef.current;
    if (delta > 0) {
      setDragOffsetY(delta);
    } else {
      setDragOffsetY(0);
    }
  };

  const handlePointerUp = () => {
    if (dragStartYRef.current === null) return;
    if (dragOffsetY > 65) {
      setDragOffsetY(0);
      dragStartYRef.current = null;
      onClose();
      return;
    }
    setDragOffsetY(0);
    dragStartYRef.current = null;
  };

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-end justify-center bg-black/45`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={e => e.stopPropagation()}
        style={
          dragOffsetY > 0
            ? { transform: `translateY(${dragOffsetY}px)` }
            : undefined
        }
        className="glass-chrome w-full max-w-xl max-h-[85dvh] rounded-t-3xl border-t border-x flex flex-col overflow-hidden shadow-2xl overscroll-contain"
      >
        {/* Drag Handle Touch Area (swipe down to close) */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="w-full pt-2.5 pb-1.5 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none shrink-0"
          aria-label="Drag down to close"
        >
          <div className="w-10 h-1.5 rounded-full bg-current opacity-25" />
        </div>

        {/* Sheet Header */}
        <div className="px-4 pb-3 border-b border-black/10 dark:border-white/10 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold truncate">{title}</div>
            {subtitle && (
              <div className="text-[13px] text-secondary-contrast truncate mt-0.5">
                {subtitle}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {headerRight}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sheet"
              className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Internal Scrollable Body (min-h-0 required in flex column for mobile scroll) */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 space-y-4">
          {children}
        </div>

        {/* Optional Fixed Footer */}
        {footer && (
          <div className="p-3 border-t border-black/10 dark:border-white/10 pb-safe shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
