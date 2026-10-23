export interface VariableDefinition {
  symbol: string;
  meaning: string;
  unit?: string;
}

export type CardStage = 'statement' | 'cloze' | 'variables';
export type CardState = 'new' | 'learning' | 'review';
export type SrsRating = 'first-time' | 'again' | 'hard' | 'good' | 'easy';
export type StudySessionMode =
  | 'recall'
  | 'first-time'
  | 'due-continuous'
  | 'practice'
  | 'interleaved'
  | 'drill';

export interface UserSettings {
  maxIntervalDays: number; // default 4
  newCardsPerDay: number;  // default 25
  dailyReviewCap: number;  // default 150
  examDate?: string;       // YYYY-MM-DD
  reminderTime?: string;   // HH:MM (24h)
  remindersEnabled?: boolean;
  swipeGesturesEnabled?: boolean; // default false (5.10)
  hapticsEnabled?: boolean;       // default true (5.12)
  reduceEffects?: boolean;        // default false (5.20)
  themeMode?: 'light' | 'dark' | 'system'; // default 'light'
}

export interface ReviewLogEntry {
  id?: string;
  cardId: string;
  deckId?: string;
  ts: number; // epoch milliseconds
  rating: SrsRating;
  prevInterval: number;
  newInterval: number;
  ms: number; // review duration in ms
}

export interface StudyStreakState {
  currentStreak: number;
  bestStreak: number;
  completedDates: string[]; // Array of YYYY-MM-DD local date keys where due reviews were completed
  lastStudiedDate?: string; // YYYY-MM-DD
}

export interface Flashcard {
  id: string;
  deckId: string;
  statement: string; // Plain text or markdown with *italic highlights*
  formula: string;   // Math expression / LaTeX notation rendered in JetBrains Mono
  variables?: VariableDefinition[];
  explanation?: string;
  category?: string;
  conditions?: string;        // e.g. "constant acceleration only"
  derivation?: string;        // Brief derivation steps shown after reveal
  derivationSummary?: string; // Legacy alias for derivation

  // Spaced Repetition Scheduling state
  repetitionStage: CardStage;
  intervalDays: number;
  easeFactor: number;
  repetitionCount: number;
  dueDate: string; // ISO string
  lastReviewedAt?: string;
  firstTimeReviewedAt?: string;
  shiftedFromDate?: string;
  rolloverCount?: number;
  lapses?: number;
  suspended?: boolean;
  consecutiveGoods?: number;
  createdAt?: string;
  state: CardState;
}

export type GameMode = 'classic' | 'time-attack';
export type TimeAttackDuration = 300 | 600 | 900; // 5 min, 10 min, 15 min in seconds

export interface RoundProgressInfo {
  roundSize: number;          // 5
  currentRound: number;       // 1-indexed
  totalRounds: number;        // Math.max(1, Math.ceil(totalInSession / 5))
  cardInRound: number;        // 1-indexed within current round
  cardsInCurrentRound: number;// 5 for full rounds, or remainder (1..5) on final partial round
  justCompletedRound: number | null; // Non-null (e.g., 3) when completedCount is an exact multiple of 5 and < totalInSession
  overallPercent: number;     // 0..100
  roundPercent: number;       // 0..100
}

export interface GameSessionRecord {
  id: string;
  mode: GameMode;
  durationSeconds?: TimeAttackDuration;
  score: number;
  cardsCompleted: number;
  correctCount: number;
  incorrectCount: number;
  roundsCompleted: number;
  completedAt: string; // ISO timestamp
}

export interface PersonalBestRecord {
  bestScore: number;
  mostCardsCompleted: number;
  achievedAt: string; // ISO timestamp
}

export interface GameAnalyticsState {
  classicBest?: PersonalBestRecord;
  timeAttackBests: Partial<Record<TimeAttackDuration, PersonalBestRecord>>;
  recentSessions: GameSessionRecord[]; // Bounded to last 100 completed sessions
}

export interface DeckSessionState {
  lastCardId: string;
  lastCardIndex: number;
  stage: CardStage;
  remainingQueueIds: string[];
  totalInSession: number;
  completedInSession: number;
  lastStudiedAt: string; // ISO string
  mode?: StudySessionMode;
  sessionId?: string;
  gameMode?: GameMode;
  score?: number;
  correctCount?: number;
  incorrectCount?: number;
  timeLimitSeconds?: TimeAttackDuration;
  startedAtEpochMs?: number;
  endsAtEpochMs?: number;
}

export interface ColumnMapping {
  statementCol: string;
  formulaCol: string;
  variablesCol?: string;
  explanationCol?: string;
  categoryCol?: string;
  conditionsCol?: string;
  derivationCol?: string;
}

export interface Deck {
  id: string;
  name: string;
  description?: string;
  sheetName?: string;
  googleDriveFileId?: string;
  googleDriveFileName?: string;
  googleDriveMimeType?: string;
  googleDriveModifiedTime?: string;
  lastSyncedAt: string; // ISO string
  syncIntervalHours: number; // default: 24
  columnMapping: ColumnMapping;
  cardsCount: number;
  newCardsPerDayOverride?: number;
  createdAt?: string;
  sessionState?: DeckSessionState; // Active recall session state ("Resume where I left off")
  firstTimeSessionState?: DeckSessionState; // First Time Review session state ("Resume First Time Review")
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}
