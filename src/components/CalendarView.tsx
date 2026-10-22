import React, { useState, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Play,
  CheckCircle2,
} from 'lucide-react';
import { Deck, Flashcard } from '../types';
import { getLocalDateKey, formatRepeatScheduleLabel } from '../services/srsEngine';
import { FormattedText } from './FormattedText';

interface CalendarViewProps {
  decks: Deck[];
  cards: Flashcard[];
  onStartContinuousCards: (cardsToStudy: Flashcard[], sessionTitle: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const CalendarView: React.FC<CalendarViewProps> = ({
  decks,
  cards,
  onStartContinuousCards,
}) => {
  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => getLocalDateKey(today), [today]);
  const tomorrowKey = useMemo(() => {
    const t = new Date(today);
    t.setDate(t.getDate() + 1);
    return getLocalDateKey(t);
  }, [today]);

  const [viewYear, setViewYear] = useState<number>(today.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(today.getMonth());
  const [selectedDateKey, setSelectedDateKey] = useState<string>(todayKey);

  // Map every card to its effective calendar date key (unfinished past cards automatically roll over to today)
  const cardsByDateKey = useMemo(() => {
    const map: Record<string, Flashcard[]> = {};
    for (const card of cards) {
      if (card.suspended) continue;
      const rawKey = getLocalDateKey(card.dueDate);
      const effectiveKey = rawKey < todayKey ? todayKey : rawKey;
      if (!map[effectiveKey]) map[effectiveKey] = [];
      map[effectiveKey].push(card);
    }
    return map;
  }, [cards, todayKey]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(y => y - 1);
    } else {
      setViewMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(y => y + 1);
    } else {
      setViewMonth(m => m + 1);
    }
  };

  const handleJumpToDate = (targetDate: Date) => {
    setViewYear(targetDate.getFullYear());
    setViewMonth(targetDate.getMonth());
    setSelectedDateKey(getLocalDateKey(targetDate));
  };

  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const cells: Array<{ day: number | null; dateKey: string | null }> = [];
    for (let i = 0; i < firstDayOfMonth; i++) {
      cells.push({ day: null, dateKey: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(viewYear, viewMonth, d);
      cells.push({ day: d, dateKey: getLocalDateKey(dateObj) });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const selectedDateCards = cardsByDateKey[selectedDateKey] || [];

  const selectedDateDeckGroups = useMemo(() => {
    return decks
      .map(deck => ({
        deck,
        cards: selectedDateCards.filter(c => c.deckId === deck.id),
      }))
      .filter(g => g.cards.length > 0);
  }, [decks, selectedDateCards]);

  const formatReadableDateKey = (dateKey: string): string => {
    if (dateKey === todayKey) return `Today (${dateKey})`;
    if (dateKey === tomorrowKey) return `Tomorrow (${dateKey})`;
    const [y, m, d] = dateKey.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">Schedule Calendar</h2>
          <p className="text-[13px] text-secondary-contrast">
            Tap any date to inspect or practice scheduled formulas
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleJumpToDate(today)}
            className={`min-h-[44px] px-3 rounded-xl text-[13px] font-bold cursor-pointer ${
              selectedDateKey === todayKey ? 'glass-button-primary' : 'glass-button'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              const t = new Date(today);
              t.setDate(t.getDate() + 1);
              handleJumpToDate(t);
            }}
            className={`min-h-[44px] px-3 rounded-xl text-[13px] font-bold cursor-pointer ${
              selectedDateKey === tomorrowKey ? 'glass-button-primary' : 'glass-button'
            }`}
          >
            Tomorrow
          </button>
        </div>
      </div>

      {/* Interactive Month Calendar Card */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        {/* Month Switcher */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handlePrevMonth}
            className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h3 className="text-[15px] font-bold tracking-tight">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </h3>
          <button
            type="button"
            onClick={handleNextMonth}
            className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Weekday Headers */}
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-secondary-contrast">
          {WEEKDAYS.map(day => (
            <div key={day} className="py-1">
              {day}
            </div>
          ))}
        </div>

        {/* Days Grid (all cells >= 44px height) */}
        <div className="grid grid-cols-7 gap-1.5">
          {calendarDays.map((cell, idx) => {
            if (!cell.day || !cell.dateKey) {
              return <div key={`empty_${idx}`} className="min-h-[46px]" />;
            }

            const count = cardsByDateKey[cell.dateKey]?.length || 0;
            const isSelected = cell.dateKey === selectedDateKey;
            const isToday = cell.dateKey === todayKey;

            return (
              <button
                key={cell.dateKey}
                type="button"
                onClick={() => setSelectedDateKey(cell.dateKey!)}
                className={`min-h-[46px] rounded-xl p-1 flex flex-col items-center justify-between border transition-colors cursor-pointer tabular-nums ${
                  isSelected
                    ? 'glass-button-primary font-bold'
                    : isToday
                    ? 'glass-panel font-bold border-black/40 dark:border-white/40'
                    : count > 0
                    ? 'glass-panel'
                    : 'border-transparent text-secondary-contrast hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <span className="text-xs leading-none mt-0.5">{cell.day}</span>
                {count > 0 ? (
                  <span className="text-xs font-bold leading-tight">{count}</span>
                ) : (
                  <span className="text-xs opacity-40">·</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Date Details (Segregated Deck-Wise) */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-bold">
              <CalendarIcon className="w-4 h-4" />
              <span>{formatReadableDateKey(selectedDateKey)}</span>
            </div>
            <p className="text-[13px] text-secondary-contrast mt-0.5 tabular-nums">
              {selectedDateCards.length}{' '}
              {selectedDateCards.length === 1 ? 'formula' : 'formulas'} across{' '}
              {selectedDateDeckGroups.length}{' '}
              {selectedDateDeckGroups.length === 1 ? 'deck' : 'decks'}
            </p>
          </div>
        </div>

        {selectedDateCards.length > 0 ? (
          <div className="space-y-3 pt-1">
            {selectedDateDeckGroups.map(({ deck, cards: deckCards }) => (
              <div
                key={deck.id}
                className="rounded-xl glass-panel p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-black/10 dark:border-white/10">
                  <div className="min-w-0">
                    <h4 className="text-[15px] font-bold truncate">{deck.name}</h4>
                    <p className="text-xs text-secondary-contrast tabular-nums">
                      {deckCards.length} {deckCards.length === 1 ? 'card' : 'cards'} scheduled
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onStartContinuousCards(deckCards, deck.name)}
                    className="glass-button-primary min-h-[44px] px-3.5 rounded-xl text-[13px] font-bold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{selectedDateKey === todayKey ? 'Review' : 'Practice'}</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto overscroll-contain">
                  {deckCards.slice(0, 50).map((card, i) => (
                    <div
                      key={card.id}
                      className="p-2.5 rounded-xl bg-white/80 dark:bg-zinc-900/80 border border-black/10 dark:border-white/10 space-y-0.5"
                    >
                      <div className="flex items-center justify-between text-xs text-secondary-contrast tabular-nums">
                        <span>
                          #{i + 1} · {card.category || 'Formula'}
                        </span>
                        <span>{formatRepeatScheduleLabel(card)}</span>
                      </div>
                      <p className="text-[13px] font-semibold leading-snug">
                        <FormattedText text={card.statement} />
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-5 text-center space-y-1.5">
            <CheckCircle2 className="w-6 h-6 mx-auto opacity-60" />
            <p className="text-[13px] font-semibold">
              No formulas due on {formatReadableDateKey(selectedDateKey)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
