import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { User } from 'firebase/auth';
import {
  Plus,
  CheckCircle2,
  Trash2,
  HelpCircle,
  Terminal,
  Search,
  ChevronDown,
  ChevronUp,
  CloudOff,
} from 'lucide-react';
import {
  Deck,
  Flashcard,
  StudySessionMode,
  DeckSessionState,
  StudyStreakState,
  UserSettings,
} from './types';
import {
  getStoredDecks,
  saveStoredDecks,
  getStoredCards,
  saveStoredCards,
  getDueTodaySessionState,
  rolloverOverdueCardsFromPastDays,
  evaluateAndRecordDailyStreak,
  syncSessionEndStreakToFirestore,
  getUserSettings,
  saveUserSettings,
  applyCatchUpPostponement,
  flushOfflineSyncQueue,
  recordCloudSyncTimestamp,
} from './services/storage';
import {
  isCardDueToday,
  getLocalDateKey,
  sortDueCardsMostOverdueFirst,
} from './services/srsEngine';
import { initAuth, googleSignIn, logout, getAccessToken } from './services/auth';
import { fetchDriveFileBinary, fetchDriveFileMetadata } from './services/drive';
import { initReviewLogStore } from './services/reviewLog';
import { Navbar, NavView } from './components/Navbar';
import { DeckCard } from './components/DeckCard';
import { StudySession } from './components/StudySession';
import { DueTodayHolder } from './components/DueTodayHolder';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { BottomSheet } from './components/BottomSheet';
import {
  McpDeckPayload,
  parseAndValidateMcpParam,
  convertMcpPayloadToDeckAndCards,
} from './services/mcpService';
import {
  loadOrBootstrapUserFirestoreState,
  syncDeckAndCardsToFirestore,
  deleteDeckAndCardsFromFirestore,
  deleteSingleCardFromFirestore,
} from './services/firestoreSync';

// Code-split heavy modals & views via React.lazy (5.21)
const DrivePickerModal = React.lazy(() =>
  import('./components/DrivePickerModal').then(m => ({ default: m.DrivePickerModal }))
);
const FormulaBrowserModal = React.lazy(() =>
  import('./components/FormulaBrowserModal').then(m => ({ default: m.FormulaBrowserModal }))
);
const ExcelGuideModal = React.lazy(() =>
  import('./components/ExcelGuideModal').then(m => ({ default: m.ExcelGuideModal }))
);
const SettingsBackupModal = React.lazy(() =>
  import('./components/SettingsBackupModal').then(m => ({ default: m.SettingsBackupModal }))
);
const StreakAnalyticsView = React.lazy(() =>
  import('./components/StreakAnalyticsView').then(m => ({ default: m.StreakAnalyticsView }))
);

