import React, { useMemo, useEffect, useState } from 'react';
import {
  Flame,
  BarChart3,
  Clock,
  Play,
  Calendar,
  Trophy,
  Timer,
  TrendingUp,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import {
  Deck,
  Flashcard,
  StudyStreakState,
  UserSettings,
  ReviewLogEntry,
  GameAnalyticsState,
  TimeAttackDuration,
} from '../types';
import {
  getLocalDateKey,
  isCardDueToday,
  isCardStable,
  isCardLeech,
  isCardLearned,
  computePoolAndTopicMastery,
} from '../services/srsEngine';
import { getUserSettings, getGameAnalyticsState } from '../services/storage';
import {
  getReviewLogsSync,
  initReviewLogStore,
  computeReviewAnalytics,
  computeHistoricalMasterySeries,
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

const TIME_ATTACK_DURATIONS: TimeAttackDuration[] = [300, 600, 900];

/**
 * Progress Screen Redesigned Around Mastery:
 * 1. Prominent Overall Mastery Percentage hero at the top (graduated card-level SRS evidence).
 * 2. Mastery Over Time SVG line chart reconstructed from real review log history.
 * 3. Topic-Level Mastery breakdown sorted weakest-first (graceful "Uncategorized" fallback).
 * 4. Study & Game Analytics: Pool workload counters (Total, Due Today, Overdue, New),
 *    Classic & Time Attack (5m/10m/15m) Personal Bests, Recent Game Sessions, Retention,
 *    Streak, 7-Day Forecast, 28-Day Heatmap, and Schedule Calendar.
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
  const [gameAnalytics, setGameAnalytics] = useState<GameAnalyticsState>(() =>
    getGameAnalyticsState()
  );

  useEffect(() => {
    initReviewLogStore().then(loaded => setLogs([...loaded]));
    setGameAnalytics(getGameAnalyticsState());
  }, [cards]);

  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);
  const completedToday = streak.completedDates.includes(todayKey);

  const activeCards = useMemo(() => cards.filter(c => !c.suspended), [cards]);

  // Pool & Workload counters (moved off the home screen into Progress)
  const workloadStats = useMemo(() => {
    const now = new Date();
    const totalCards = activeCards.length;
    const dueTodayCards = activeCards.filter(
      c => isCardLearned(c) && isCardDueToday(c, now, settings)
    );
    const overdueCards = dueTodayCards.filter(
      c =>
        (c.shiftedFromDate && c.shiftedFromDate < todayKey) ||
        getLocalDateKey(c.dueDate) < todayKey
    );
    const newCards = activeCards.filter(c => !isCardLearned(c));
    const stableCards = activeCards.filter(c => isCardStable(c, settings, now));
    const leeches = activeCards.filter(c => isCardLeech(c));
    const suspended = cards.filter(c => c.suspended);

    return {
      totalCards,
      dueTodayCount: dueTodayCards.length,
      overdueCount: overdueCards.length,
      newCount: newCards.length,
      stableCount: stableCards.length,
      leechCount: leeches.length,
      suspendedCount: suspended.length,
    };
  }, [activeCards, cards, settings, todayKey]);

  // Overall Mastery & Topic-Level Mastery
  const masterySummary = useMemo(
    () => computePoolAndTopicMastery(cards, settings, new Date()),
    [cards, settings]
  );

  // Mastery Over Time series reconstructed from real review logs
  const masterySeries = useMemo(
    () => computeHistoricalMasterySeries(cards, logs, settings, 14, new Date()),
    [cards, logs, settings]
  );

  // 7-Day Workload Forecast Strip
  const forecastStrip = useMemo(() => {
    const now = new Date();
    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const totalUnseen = activeCards.filter(c => !isCardLearned(c)).length;

    let remainingUnseenPool = totalUnseen;

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const key = getLocalDateKey(d);
      const scheduledReviews = activeCards.filter(c => {
        if (!isCardLearned(c)) return false;
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

  // Review Log Analytics (Retention %, Cards/Day, Time/Day)
  const logStats = useMemo(() => computeReviewAnalytics(logs, 7), [logs]);

  // Last 28 days (4 weeks) consistency heatmap
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

  const maxDailyCards = useMemo(
    () => Math.max(10, ...logStats.dailyMetrics.map(d => d.cardsCount)),
    [logStats.dailyMetrics]
  );

  const maxDailyMinutes = useMemo(
    () => Math.max(5, ...logStats.dailyMetrics.map(d => d.totalMinutes)),
    [logStats.dailyMetrics]
  );

  // SVG Polyline coordinates for Mastery Over Time
  const chartGeometry = useMemo(() => {
    if (masterySeries.length === 0) return null;
    const width = 320;
    const height = 110;
    const padX = 16;
    const padY = 14;
    const usableW = width - padX * 2;
    const usableH = height - padY * 2;

    const coords = masterySeries.map((pt, idx) => {
      const x =
        masterySeries.length === 1
          ? width / 2
          : padX + (idx / (masterySeries.length - 1)) * usableW;
      const y = padY + usableH - (Math.max(0, Math.min(100, pt.masteryPct)) / 100) * usableH;
      return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), pt };
    });

    const polylinePoints = coords.map(c => `${c.x},${c.y}`).join(' ');
    return { width, height, coords, polylinePoints };
  }, [masterySeries]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Progress & Mastery</h1>
          <p className="text-[13px] text-secondary-contrast">
            Card-level formula mastery, topic breakdown, game records & schedule
          </p>
        </div>
      </div>

      {/* 1. Prominent Overall Mastery Hero */}
      <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-secondary-contrast block">
              Overall Formula Mastery
            </span>
            <div className="flex items-baseline gap-2.5">
              <span className="text-4xl sm:text-5xl font-extrabold tracking-tight tabular-nums">
                {masterySummary.overallMasteryPct}%
              </span>
              <span className="text-xs font-semibold text-secondary-contrast tabular-nums">
                {masterySummary.stableCount} / {masterySummary.activeCount} stable
              </span>
            </div>
            <p className="text-xs text-secondary-contrast leading-relaxed">
              Graduated from card-level SRS intervals and consecutive recall stability (0% unseen,
              25–85% active review, 100% stable at cap).
            </p>
          </div>

          {workloadStats.dueTodayCount > 0 && (
            <button
              type="button"
              onClick={onReviewDue}
              className="glass-button-primary min-h-[44px] px-3.5 rounded-xl text-[13px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Review</span>
            </button>
          )}
        </div>

        <div className="w-full h-2.5 bg-black/10 dark:bg-white/15 rounded-full overflow-hidden">
          <div
            className="h-full bg-black dark:bg-white transition-all duration-300"
            style={{ width: `${masterySummary.overallMasteryPct}%` }}
          />
        </div>
      </div>

      {/* 2. Mastery Over Time Line Chart */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[15px] font-bold flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" />
            <span>Mastery Over Time</span>
          </span>
          <span className="text-xs text-secondary-contrast tabular-nums">
            {masterySeries.length > 0
              ? `${masterySeries.length}d history`
              : 'No review history yet'}
          </span>
        </div>

        {chartGeometry && masterySeries.length > 0 ? (
          <div className="space-y-2">
            <div className="p-3 rounded-xl glass-panel">
              <svg
                viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
                className="w-full h-28 overflow-visible"
                role="img"
                aria-label="Mastery percentage over time line chart"
              >
                {/* Horizontal reference lines at 0%, 50%, 100% */}
                <line
                  x1="16"
                  y1="14"
                  x2="304"
                  y2="14"
                  stroke="currentColor"
                  strokeOpacity="0.12"
                  strokeDasharray="3 3"
                />
                <line
                  x1="16"
                  y1="55"
                  x2="304"
                  y2="55"
                  stroke="currentColor"
                  strokeOpacity="0.12"
                  strokeDasharray="3 3"
                />
                <line
                  x1="16"
                  y1="96"
                  x2="304"
                  y2="96"
                  stroke="currentColor"
                  strokeOpacity="0.15"
                />

                {chartGeometry.coords.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={chartGeometry.polylinePoints}
                  />
                )}

                {chartGeometry.coords.map(c => (
                  <g key={c.pt.dateKey}>
                    <circle cx={c.x} cy={c.y} r="3.5" fill="currentColor" />
                    <title>{`${c.pt.label}: ${c.pt.masteryPct}% mastery`}</title>
                  </g>
                ))}
              </svg>

              <div className="flex items-center justify-between text-xs text-secondary-contrast tabular-nums pt-1">
                <span>
                  {masterySeries[0].label} ({masterySeries[0].masteryPct}%)
                </span>
                <span>
                  {masterySeries[masterySeries.length - 1].label} (
                  {masterySeries[masterySeries.length - 1].masteryPct}%)
                </span>
              </div>
            </div>

            <p className="text-xs text-secondary-contrast leading-snug">
              Estimated trajectory reconstructed from chronological review logs across your active
              formula pool.
            </p>
          </div>
        ) : (
          <div className="p-4 rounded-xl glass-panel text-center text-[13px] text-secondary-contrast">
            Complete your first review session to record mastery history over time.
          </div>
        )}
      </div>

      {/* 3. Topic-Level Mastery Breakdown (Sorted Weakest First) */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-bold">Topic-Level Mastery</h2>
          <span className="text-xs text-secondary-contrast">Weakest first</span>
        </div>

        {masterySummary.topics.length > 0 ? (
          <div className="space-y-2">
            {masterySummary.topics.map(topic => (
              <div key={topic.category} className="p-3 rounded-xl glass-panel space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="font-bold truncate">{topic.category}</span>
                  <div className="flex items-center gap-2 shrink-0 tabular-nums text-xs">
                    <span className="text-secondary-contrast">
                      {topic.stableCount}/{topic.cardCount} stable
                      {topic.dueCount > 0 ? ` · ${topic.dueCount} due` : ''}
                    </span>
                    <span className="font-extrabold text-[13px]">{topic.masteryPct}%</span>
                  </div>
                </div>
                <div className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-black dark:bg-white transition-all duration-300"
                    style={{ width: `${topic.masteryPct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-xl glass-panel text-center text-[13px] text-secondary-contrast">
            No active topics in pool.
          </div>
        )}
      </div>

      {/* 4. Pool & Workload Statistics (Moved off Home Screen) */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold flex items-center gap-1.5">
            <Layers className="w-4 h-4" />
            <span>Pool & Workload Overview</span>
          </h2>
          <span className="text-xs text-secondary-contrast tabular-nums">
            {workloadStats.leechCount} leeches · {workloadStats.suspendedCount} suspended
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl p-3 glass-panel">
            <span className="text-xs font-bold uppercase text-secondary-contrast">Total Cards</span>
            <div className="text-lg font-extrabold tabular-nums">{workloadStats.totalCards}</div>
            <span className="text-xs text-secondary-contrast">Active pool</span>
          </div>

          <div className="rounded-xl p-3 glass-panel">
            <span className="text-xs font-bold uppercase text-secondary-contrast">Due Today</span>
            <div className="text-lg font-extrabold tabular-nums">{workloadStats.dueTodayCount}</div>
            <span className="text-xs text-secondary-contrast">Scheduled</span>
          </div>

          <div className="rounded-xl p-3 glass-panel">
            <span className="text-xs font-bold uppercase text-secondary-contrast">Overdue</span>
            <div className="text-lg font-extrabold tabular-nums">{workloadStats.overdueCount}</div>
            <span className="text-xs text-secondary-contrast">Past due date</span>
          </div>

          <div className="rounded-xl p-3 glass-panel">
            <span className="text-xs font-bold uppercase text-secondary-contrast">New Cards</span>
            <div className="text-lg font-extrabold tabular-nums">{workloadStats.newCount}</div>
            <span className="text-xs text-secondary-contrast">Unseen in pool</span>
          </div>
        </div>
      </div>

      {/* 5. Personal Bests (Classic Mode & Time Attack Presets) + Recent Sessions */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold flex items-center gap-1.5">
            <Trophy className="w-4 h-4" />
            <span>Personal Bests & Session History</span>
          </h2>
          <span className="text-xs text-secondary-contrast tabular-nums">
            {gameAnalytics.recentSessions.length} sessions recorded
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* Classic Mode Personal Best */}
          <div className="rounded-xl p-3 glass-panel space-y-0.5">
            <span className="text-xs font-bold uppercase text-secondary-contrast block">
              Classic
            </span>
            {gameAnalytics.classicBest ? (
              <>
                <div className="text-base font-extrabold tabular-nums">
                  {gameAnalytics.classicBest.bestScore > 0
                    ? `+${gameAnalytics.classicBest.bestScore}`
                    : gameAnalytics.classicBest.bestScore}{' '}
                  pts
                </div>
                <span className="text-xs text-secondary-contrast tabular-nums block">
                  {gameAnalytics.classicBest.mostCardsCompleted} cards max
                </span>
              </>
            ) : (
              <div className="text-xs text-secondary-contrast pt-1">No record yet</div>
            )}
          </div>

          {/* Time Attack Personal Bests by Duration (5m, 10m, 15m) */}
          {TIME_ATTACK_DURATIONS.map(dur => {
            const best = gameAnalytics.timeAttackBests[dur];
            return (
              <div key={dur} className="rounded-xl p-3 glass-panel space-y-0.5">
                <span className="text-xs font-bold uppercase text-secondary-contrast flex items-center gap-1">
                  <Timer className="w-3 h-3" />
                  <span>{dur / 60}m Timed</span>
                </span>
                {best ? (
                  <>
                    <div className="text-base font-extrabold tabular-nums">
                      {best.bestScore > 0 ? `+${best.bestScore}` : best.bestScore} pts
                    </div>
                    <span className="text-xs text-secondary-contrast tabular-nums block">
                      {best.mostCardsCompleted} cards max
                    </span>
                  </>
                ) : (
                  <div className="text-xs text-secondary-contrast pt-1">No record yet</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Recent Game Sessions */}
        {gameAnalytics.recentSessions.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-black/10 dark:border-white/10">
            <div className="text-xs font-bold uppercase tracking-wider text-secondary-contrast">
              Recent Sessions
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
              {gameAnalytics.recentSessions.slice(0, 8).map(sess => {
                const recallTrials = sess.correctCount + sess.incorrectCount;
                const acc =
                  recallTrials > 0 ? Math.round((sess.correctCount / recallTrials) * 100) : null;
                const dateLabel = new Date(sess.completedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                });
                return (
                  <div
                    key={sess.id}
                    className="px-3 py-2 rounded-xl glass-panel flex items-center justify-between gap-2 text-xs tabular-nums"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold">
                        {sess.mode === 'time-attack'
                          ? `Time Attack (${(sess.durationSeconds || 300) / 60}m)`
                          : 'Classic'}
                      </span>
                      <span className="text-secondary-contrast">· {dateLabel}</span>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0 font-semibold">
                      <span>{sess.cardsCompleted} cards</span>
                      {acc !== null && <span className="text-secondary-contrast">{acc}%</span>}
                      <span className="font-bold">
                        {sess.score > 0 ? `+${sess.score}` : sess.score} pts
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 6. Streak + Retention Summary Card */}
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
                  : workloadStats.dueTodayCount > 0
                  ? `${workloadStats.dueTodayCount} due left today`
                  : 'Caught up for today'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-semibold text-secondary-contrast shrink-0">
            <ShieldCheck className="w-4 h-4" />
            <span>{workloadStats.stableCount} stable</span>
          </div>
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

      {/* 7. 7-Day Workload Forecast Strip */}
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
                idx === 0 ? 'glass-button-primary' : 'glass-panel'
              }`}
            >
              <span className="text-xs font-bold">{day.dayLabel}</span>
              <span className="text-[15px] font-extrabold tabular-nums mt-0.5">
                {day.reviewCount}
              </span>
              <span className="text-xs opacity-80 tabular-nums">+{day.newCount}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 8. 28-Day Consistency Heatmap */}
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

      {/* 9. Review Log Charts: Cards / Day & Time / Day */}
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

      {/* 10. Interactive Schedule Calendar */}
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

