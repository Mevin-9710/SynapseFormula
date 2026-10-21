export interface VariableDefinition {
  symbol: string;
  meaning: string;
  unit?: string;
}

export type CardStage = 'statement' | 'cloze' | 'variables';
export type CardState = 'new' | 'learning' | 'review' | 'mastered';
export type SrsRating = 'first-time' | 'again' | 'hard' | 'good' | 'easy';
export type StudySessionMode = 'recall' | 'first-time' | 'due-continuous';

export interface Flashcard {
  id: string;
  deckId: string;
  statement: string; // Plain text or markdown with *italic highlights*
  formula: string;   // Math expression / LaTeX notation rendered in JetBrains Mono
  variables?: VariableDefinition[];
  explanation?: string;
  category?: string;
  derivationSummary?: string;
  
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
  state: CardState;
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
}

export interface ColumnMapping {
  statementCol: string;
  formulaCol: string;
  variablesCol?: string;
  explanationCol?: string;
  categoryCol?: string;
}

export interface Deck {
  id: string;
  name: string;
  description?: string;
  googleDriveFileId?: string;
  googleDriveFileName?: string;
  googleDriveMimeType?: string;
  googleDriveModifiedTime?: string;
  lastSyncedAt: string; // ISO string
  syncIntervalHours: number; // default: 24
  columnMapping: ColumnMapping;
  cardsCount: number;
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
