import React, { useState, useEffect } from 'react';
import { Download, Smartphone, WifiOff } from 'lucide-react';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWAInstall';
import {
  getLastCloudSyncTimestamp,
  getOfflinePendingSyncCount,
  hasCompletedFirstSession,
} from '../services/storage';
import { BottomSheet } from './BottomSheet';

interface PWAInstallButtonProps {
  requireFirstSessionCompleted?: boolean;
  fullWidth?: boolean;
}

export function formatRelativeTimeAgo(timestampMs: number | null): string {
  if (!timestampMs) return 'local only';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  requireFirstSessionCompleted = false,
  fullWidth = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideSheet, setShowGuideSheet] = useState(false);

  if (isInstalled) {
    return null;
  }

  // Requirement 5.25: Show the install prompt on Home only after the first completed review session
  if (requireFirstSessionCompleted && !hasCompletedFirstSession()) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuideSheet(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className={`glass-button min-h-[44px] px-3.5 py-2 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 cursor-pointer ${
          fullWidth ? 'w-full' : ''
        }`}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Install App for Offline Study</span>
      </button>

      <BottomSheet
        isOpen={showGuideSheet}
        onClose={() => setShowGuideSheet(false)}
        title={
          <span className="flex items-center gap-2">
            <Smartphone className="w-4 h-4" />
            <span>Install SynapseFormula</span>
          </span>
        }
        subtitle="Add to your home screen for full-screen offline study"
        zIndexClass="z-[70]"
        footer={
          <button
            type="button"
            onClick={() => setShowGuideSheet(false)}
            className="glass-button-primary w-full min-h-[44px] rounded-xl text-[13px] font-bold cursor-pointer"
          >
            Got it
          </button>
        }
      >
        {isIOS ? (
          <div className="rounded-xl glass-panel p-4 text-[15px] space-y-2.5 leading-relaxed">
            <p>
              1. Tap the <strong>Share</strong> button in your Safari toolbar.
            </p>
            <p>
              2. Scroll down and tap <strong>Add to Home Screen</strong>.
            </p>
          </div>
        ) : (
          <div className="rounded-xl glass-panel p-4 text-[15px] space-y-2.5 leading-relaxed">
            <p>
              1. Open the browser menu (<strong>⋮</strong>) or address bar install icon.
            </p>
            <p>
              2. Select <strong>Install app</strong> or <strong>Add to Home screen</strong>.
            </p>
          </div>
        )}
      </BottomSheet>
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (isOnline) return;
    const timer = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(timer);
  }, [isOnline]);

  if (isOnline) return null;

  const lastSyncTs = getLastCloudSyncTimestamp();
  const pendingCount = getOfflinePendingSyncCount();
  const agoLabel = formatRelativeTimeAgo(lastSyncTs);

  return (
    <div
      role="status"
      className="fixed bottom-20 left-4 right-4 max-w-xl mx-auto z-40 glass-chrome rounded-xl px-3.5 py-2.5 border flex items-center justify-between gap-2 text-[13px] font-semibold shadow-md"
    >
      <span className="flex items-center gap-2">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span>Offline · last synced {agoLabel}</span>
      </span>
      {pendingCount > 0 && (
        <span className="text-xs text-secondary-contrast tabular-nums">
          {pendingCount} queued
        </span>
      )}
    </div>
  );
};
