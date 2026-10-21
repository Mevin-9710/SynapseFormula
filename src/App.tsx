import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { Plus, CheckCircle2, Trash2, AlertCircle, HelpCircle } from 'lucide-react';
import { Deck, Flashcard } from './types';
import {
  getStoredDecks,
  saveStoredDecks,
  getStoredCards,
  saveStoredCards,
} from './services/storage';
import { initAuth, googleSignIn, logout, getAccessToken } from './services/auth';
import { fetchDriveFileBinary, fetchDriveFileMetadata } from './services/drive';
import { convertRowsToFlashcards } from './services/excelParser';
import { Navbar } from './components/Navbar';
import { DeckCard } from './components/DeckCard';
import { StudySession } from './components/StudySession';
import { DrivePickerModal } from './components/DrivePickerModal';
import { FormulaBrowserModal } from './components/FormulaBrowserModal';
import { Scratchpad } from './components/Scratchpad';
import { FormulaDisplay } from './components/FormulaDisplay';
import { ExcelGuideModal } from './components/ExcelGuideModal';

export default function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [user, setUser] = useState<User | null>(null);

  const [currentView, setCurrentView] = useState<'decks' | 'due' | 'scratchpad'>('decks');
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [browseDeck, setBrowseDeck] = useState<Deck | null>(null);
  const [deckToDelete, setDeckToDelete] = useState<Deck | null>(null);

  // Active Study Session
  const [activeStudyDeck, setActiveStudyDeck] = useState<Deck | null>(null);
  const [resumeMode, setResumeMode] = useState<boolean>(false);

  // Sync state
  const [syncingDeckIds, setSyncingDeckIds] = useState<Record<string, boolean>>({});
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  useEffect(() => {
    setDecks(getStoredDecks());
    setCards(getStoredCards());
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
    setSyncToast(`Added ${newDeck.name}`);
    setTimeout(() => setSyncToast(null), 3000);
  };

  const onRequestDeleteDeck = (deck: Deck) => {
    setDeckToDelete(deck);
  };

  const confirmDeleteDeck = (target: Deck) => {
    const updatedDecks = decks.filter(d => d.id !== target.id);
    const updatedCards = cards.filter(c => c.deckId !== target.id);
    setDecks(updatedDecks);
    setCards(updatedCards);
    saveStoredDecks(updatedDecks);
    saveStoredCards(updatedCards);
    setDeckToDelete(null);
    if (browseDeck?.id === target.id) {
      setBrowseDeck(null);
    }
    setSyncToast(`Deleted "${target.name}"`);
    setTimeout(() => setSyncToast(null), 3000);
  };

  const handleStartFresh = (deck: Deck) => {
    setActiveStudyDeck(deck);
    setResumeMode(false);
  };

  const handleResume = (deck: Deck) => {
    setActiveStudyDeck(deck);
    setResumeMode(true);
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

      setSyncToast(`Synced "${deck.name}" with Drive`);
      setTimeout(() => setSyncToast(null), 3000);
    } catch (err: any) {
      setSyncToast(`Sync failed: ${err?.message || 'Error connecting to Google Drive'}`);
      setTimeout(() => setSyncToast(null), 4000);
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
        return {
          ...d,
          cardsCount: Math.max(0, d.cardsCount - 1),
          sessionState: d.sessionState ? {
            ...d.sessionState,
            remainingQueueIds: remainingQueue,
            totalInSession: Math.max(0, d.sessionState.totalInSession - 1),
          } : undefined,
        };
      }
      return d;
    });

    setDecks(updatedDecks);
    setCards(updatedCards);
    saveStoredDecks(updatedDecks);
    saveStoredCards(updatedCards);
    setSyncToast('Formula removed');
    setTimeout(() => setSyncToast(null), 2000);
  };

  // Active study session takes full screen on mobile
  if (activeStudyDeck) {
    const deckCards = cards.filter(c => c.deckId === activeStudyDeck.id);
    return (
      <div className="min-h-screen mobile-canvas-bg selection:bg-black selection:text-white">
        <StudySession
          deck={activeStudyDeck}
          cards={deckCards}
          resumeFromSession={resumeMode}
          onExit={() => {
            setActiveStudyDeck(null);
            setDecks(getStoredDecks());
            setCards(getStoredCards());
          }}
          onDeleteCard={handleDeleteCard}
        />
      </div>
    );
  }

  const now = Date.now();
  const dueCardsTotal = cards.filter(c => new Date(c.dueDate).getTime() <= now);

  return (
    <div className="min-h-screen mobile-canvas-bg selection:bg-black selection:text-white flex flex-col pb-24">
      {/* Mobile Top Navbar & Pinned Bottom Tab Bar */}
      <Navbar
        currentView={currentView}
        onSelectView={setCurrentView}
        onOpenConnectModal={() => setIsConnectModalOpen(true)}
        user={user}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        dueCount={dueCardsTotal.length}
        isSyncingAll={isSyncingAll}
        onSyncAll={handleSyncAllDecks}
      />

      {/* Sync Toast Notification */}
      {syncToast && (
        <div className="fixed top-14 left-4 right-4 z-50 max-w-sm mx-auto">
          <div className="glass-panel rounded-xl py-2 px-3 text-xs text-black flex items-center justify-between border border-black/15 shadow-sm">
            <span className="flex items-center gap-1.5 truncate pr-2">
              <CheckCircle2 className="w-4 h-4 text-black shrink-0" />
              <span className="truncate">{syncToast}</span>
            </span>
            <button onClick={() => setSyncToast(null)} className="text-black/50 text-xs cursor-pointer shrink-0">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main View Container */}
      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-4">
        {/* VIEW 1: DECKS */}
        {currentView === 'decks' && (
          <div className="space-y-4">
            {/* Minimalist Summary Header */}
            <div className="flex items-center justify-between py-1">
              <div>
                <h1 className="text-lg font-bold text-black tracking-tight">
                  Formula Decks
                </h1>
                <p className="text-xs text-black/50">
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

        {/* VIEW 2: DUE TODAY */}
        {currentView === 'due' && (
          <div className="space-y-4">
            <div className="py-1">
              <h2 className="text-lg font-bold text-black tracking-tight">
                Due Today ({dueCardsTotal.length})
              </h2>
              <p className="text-xs text-black/50">
                Spaced repetitions due for review
              </p>
            </div>

            {dueCardsTotal.length > 0 ? (
              <div className="space-y-2.5">
                {dueCardsTotal.map((card) => {
                  const deck = decks.find(d => d.id === card.deckId);
                  return (
                    <div
                      key={card.id}
                      className="glass-card rounded-xl p-3.5 flex items-center justify-between gap-3 border border-black/10"
                    >
                      <div className="truncate pr-2 space-y-1">
                        <span className="text-[10px] text-black/40 block">
                          {deck?.name || 'Formula'}
                        </span>
                        <p className="text-xs font-bold text-black truncate">
                          {card.statement}
                        </p>
                        <div className="text-xs text-black/90 truncate">
                          <FormulaDisplay formula={card.formula} displayMode={false} size="sm" />
                        </div>
                      </div>

                      {deck && (
                        <button
                          onClick={() => handleResume(deck)}
                          className="glass-button-primary px-3 py-2 rounded-xl text-xs font-bold shrink-0 min-h-[40px] cursor-pointer"
                        >
                          Review
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="glass-card rounded-2xl p-8 text-center border border-black/10 space-y-2">
                <CheckCircle2 className="w-8 h-8 mx-auto text-black" />
                <h3 className="text-sm font-bold text-black">
                  All Caught Up!
                </h3>
                <p className="text-xs text-black/50">
                  Zero formulas due right now.
                </p>
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: SCRATCHPAD */}
        {currentView === 'scratchpad' && (
          <div className="space-y-3">
            <div className="py-1">
              <h2 className="text-lg font-bold text-black tracking-tight">
                Formula Scratchpad
              </h2>
              <p className="text-xs text-black/50">
                Write or type equations to test recall
              </p>
            </div>
            <Scratchpad className="h-[420px]" />
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal (In-app, iframe safe, zero window.confirm) */}
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
        onStudyCard={(deck) => {
          setBrowseDeck(null);
          setActiveStudyDeck(deck);
          setResumeMode(false);
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
