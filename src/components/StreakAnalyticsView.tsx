import React, { useMemo, useEffect, useState } from 'react';
import {
  Flame,
  BarChart3,
  Clock,
  Play,
  Calendar,
} from 'lucide-react';
import { Deck, Flashcard, StudyStreakState, UserSettings, ReviewLogEntry } from '../types';
import { getLocalDateKey, isCardDueToday, isCardStable, isCardLeech } from '../services/srsEngine';
import { getUserSettings } from '../services/storage';
import {
  getReviewLogsSync,
  initReviewLogStore,
  computeReviewAnalytics,
} from '../services/reviewLog';
import { CalendarView } from './CalendarView';

interface StreakAnalyticsViewProps {
  decks: Deck[];
  cards: Flashcard[];
  streak: StudyStreakState;
  settings?: UserSettings;
  onReviewDue: () => void;
  onStartContinuousCards?: (cardsToStudy: Flashcard[], sessionTitle: string) => void;
}

/**
 * Unified Progress Tab (5.4 & 5.5):
 * Combines Streak, 7-Day Workload Forecast, 28-Day Heatmap, Stability/Mastery,
 * Review Log Analytics (Retention %, Cards/Day, Time/Day), and Schedule Calendar.
 */
export const StreakAnalyticsView: React.FC<StreakAnalyticsViewProps> = ({
  decks,
  cards,
  streak,
  settings: propSettings,
  onReviewDue,
  onStartContinuousCards,
}) => {
  const settings = propSettings || getUserSettings();
  const [logs, setLogs] = useState<ReviewLogEntry[]>(() => getReviewLogsSync());

  useEffect(() => {
    initReviewLogStore().then(loaded => setLogs([...loaded]));
  }, [cards]);

  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);
  const completedToday = streak.completedDates.includes(todayKey);

  const activeCards = useMemo(() => cards.filter(c => !c.suspended), [cards]);
  const dueCardsToday = useMemo(
    () => activeCards.filter(c => isCardDueToday(c, new Date(), settings)),
    [activeCards, settings]
  );

  // 7-Day Workload Forecast Strip (2.10 & 5.5)
  const forecastStrip = useMemo(() => {
    const now = new Date();
    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const totalUnseen = activeCards.filter(
      c => !c.firstTimeReviewedAt && c.repetitionCount === 0
    ).length;

    let remainingUnseenPool = totalUnseen;

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const key = getLocalDateKey(d);
      const scheduledReviews = activeCards.filter(c => {
        if (c.repetitionCount === 0 && !c.firstTimeReviewedAt) return false;
        const cardKey = getLocalDateKey(c.dueDate);
        return i === 0 ? cardKey <= todayKey : cardKey === key;
      }).length;

      const plannedNew = Math.min(remainingUnseenPool, settings.newCardsPerDay);
      remainingUnseenPool = Math.max(0, remainingUnseenPool - plannedNew);

      return {
        dateKey: key,
        dayLabel: i === 0 ? 'Today' : shortDays[d.getDay()],
        reviewCount: scheduledReviews,
        newCount: plannedNew,
      };
    });
  }, [activeCards, settings.newCardsPerDay, todayKey]);

  // Review Log Analytics (2.5: retention %, cards/day and time/day charts)
  const logStats = useMemo(() => computeReviewAnalytics(logs, 7), [logs]);

  // Last 28 days (4 weeks) consistency heatmap (3.5)
  const last28Days = useMemo(() => {
    const days: Array<{
      dateKey: string;
      dayNum: number;
      done: boolean;
      isToday: boolean;
    }> = [];
    const now = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = getLocalDateKey(d);
      days.push({
        dateKey: key,
        dayNum: d.getDate(),
        done: streak.completedDates.includes(key),
        isToday: i === 0,
      });
    }
    return days;
  }, [streak.completedDates]);

  // Overall Card Stability & State Distribution (3.1: show "stable" instead of mastered)
  const stats = useMemo(() => {
    const total = activeCards.length;
    const stable = activeCards.filter(c => isCardStable(c, settings)).length;
    const review = activeCards.filter(c => c.state === 'review' && !isCardStable(c, settings)).length;
    const learning = activeCards.filter(c => c.state === 'learning').length;
    const unseen = activeCards.filter(c => c.state === 'new').length;
    const leeches = activeCards.filter(c => isCardLeech(c)).length;
    const suspended = cards.filter(c => c.suspended).length;

    return {
      total,
      stable,
      review,
      learning,
      unseen,
      leeches,
      suspended,
    };
  }, [activeCards, cards, settings]);

  const maxDailyCards = useMemo(
    () => Math.max(10, ...logStats.dailyMetrics.map(d => d.cardsCount)),
    [logStats.dailyMetrics]
  );

  const maxDailyMinutes = useMemo(
    () => Math.max(5, ...logStats.dailyMetrics.map(d => d.totalMinutes)),
    [logStats.dailyMetrics]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Progress & Schedule</h1>
          <p className="text-[13px] text-secondary-contrast">
            Streak, 7-day forecast, stability, retention & calendar
          </p>
        </div>
      </div>

      {/* Compact Streak + Retention Summary Card */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-black/5 dark:bg-white/10 flex items-center justify-center shrink-0">
              <Flame className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-extrabold tabular-nums">
                  {streak.currentStreak}d Streak
                </span>
                <span className="text-[13px] text-secondary-contrast tabular-nums">
                  · Best {streak.bestStreak}d
                </span>
              </div>
              <p className="text-[13px] text-secondary-contrast truncate">
                {completedToday
                  ? 'All due reviews completed for today'
                  : dueCardsToday.length > 0
                  ? `${dueCardsToday.length} due left today`
                  : 'Caught up for today'}
              </p>
            </div>
          </div>

          {!completedToday && dueCardsToday.length > 0 && (
            <button
              type="button"
              onClick={onReviewDue}
              className="glass-button-primary min-h-[44px] px-3.5 rounded-xl text-[13px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Review ({dueCardsToday.length})</span>
            </button>
          )}
        </div>

        {/* Retention %, Total Logged Reviews, Avg Pace */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="rounded-xl glass-panel p-2.5">
            <div className="text-xs font-bold text-secondary-contrast uppercase">Retention</div>
            <div className="text-base font-extrabold tabular-nums">
              {logStats.overallRetentionPct}%
            </div>
          </div>
          <div className="rounded-xl glass-panel p-2.5">
            <div className="text-xs font-bold text-secondary-contrast uppercase">Reviews</div>
            <div className="text-base font-extrabold tabular-nums">
              {logStats.totalReviews}
            </div>
          </div>
          <div className="rounded-xl glass-panel p-2.5">
            <div className="text-xs font-bold text-secondary-contrast uppercase">Pace</div>
            <div className="text-base font-extrabold tabular-nums">
              {logStats.avgSecondsPerCard}s/card
            </div>
          </div>
        </div>
      </div>

      {/* 7-Day Workload Forecast Strip (2.10 & 5.5) */}
      <div className="glass-card rounded-2xl p-4 space-y-2.5">
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-bold">7-Day Workload Forecast</span>
          <span className="text-xs text-secondary-contrast tabular-nums">
            Review · +New ({settings.newCardsPerDay}/d quota)
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1.5 text-center">
          {forecastStrip.map((day, idx) => (
            <div
              key={day.dateKey}
              className={`rounded-xl py-2 px-1 border flex flex-col items-center justify-between ${
                idx === 0
                  ? 'glass-button-primary'
                  : 'glass-panel'
              }`}
            >
              <span className="text-xs font-bold">{day.dayLabel}</span>
              <span className="text-[15px] font-extrabold tabular-nums mt-0.5">
                {day.reviewCount}
              </span>
              <span className="text-xs opacity-80 tabular-nums">
                +{day.newCount}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Formula Stability Breakdown (3.1: Stable instead of Mastered) */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold">Formula Stability</h2>
          <span className="text-xs text-secondary-contrast tabular-nums">
            {stats.leeches} leeches · {stats.suspended} suspended
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl p-3 glass-panel">
            <span className="text-xs font-bold uppercase text-secondary-contrast">Stable</span>
            <div className="text-lg font-extrabold tabular-nums">{stats.stable}</div>
            <span className="text-xs text-secondary-contrast">3× Good at cap</span>
          </div>

          <div className="rounded-xl p-3 glass-panel">
            <span className="text-xs font-bold uppercase text-secondary-contrast">Review</span>
            <div className="text-lg font-extrabold tabular-nums">{stats.review}</div>
            <span className="text-xs text-secondary-contrast">Active cycle</span>
          </div>

          <div className="rounded-xl p-3 glass-panel">
            <span className="text-xs font-bold uppercase text-secondary-contrast">Learning</span>
            <div className="text-lg font-extrabold tabular-nums">{stats.learning}</div>
            <span className="text-xs text-secondary-contrast">Short steps</span>
          </div>

          <div className="rounded-xl p-3 glass-panel">
            <span className="text-xs font-bold uppercase text-secondary-contrast">Unseen</span>
            <div className="text-lg font-extrabold tabular-nums">{stats.unseen}</div>
            <span className="text-xs text-secondary-contrast">New queue</span>
          </div>
        </div>
      </div>

      {/* 28-Day Consistency Heatmap */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            <h2 className="text-[15px] font-bold">28-Day Heatmap</h2>
          </div>
          <span className="text-xs font-semibold text-secondary-contrast tabular-nums">
            {last28Days.filter(d => d.done).length} active days
          </span>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {last28Days.map(day => (
            <div
              key={day.dateKey}
              title={`${day.dateKey}: ${day.done ? 'Completed due reviews' : 'No streak recorded'}`}
              className={`min-h-[38px] rounded-xl flex items-center justify-center text-xs font-bold tabular-nums border ${
                day.done
                  ? 'glass-button-primary'
                  : day.isToday
                  ? 'glass-panel border-black/40 dark:border-white/40'
                  : 'glass-panel text-secondary-contrast'
              }`}
            >
              {day.dayNum}
            </div>
          ))}
        </div>
      </div>

      {/* Review Log Charts: Cards / Day & Time / Day (2.5) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4" />
              <span>Cards / Day (7d)</span>
            </span>
            <span className="text-xs text-secondary-contrast tabular-nums">
              {logStats.dailyMetrics[logStats.dailyMetrics.length - 1]?.cardsCount || 0} today
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1.5 items-end h-28 pt-2">
            {logStats.dailyMetrics.map(day => {
              const heightPct = Math.max(8, Math.round((day.cardsCount / maxDailyCards) * 100));
              return (
                <div key={day.dateKey} className="flex flex-col items-center gap-1 h-full justify-end">
                  <span className="text-xs font-bold text-secondary-contrast tabular-nums">
                    {day.cardsCount}
                  </span>
                  <div className="w-full bg-black/10 dark:bg-white/10 rounded-t-md h-16 flex items-end overflow-hidden">
                    <div
                      style={{ height: `${heightPct}%` }}
                      className="w-full bg-black dark:bg-white rounded-t-md"
                    />
                  </div>
                  <span className="text-xs text-secondary-contrast truncate w-full text-center">
                    {day.label.split(' ')[1] || day.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              <span>Time / Day (Mins)</span>
            </span>
            <span className="text-xs text-secondary-contrast tabular-nums">
              {logStats.dailyMetrics[logStats.dailyMetrics.length - 1]?.totalMinutes || 0}m today
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1.5 items-end h-28 pt-2">
            {logStats.dailyMetrics.map(day => {
              const heightPct = Math.max(
                8,
                Math.round((day.totalMinutes / maxDailyMinutes) * 100)
              );
              return (
                <div key={day.dateKey} className="flex flex-col items-center gap-1 h-full justify-end">
                  <span className="text-xs font-bold text-secondary-contrast tabular-nums">
                    {day.totalMinutes}m
                  </span>
                  <div className="w-full bg-black/10 dark:bg-white/10 rounded-t-md h-16 flex items-end overflow-hidden">
                    <div
                      style={{ height: `${heightPct}%` }}
                      className="w-full bg-black dark:bg-white rounded-t-md"
                    />
                  </div>
                  <span className="text-xs text-secondary-contrast truncate w-full text-center">
                    {day.label.split(' ')[1] || day.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Interactive Schedule Calendar (5.5) */}
      {onStartContinuousCards && (
        <CalendarView
          decks={decks}
          cards={cards}
          onStartContinuousCards={onStartContinuousCards}
        />
      )}
    </div>
  );
};
