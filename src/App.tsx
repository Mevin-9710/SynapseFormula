import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { Plus, CheckCircle2, Trash2, HelpCircle } from 'lucide-react';
import { Deck, Flashcard, StudySessionMode, DeckSessionState, StudyStreakState } from './types';
import {
  getStoredDecks,
  saveStoredDecks,
  getStoredCards,
  saveStoredCards,
  getDueTodaySessionState,
  rolloverOverdueCardsFromPastDays,
  evaluateAndRecordDailyStreak,
} from './services/storage';
import { isCardDueToday } from './services/srsEngine';
import { initAuth, googleSignIn, logout, getAccessToken } from './services/auth';
import { fetchDriveFileBinary, fetchDriveFileMetadata } from './services/drive';
import { convertRowsToFlashcards } from './services/excelParser';
import { Navbar, NavView } from './components/Navbar';
import { DeckCard } from './components/DeckCard';
import { StudySession } from './components/StudySession';
import { DrivePickerModal } from './components/DrivePickerModal';
import { FormulaBrowserModal } from './components/FormulaBrowserModal';
import { ExcelGuideModal } from './components/ExcelGuideModal';
import { DueTodayHolder } from './components/DueTodayHolder';
import { CalendarView } from './components/CalendarView';
import { StreakAnalyticsView } from './components/StreakAnalyticsView';

