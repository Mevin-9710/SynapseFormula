import { Deck, Flashcard, VariableDefinition } from '../types';

export interface McpFormulaItem {
  statement: string;
  formula: string;
  variables?: VariableDefinition[];
  explanation?: string;
  category?: string;
}

export interface McpDeckPayload {
  id: string;
  deckName: string;
  description: string;
  formulas: McpFormulaItem[];
  createdAt: string;
  source: 'gemini-mcp' | 'external-mcp';
}

export const convertMcpPayloadToDeckAndCards = (
  payload: McpDeckPayload
): { deck: Deck; cards: Flashcard[] } => {
  const now = new Date().toISOString();
  const deckId = `deck_mcp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const cards: Flashcard[] = (payload.formulas || [])
    .filter(f => f && f.statement && f.formula)
    .map((item, idx) => ({
      id: `card_${deckId}_${idx}`,
      deckId,
      statement: item.statement.trim(),
      formula: item.formula.trim().replace(/^\$+|\$+$/g, ''),
      variables: Array.isArray(item.variables)
        ? item.variables
            .filter(v => v && v.symbol && v.meaning)
            .map(v => ({
              symbol: String(v.symbol).trim().replace(/^\$+|\$+$/g, ''),
              meaning: String(v.meaning).trim(),
              unit: v.unit ? String(v.unit).trim() : undefined,
            }))
        : undefined,
      explanation: item.explanation ? String(item.explanation).trim() : undefined,
      category: item.category ? String(item.category).trim() : undefined,
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      state: 'new',
    }));

  const deck: Deck = {
    id: deckId,
    name: payload.deckName.trim() || 'AI Generated Deck',
    description:
      payload.description?.trim() ||
      (payload.source === 'gemini-mcp'
        ? 'Generated directly by Gemini via MCP'
        : 'Created via external MCP connection'),
    lastSyncedAt: now,
    syncIntervalHours: 24,
    columnMapping: {
      statementCol: 'Statement',
      formulaCol: 'Formula',
      variablesCol: 'Variables',
      explanationCol: 'Explanation',
      categoryCol: 'Category',
    },
    cardsCount: cards.length,
    sessionState:
      cards.length > 0
        ? {
            lastCardId: cards[0].id,
            lastCardIndex: 0,
            stage: 'statement',
            remainingQueueIds: cards.map(c => c.id),
            totalInSession: cards.length,
            completedInSession: 0,
            lastStudiedAt: now,
            mode: 'recall',
          }
        : undefined,
  };

  return { deck, cards };
};

export const generateDeckViaGeminiMcp = async (
  prompt: string,
  cardCount: number = 8
): Promise<{ deck: Deck; cards: Flashcard[] }> => {
  const response = await fetch('/api/mcp/gemini-deck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, cardCount }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || 'Failed to generate deck with Gemini MCP.');
  }

  if (!data?.deck || !Array.isArray(data.deck.formulas) || data.deck.formulas.length === 0) {
    throw new Error('Gemini returned an empty formula list. Try a more specific topic.');
  }

  return convertMcpPayloadToDeckAndCards(data.deck);
};

export const pullPendingExternalMcpDecks = async (): Promise<
  Array<{ deck: Deck; cards: Flashcard[] }>
> => {
  const response = await fetch('/api/mcp/pending-decks');
  if (!response.ok) return [];
  const data = await response.json();
  const list: McpDeckPayload[] = Array.isArray(data?.decks) ? data.decks : [];
  return list
    .map(item => convertMcpPayloadToDeckAndCards(item))
    .filter(item => item.cards.length > 0);
};
