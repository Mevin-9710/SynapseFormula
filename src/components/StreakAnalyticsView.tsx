import React, { useMemo } from 'react';
import {
  Flame,
  Trophy,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  Zap,
  Award,
  Play,
  Calendar,
} from 'lucide-react';
import { Deck, Flashcard, StudyStreakState } from '../types';
import { getLocalDateKey, isCardDueToday } from '../services/srsEngine';

interface StreakAnalyticsViewProps {
  decks: Deck[];
  cards: Flashcard[];
  streak: StudyStreakState;
  onReviewDue: () => void;
}

export const StreakAnalyticsView: React.FC<StreakAnalyticsViewProps> = ({
  decks,
  cards,
  streak,
  onReviewDue,
}) => {
  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);
  const completedToday = streak.completedDates.includes(todayKey);

  const dueCardsToday = useMemo(
    () => cards.filter(c => isCardDueToday(c)),
    [cards]
  );

  // Last 7 days strip
  const last7Days = useMemo(() => {
    const days: Array<{
      label: string;
      dateNum: number;
      dateKey: string;
      done: boolean;
      isToday: boolean;
    }> = [];
    const now = new Date();
    const shortLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = getLocalDateKey(d);
      days.push({
        label: shortLabels[d.getDay()],
        dateNum: d.getDate(),
        dateKey: key,
        done: streak.completedDates.includes(key),
        isToday: i === 0,
      });
    }
    return days;
  }, [streak.completedDates]);

  // Last 28 days (4 weeks) consistency grid
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

  // Overall Card Mastery & Performance Stats
  const stats = useMemo(() => {
    const total = cards.length;
    const mastered = cards.filter(c => c.state === 'mastered').length;
    const review = cards.filter(c => c.state === 'review').length;
    const learning = cards.filter(c => c.state === 'learning').length;
    const unseen = cards.filter(c => c.state === 'new').length;

    const reviewedTodayCount = cards.filter(
      c =>
        (c.lastReviewedAt && getLocalDateKey(c.lastReviewedAt) === todayKey) ||
        (c.firstTimeReviewedAt && getLocalDateKey(c.firstTimeReviewedAt) === todayKey)
    ).length;

    const totalRepetitions = cards.reduce((sum, c) => sum + (c.repetitionCount || 0), 0);

    const seenCards = cards.filter(c => c.state !== 'new');
    const avgEase =
      seenCards.length > 0
        ? seenCards.reduce((sum, c) => sum + (c.easeFactor || 2.5), 0) / seenCards.length
        : 2.5;

    const masteryRate =
      total > 0 ? Math.round(((mastered + review) / total) * 100) : 0;

    return {
      total,
      mastered,
      review,
      learning,
      unseen,
      reviewedTodayCount,
      totalRepetitions,
      avgEase,
      masteryRate,
    };
  }, [cards, todayKey]);

  // Deck-wise performance breakdown
  const deckPerformance = useMemo(() => {
    return decks.map(deck => {
      const deckCards = cards.filter(c => c.deckId === deck.id);
      const total = deckCards.length;
      const mastered = deckCards.filter(c => c.state === 'mastered').length;
      const review = deckCards.filter(c => c.state === 'review').length;
      const learning = deckCards.filter(c => c.state === 'learning').length;
      const unseen = deckCards.filter(c => c.state === 'new').length;
      const due = deckCards.filter(c => isCardDueToday(c)).length;

      const avgEase =
        total > 0
          ? deckCards.reduce((sum, c) => sum + (c.easeFactor || 2.5), 0) / total
          : 2.5;

      const progressPct =
        total > 0
          ? Math.round(((mastered * 1 + review * 0.75 + learning * 0.35) / total) * 100)
          : 0;

      return {
        deck,
        total,
        mastered,
        review,
        learning,
        unseen,
        due,
        avgEase,
        progressPct,
      };
    });
  }, [decks, cards]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-black tracking-tight flex items-center gap-2">
            <Flame className="w-5 h-5 text-orange-500 fill-amber-400" />
            <span>Streaks & Analytics</span>
          </h1>
          <p className="text-xs text-black/55">
            Daily review consistency & formula recall performance
          </p>
        </div>
      </div>

      {/* Hero Study Streak Card */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 border border-amber-300/70 bg-gradient-to-br from-amber-50/90 via-orange-50/60 to-white space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-xs border ${
                completedToday
                  ? 'bg-gradient-to-br from-orange-500 to-amber-500 text-white border-orange-400'
                  : 'bg-amber-100/90 text-orange-600 border-amber-300'
              }`}
            >
              <Flame
                className={`w-6 h-6 ${
                  completedToday ? 'text-white fill-amber-200' : 'text-orange-500 fill-amber-400'
                }`}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-black tabular-nums tracking-tight">
                  {streak.currentStreak}
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-orange-600">
                  {streak.currentStreak === 1 ? 'Day Streak' : 'Days Streak'}
                </span>
              </div>
              <p className="text-xs text-black/65 mt-0.5 leading-snug">
                {completedToday
                  ? 'All due reviews completed for today!'
                  : dueCardsToday.length > 0
                  ? `${dueCardsToday.length} due ${
                      dueCardsToday.length === 1 ? 'card' : 'cards'
                    } left to lock in today’s streak`
                  : 'Review any formula today to build your streak'}
              </p>
            </div>
          </div>

          {!completedToday && dueCardsToday.length > 0 && (
            <button
              onClick={onReviewDue}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs transition-colors min-h-[40px]"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Finish ({dueCardsToday.length})</span>
            </button>
          )}
        </div>

        {/* Streak Mini KPI Row */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="rounded-xl bg-white/85 border border-amber-200/70 p-2.5 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] font-semibold text-black/50 uppercase">Best Streak</div>
              <div className="text-sm font-bold text-black tabular-nums">
                {streak.bestStreak} {streak.bestStreak === 1 ? 'day' : 'days'}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-white/85 border border-emerald-200/70 p-2.5 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] font-semibold text-black/50 uppercase">Total Days</div>
              <div className="text-sm font-bold text-black tabular-nums">
                {streak.completedDates.length}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-white/85 border border-sky-200/70 p-2.5 flex items-center gap-2">
            <Zap className="w-4 h-4 text-sky-500 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] font-semibold text-black/50 uppercase">Done Today</div>
              <div className="text-sm font-bold text-black tabular-nums">
                {stats.reviewedTodayCount} cards
              </div>
            </div>
          </div>
        </div>

        {/* Last 7 Days Visual Tracker */}
        <div className="rounded-xl bg-white/90 border border-black/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-black/70 uppercase tracking-wider">
              Last 7 Days
            </span>
            <span className="text-[11px] font-semibold text-emerald-600 tabular-nums">
              {last7Days.filter(d => d.done).length}/7 days completed
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {last7Days.map(day => (
              <div
                key={day.dateKey}
                className={`rounded-xl py-2 px-1 flex flex-col items-center gap-1 border ${
                  day.done
                    ? 'bg-emerald-50/90 border-emerald-200 text-emerald-800'
                    : day.isToday
                    ? 'bg-amber-50/90 border-amber-300 text-amber-800'
                    : 'bg-black/[0.02] border-black/5 text-black/40'
                }`}
              >
                <span className="text-[9px] font-bold uppercase tracking-tight">
                  {day.label}
                </span>
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums ${
                    day.done
                      ? 'bg-emerald-500 text-white shadow-2xs'
                      : day.isToday
                      ? 'bg-amber-400/25 text-amber-800 border border-amber-400'
                      : 'bg-black/5 text-black/40'
                  }`}
                >
                  {day.done ? '✓' : day.dateNum}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Performance Analytics Overview */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-black">Recall Performance & Mastery</h2>
          </div>
          <span className="text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-lg tabular-nums">
            {stats.masteryRate}% Mature
          </span>
        </div>

        {/* 4 Metric Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="rounded-xl p-3 bg-emerald-50/70 border border-emerald-200/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              Mastered
            </span>
            <div className="text-xl font-extrabold text-emerald-900 tabular-nums mt-0.5">
              {stats.mastered}
            </div>
            <span className="text-[10px] text-emerald-700/80">21+ days interval</span>
          </div>

          <div className="rounded-xl p-3 bg-indigo-50/70 border border-indigo-200/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
              In Review
            </span>
            <div className="text-xl font-extrabold text-indigo-900 tabular-nums mt-0.5">
              {stats.review}
            </div>
            <span className="text-[10px] text-indigo-700/80">Active recall cycle</span>
          </div>

          <div className="rounded-xl p-3 bg-amber-50/70 border border-amber-200/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
              Learning
            </span>
            <div className="text-xl font-extrabold text-amber-900 tabular-nums mt-0.5">
              {stats.learning}
            </div>
            <span className="text-[10px] text-amber-700/80">Short-term steps</span>
          </div>

          <div className="rounded-xl p-3 bg-sky-50/70 border border-sky-200/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700">
              Unseen
            </span>
            <div className="text-xl font-extrabold text-sky-900 tabular-nums mt-0.5">
              {stats.unseen}
            </div>
            <span className="text-[10px] text-sky-700/80">First-time queue</span>
          </div>
        </div>

        {/* Stacked Distribution Bar */}
        {stats.total > 0 && (
          <div className="space-y-1.5">
            <div className="w-full h-3 rounded-full bg-black/5 overflow-hidden flex">
              {stats.mastered > 0 && (
                <div
                  style={{ width: `${(stats.mastered / stats.total) * 100}%` }}
                  className="bg-emerald-500 h-full transition-all"
                  title={`Mastered: ${stats.mastered}`}
                />
              )}
              {stats.review > 0 && (
                <div
                  style={{ width: `${(stats.review / stats.total) * 100}%` }}
                  className="bg-indigo-500 h-full transition-all"
                  title={`Review: ${stats.review}`}
                />
              )}
              {stats.learning > 0 && (
                <div
                  style={{ width: `${(stats.learning / stats.total) * 100}%` }}
                  className="bg-amber-400 h-full transition-all"
                  title={`Learning: ${stats.learning}`}
                />
              )}
              {stats.unseen > 0 && (
                <div
                  style={{ width: `${(stats.unseen / stats.total) * 100}%` }}
                  className="bg-sky-300 h-full transition-all"
                  title={`Unseen: ${stats.unseen}`}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between text-[10px] text-black/55 gap-2">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Mastered
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-indigo-500" /> Review
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400" /> Learning
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-sky-300" /> Unseen
                </span>
              </div>
              <span className="tabular-nums font-semibold">
                Avg Ease: {stats.avgEase.toFixed(2)}x · {stats.totalRepetitions} total reps
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 28-Day Activity Heatmap */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-black">28-Day Consistency Heatmap</h2>
          </div>
          <span className="text-[11px] font-semibold text-black/55 tabular-nums">
            {last28Days.filter(d => d.done).length} active days
          </span>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {last28Days.map(day => (
            <div
              key={day.dateKey}
              title={`${day.dateKey}: ${day.done ? 'Completed due reviews' : 'No streak recorded'}`}
              className={`h-8 rounded-lg flex items-center justify-center text-[11px] font-semibold tabular-nums border transition-colors ${
                day.done
                  ? 'bg-emerald-500 text-white border-emerald-600 shadow-2xs'
                  : day.isToday
                  ? 'bg-amber-50 text-amber-800 border-amber-300 font-bold'
                  : 'bg-black/[0.03] text-black/40 border-black/5'
              }`}
            >
              {day.dayNum}
            </div>
          ))}
        </div>
      </div>

      {/* Deck-by-Deck Performance Breakdown */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-600" />
            <h2 className="text-sm font-bold text-black">Deck Mastery Breakdown</h2>
          </div>
          <span className="text-[11px] text-black/50 tabular-nums">{decks.length} decks</span>
        </div>

        <div className="space-y-2.5">
          {deckPerformance.map(item => (
            <div
              key={item.deck.id}
              className="rounded-xl bg-white/75 border border-black/8 p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-xs font-bold text-black truncate">{item.deck.name}</h3>
                  <p className="text-[10px] text-black/50 tabular-nums">
                    {item.total} cards · Ease {item.avgEase.toFixed(2)}x
                    {item.due > 0 ? ` · ${item.due} due today` : ' · All caught up'}
                  </p>
                </div>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-lg tabular-nums shrink-0 ${
                    item.progressPct >= 75
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : item.progressPct >= 40
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}
                >
                  {item.progressPct}%
                </span>
              </div>

              <div className="w-full h-2 rounded-full bg-black/5 overflow-hidden flex">
                {item.total > 0 && (
                  <>
                    <div
                      style={{ width: `${(item.mastered / item.total) * 100}%` }}
                      className="bg-emerald-500 h-full"
                    />
                    <div
                      style={{ width: `${(item.review / item.total) * 100}%` }}
                      className="bg-indigo-500 h-full"
                    />
                    <div
                      style={{ width: `${(item.learning / item.total) * 100}%` }}
                      className="bg-amber-400 h-full"
                    />
                  </>
                )}
              </div>

              <div className="flex items-center justify-between text-[10px] text-black/55 tabular-nums">
                <span className="text-emerald-700 font-medium">{item.mastered} mastered</span>
                <span className="text-indigo-700 font-medium">{item.review} review</span>
                <span className="text-amber-700 font-medium">{item.learning} learning</span>
                <span className="text-sky-700 font-medium">{item.unseen} unseen</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
