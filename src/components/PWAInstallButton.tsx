import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuideModal(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        title="Install SynapseFormula App"
        className="glass-button px-2.5 py-1.5 rounded-xl text-xs font-bold text-black flex items-center gap-1.5 min-h-[40px] cursor-pointer"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline text-[11px]">Install</span>
      </button>

      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="glass-card bg-white/95 w-full max-w-sm rounded-2xl p-5 border border-black/10 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-black text-white flex items-center justify-center shrink-0">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-black">Install SynapseFormula</h3>
                  <p className="text-[11px] text-black/55">Add to your home screen for offline study</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1 rounded-lg text-black/45 hover:text-black cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="rounded-xl bg-black/[0.03] border border-black/8 p-3.5 text-xs text-black/80 space-y-2 leading-relaxed">
                <p>
                  1. Tap the <strong>Share</strong> button in your Safari toolbar.
                </p>
                <p>
                  2. Scroll down and tap <strong>Add to Home Screen</strong>.
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-black/[0.03] border border-black/8 p-3.5 text-xs text-black/80 space-y-2 leading-relaxed">
                <p>
                  1. Open the browser menu (<strong>⋮</strong>) or address bar install icon.
                </p>
                <p>
                  2. Select <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="glass-button-primary w-full h-10 rounded-xl text-xs font-bold cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white shadow-lg">
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      <span>Offline Mode — Cached formulas active</span>
    </div>
  );
};
