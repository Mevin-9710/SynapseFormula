import { Flashcard, SrsRating } from '../types';

export interface SrsCalculationResult {
  nextIntervalDays: number;
  nextEaseFactor: number;
  nextRepetitionCount: number;
  nextDueDate: string;
  nextState: Flashcard['state'];
  readableNextInterval: string;
}

/**
 * Returns YYYY-MM-DD in the user's local timezone for calendar grouping and rollover checks.
 */
export const getLocalDateKey = (dateInput: string | Date | number = new Date()): string => {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date();
    return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`;
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Checks if a card is due today (any time up to 23:59:59 today) or earlier.
 */
export const isCardDueToday = (card: Flashcard, referenceDate: Date = new Date()): boolean => {
  const todayKey = getLocalDateKey(referenceDate);
  const cardKey = getLocalDateKey(card.dueDate);
  return cardKey <= todayKey;
};

/**
 * Formats a human-readable repeat schedule label for a card (e.g., "Repeat after 3d", "Due today", "Due tomorrow").
 */
export const formatRepeatScheduleLabel = (card: Flashcard): string => {
  const todayKey = getLocalDateKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = getLocalDateKey(tomorrow);
  const cardKey = getLocalDateKey(card.dueDate);

  if (card.intervalDays > 0) {
    const intervalStr = formatIntervalReadable(card.intervalDays);
    if (cardKey <= todayKey) {
      return `Due today · Interval ${intervalStr}`;
    }
    if (cardKey === tomorrowKey) {
      return `Due tomorrow · Repeat ${intervalStr}`;
    }
    return `Repeat after ${intervalStr}`;
  }

  if (card.firstTimeReviewedAt) {
    return cardKey === tomorrowKey ? 'First-time reviewed · Due tomorrow' : 'First-time reviewed';
  }

  return 'New · Unseen';
};

/**
 * Calculates updated spaced repetition parameters using an accelerated hybrid SM-2 algorithm
 * designed specifically for rapid physics formula retention, including First Time Review.
 */
export const calculateNextReview = (card: Flashcard, rating: SrsRating): SrsCalculationResult => {
  const now = new Date();
  let intervalDays = card.intervalDays;
  let easeFactor = card.easeFactor || 2.5;
  let repetitionCount = card.repetitionCount || 0;
  let state = card.state;

  if (rating === 'first-time') {
    // First Time Review: User is going through unfamiliar cards to learn what's in the deck first
    // before testing active recall. No ease factor penalty; schedules card for tomorrow (1d).
    intervalDays = 1;
    easeFactor = card.easeFactor || 2.5;
    repetitionCount = 0;
    state = 'learning';

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    return {
      nextIntervalDays: intervalDays,
      nextEaseFactor: Number(easeFactor.toFixed(2)),
      nextRepetitionCount: repetitionCount,
      nextDueDate: tomorrow.toISOString(),
      nextState: state,
      readableNextInterval: '1d',
    };
  }

  if (card.state === 'new' || card.state === 'learning' || repetitionCount === 0) {
    switch (rating) {
      case 'again':
        intervalDays = 1 / (24 * 60); // 1 minute
        easeFactor = Math.max(1.3, easeFactor - 0.2);
        repetitionCount = 0;
        state = 'learning';
        break;
      case 'hard':
        intervalDays = 10 / (24 * 60); // 10 minutes
        easeFactor = Math.max(1.3, easeFactor - 0.15);
        repetitionCount = 0;
        state = 'learning';
        break;
      case 'good':
        intervalDays = 1; // 1 day
        repetitionCount = 1;
        state = 'review';
        break;
      case 'easy':
        intervalDays = 3; // 3 days
        easeFactor = Math.min(3.0, easeFactor + 0.15);
        repetitionCount = 1;
        state = 'review';
        break;
    }
  } else {
    switch (rating) {
      case 'again':
        intervalDays = 1 / (24 * 60);
        easeFactor = Math.max(1.3, easeFactor - 0.2);
        repetitionCount = 0;
        state = 'learning';
        break;
      case 'hard':
        intervalDays = Math.max(1, Math.round(intervalDays * 1.2));
        easeFactor = Math.max(1.3, easeFactor - 0.15);
        repetitionCount += 1;
        state = 'review';
        break;
      case 'good':
        intervalDays = Math.max(2, Math.round(intervalDays * easeFactor));
        repetitionCount += 1;
        state = repetitionCount >= 4 ? 'mastered' : 'review';
        break;
      case 'easy':
        intervalDays = Math.max(4, Math.round(intervalDays * easeFactor * 1.3));
        easeFactor = Math.min(3.0, easeFactor + 0.15);
        repetitionCount += 1;
        state = repetitionCount >= 3 ? 'mastered' : 'review';
        break;
    }
  }

  const nextDueDate = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString();

  return {
    nextIntervalDays: intervalDays,
    nextEaseFactor: Number(easeFactor.toFixed(2)),
    nextRepetitionCount: repetitionCount,
    nextDueDate,
    nextState: state,
    readableNextInterval: formatIntervalReadable(intervalDays),
  };
};

export const previewRatingIntervals = (card: Flashcard): Record<SrsRating, string> => {
  return {
    'first-time': calculateNextReview(card, 'first-time').readableNextInterval,
    again: calculateNextReview(card, 'again').readableNextInterval,
    hard: calculateNextReview(card, 'hard').readableNextInterval,
    good: calculateNextReview(card, 'good').readableNextInterval,
    easy: calculateNextReview(card, 'easy').readableNextInterval,
  };
};

export const formatIntervalReadable = (days: number): string => {
  if (days < 1 / 24) {
    const minutes = Math.max(1, Math.round(days * 24 * 60));
    return `${minutes}m`;
  }
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours}h`;
  }
  const roundDays = Math.round(days);
  if (roundDays === 1) return '1d';
  if (roundDays < 30) return `${roundDays}d`;
  const months = Math.round(roundDays / 30);
  return `${months}mo`;
};