export default function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [dueSessionState, setDueSessionState] = useState<DeckSessionState | undefined>(undefined);
  const [streak, setStreak] = useState<StudyStreakState>({
    currentStreak: 0,
    bestStreak: 0,
    completedDates: [],
  });
  const [user, setUser] = useState<User | null>(null);

  const [currentView, setCurrentView] = useState<NavView>('decks');
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [browseDeck, setBrowseDeck] = useState<Deck | null>(null);
  const [deckToDelete, setDeckToDelete] = useState<Deck | null>(null);

  // Active Study Session
  const [activeStudyDeck, setActiveStudyDeck] = useState<Deck | null>(null);
  const [activeSessionCards, setActiveSessionCards] = useState<Flashcard[]>([]);
  const [activeSessionMode, setActiveSessionMode] = useState<StudySessionMode>('recall');
  const [resumeMode, setResumeMode] = useState<boolean>(false);
  const [initialCardIndex, setInitialCardIndex] = useState<number>(0);

  // Sync state
  const [syncingDeckIds, setSyncingDeckIds] = useState<Record<string, boolean>>({});
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  const showToast = (msg: string, durationMs = 3000) => {
    setSyncToast(msg);
    setTimeout(() => setSyncToast(null), durationMs);
  };

  // Load decks & cards, automatically shift unfinished past due cards, and evaluate streak
  useEffect(() => {
    const loadedDecks = getStoredDecks();
    const loadedCards = getStoredCards();
    const { updatedCards } = rolloverOverdueCardsFromPastDays(loadedCards);

    setDecks(loadedDecks);
    setCards(updatedCards);
    setDueSessionState(getDueTodaySessionState());
    setStreak(evaluateAndRecordDailyStreak(updatedCards));
  }, []);

  // Automatic background rollover check when the day ends
  useEffect(() => {
    const interval = setInterval(() => {
      const currentStored = getStoredCards();
      const { updatedCards, shiftedCount } = rolloverOverdueCardsFromPastDays(currentStored);
      if (shiftedCount > 0) {
        setCards(updatedCards);
      }
      setStreak(evaluateAndRecordDailyStreak(updatedCards));
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser) => setUser(currentUser),
      () => setUser(null)
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    try {
      const res = await googleSignIn();
      if (res?.user) setUser(res.user);
    } catch (err) {
      console.error('Sign-in failed:', err);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
  };

  const handleDeckCreated = (newDeck: Deck, newCards: Flashcard[]) => {
    const updatedDecks = [newDeck, ...decks];
    const updatedCards = [...newCards, ...cards];
    setDecks(updatedDecks);
    setCards(updatedCards);
    saveStoredDecks(updatedDecks);
    saveStoredCards(updatedCards);
    setStreak(evaluateAndRecordDailyStreak(updatedCards));
    showToast(`Added ${newDeck.name}`);
  };

  const confirmDeleteDeck = (target: Deck) => {
    const updatedDecks = decks.filter(d => d.id !== target.id);
    const updatedCards = cards.filter(c => c.deckId !== target.id);
    setDecks(updatedDecks);
    setCards(updatedCards);
    saveStoredDecks(updatedDecks);
    saveStoredCards(updatedCards);
    setStreak(evaluateAndRecordDailyStreak(updatedCards));
    setDeckToDelete(null);
    if (browseDeck?.id === target.id) {
      setBrowseDeck(null);
    }
    showToast(`Deleted "${target.name}"`);
  };

  const handleStartFresh = (deck: Deck, mode: StudySessionMode = 'recall') => {
    const deckCards = cards.filter(c => c.deckId === deck.id);
    setActiveStudyDeck(deck);
    setActiveSessionCards(deckCards);
    setActiveSessionMode(mode);
    setResumeMode(false);
    setInitialCardIndex(0);
  };

  const handleResume = (deck: Deck, mode: StudySessionMode = 'recall') => {
    const deckCards = cards.filter(c => c.deckId === deck.id);
    setActiveStudyDeck(deck);
    setActiveSessionCards(deckCards);
    setActiveSessionMode(mode);
    setResumeMode(true);
    setInitialCardIndex(0);
  };

  // Automatically picks up where the user left off across due cards (or within a specific deck's due cards)
  const handleReviewDue = (options?: {
    deckId?: string;
    startCardId?: string;
    startFresh?: boolean;
  }) => {
    if (options?.deckId) {
      const targetDeck = decks.find(d => d.id === options.deckId);
      const deckDue = cards.filter(c => c.deckId === options.deckId && isCardDueToday(c));
      if (!targetDeck || deckDue.length === 0) return;

      const cardIdx = options.startCardId
        ? Math.max(0, deckDue.findIndex(c => c.id === options.startCardId))
        : 0;

      setActiveStudyDeck(targetDeck);
      setActiveSessionCards(deckDue);
      setActiveSessionMode('recall');
      setResumeMode(!options.startFresh && !options.startCardId);
      setInitialCardIndex(cardIdx);
      return;
    }

    const dueOrderedDeckWise: Flashcard[] = [];
    for (const deck of decks) {
      const deckDue = cards.filter(c => c.deckId === deck.id && isCardDueToday(c));
      dueOrderedDeckWise.push(...deckDue);
    }

    if (dueOrderedDeckWise.length === 0) return;

    const syntheticDueDeck: Deck = {
      id: '__due_today__',
      name: 'Due Today',
      lastSyncedAt: new Date().toISOString(),
      syncIntervalHours: 24,
      columnMapping: { statementCol: 'Statement', formulaCol: 'Formula' },
      cardsCount: dueOrderedDeckWise.length,
      sessionState: getDueTodaySessionState(),
    };

    setActiveStudyDeck(syntheticDueDeck);
    setActiveSessionCards(dueOrderedDeckWise);
    setActiveSessionMode('due-continuous');
    setResumeMode(!options?.startFresh);
    setInitialCardIndex(0);
  };

  const handleStartContinuousCustomCards = (cardsToStudy: Flashcard[], sessionTitle: string) => {
    if (cardsToStudy.length === 0) return;
    const syntheticDeck: Deck = {
      id: '__custom_calendar_session__',
      name: sessionTitle,
      lastSyncedAt: new Date().toISOString(),
      syncIntervalHours: 24,
      columnMapping: { statementCol: 'Statement', formulaCol: 'Formula' },
      cardsCount: cardsToStudy.length,
    };
    setActiveStudyDeck(syntheticDeck);
    setActiveSessionCards(cardsToStudy);
    setActiveSessionMode('due-continuous');
    setResumeMode(false);
    setInitialCardIndex(0);
  };

  const handleRefreshDeck = async (deck: Deck) => {
    if (!deck.googleDriveFileId) return;

    setSyncingDeckIds(prev => ({ ...prev, [deck.id]: true }));
    try {
      const token = await getAccessToken();
      if (!token) await handleSignIn();

      const buffer = await fetchDriveFileBinary(deck.googleDriveFileId, deck.googleDriveMimeType);
      const metadata = await fetchDriveFileMetadata(deck.googleDriveFileId);

      const freshCards = convertRowsToFlashcards(
        buffer,
        Object.keys(deck.columnMapping).length > 0 ? Object.values(deck.columnMapping)[0] || 'Sheet1' : 'Sheet1',
        deck.columnMapping,
        deck.id
      );

      // Preserve SRS memory scores for identical formulas
      const existingDeckCards = cards.filter(c => c.deckId === deck.id);
      const mergedCards = freshCards.map(fresh => {
        const match = existingDeckCards.find(e => e.statement === fresh.statement || e.formula === fresh.formula);
        if (match) {
          return {
            ...fresh,
            id: match.id,
            intervalDays: match.intervalDays,
            easeFactor: match.easeFactor,
            repetitionCount: match.repetitionCount,
            dueDate: match.dueDate,
            state: match.state,
            lastReviewedAt: match.lastReviewedAt,
            firstTimeReviewedAt: match.firstTimeReviewedAt,
            shiftedFromDate: match.shiftedFromDate,
            rolloverCount: match.rolloverCount,
          };
        }
        return fresh;
      });

      const updatedDeck: Deck = {
        ...deck,
        lastSyncedAt: new Date().toISOString(),
        googleDriveModifiedTime: metadata.modifiedTime,
        cardsCount: mergedCards.length,
      };

      const updatedDecks = decks.map(d => (d.id === deck.id ? updatedDeck : d));
      const otherCards = cards.filter(c => c.deckId !== deck.id);
      const updatedCards = [...otherCards, ...mergedCards];

      setDecks(updatedDecks);
      setCards(updatedCards);
      saveStoredDecks(updatedDecks);
      saveStoredCards(updatedCards);
      setStreak(evaluateAndRecordDailyStreak(updatedCards));

      showToast(`Synced "${deck.name}" with Drive`);
    } catch (err: any) {
      showToast(`Sync failed: ${err?.message || 'Error connecting to Google Drive'}`, 4000);
    } finally {
      setSyncingDeckIds(prev => ({ ...prev, [deck.id]: false }));
    }
  };

  const handleSyncAllDecks = async () => {
    setIsSyncingAll(true);
    for (const deck of decks) {
      if (deck.googleDriveFileId) {
        await handleRefreshDeck(deck);
      }
    }
    setIsSyncingAll(false);
  };

  const handleDeleteCard = (cardId: string) => {
    const cardToDelete = cards.find(c => c.id === cardId);
    if (!cardToDelete) return;

    const targetDeckId = cardToDelete.deckId;
    const updatedCards = cards.filter(c => c.id !== cardId);

    const updatedDecks = decks.map(d => {
      if (d.id === targetDeckId) {
        const remainingQueue = d.sessionState?.remainingQueueIds?.filter(id => id !== cardId) || [];
        const remainingFirstTime = d.firstTimeSessionState?.remainingQueueIds?.filter(id => id !== cardId) || [];
        return {
          ...d,
          cardsCount: Math.max(0, d.cardsCount - 1),
          sessionState: d.sessionState
            ? {
                ...d.sessionState,
                remainingQueueIds: remainingQueue,
                totalInSession: Math.max(0, d.sessionState.totalInSession - 1),
              }
            : undefined,
          firstTimeSessionState: d.firstTimeSessionState
            ? {
                ...d.firstTimeSessionState,
                remainingQueueIds: remainingFirstTime,
                totalInSession: Math.max(0, d.firstTimeSessionState.totalInSession - 1),
              }
            : undefined,
        };
      }
      return d;
    });

    setDecks(updatedDecks);
    setCards(updatedCards);
    saveStoredDecks(updatedDecks);
    saveStoredCards(updatedCards);
    setStreak(evaluateAndRecordDailyStreak(updatedCards));
    showToast('Formula removed', 2000);
  };

  // Active study session takes full screen
  if (activeStudyDeck) {
    return (
      <div className="min-h-screen mobile-canvas-bg selection:bg-black selection:text-white">
        <StudySession
          deck={activeStudyDeck}
          cards={activeSessionCards}
          allDecks={decks}
          mode={activeSessionMode}
          resumeFromSession={resumeMode}
          initialCardIndex={initialCardIndex}
          onExit={() => {
            const latestCards = getStoredCards();
            setActiveStudyDeck(null);
            setDecks(getStoredDecks());
            setCards(latestCards);
            setDueSessionState(getDueTodaySessionState());
            setStreak(evaluateAndRecordDailyStreak(latestCards));
          }}
          onDeleteCard={handleDeleteCard}
        />
      </div>
    );
  }

  const dueCardsTotal = cards.filter(c => isCardDueToday(c));

  return (
    <div className="min-h-screen mobile-canvas-bg selection:bg-black selection:text-white flex flex-col pb-24">
      {/* Top Navbar & Pinned Bottom Tab Bar */}
      <Navbar
        currentView={currentView}
        onSelectView={setCurrentView}
        onOpenConnectModal={() => setIsConnectModalOpen(true)}
        user={user}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        dueCount={dueCardsTotal.length}
        streak={streak}
        isSyncingAll={isSyncingAll}
        onSyncAll={handleSyncAllDecks}
      />

      {/* Sync Toast Notification */}
      {syncToast && (
        <div className="fixed top-14 left-4 right-4 z-50 max-w-md mx-auto">
          <div className="glass-panel rounded-xl py-2.5 px-3.5 text-xs text-black flex items-center justify-between border border-black/15 shadow-sm">
            <span className="flex items-center gap-2 pr-2">
              <CheckCircle2 className="w-4 h-4 text-black shrink-0" />
              <span className="leading-snug">{syncToast}</span>
            </span>
            <button
              onClick={() => setSyncToast(null)}
              className="text-black/50 text-xs cursor-pointer shrink-0 p-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main View Container */}
      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-4">
        {/* VIEW 1: MAIN DASHBOARD (DUE TODAY HOLDER + DECKS) */}
        {currentView === 'decks' && (
          <div className="space-y-5">
            {/* Main Dashboard Due Today Holder */}
            <DueTodayHolder
              decks={decks}
              cards={cards}
              dueSessionState={dueSessionState}
              onReviewDue={handleReviewDue}
            />

            {/* Minimalist Decks Header */}
            <div className="flex items-center justify-between pt-1">
              <div>
                <h1 className="text-lg font-bold text-black tracking-tight">
                  Formula Decks
                </h1>
                <p className="text-xs text-black/50 tabular-nums">
                  {cards.length} formulas · {dueCardsTotal.length} due today
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setIsGuideOpen(true)}
                  className="glass-button px-2.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer min-h-[40px] text-black/75 hover:text-black"
                  title="Spreadsheet & LaTeX Formula Guide"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Guide</span>
                </button>

                <button
                  onClick={() => setIsConnectModalOpen(true)}
                  className="glass-button-primary px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs min-h-[40px]"
                  title="Import from Google Sheets, Excel (.xlsx), or CSV"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Import</span>
                </button>
              </div>
            </div>

            {/* Decks Stack */}
            <div className="space-y-3">
              {decks.length > 0 ? (
                decks.map(deck => (
                  <DeckCard
                    key={deck.id}
                    deck={deck}
                    cards={cards.filter(c => c.deckId === deck.id)}
                    onResume={handleResume}
                    onStartFresh={handleStartFresh}
                    onRefreshDrive={handleRefreshDeck}
                    onDeleteDeck={confirmDeleteDeck}
                    onBrowseDeck={setBrowseDeck}
                    isSyncing={Boolean(syncingDeckIds[deck.id])}
                  />
                ))
              ) : (
                <div className="glass-panel rounded-2xl p-8 text-center border border-dashed border-black/20 space-y-3">
                  <p className="text-xs text-black/60">No decks added yet.</p>
                  <button
                    onClick={() => setIsConnectModalOpen(true)}
                    className="glass-button-primary px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Import Google Sheet or Excel
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: STREAKS & PERFORMANCE ANALYTICS */}
        {currentView === 'analytics' && (
          <StreakAnalyticsView
            decks={decks}
            cards={cards}
            streak={streak}
            onReviewDue={() => handleReviewDue()}
          />
        )}

        {/* VIEW 3: CALENDAR */}
        {currentView === 'calendar' && (
          <CalendarView
            decks={decks}
            cards={cards}
            onStartContinuousCards={handleStartContinuousCustomCards}
          />
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {deckToDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="glass-card rounded-2xl w-full max-w-sm p-5 border border-black/10 shadow-2xl space-y-4 bg-white/95">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-black/5 flex items-center justify-center shrink-0 text-black">
                <Trash2 className="w-4 h-4" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-sm font-bold text-black">Delete Deck?</h3>
                <p className="text-xs text-black/60 break-words leading-relaxed">
                  Are you sure you want to delete <span className="font-semibold text-black">"{deckToDelete.name}"</span>? All associated formula cards will be removed.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => setDeckToDelete(null)}
                className="glass-button h-11 rounded-xl text-xs font-semibold text-black cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDeleteDeck(deckToDelete)}
                className="glass-button-primary h-11 rounded-xl text-xs font-bold bg-black text-white cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <DrivePickerModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onDeckCreated={handleDeckCreated}
      />

      <FormulaBrowserModal
        deck={browseDeck}
        cards={cards}
        isOpen={Boolean(browseDeck)}
        onClose={() => setBrowseDeck(null)}
        onStudyCard={(deck, cardIdx) => {
          setBrowseDeck(null);
          const deckCards = cards.filter(c => c.deckId === deck.id);
          setActiveStudyDeck(deck);
          setActiveSessionCards(deckCards);
          setActiveSessionMode('recall');
          setResumeMode(false);
          setInitialCardIndex(cardIdx || 0);
        }}
        onDeleteCard={handleDeleteCard}
        onDeleteDeck={confirmDeleteDeck}
      />

      <ExcelGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
    </div>
  );
}
