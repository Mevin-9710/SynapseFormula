import React, { useMemo } from 'react';
import {
  Layers,
  Calendar,
  Plus,
  LogOut,
  RefreshCw,
  Flame,
  BarChart3,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { StudyStreakState } from '../types';
import { getLocalDateKey } from '../services/srsEngine';
import { PWAInstallButton } from './PWAInstallButton';

export type NavView = 'decks' | 'analytics' | 'calendar';

interface NavbarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  onOpenConnectModal: () => void;
  user: User | null;
  onSignIn: () => void;
  onSignOut: () => void;
  dueCount?: number;
  streak?: StudyStreakState;
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
  streak = { currentStreak: 0, bestStreak: 0, completedDates: [] },
  isSyncingAll = false,
  onSyncAll,
}) => {
  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);
  const completedToday = streak.completedDates.includes(todayKey);

  return (
    <>
      {/* Compact Top Bar */}
      <header className="sticky top-0 z-40 w-full glass-panel border-b border-black/10 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-black text-white flex items-center justify-center text-xs font-bold shadow-xs shrink-0">
              ∑
            </div>
            <span className="font-bold text-sm tracking-tight text-black whitespace-nowrap truncate">
              SynapseFormula
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Gamified Study Streak Indicator (tapping opens dedicated Streaks & Analytics page) */}
            <button
              type="button"
              onClick={() => onSelectView('analytics')}
              title="View Study Streak & Performance Analytics"
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 min-h-[40px] border transition-all cursor-pointer tabular-nums ${
                currentView === 'analytics'
                  ? 'bg-orange-500 border-orange-600 text-white shadow-xs'
                  : completedToday
                  ? 'bg-amber-50 border-amber-300 text-orange-600 shadow-2xs'
                  : streak.currentStreak > 0
                  ? 'bg-orange-50/70 border-amber-200 text-amber-700'
                  : 'glass-button text-slate-700'
              }`}
            >
              <Flame
                className={`w-4 h-4 shrink-0 ${
                  currentView === 'analytics'
                    ? 'text-white fill-amber-200'
                    : completedToday
                    ? 'text-orange-500 fill-amber-400'
                    : streak.currentStreak > 0
                    ? 'text-amber-500 fill-amber-200'
                    : 'text-amber-500/80'
                }`}
              />
              <span>{streak.currentStreak}</span>
              <span className="hidden sm:inline text-[11px] font-semibold">
                {streak.currentStreak === 1 ? 'Day' : 'Days'}
              </span>
            </button>

            {/* In-App PWA Install Button */}
            <PWAInstallButton />

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
                <span className="text-[11px] truncate max-w-[80px] sm:max-w-[110px]">
                  {user.email?.split('@')[0]}
                </span>
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

      {/* Pinned Bottom Thumb Navigation Bar (4 Tabs: Decks, Streaks & Analytics, Calendar, + Import) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-black/10 pb-safe">
        <div className="max-w-md mx-auto grid grid-cols-4 items-center h-16 px-2">
          {/* Tab 1: Decks (Home Dashboard) */}
          <button
            onClick={() => onSelectView('decks')}
            className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors cursor-pointer ${
              currentView === 'decks' ? 'text-black font-bold' : 'text-black/40 hover:text-black'
            }`}
          >
            <Layers className="w-5 h-5" />
            <span className="text-[10px] mt-1 tracking-tight whitespace-nowrap">Decks</span>
          </button>

          {/* Tab 2: Streaks & Performance Analytics (replaces Due button) */}
          <button
            onClick={() => onSelectView('analytics')}
            className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors relative cursor-pointer ${
              currentView === 'analytics'
                ? 'text-orange-600 font-bold'
                : 'text-black/40 hover:text-black'
            }`}
          >
            <div className="relative flex items-center">
              <BarChart3
                className={`w-5 h-5 ${
                  currentView === 'analytics' ? 'text-orange-500' : ''
                }`}
              />
              {streak.currentStreak > 0 && (
                <span className="absolute -top-1 -right-3 bg-orange-500 text-white text-[9px] font-bold px-1 rounded-full tabular-nums">
                  {streak.currentStreak}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-1 tracking-tight whitespace-nowrap">Streaks</span>
          </button>

          {/* Tab 3: Calendar */}
          <button
            onClick={() => onSelectView('calendar')}
            className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors cursor-pointer ${
              currentView === 'calendar' ? 'text-black font-bold' : 'text-black/40 hover:text-black'
            }`}
          >
            <Calendar className="w-5 h-5" />
            <span className="text-[10px] mt-1 tracking-tight whitespace-nowrap">Calendar</span>
          </button>

          {/* Tab 4: Add Excel */}
          <button
            onClick={onOpenConnectModal}
            className="flex flex-col items-center justify-center h-full min-h-[44px] text-black hover:text-black/80 transition-colors cursor-pointer"
          >
            <div className="w-6 h-6 rounded-full bg-black text-white flex items-center justify-center">
              <Plus className="w-3.5 h-3.5" />
            </div>
            <span className="text-[10px] mt-1 tracking-tight font-semibold whitespace-nowrap">+ Import</span>
          </button>
        </div>
      </nav>
    </>
  );
};