export interface ClozeItem {
  maskedFormula: string;
  hiddenTerm: string;
  options: string[];
}

/**
 * Deconstructs mathematical formulas to generate clean cloze deletion targets
 * replacing targets directly with a clean question mark '?' without brackets
 * to ensure 100% standard LaTeX compatibility.
 */
export const generateFormulaCloze = (formula: string): ClozeItem => {
  if (!formula || formula.length < 3) {
    return {
      maskedFormula: '?',
      hiddenTerm: formula,
      options: [formula, 'x^2', '0', '1'],
    };
  }

  // 1. Exponents like ^2, ^{2}, ^3, ^4
  const exponentMatch = formula.match(/\^\{?([0-9a-zA-Z\+\-]+)\}?/);
  if (exponentMatch && exponentMatch[1]) {
    const fullMatch = exponentMatch[0];
    const power = exponentMatch[1];
    return {
      maskedFormula: formula.replace(fullMatch, '^?'),
      hiddenTerm: power,
      options: shuffle([power, '2', '3', '4', '-1', '\\frac{1}{2}']),
    };
  }

  // 2. Denominators in \frac{numerator}{denominator}
  const fracMatch = formula.match(/\\frac\{([^}]+)\}\{([^}]+)\}/);
  if (fracMatch && fracMatch[2]) {
    const denom = fracMatch[2];
    return {
      maskedFormula: formula.replace(`{${denom}}`, '{?}'),
      hiddenTerm: denom,
      options: shuffle([denom, 'r^2', '2m', 'c', '\\Delta t', '2']),
    };
  }

  // 3. Multiplication/addition terms: split by operators
  const parts = formula.split(/(=|\+|-|\times|\\times)/);
  if (parts.length >= 3) {
    const targetIdx = parts.length - 1;
    const token = parts[targetIdx].trim();
    if (token) {
      const masked = parts
        .map((p, i) => (i === targetIdx ? ' ? ' : p))
        .join('');
      return {
        maskedFormula: masked,
        hiddenTerm: token,
        options: shuffle([token, 'm \\cdot v', 'q \\vec{E}', 'k_B T', '\\hbar \\omega', '\\vec{B}']),
      };
    }
  }

  // Fallback: mask right side with ?
  const half = Math.floor(formula.length / 2);
  const left = formula.slice(0, half);
  const right = formula.slice(half);
  return {
    maskedFormula: `${left} ?`,
    hiddenTerm: right,
    options: shuffle([right, 'm a', 'r^2', '\\hbar \\omega']),
  };
};

function shuffle(arr: string[]): string[] {
  const unique = Array.from(new Set(arr));
  return unique.sort(() => Math.random() - 0.5);
}
