import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Download,
  Upload,
  Bell,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  LogOut,
  CloudOff,
  Cloud,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { UserSettings } from '../types';
import {
  checkLocalStorageQuotaWarning,
  exportFullBackupJson,
  importFullBackupJson,
} from '../services/storage';
import { getDaysLeftBeforeExam, getEffectiveMaxIntervalDays } from '../services/srsEngine';
import { PWAInstallButton } from './PWAInstallButton';
import { BottomSheet } from './BottomSheet';

interface SettingsBackupModalProps {
  isOpen: boolean;
  settings: UserSettings;
  user?: User | null;
  driveReconnectNeeded?: boolean;
  isSyncingAll?: boolean;
  onSignIn?: () => void;
  onSignOut?: () => void;
  onSyncAll?: () => void;
  onClose: () => void;
  onSaveSettings: (next: UserSettings) => void;
  onBackupImported: (summaryMsg: string) => void;
}

export const SettingsBackupModal: React.FC<SettingsBackupModalProps> = ({
  isOpen,
  settings,
  user = null,
  driveReconnectNeeded = false,
  isSyncingAll = false,
  onSignIn,
  onSignOut,
  onSyncAll,
  onClose,
  onSaveSettings,
  onBackupImported,
}) => {
  const [maxIntervalDays, setMaxIntervalDays] = useState(settings.maxIntervalDays);
  const [newCardsPerDay, setNewCardsPerDay] = useState(settings.newCardsPerDay);
  const [dailyReviewCap, setDailyReviewCap] = useState(settings.dailyReviewCap);
  const [examDate, setExamDate] = useState(settings.examDate || '');
  const [reminderTime, setReminderTime] = useState(settings.reminderTime || '09:00');
  const [remindersEnabled, setRemindersEnabled] = useState(Boolean(settings.remindersEnabled));
  const [swipeGesturesEnabled, setSwipeGesturesEnabled] = useState(
    Boolean(settings.swipeGesturesEnabled)
  );
  const [hapticsEnabled, setHapticsEnabled] = useState(
    settings.hapticsEnabled !== undefined ? Boolean(settings.hapticsEnabled) : true
  );
  const [reduceEffects, setReduceEffects] = useState(Boolean(settings.reduceEffects));
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMaxIntervalDays(settings.maxIntervalDays);
      setNewCardsPerDay(settings.newCardsPerDay);
      setDailyReviewCap(settings.dailyReviewCap);
      setExamDate(settings.examDate || '');
      setReminderTime(settings.reminderTime || '09:00');
      setRemindersEnabled(Boolean(settings.remindersEnabled));
      setSwipeGesturesEnabled(Boolean(settings.swipeGesturesEnabled));
      setHapticsEnabled(
        settings.hapticsEnabled !== undefined ? Boolean(settings.hapticsEnabled) : true
      );
      setReduceEffects(Boolean(settings.reduceEffects));
      setStatusMsg(null);
      setErrorMsg(null);
    }
  }, [isOpen, settings]);

  const quotaInfo = checkLocalStorageQuotaWarning();
  const daysLeft = getDaysLeftBeforeExam(examDate || undefined);
  const effectiveCap = getEffectiveMaxIntervalDays({
    maxIntervalDays,
    examDate: examDate || undefined,
  });

  const handleToggleReminder = async (checked: boolean) => {
    if (checked && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        // ignore
      }
    }
    setRemindersEnabled(checked);
  };

  const handleSave = () => {
    const next: UserSettings = {
      maxIntervalDays: Math.max(1, Math.min(365, Number(maxIntervalDays) || 4)),
      newCardsPerDay: Math.max(1, Math.min(500, Number(newCardsPerDay) || 25)),
      dailyReviewCap: Math.max(10, Math.min(2000, Number(dailyReviewCap) || 150)),
      examDate: examDate.trim() || undefined,
      reminderTime: reminderTime.trim() || '09:00',
      remindersEnabled,
      swipeGesturesEnabled,
      hapticsEnabled,
      reduceEffects,
    };
    onSaveSettings(next);
    onClose();
  };

  const handleExportBackup = async () => {
    try {
      const json = await exportFullBackupJson();
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SynapseFormula_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMsg('Exported decks, SRS state, and review log.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to export backup.');
    }
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setStatusMsg(null);

    const reader = new FileReader();
    reader.onload = async event => {
      try {
        const text = String(event.target?.result || '');
        const res = await importFullBackupJson(text);
        onBackupImported(
          `Merged ${res.mergedDecksCount} decks, ${res.mergedCardsCount} cards, ${res.mergedLogsCount} logs`
        );
        onClose();
      } catch (err: any) {
        setErrorMsg(err?.message || 'Invalid backup JSON file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Sliders className="w-4 h-4" />
          <span>Settings, Sync & Backup</span>
        </span>
      }
      subtitle="Study quotas, exam date, account, PWA install & JSON backup"
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="glass-button flex-1 min-h-[48px] rounded-xl text-[15px] font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="glass-button-primary flex-1 min-h-[48px] rounded-xl text-[15px] font-bold cursor-pointer"
          >
            Save Settings
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-[13px]">
        {/* LocalStorage Quota Warning (2.11) */}
        {quotaInfo.isNearQuota && (
          <div className="p-3.5 rounded-xl glass-panel flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-[15px]">
                LocalStorage Quota Warning ({quotaInfo.pctUsed}% used)
              </p>
              <p className="text-[13px] text-secondary-contrast">
                Review logs are safely stored in IndexedDB. Export a JSON backup to archive older decks.
              </p>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-xl glass-panel font-semibold">
            {errorMsg}
          </div>
        )}

        {statusMsg && (
          <div className="p-3 rounded-xl glass-panel flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* Account, Drive Sync & PWA Install (5.4) */}
        <div className="p-3.5 rounded-2xl glass-panel space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-secondary-contrast">
            Account, Cloud Sync & App
          </div>

          <div className="flex flex-col gap-2">
            {user ? (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[15px] font-bold truncate">{user.email}</div>
                  <div className="text-xs text-secondary-contrast">
                    {driveReconnectNeeded
                      ? 'Google Drive token expired after reload'
                      : 'Cloud Firestore & Google Drive connected'}
                  </div>
                </div>
                {onSignOut && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="glass-button min-h-[44px] px-3.5 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                )}
              </div>
            ) : (
              onSignIn && (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="glass-button-primary w-full min-h-[48px] px-4 rounded-xl text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Cloud className="w-4 h-4" />
                  <span>Sign in with Google Drive & Cloud Sync</span>
                </button>
              )
            )}

            {user && driveReconnectNeeded && onSignIn && (
              <button
                type="button"
                onClick={onSignIn}
                className="glass-button w-full min-h-[44px] px-3.5 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <CloudOff className="w-4 h-4" />
                <span>Reconnect Google Drive</span>
              </button>
            )}

            {onSyncAll && (
              <button
                type="button"
                disabled={isSyncingAll}
                onClick={onSyncAll}
                className="glass-button w-full min-h-[44px] px-3.5 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncingAll ? 'animate-spin' : ''}`} />
                <span>{isSyncingAll ? 'Syncing Drive Decks...' : 'Sync All Google Drive Decks'}</span>
              </button>
            )}

            <PWAInstallButton fullWidth />
          </div>
        </div>

        {/* SRS Scheduling Parameters */}
        <div className="space-y-2.5">
          <div className="text-xs font-bold uppercase tracking-wider text-secondary-contrast">
            Spaced Repetition & Quotas
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="p-3 rounded-2xl glass-panel space-y-1.5">
              <label className="font-bold block text-[13px]">Max Interval (Days)</label>
              <input
                type="number"
                inputMode="numeric"
                enterKeyHint="done"
                min={1}
                max={365}
                value={maxIntervalDays}
                onChange={e => setMaxIntervalDays(Number(e.target.value))}
                className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-base font-bold tabular-nums"
              />
              <span className="text-xs text-secondary-contrast block">
                Default: 4d (Effective: {effectiveCap}d)
              </span>
            </div>

            <div className="p-3 rounded-2xl glass-panel space-y-1.5">
              <label className="font-bold block text-[13px]">New Cards / Day</label>
              <input
                type="number"
                inputMode="numeric"
                enterKeyHint="done"
                min={1}
                max={500}
                value={newCardsPerDay}
                onChange={e => setNewCardsPerDay(Number(e.target.value))}
                className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-base font-bold tabular-nums"
              />
              <span className="text-xs text-secondary-contrast block">Default: 25/day</span>
            </div>

            <div className="p-3 rounded-2xl glass-panel space-y-1.5">
              <label className="font-bold block text-[13px]">Daily Review Cap</label>
              <input
                type="number"
                inputMode="numeric"
                enterKeyHint="done"
                min={10}
                max={2000}
                value={dailyReviewCap}
                onChange={e => setDailyReviewCap(Number(e.target.value))}
                className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-base font-bold tabular-nums"
              />
              <span className="text-xs text-secondary-contrast block">Default: 150/day</span>
            </div>
          </div>
        </div>

        {/* Exam-Date Mode (2.3) */}
        <div className="p-3.5 rounded-2xl glass-panel space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label className="font-bold text-[15px] flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>Exam Date Mode</span>
            </label>
            {examDate && (
              <button
                type="button"
                onClick={() => setExamDate('')}
                className="glass-button min-h-[44px] px-3 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Clear date
              </button>
            )}
          </div>
          <input
            type="date"
            value={examDate}
            onChange={e => setExamDate(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-base"
          />
          <p className="text-[13px] text-secondary-contrast leading-snug">
            {daysLeft !== null
              ? `${daysLeft} days left · Caps intervals at min(${maxIntervalDays}, ${Math.max(
                  1,
                  daysLeft - 1
                )}) = ${effectiveCap}d. Final 7 days activates Final-Week Mode (≤3d).`
              : 'Set your target exam date to automatically bound all intervals before exam day.'}
          </p>
        </div>

        {/* Study Experience & Accessibility Switches (5.10, 5.12, 5.20) */}
        <div className="p-3.5 rounded-2xl glass-panel space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-secondary-contrast mb-1">
            Study Controls & Visuals
          </div>

          <label className="flex items-center justify-between gap-3 min-h-[44px] cursor-pointer">
            <div>
              <div className="text-[15px] font-semibold">Swipe gestures in study</div>
              <div className="text-xs text-secondary-contrast">
                Swipe left = Again, swipe right = Good (with 5s undo toast)
              </div>
            </div>
            <input
              type="checkbox"
              checked={swipeGesturesEnabled}
              onChange={e => setSwipeGesturesEnabled(e.target.checked)}
              className="w-5 h-5 rounded shrink-0"
            />
          </label>

          <label className="flex items-center justify-between gap-3 min-h-[44px] cursor-pointer">
            <div>
              <div className="text-[15px] font-semibold">Haptic feedback on rating</div>
              <div className="text-xs text-secondary-contrast">
                Subtle vibration tick when rating a card
              </div>
            </div>
            <input
              type="checkbox"
              checked={hapticsEnabled}
              onChange={e => setHapticsEnabled(e.target.checked)}
              className="w-5 h-5 rounded shrink-0"
            />
          </label>

          <label className="flex items-center justify-between gap-3 min-h-[44px] cursor-pointer">
            <div>
              <div className="text-[15px] font-semibold">Reduce glass effects</div>
              <div className="text-xs text-secondary-contrast">
                Use opaque surfaces instead of blur and disable motion
              </div>
            </div>
            <input
              type="checkbox"
              checked={reduceEffects}
              onChange={e => setReduceEffects(e.target.checked)}
              className="w-5 h-5 rounded shrink-0"
            />
          </label>
        </div>

        {/* Optional Daily Reminder (2.12) */}
        <div className="p-3.5 rounded-2xl glass-panel space-y-2">
          <label className="flex items-center justify-between gap-3 min-h-[44px] cursor-pointer">
            <span className="font-bold text-[15px] flex items-center gap-2">
              <Bell className="w-4 h-4" />
              <span>Daily Study Reminder</span>
            </span>
            <input
              type="checkbox"
              checked={remindersEnabled}
              onChange={e => handleToggleReminder(e.target.checked)}
              className="w-5 h-5 rounded shrink-0"
            />
          </label>
          {remindersEnabled && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[13px] text-secondary-contrast">Notification time:</span>
              <input
                type="time"
                value={reminderTime}
                onChange={e => setReminderTime(e.target.value)}
                className="min-h-[44px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-base"
              />
            </div>
          )}
        </div>

        {/* Backup / Export / Import with Merge (2.11) */}
        <div className="p-3.5 rounded-2xl glass-panel space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-[15px]">Backup & Restore (JSON)</span>
            <span className="text-xs text-secondary-contrast tabular-nums">
              Storage: {quotaInfo.pctUsed}% used
            </span>
          </div>
          <p className="text-[13px] text-secondary-contrast leading-snug">
            Export all decks, SRS scheduling state, settings, and IndexedDB review logs as JSON, or merge an existing backup file.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleExportBackup}
              className="glass-button min-h-[44px] rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export JSON</span>
            </button>
            <label className="glass-button min-h-[44px] rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer">
              <Upload className="w-4 h-4" />
              <span>Import & Merge</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleImportBackup}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
};
