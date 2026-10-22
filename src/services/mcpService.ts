import { Deck, Flashcard, VariableDefinition } from '../types';
import { computeDeterministicCardId } from './excelParser';

export const VERCEL_PRODUCTION_DOMAIN = 'https://synapse-formula.vercel.app';
export const VERCEL_MCP_ENDPOINT = `${VERCEL_PRODUCTION_DOMAIN}/api/mcp`;
export const MAX_MCP_FORMULAS = 200;
export const MAX_MCP_ENCODED_CHARS = 350_000;

export interface McpFormulaItem {
  statement: string;
  formula: string;
  variables?: VariableDefinition[];
  conditions?: string;
  derivation?: string;
  explanation?: string;
  category?: string;
}

export interface McpDeckPayload {
  id?: string;
  deckName: string;
  description?: string;
  formulas: McpFormulaItem[];
  createdAt?: string;
  source?: 'external-mcp';
}

function boundStr(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val.trim() : String(val ?? fallback).trim();
  return s.slice(0, maxLen);
}

/**
 * Parses and validates a `?mcp_deck=` base64url string, enforcing payload size,
 * formula count (max 200), and string length limits before returning a preview.
 */
export const parseAndValidateMcpParam = (encodedMcp: string): McpDeckPayload => {
  if (!encodedMcp || encodedMcp.length > MAX_MCP_ENCODED_CHARS) {
    throw new Error('MCP deck link exceeds maximum size limit.');
  }

  const base64 = encodedMcp.replace(/-/g, '+').replace(/_/g, '/');
  const decodedJson = decodeURIComponent(
    Array.from(atob(base64), c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
  );
  const raw = JSON.parse(decodedJson);

  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.formulas)) {
    throw new Error('Invalid MCP deck payload format.');
  }

  if (raw.formulas.length === 0) {
    throw new Error('MCP deck contains no formulas.');
  }

  if (raw.formulas.length > MAX_MCP_FORMULAS) {
    throw new Error(`MCP deck exceeds maximum limit of ${MAX_MCP_FORMULAS} formulas.`);
  }

  const sanitizedFormulas: McpFormulaItem[] = raw.formulas
    .filter((f: any) => f && f.statement && f.formula)
    .slice(0, MAX_MCP_FORMULAS)
    .map((f: any) => ({
      statement: boundStr(f.statement, 1000),
      formula: boundStr(f.formula, 1000).replace(/^\$+|\$+$/g, ''),
      variables: Array.isArray(f.variables)
        ? f.variables
            .filter((v: any) => v && v.symbol && v.meaning)
            .slice(0, 20)
            .map((v: any) => ({
              symbol: boundStr(v.symbol, 120).replace(/^\$+|\$+$/g, ''),
              meaning: boundStr(v.meaning, 300),
              unit: v.unit ? boundStr(v.unit, 80) : undefined,
            }))
        : undefined,
      conditions: f.conditions ? boundStr(f.conditions, 500) : undefined,
      derivation: f.derivation ? boundStr(f.derivation, 1000) : undefined,
      explanation: f.explanation ? boundStr(f.explanation, 1000) : undefined,
      category: f.category ? boundStr(f.category, 120) : undefined,
    }));

  if (sanitizedFormulas.length === 0) {
    throw new Error('No valid formulas found in MCP deck payload.');
  }

  return {
    id: raw.id ? boundStr(raw.id, 120) : undefined,
    deckName: boundStr(raw.deckName, 200, 'MCP Formula Deck'),
    description: raw.description ? boundStr(raw.description, 600) : undefined,
    formulas: sanitizedFormulas,
    createdAt: raw.createdAt ? boundStr(raw.createdAt, 64) : undefined,
    source: 'external-mcp',
  };
};

export const convertMcpPayloadToDeckAndCards = (
  payload: McpDeckPayload
): { deck: Deck; cards: Flashcard[] } => {
  const now = new Date().toISOString();
  const deckId = `deck_mcp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const seenIds = new Set<string>();

  const cards: Flashcard[] = (payload.formulas || [])
    .slice(0, MAX_MCP_FORMULAS)
    .filter(f => f && f.statement && f.formula)
    .map((item, idx) => {
      const statement = boundStr(item.statement, 1000);
      const formula = boundStr(item.formula, 1000).replace(/^\$+|\$+$/g, '');
      let id = computeDeterministicCardId(deckId, statement, formula);
      if (seenIds.has(id)) id = `${id}_${idx}`;
      seenIds.add(id);

      return {
        id,
        deckId,
        statement,
        formula,
        variables: Array.isArray(item.variables)
          ? item.variables
              .filter(v => v && v.symbol && v.meaning)
              .slice(0, 20)
              .map(v => ({
                symbol: boundStr(v.symbol, 120).replace(/^\$+|\$+$/g, ''),
                meaning: boundStr(v.meaning, 300),
                unit: v.unit ? boundStr(v.unit, 80) : undefined,
              }))
          : undefined,
        conditions: item.conditions ? boundStr(item.conditions, 500) : undefined,
        derivation: item.derivation ? boundStr(item.derivation, 1000) : undefined,
        derivationSummary: item.derivation ? boundStr(item.derivation, 1000) : undefined,
        explanation: item.explanation ? boundStr(item.explanation, 1000) : undefined,
        category: item.category ? boundStr(item.category, 120) : undefined,
        repetitionStage: 'statement',
        intervalDays: 0,
        easeFactor: 2.5,
        repetitionCount: 0,
        lapses: 0,
        consecutiveGoods: 0,
        suspended: false,
        dueDate: now,
        createdAt: now,
        state: 'new',
      };
    });

  const deck: Deck = {
    id: deckId,
    name: boundStr(payload.deckName, 200, 'MCP Formula Deck'),
    description:
      boundStr(payload.description, 600) ||
      'Created via External MCP (synapse-formula.vercel.app)',
    sheetName: 'Sheet1',
    lastSyncedAt: now,
    createdAt: now,
    syncIntervalHours: 24,
    columnMapping: {
      statementCol: 'Statement',
      formulaCol: 'Formula',
      variablesCol: 'Variables',
      explanationCol: 'Explanation',
      categoryCol: 'Category',
      conditionsCol: 'Conditions',
      derivationCol: 'Derivation',
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