export default function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [settings, setSettings] = useState<UserSettings>(() => getUserSettings());
  const [dueSessionState, setDueSessionState] = useState<DeckSessionState | undefined>(undefined);
  const [streak, setStreak] = useState<StudyStreakState>({
    currentStreak: 0,
    bestStreak: 0,
    completedDates: [],
  });
  const [user, setUser] = useState<User | null>(null);
  const [hasDriveToken, setHasDriveToken] = useState<boolean>(false);

  const [currentView, setCurrentView] = useState<NavView>('decks');
  const [viewRestoreKey, setViewRestoreKey] = useState<number>(0);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [browseDeck, setBrowseDeck] = useState<Deck | null>(null);
  const [deckToDelete, setDeckToDelete] = useState<Deck | null>(null);

  // Deck list search (>6 decks) and collapsed caught-up decks state (5.2)
  const [deckSearchQuery, setDeckSearchQuery] = useState('');
  const [showCaughtUpDecks, setShowCaughtUpDecks] = useState(false);

  // Pending ?mcp_deck= confirmation sheet state (Security 4.2 & 5.6)
  const [pendingMcpPayload, setPendingMcpPayload] = useState<McpDeckPayload | null>(null);

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

  // Apply "Reduce effects" class to <html> when toggled in Settings (5.20)
  useEffect(() => {
    if (settings.reduceEffects) {
      document.documentElement.classList.add('reduce-effects');
    } else {
      document.documentElement.classList.remove('reduce-effects');
    }
  }, [settings.reduceEffects]);

  // Apply Light / Dark / System theme class to <html> (defaults to Light Mode)
  const [isDarkResolved, setIsDarkResolved] = useState<boolean>(false);

  useEffect(() => {
    const mode = settings.themeMode || 'light';
    const mediaQuery =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    const applyTheme = () => {
      const dark =
        mode === 'dark' || (mode === 'system' && Boolean(mediaQuery?.matches));
      setIsDarkResolved(dark);
      if (dark) {
        document.documentElement.classList.add('dark');
        document.documentElement.style.colorScheme = 'dark';
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.style.colorScheme = 'light';
      }
    };

    applyTheme();

    if (mode === 'system' && mediaQuery) {
      mediaQuery.addEventListener?.('change', applyTheme);
      return () => mediaQuery.removeEventListener?.('change', applyTheme);
    }
  }, [settings.themeMode]);

  const handleToggleTheme = () => {
    const nextMode: 'light' | 'dark' = isDarkResolved ? 'light' : 'dark';
    const nextSettings: UserSettings = {
      ...settings,
      themeMode: nextMode,
    };
    setSettings(nextSettings);
    saveUserSettings(nextSettings);
    showToast(nextMode === 'light' ? 'Switched to Light Mode' : 'Switched to Dark Mode', 1800);
  };

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [currentView, viewRestoreKey, activeStudyDeck]);

  const handleSelectView = (nextView: NavView) => {
    if (nextView === 'settings') {
      setIsSettingsOpen(true);
      return;
    }
    setCurrentView(nextView);
    setViewRestoreKey(prev => prev + 1);
  };

  const showToast = (msg: string, durationMs = 3000) => {
    setSyncToast(msg);
    setTimeout(() => setSyncToast(null), durationMs);
  };

  // Load decks, cards, IndexedDB review logs, and validate any ?mcp_deck= parameter
  useEffect(() => {
    initReviewLogStore().catch(() => {});
    const loadedDecks = getStoredDecks();
    const { updatedCards } = rolloverOverdueCardsFromPastDays(getStoredCards());

    // Security 4.2: ?mcp_deck= must show a confirmation dialog with name + card count before adding
    try {
      const params = new URLSearchParams(window.location.search);
      const encodedMcp = params.get('mcp_deck');
      if (encodedMcp) {
        const validatedPayload = parseAndValidateMcpParam(encodedMcp);
        setPendingMcpPayload(validatedPayload);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (err: any) {
      console.error('Failed to validate mcp_deck parameter:', err);
      showToast(err?.message || 'Invalid MCP deck link', 4000);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    setDecks(loadedDecks);
    setCards(updatedCards);
    setDueSessionState(getDueTodaySessionState());
    setStreak(evaluateAndRecordDailyStreak(updatedCards));
  }, []);

  // Flush queued offline ratings automatically when connection returns (5.23)
  useEffect(() => {
    const handleOnlineFlush = () => {
      flushOfflineSyncQueue().then(flushed => {
        if (flushed > 0) {
          showToast(`Synced ${flushed} offline card ratings to cloud`);
        }
      });
    };
    window.addEventListener('online', handleOnlineFlush);
    return () => window.removeEventListener('online', handleOnlineFlush);
  }, []);

  // Automatic background rollover check & optional daily PWA reminder (Feature 2.12)
  useEffect(() => {
    const interval = setInterval(() => {
      const currentStored = getStoredCards();
      const { updatedCards, shiftedCount } = rolloverOverdueCardsFromPastDays(currentStored);
      if (shiftedCount > 0) {
        setCards(updatedCards);
      }
      setStreak(evaluateAndRecordDailyStreak(updatedCards));

      // Check optional daily reminder (2.12)
      const currentSettings = getUserSettings();
      if (currentSettings.remindersEnabled && currentSettings.reminderTime) {
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const todayKey = getLocalDateKey(now);
        const lastFired = localStorage.getItem('synapse_last_reminder_date');
        if (hhmm === currentSettings.reminderTime && lastFired !== todayKey) {
          const dueNow = updatedCards.filter(c => isCardDueToday(c, now, currentSettings)).length;
          if (dueNow > 0 && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            localStorage.setItem('synapse_last_reminder_date', todayKey);
            try {
              new Notification('SynapseFormula Study Reminder', {
                body: `You have ${dueNow} physics formulas due for review today.`,
                icon: '/pwa-192x192.png',
              });
            } catch {
              navigator.serviceWorker?.ready
                .then(reg =>
                  reg.showNotification('SynapseFormula Study Reminder', {
                    body: `You have ${dueNow} physics formulas due for review today.`,
                    icon: '/pwa-192x192.png',
                  })
                )
                .catch(() => {});
            }
          }
        }
      }
    }, 45 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubscribe = initAuth(
      async (currentUser, token) => {
        setUser(currentUser);
        setHasDriveToken(Boolean(token));
        try {
          const localDecks = getStoredDecks();
          const localCards = getStoredCards();
          const localStreak = evaluateAndRecordDailyStreak(localCards);
          const synced = await loadOrBootstrapUserFirestoreState(
            localDecks,
            localCards,
            localStreak
          );
          const { updatedCards } = rolloverOverdueCardsFromPastDays(synced.cards);
          setDecks(synced.decks);
          setCards(updatedCards);
          setStreak(evaluateAndRecordDailyStreak(updatedCards));
          saveStoredDecks(synced.decks);
          saveStoredCards(updatedCards);
          recordCloudSyncTimestamp();
          flushOfflineSyncQueue().catch(() => {});
        } catch (err) {
          console.error('Firestore cloud sync error:', err);
        }
      },
      () => {
        setUser(null);
        setHasDriveToken(false);
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    try {
      const res = await googleSignIn();
      if (res?.user) {
        setUser(res.user);
        setHasDriveToken(Boolean(res.accessToken));
      }
    } catch (err) {
      console.error('Sign-in failed:', err);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setHasDriveToken(false);
  };

  const handleConfirmMcpImport = () => {
    if (!pendingMcpPayload) return;
    const { deck: mcpDeck, cards: mcpCards } = convertMcpPayloadToDeckAndCards(pendingMcpPayload);
    setPendingMcpPayload(null);
    if (mcpCards.length > 0) {
      handleDeckCreated(mcpDeck, mcpCards);
    }
  };

  const handleDeckCreated = (newDeck: Deck, newCards: Flashcard[]) => {
    const updatedDecks = [newDeck, ...decks];
    const updatedCards = [...newCards, ...cards];
    setDecks(updatedDecks);
    setCards(updatedCards);
    saveStoredDecks(updatedDecks);
    saveStoredCards(updatedCards);
    setStreak(evaluateAndRecordDailyStreak(updatedCards));
    syncDeckAndCardsToFirestore(newDeck, newCards)
      .then(() => recordCloudSyncTimestamp())
      .catch(err => console.error('Failed to persist deck to Firestore:', err));
    showToast(`Added ${newDeck.name}`);
  };

  const handleUpdateDeckOverride = (deckId: string, newCardsPerDayOverride?: number) => {
    const updatedDecks = decks.map(d =>
      d.id === deckId ? { ...d, newCardsPerDayOverride } : d
    );
    setDecks(updatedDecks);
    saveStoredDecks(updatedDecks);
    const target = updatedDecks.find(d => d.id === deckId);
    if (target) {
      const deckCards = cards.filter(c => c.deckId === deckId);
      syncDeckAndCardsToFirestore(target, deckCards).catch(() => {});
    }
    showToast(
      newCardsPerDayOverride
        ? `Set deck limit to ${newCardsPerDayOverride} new/day`
        : 'Restored global new cards/day limit'
    );
  };

  const confirmDeleteDeck = (target: Deck) => {
    const targetCardIds = cards.filter(c => c.deckId === target.id).map(c => c.id);
    const updatedDecks = decks.filter(d => d.id !== target.id);
    const updatedCards = cards.filter(c => c.deckId !== target.id);
    setDecks(updatedDecks);
    setCards(updatedCards);
    saveStoredDecks(updatedDecks);
    saveStoredCards(updatedCards);
    setStreak(evaluateAndRecordDailyStreak(updatedCards));
    deleteDeckAndCardsFromFirestore(target.id, targetCardIds).catch(err =>
      console.error('Failed to delete deck from Firestore:', err)
    );
    setDeckToDelete(null);
    if (browseDeck?.id === target.id) {
      setBrowseDeck(null);
    }
    showToast(`Deleted "${target.name}"`);
  };

  const handleStartFresh = (deck: Deck, mode: StudySessionMode = 'recall') => {
    const deckCards = cards.filter(c => c.deckId === deck.id && !c.suspended);
    // Bug 1.4: If mode is recall and nothing is due in this deck, use practice mode so schedule isn't ruined
    const dueInDeck = deckCards.filter(c => isCardDueToday(c, new Date(), settings));
    const effectiveMode =
      mode === 'recall' && dueInDeck.length === 0 ? 'practice' : mode;

    setActiveStudyDeck(deck);
    setActiveSessionCards(deckCards);
    setActiveSessionMode(effectiveMode);
    setResumeMode(false);
    setInitialCardIndex(0);
  };

  const handleResume = (deck: Deck, mode: StudySessionMode = 'recall') => {
    const deckCards = cards.filter(c => c.deckId === deck.id && !c.suspended);
    setActiveStudyDeck(deck);
    setActiveSessionCards(deckCards);
    setActiveSessionMode(mode);
    setResumeMode(true);
    setInitialCardIndex(0);
  };

  const handleReviewDue = (options?: {
    deckId?: string;
    startCardId?: string;
    startFresh?: boolean;
  }) => {
    if (options?.deckId) {
      const targetDeck = decks.find(d => d.id === options.deckId);
      const deckDue = sortDueCardsMostOverdueFirst(
        cards.filter(c => c.deckId === options.deckId && isCardDueToday(c, new Date(), settings))
      ).slice(0, settings.dailyReviewCap);
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

    const allDueSorted = sortDueCardsMostOverdueFirst(
      cards.filter(c => isCardDueToday(c, new Date(), settings))
    ).slice(0, settings.dailyReviewCap);

    if (allDueSorted.length === 0) return;

    const syntheticDueDeck: Deck = {
      id: '__due_today__',
      name: 'Due Today',
      lastSyncedAt: new Date().toISOString(),
      syncIntervalHours: 24,
      columnMapping: { statementCol: 'Statement', formulaCol: 'Formula' },
      cardsCount: allDueSorted.length,
      sessionState: getDueTodaySessionState(),
    };

    setActiveStudyDeck(syntheticDueDeck);
    setActiveSessionCards(allDueSorted);
    setActiveSessionMode('due-continuous');
    setResumeMode(!options?.startFresh);
    setInitialCardIndex(0);
  };

  const handleCatchUpMode = () => {
    const { updatedCards, postponedCount } = applyCatchUpPostponement(
      cards,
      settings.dailyReviewCap
    );
    setCards(updatedCards);
    if (postponedCount > 0) {
      showToast(
        `Catch-Up Mode: Kept top ${settings.dailyReviewCap} overdue cards today and spread ${postponedCount} across the next 3 days.`,
        4000
      );
    }
    handleReviewDue({ startFresh: true });
  };

  const handleStartInterleavedSession = (selectedDeckIds: string[]) => {
    const idSet = new Set(selectedDeckIds);
    const pool = cards.filter(c => !c.suspended && idSet.has(c.deckId));
    if (pool.length === 0) {
      showToast('No active cards in selected decks.');
      return;
    }

    const syntheticDeck: Deck = {
      id: '__interleaved_session__',
      name: 'Interleaved Recall',
      lastSyncedAt: new Date().toISOString(),
      syncIntervalHours: 24,
      columnMapping: { statementCol: 'Statement', formulaCol: 'Formula' },
      cardsCount: pool.length,
    };

    setActiveStudyDeck(syntheticDeck);
    setActiveSessionCards(pool);
    setActiveSessionMode('interleaved');
    setResumeMode(false);
    setInitialCardIndex(0);
  };

  const handleStartContinuousCustomCards = (cardsToStudy: Flashcard[], sessionTitle: string) => {
    if (cardsToStudy.length === 0) return;
    const now = new Date();
    const anyDueToday = cardsToStudy.some(c => isCardDueToday(c, now, settings));
    const syntheticDeck: Deck = {
      id: '__custom_calendar_session__',
      name: sessionTitle,
      lastSyncedAt: now.toISOString(),
      syncIntervalHours: 24,
      columnMapping: { statementCol: 'Statement', formulaCol: 'Formula' },
      cardsCount: cardsToStudy.length,
    };
    setActiveStudyDeck(syntheticDeck);
    setActiveSessionCards(cardsToStudy);
    setActiveSessionMode(anyDueToday ? 'due-continuous' : 'practice');
    setResumeMode(false);
    setInitialCardIndex(0);
  };

  /**
   * Bug 1.5 Fixed: Uses deck.sheetName (not Object.values(columnMapping)[0])
   * and matches existing cards by deterministic id/hash first, then AND-match (statement && formula).
   * Dynamically imports excelParser so xlsx is code-split from initial bundle (5.21).
   */
  const handleRefreshDeck = async (deck: Deck) => {
    if (!deck.googleDriveFileId) return;

    setSyncingDeckIds(prev => ({ ...prev, [deck.id]: true }));
    try {
      const token = await getAccessToken();
      if (!token) await handleSignIn();

      const buffer = await fetchDriveFileBinary(deck.googleDriveFileId, deck.googleDriveMimeType);
      const metadata = await fetchDriveFileMetadata(deck.googleDriveFileId);

      const { convertRowsToFlashcards, computeDeterministicCardId } = await import(
        './services/excelParser'
      );

      const targetSheetName = deck.sheetName || 'Sheet1';
      const freshCards = convertRowsToFlashcards(
        buffer,
        targetSheetName,
        deck.columnMapping,
        deck.id
      );

      const existingDeckCards = cards.filter(c => c.deckId === deck.id);
      const usedExistingIds = new Set<string>();

      const mergedCards = freshCards.map(fresh => {
        const expectedHashId = computeDeterministicCardId(
          deck.id,
          fresh.statement,
          fresh.formula
        );

        let match = existingDeckCards.find(
          e =>
            !usedExistingIds.has(e.id) &&
            (e.id === fresh.id || e.id === expectedHashId)
        );

        if (!match) {
          match = existingDeckCards.find(
            e =>
              !usedExistingIds.has(e.id) &&
              e.statement.trim() === fresh.statement.trim() &&
              e.formula.trim() === fresh.formula.trim()
          );
        }

        if (match) {
          usedExistingIds.add(match.id);
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
            lapses: match.lapses,
            consecutiveGoods: match.consecutiveGoods,
            suspended: match.suspended,
            createdAt: match.createdAt || fresh.createdAt,
          };
        }
        return fresh;
      });

      const updatedDeck: Deck = {
        ...deck,
        sheetName: targetSheetName,
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
      syncDeckAndCardsToFirestore(updatedDeck, mergedCards)
        .then(() => recordCloudSyncTimestamp())
        .catch(err => console.error('Failed to persist refreshed deck to Firestore:', err));

      showToast(`Synced "${deck.name}" (${targetSheetName}) with Drive`);
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
        const remainingFirstTime =
          d.firstTimeSessionState?.remainingQueueIds?.filter(id => id !== cardId) || [];
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
    deleteSingleCardFromFirestore(cardId).catch(err =>
      console.error('Failed to delete card from Firestore:', err)
    );
    showToast('Formula removed', 2000);
  };

  // Sort decks: decks with due cards first; caught-up decks collapsed (5.2)
  const { dueDecks, caughtUpDecks } = useMemo(() => {
    const now = new Date();
    const q = deckSearchQuery.trim().toLowerCase();
    const filteredDecks = q
      ? decks.filter(d => d.name.toLowerCase().includes(q))
      : decks;

    const withDue: Deck[] = [];
    const withoutDue: Deck[] = [];

    for (const d of filteredDecks) {
      const deckDueCount = cards.filter(
        c => c.deckId === d.id && !c.suspended && isCardDueToday(c, now, settings)
      ).length;
      if (deckDueCount > 0) {
        withDue.push(d);
      } else {
        withoutDue.push(d);
      }
    }

    return { dueDecks: withDue, caughtUpDecks: withoutDue };
  }, [decks, cards, deckSearchQuery, settings]);

  // Active study session takes full screen
  if (activeStudyDeck) {
    return (
      <div
        key={`study-${activeStudyDeck.id}`}
        className="min-h-dvh w-full mobile-canvas-bg selection:bg-black selection:text-white page-restore-enter"
      >
        <StudySession
          deck={activeStudyDeck}
          cards={activeSessionCards}
          allDecks={decks}
          allCards={cards}
          mode={activeSessionMode}
          resumeFromSession={resumeMode}
          initialCardIndex={initialCardIndex}
          settings={settings}
          onExit={() => {
            const latestCards = getStoredCards();
            setActiveStudyDeck(null);
            setDecks(getStoredDecks());
            setCards(latestCards);
            setDueSessionState(getDueTodaySessionState());
            // Bug 1.7: Write streak once per session end, not per rating
            setStreak(syncSessionEndStreakToFirestore(latestCards));
            setViewRestoreKey(prev => prev + 1);
          }}
          onDeleteCard={handleDeleteCard}
          onCardsMutated={(nextCards, nextDecks) => {
            setCards(nextCards);
            if (nextDecks) setDecks(nextDecks);
          }}
        />
      </div>
    );
  }

  const dueCardsTotal = cards.filter(c => isCardDueToday(c, new Date(), settings));
  const hasDriveDecks = decks.some(d => Boolean(d.googleDriveFileId));
  const driveReconnectNeeded = Boolean(user && hasDriveDecks && !hasDriveToken);

  return (
    <div className="min-h-dvh w-full mobile-canvas-bg selection:bg-black selection:text-white flex flex-col pb-28">
      <Navbar
        currentView={currentView}
        onSelectView={handleSelectView}
        onOpenSettingsModal={() => setIsSettingsOpen(true)}
        dueCount={dueCardsTotal.length}
        isDark={isDarkResolved}
        onToggleTheme={handleToggleTheme}
      />

      {syncToast && (
        <div className="fixed top-16 left-4 right-4 z-50 max-w-xl mx-auto">
          <div className="glass-chrome rounded-xl py-3 px-4 text-[13px] font-semibold flex items-center justify-between border shadow-md">
            <span className="flex items-center gap-2 pr-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="leading-snug">{syncToast}</span>
            </span>
            <button
              type="button"
              onClick={() => setSyncToast(null)}
              className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center text-secondary-contrast cursor-pointer shrink-0"
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <main
        key={`${currentView}-${viewRestoreKey}`}
        className="flex-1 max-w-xl mx-auto w-full px-4 py-4 page-restore-enter"
      >
        {currentView === 'decks' && (
          <div className="space-y-4">
            {/* Hero "Review N due" button across all decks at the top (5.1) */}
            <DueTodayHolder
              decks={decks}
              cards={cards}
              dueSessionState={dueSessionState}
              settings={settings}
              onReviewDue={handleReviewDue}
              onCatchUpMode={handleCatchUpMode}
              onStartInterleaved={handleStartInterleavedSession}
            />

            {/* Friendly Drive Disconnected Banner (5.26 & 4.4) */}
            {driveReconnectNeeded && (
              <div className="glass-panel rounded-2xl p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CloudOff className="w-4 h-4 shrink-0" />
                  <span className="text-[13px] font-medium truncate">
                    Google Drive disconnected after reload
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSignIn}
                  className="glass-button min-h-[44px] px-3.5 rounded-xl text-[13px] font-bold shrink-0 cursor-pointer"
                >
                  Reconnect
                </button>
              </div>
            )}

            {/* PWA Install Prompt shown ONLY after first completed review session (5.25) */}
            <PWAInstallButton requireFirstSessionCompleted fullWidth />

            {/* Decks Header: No duplicate "N formulas · N due" line (5.1); "+" Import in Decks header only (5.5) */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <h1 className="text-lg font-bold tracking-tight">Formula Decks</h1>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsGuideOpen(true)}
                  className="glass-button min-h-[44px] min-w-[44px] px-3 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  title="Spreadsheet & LaTeX Formula Guide"
                >
                  <HelpCircle className="w-4 h-4" />
                  <span>Guide</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsConnectModalOpen(true)}
                  aria-label="Import deck"
                  className="glass-button-primary min-h-[44px] min-w-[44px] px-3.5 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  title="Import from External MCP, Google Drive, or Excel/CSV"
                >
                  <Plus className="w-4 h-4" />
                  <span>Import</span>
                </button>
              </div>
            </div>

            {/* Search box when more than 6 decks (5.2 & 5.16: 16px font size) */}
            {decks.length > 6 && (
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
                <input
                  type="search"
                  enterKeyHint="search"
                  value={deckSearchQuery}
                  onChange={e => setDeckSearchQuery(e.target.value)}
                  placeholder="Search formula decks..."
                  className="w-full min-h-[44px] pl-10 pr-3.5 py-2 rounded-xl text-base bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 focus:outline-none"
                />
              </div>
            )}

            {/* Deck List: Decks with due cards first; caught-up decks collapsed (5.2) */}
            {decks.length === 0 ? (
              <div className="glass-panel rounded-2xl p-8 text-center border border-dashed border-black/20 dark:border-white/20 space-y-3">
                <p className="text-[15px] font-bold">No formula decks yet</p>
                <p className="text-[13px] text-secondary-contrast max-w-xs mx-auto">
                  Import a physics spreadsheet from Google Drive, Excel (.xlsx), CSV, or link via External MCP.
                </p>
                <button
                  type="button"
                  onClick={() => setIsConnectModalOpen(true)}
                  className="glass-button-primary min-h-[48px] px-5 rounded-xl text-[15px] font-bold cursor-pointer"
                >
                  + Import First Deck
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {dueDecks.map(deck => (
                  <DeckCard
                    key={deck.id}
                    deck={deck}
                    cards={cards.filter(c => c.deckId === deck.id)}
                    allCards={cards}
                    settings={settings}
                    onResume={handleResume}
                    onStartFresh={handleStartFresh}
                    onRefreshDrive={handleRefreshDeck}
                    onDeleteDeck={confirmDeleteDeck}
                    onBrowseDeck={setBrowseDeck}
                    onUpdateDeckOverride={handleUpdateDeckOverride}
                    isSyncing={Boolean(syncingDeckIds[deck.id])}
                  />
                ))}

                {/* Caught-up decks collapsed section (5.2) */}
                {caughtUpDecks.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {dueDecks.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowCaughtUpDecks(prev => !prev)}
                        className="glass-panel w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-[13px] font-bold flex items-center justify-between cursor-pointer"
                      >
                        <span>Caught-up decks ({caughtUpDecks.length})</span>
                        {showCaughtUpDecks ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    ) : null}

                    {(showCaughtUpDecks || dueDecks.length === 0) &&
                      caughtUpDecks.map(deck => (
                        <DeckCard
                          key={deck.id}
                          deck={deck}
                          cards={cards.filter(c => c.deckId === deck.id)}
                          allCards={cards}
                          settings={settings}
                          onResume={handleResume}
                          onStartFresh={handleStartFresh}
                          onRefreshDrive={handleRefreshDeck}
                          onDeleteDeck={confirmDeleteDeck}
                          onBrowseDeck={setBrowseDeck}
                          onUpdateDeckOverride={handleUpdateDeckOverride}
                          isSyncing={Boolean(syncingDeckIds[deck.id])}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {currentView === 'progress' && (
          <Suspense
            fallback={
              <div className="glass-panel rounded-2xl p-6 text-center text-[15px] text-secondary-contrast">
                Loading Progress & Schedule...
              </div>
            }
          >
            <StreakAnalyticsView
              decks={decks}
              cards={cards}
              streak={streak}
              settings={settings}
              onReviewDue={() => handleReviewDue()}
              onStartContinuousCards={handleStartContinuousCustomCards}
            />
          </Suspense>
        )}
      </main>

      {/* ?mcp_deck= Import Confirmation Bottom Sheet (Security 4.2 & 5.6) */}
      <BottomSheet
        isOpen={Boolean(pendingMcpPayload)}
        onClose={() => setPendingMcpPayload(null)}
        zIndexClass="z-[85]"
        title={
          <span className="flex items-center gap-2">
            <Terminal className="w-4 h-4" />
            <span>Import External MCP Deck?</span>
          </span>
        }
        subtitle="Confirm before adding formulas to your study decks"
        footer={
          pendingMcpPayload ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPendingMcpPayload(null)}
                className="glass-button min-h-[48px] rounded-xl text-[15px] font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmMcpImport}
                className="glass-button-primary min-h-[48px] rounded-xl text-[15px] font-bold cursor-pointer"
              >
                Import ({pendingMcpPayload.formulas.length})
              </button>
            </div>
          ) : undefined
        }
      >
        {pendingMcpPayload && (
          <p className="text-[15px] leading-relaxed">
            Add <strong className="font-bold">"{pendingMcpPayload.deckName}"</strong> containing{' '}
            <strong className="font-bold">
              {pendingMcpPayload.formulas.length}{' '}
              {pendingMcpPayload.formulas.length === 1 ? 'formula' : 'formulas'}
            </strong>{' '}
            to your decks?
          </p>
        )}
      </BottomSheet>

      {/* Delete Confirmation Bottom Sheet (5.6) */}
      <BottomSheet
        isOpen={Boolean(deckToDelete)}
        onClose={() => setDeckToDelete(null)}
        zIndexClass="z-[80]"
        title={
          <span className="flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            <span>Delete Deck?</span>
          </span>
        }
        footer={
          deckToDelete ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDeckToDelete(null)}
                className="glass-button min-h-[48px] rounded-xl text-[15px] font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmDeleteDeck(deckToDelete)}
                className="glass-button-primary min-h-[48px] rounded-xl text-[15px] font-bold cursor-pointer"
              >
                Delete
              </button>
            </div>
          ) : undefined
        }
      >
        {deckToDelete && (
          <p className="text-[15px] leading-relaxed">
            Are you sure you want to delete{' '}
            <strong className="font-bold">"{deckToDelete.name}"</strong>? All associated formula
            cards will be removed.
          </p>
        )}
      </BottomSheet>

      <Suspense fallback={null}>
        {isConnectModalOpen && (
          <DrivePickerModal
            isOpen={isConnectModalOpen}
            onClose={() => setIsConnectModalOpen(false)}
            onDeckCreated={handleDeckCreated}
          />
        )}

        {browseDeck && (
          <FormulaBrowserModal
            deck={browseDeck}
            cards={cards}
            isOpen={Boolean(browseDeck)}
            onClose={() => setBrowseDeck(null)}
            onStudyCard={(deck, cardIdx) => {
              setBrowseDeck(null);
              const deckCards = cards.filter(c => c.deckId === deck.id && !c.suspended);
              const dueInDeck = deckCards.filter(c => isCardDueToday(c, new Date(), settings));
              setActiveStudyDeck(deck);
              setActiveSessionCards(deckCards);
              setActiveSessionMode(dueInDeck.length > 0 ? 'recall' : 'practice');
              setResumeMode(false);
              setInitialCardIndex(cardIdx || 0);
            }}
            onDeleteCard={handleDeleteCard}
            onDeleteDeck={confirmDeleteDeck}
            onCardsUpdated={setCards}
          />
        )}

        {isGuideOpen && (
          <ExcelGuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
        )}

        {isSettingsOpen && (
          <SettingsBackupModal
            isOpen={isSettingsOpen}
            settings={settings}
            user={user}
            driveReconnectNeeded={driveReconnectNeeded}
            isSyncingAll={isSyncingAll}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
            onSyncAll={handleSyncAllDecks}
            onClose={() => setIsSettingsOpen(false)}
            onSaveSettings={next => {
              setSettings(next);
              saveUserSettings(next);
              showToast('Saved settings');
            }}
            onBackupImported={summaryMsg => {
              setDecks(getStoredDecks());
              setCards(getStoredCards());
              setSettings(getUserSettings());
              setStreak(evaluateAndRecordDailyStreak(getStoredCards()));
              showToast(summaryMsg);
            }}
          />
        )}
      </Suspense>

      <OfflineIndicator />
    </div>
  );
}
