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
import { FormulaDisplay } from './FormulaDisplay';

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

  // Build calendar cells for current viewMonth / viewYear
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

  // Segregate selected date's due cards deck-wise
  const selectedDateDeckGroups = useMemo(() => {
    return decks
      .map(deck => ({
        deck,
        cards: selectedDateCards.filter(c => c.deckId === deck.id),
      }))
      .filter(g => g.cards.length > 0);
  }, [decks, selectedDateCards]);

  // Upcoming dates (after today) with scheduled repeats, segregated deck-wise
  const upcomingDateEntries = useMemo(() => {
    return Object.entries(cardsByDateKey)
      .filter(([dateKey, list]) => dateKey > todayKey && list.length > 0)
      .sort(([a], [b]) => a.localeCompare(b));
  }, [cardsByDateKey, todayKey]);

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
      {/* Page Header */}
      <div className="flex items-center justify-between py-1">
        <div>
          <h1 className="text-lg font-bold text-black tracking-tight">
            Calendar
          </h1>
          <p className="text-xs text-black/50">
            Due cards segregated deck-wise
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleJumpToDate(today)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold min-h-[38px] cursor-pointer ${
              selectedDateKey === todayKey
                ? 'glass-button-primary text-white'
                : 'glass-button text-black'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => {
              const t = new Date(today);
              t.setDate(t.getDate() + 1);
              handleJumpToDate(t);
            }}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold min-h-[38px] cursor-pointer ${
              selectedDateKey === tomorrowKey
                ? 'glass-button-primary text-white'
                : 'glass-button text-black'
            }`}
          >
            Tomorrow
          </button>
        </div>
      </div>

      {/* Interactive Month Calendar Card */}
      <div className="glass-card rounded-2xl p-4 border border-black/10 shadow-xs space-y-3">
        {/* Month Switcher */}
        <div className="flex items-center justify-between">
          <button
            onClick={handlePrevMonth}
            className="p-2 rounded-xl glass-button text-black min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-black tracking-tight">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </h2>
          <button
            onClick={handleNextMonth}
            className="p-2 rounded-xl glass-button text-black min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Weekday Headers */}
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-black/45">
          {WEEKDAYS.map(day => (
            <div key={day} className="py-1">
              {day}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((cell, idx) => {
            if (!cell.day || !cell.dateKey) {
              return <div key={`empty_${idx}`} className="h-12" />;
            }

            const count = cardsByDateKey[cell.dateKey]?.length || 0;
            const isSelected = cell.dateKey === selectedDateKey;
            const isToday = cell.dateKey === todayKey;

            return (
              <button
                key={cell.dateKey}
                onClick={() => setSelectedDateKey(cell.dateKey!)}
                className={`h-12 rounded-xl p-1 flex flex-col items-center justify-between border transition-all cursor-pointer tabular-nums ${
                  isSelected
                    ? 'bg-black text-white border-black font-bold shadow-xs'
                    : isToday
                    ? 'bg-black/5 text-black border-black/30 font-bold'
                    : count > 0
                    ? 'bg-white text-black border-black/15 hover:border-black/40'
                    : 'bg-transparent text-black/50 border-transparent hover:bg-black/5'
                }`}
              >
                <span className="text-xs leading-none mt-0.5">{cell.day}</span>
                {count > 0 ? (
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md leading-tight ${
                      isSelected ? 'bg-white text-black' : 'bg-black text-white'
                    }`}
                  >
                    {count} due
                  </span>
                ) : (
                  <span className="text-[9px] opacity-30">·</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Date Details (Segregated Deck-Wise) */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 border border-black/10 shadow-xs space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-black">
              <CalendarIcon className="w-3.5 h-3.5" />
              <span>{formatReadableDateKey(selectedDateKey)}</span>
            </div>
            <p className="text-[11px] text-black/55 mt-0.5 tabular-nums">
              {selectedDateCards.length} {selectedDateCards.length === 1 ? 'formula' : 'formulas'} across{' '}
              {selectedDateDeckGroups.length} {selectedDateDeckGroups.length === 1 ? 'deck' : 'decks'}
            </p>
          </div>
        </div>

        {selectedDateCards.length > 0 ? (
          <div className="space-y-3 pt-1">
            {selectedDateDeckGroups.map(({ deck, cards: deckCards }) => (
              <div
                key={deck.id}
                className="rounded-xl bg-black/[0.025] border border-black/10 p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-black/5">
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold text-black truncate">
                      {deck.name}
                    </h3>
                    <p className="text-[10px] text-black/50 tabular-nums">
                      {deckCards.length} {deckCards.length === 1 ? 'card' : 'cards'} scheduled
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      onStartContinuousCards(deckCards, deck.name)
                    }
                    className="glass-button-primary px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 min-h-[34px] cursor-pointer shrink-0"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Review ({deckCards.length})</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {deckCards.map((card, i) => (
                    <div
                      key={card.id}
                      className="p-2.5 rounded-lg bg-white/95 border border-black/5 space-y-1"
                    >
                      <div className="flex items-center justify-between text-[10px] text-black/45 tabular-nums">
                        <span>
                          #{i + 1} · {card.category || 'Formula'}
                        </span>
                        <span>{formatRepeatScheduleLabel(card)}</span>
                      </div>
                      <p className="text-xs font-semibold text-black leading-snug">
                        {card.statement}
                      </p>
                      <div className="py-1 px-2 rounded bg-black/[0.02] overflow-x-auto">
                        <FormulaDisplay formula={card.formula} displayMode={false} size="xs" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center space-y-1.5">
            <CheckCircle2 className="w-7 h-7 mx-auto text-black/40" />
            <p className="text-xs font-semibold text-black">
              No formulas due on {formatReadableDateKey(selectedDateKey)}
            </p>
          </div>
        )}
      </div>

      {/* Upcoming Repeat Schedule Summary (Segregated Deck-Wise) */}
      {upcomingDateEntries.length > 0 && (
        <div className="glass-card rounded-2xl p-4 sm:p-5 border border-black/10 shadow-xs space-y-3">
          <div>
            <h3 className="text-xs font-bold text-black">
              Upcoming Repeats (Deck-Wise)
            </h3>
            <p className="text-[11px] text-black/50">
              Formulas scheduled to repeat over the coming days
            </p>
          </div>

          <div className="space-y-2">
            {upcomingDateEntries.map(([dateKey, list]) => {
              const deckBreakdown = decks
                .map(d => ({
                  deck: d,
                  count: list.filter(c => c.deckId === d.id).length,
                }))
                .filter(x => x.count > 0);

              return (
                <button
                  key={dateKey}
                  onClick={() => {
                    const [y, m, d] = dateKey.split('-').map(Number);
                    handleJumpToDate(new Date(y, m - 1, d));
                  }}
                  className="w-full text-left p-3 rounded-xl bg-black/[0.02] hover:bg-black/[0.05] border border-black/10 flex items-center justify-between gap-2 cursor-pointer transition-colors"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs font-bold text-black">
                      {formatReadableDateKey(dateKey)}
                    </p>
                    <p className="text-[11px] text-black/60 truncate">
                      {deckBreakdown.map(b => `${b.deck.name} (${b.count})`).join(' · ')}
                    </p>
                  </div>
                  <span className="text-xs font-bold text-black shrink-0 tabular-nums">
                    {list.length} due →
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
