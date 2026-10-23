import React from 'react';
import { Layers, BarChart3, Sliders, Sun, Moon } from 'lucide-react';

export type NavView = 'decks' | 'progress' | 'settings';

interface NavbarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  onOpenSettingsModal: () => void;
  dueCount?: number;
  isDark?: boolean;
  onToggleTheme?: () => void;
}

/**
 * Mobile-First Top Bar & Bottom Nav:
 * - Top bar: Logo, Light/Dark mode toggle, settings button (no due-count clutter).
 * - Bottom nav (3 tabs): Review, Progress, Settings.
 * - Uses .glass-chrome (real blur 14px with opaque fallback), env(safe-area-inset-*) and >= 44x44px targets.
 */
export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onSelectView,
  onOpenSettingsModal,
  isDark = false,
  onToggleTheme,
}) => {
  return (
    <>
      {/* Sticky Top Bar: Logo, Light/Dark Toggle, Settings */}
      <header className="sticky top-0 z-40 w-full glass-chrome border-b px-4 py-2 pt-safe">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-2 min-h-[44px]">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-black dark:bg-white text-white dark:text-black flex items-center justify-center text-sm font-bold shrink-0">
              ∑
            </div>
            <span className="font-bold text-[15px] tracking-tight whitespace-nowrap truncate">
              SynapseFormula
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onToggleTheme && (
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            )}

            <button
              type="button"
              onClick={onOpenSettingsModal}
              aria-label="Open Settings"
              title="Settings, Pool & Sync"
              className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
            >
              <Sliders className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Pinned Bottom 3-Tab Thumb Navigation Bar: Review, Progress, Settings */}
      <nav
        aria-label="Primary Navigation"
        className="fixed bottom-0 left-0 right-0 z-40 glass-chrome border-t pb-safe pl-safe pr-safe"
      >
        <div className="max-w-xl mx-auto grid grid-cols-3 gap-2 items-center h-16 px-3">
          <button
            type="button"
            onClick={() => onSelectView('decks')}
            className={`flex flex-col items-center justify-center min-h-[44px] rounded-xl transition-colors cursor-pointer ${
              currentView === 'decks'
                ? 'font-bold text-black dark:text-white bg-black/5 dark:bg-white/10'
                : 'text-secondary-contrast font-medium'
            }`}
          >
            <Layers className="w-5 h-5" />
            <span className="text-xs mt-0.5 tracking-tight whitespace-nowrap">Review</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectView('progress')}
            className={`flex flex-col items-center justify-center min-h-[44px] rounded-xl transition-colors cursor-pointer ${
              currentView === 'progress'
                ? 'font-bold text-black dark:text-white bg-black/5 dark:bg-white/10'
                : 'text-secondary-contrast font-medium'
            }`}
          >
            <BarChart3 className="w-5 h-5" />
            <span className="text-xs mt-0.5 tracking-tight whitespace-nowrap">Progress</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettingsModal}
            className={`flex flex-col items-center justify-center min-h-[44px] rounded-xl transition-colors cursor-pointer ${
              currentView === 'settings'
                ? 'font-bold text-black dark:text-white bg-black/5 dark:bg-white/10'
                : 'text-secondary-contrast font-medium'
            }`}
          >
            <Sliders className="w-5 h-5" />
            <span className="text-xs mt-0.5 tracking-tight whitespace-nowrap">Settings</span>
          </button>
        </div>
      </nav>
    </>
  );
};
