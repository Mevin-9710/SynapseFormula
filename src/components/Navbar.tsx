import React from 'react';
import { Layers, CheckCircle2, PenTool, Plus, LogOut, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { User } from 'firebase/auth';

interface NavbarProps {
  currentView: 'decks' | 'due' | 'scratchpad';
  onSelectView: (view: 'decks' | 'due' | 'scratchpad') => void;
  onOpenConnectModal: () => void;
  user: User | null;
  onSignIn: () => void;
  onSignOut: () => void;
  dueCount?: number;
  isSyncingAll?: boolean;
  onSyncAll?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onSelectView,
  onOpenConnectModal,
  user,
  onSignIn,
  onSignOut,
  dueCount = 0,
  isSyncingAll = false,
  onSyncAll,
}) => {
  return (
    <>
      {/* Compact Top Bar */}
      <header className="sticky top-0 z-40 w-full glass-panel border-b border-black/10 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-black text-white flex items-center justify-center text-xs font-bold shadow-xs">
              ∑
            </div>
            <span className="font-bold text-sm tracking-tight text-black">
              SynapseFormula
            </span>
          </div>

          <div className="flex items-center gap-2">
            {onSyncAll && (
              <button
                onClick={onSyncAll}
                disabled={isSyncingAll}
                title="Check 24h Google Drive updates"
                className="p-2 rounded-xl text-black/60 hover:text-black glass-button min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncingAll ? 'animate-spin' : ''}`} />
              </button>
            )}

            {user ? (
              <button
                onClick={onSignOut}
                title={`Signed in as ${user.email}. Click to sign out.`}
                className="glass-button px-2.5 py-1.5 rounded-xl text-xs text-black/70 hover:text-black flex items-center gap-1.5 min-h-[40px] cursor-pointer"
              >
                <span className="text-[11px] truncate max-w-[90px]">{user.email?.split('@')[0]}</span>
                <LogOut className="w-3.5 h-3.5 text-black/50" />
              </button>
            ) : (
              <button
                onClick={onSignIn}
                className="glass-button px-2.5 py-1.5 rounded-xl text-xs text-black flex items-center gap-1.5 min-h-[40px] cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 48 48">
                  <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#EA4335" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                </svg>
                <span>Drive</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Pinned Bottom Thumb Navigation Bar (Natural Reach Zone) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-black/10 pb-safe">
        <div className="max-w-md mx-auto grid grid-cols-4 items-center h-16 px-2">
          {/* Tab 1: Decks */}
          <button
            onClick={() => onSelectView('decks')}
            className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors cursor-pointer ${
              currentView === 'decks' ? 'text-black font-bold' : 'text-black/40 hover:text-black'
            }`}
          >
            <Layers className="w-5 h-5" />
            <span className="text-[10px] mt-1 tracking-tight">Decks</span>
          </button>

          {/* Tab 2: Due Today */}
          <button
            onClick={() => onSelectView('due')}
            className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors relative cursor-pointer ${
              currentView === 'due' ? 'text-black font-bold' : 'text-black/40 hover:text-black'
            }`}
          >
            <div className="relative">
              <CheckCircle2 className="w-5 h-5" />
              {dueCount > 0 && (
                <span className="absolute -top-1 -right-2 bg-black text-white text-[9px] font-bold px-1 rounded-full">
                  {dueCount}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-1 tracking-tight">Due</span>
          </button>

          {/* Tab 3: Scratchpad */}
          <button
            onClick={() => onSelectView('scratchpad')}
            className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors cursor-pointer ${
              currentView === 'scratchpad' ? 'text-black font-bold' : 'text-black/40 hover:text-black'
            }`}
          >
            <PenTool className="w-5 h-5" />
            <span className="text-[10px] mt-1 tracking-tight">Scratch</span>
          </button>

          {/* Tab 4: Add Excel */}
          <button
            onClick={onOpenConnectModal}
            className="flex flex-col items-center justify-center h-full min-h-[44px] text-black hover:text-black/80 transition-colors cursor-pointer"
          >
            <div className="w-6 h-6 rounded-full bg-black text-white flex items-center justify-center">
              <Plus className="w-3.5 h-3.5" />
            </div>
            <span className="text-[10px] mt-1 tracking-tight font-semibold">+ Import</span>
          </button>
        </div>
      </nav>
    </>
  );
};
