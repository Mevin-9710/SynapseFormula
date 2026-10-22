import * as XLSX from 'xlsx';
import { Flashcard, ColumnMapping, VariableDefinition } from '../types';

export const MAX_SPREADSHEET_FILE_BYTES = 10 * 1024 * 1024; // 10 MB safety limit

export interface ParsedExcelSummary {
  sheetNames: string[];
  activeSheet: string;
  headers: string[];
  rowCount: number;
  sampleRows: Record<string, any>[];
  detectedMapping: ColumnMapping;
}

export function validateSpreadsheetBufferSize(buffer: ArrayBuffer): void {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Spreadsheet file is empty.');
  }
  if (buffer.byteLength > MAX_SPREADSHEET_FILE_BYTES) {
    const sizeMb = (buffer.byteLength / (1024 * 1024)).toFixed(1);
    throw new Error(`Spreadsheet file is too large (${sizeMb} MB). Maximum allowed size is 10 MB.`);
  }
}

/**
 * Deterministic hash for a (deckId, statement, formula) tuple so Drive re-syncs
 * match cards reliably across imports.
 */
export function computeDeterministicCardId(
  deckId: string,
  statement: string,
  formula: string
): string {
  const input = `${deckId}::${statement.trim()}::${formula.trim()}`;
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hashHex =
    (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  const cleanDeck = deckId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return `card_${cleanDeck}_${hashHex}`;
}

/**
 * Parses an ArrayBuffer (Excel .xlsx, .xls, or .csv) and auto-detects formula columns.
 */
export const parseWorkbookSummary = (
  buffer: ArrayBuffer,
  preferredSheet?: string
): ParsedExcelSummary => {
  validateSpreadsheetBufferSize(buffer);
  const workbook = XLSX.read(buffer, { type: 'array', cellFormula: false, cellHTML: false });
  const sheetNames = workbook.SheetNames;

  if (sheetNames.length === 0) {
    throw new Error('The uploaded workbook contains no sheets.');
  }

  const activeSheet =
    preferredSheet && sheetNames.includes(preferredSheet) ? preferredSheet : sheetNames[0];
  const worksheet = workbook.Sheets[activeSheet];

  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  const detectedMapping = autoDetectColumns(headers);

  return {
    sheetNames,
    activeSheet,
    headers,
    rowCount: rows.length,
    sampleRows: rows.slice(0, 4),
    detectedMapping,
  };
};

/**
 * Converts workbook rows into structured Flashcards with SRS scheduling defaults.
 */
export const convertRowsToFlashcards = (
  buffer: ArrayBuffer,
  sheetName: string,
  mapping: ColumnMapping,
  deckId: string
): Flashcard[] => {
  validateSpreadsheetBufferSize(buffer);
  const workbook = XLSX.read(buffer, { type: 'array', cellFormula: false, cellHTML: false });
  const targetSheet =
    sheetName && workbook.SheetNames.includes(sheetName)
      ? sheetName
      : workbook.SheetNames[0];
  const worksheet = workbook.Sheets[targetSheet];
  if (!worksheet) return [];

  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  const now = new Date().toISOString();
  const seenIds = new Set<string>();

  return rows
    .map((row, index): Flashcard | null => {
      const statement = String(row[mapping.statementCol] ?? '').trim();
      const rawFormula = String(row[mapping.formulaCol] ?? '').trim();
      const formula = rawFormula.replace(/^\$+|\$+$/g, '').trim();

      if (!statement || !formula) {
        return null;
      }

      const variables = extractRowVariables(row, mapping);

      const explanation = mapping.explanationCol
        ? String(row[mapping.explanationCol] ?? '').trim()
        : undefined;
      const category = mapping.categoryCol
        ? String(row[mapping.categoryCol] ?? '').trim()
        : undefined;
      const conditions = mapping.conditionsCol
        ? String(row[mapping.conditionsCol] ?? '').trim()
        : undefined;
      const derivation = mapping.derivationCol
        ? String(row[mapping.derivationCol] ?? '').trim()
        : undefined;

      let cardId = computeDeterministicCardId(deckId, statement, formula);
      if (seenIds.has(cardId)) {
        cardId = `${cardId}_${index}`;
      }
      seenIds.add(cardId);

      return {
        id: cardId,
        deckId,
        statement: statement.slice(0, 2000),
        formula: formula.slice(0, 2000),
        variables: variables.length > 0 ? variables : undefined,
        explanation: explanation ? explanation.slice(0, 2000) : undefined,
        category: category ? category.slice(0, 200) : undefined,
        conditions: conditions ? conditions.slice(0, 1000) : undefined,
        derivation: derivation ? derivation.slice(0, 2000) : undefined,
        derivationSummary: derivation ? derivation.slice(0, 2000) : undefined,
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
    })
    .filter((card): card is Flashcard => card !== null);
};

function autoDetectColumns(headers: string[]): ColumnMapping {
  const lowerHeaders = headers.map(h => ({ original: h, lower: h.toLowerCase().trim() }));

  const findHeader = (keywords: string[], fallbackIndex: number): string => {
    for (const kw of keywords) {
      const match = lowerHeaders.find(h => h.lower === kw || h.lower.includes(kw));
      if (match) return match.original;
    }
    return headers[fallbackIndex] || headers[0] || '';
  };

  const findOptionalHeader = (keywords: string[]): string | undefined => {
    for (const kw of keywords) {
      const match = lowerHeaders.find(h => h.lower === kw || h.lower.includes(kw));
      if (match) return match.original;
    }
    return undefined;
  };

  return {
    statementCol: findHeader(
      ['statement', 'concept', 'law', 'name', 'question', 'prompt', 'title', 'topic'],
      0
    ),
    formulaCol: findHeader(
      ['formula', 'equation', 'math', 'expression', 'latex', 'relation'],
      1
    ),
    variablesCol: findOptionalHeader([
      'variables',
      'variable',
      'symbols',
      'definitions',
      'where',
      'terms',
      'legend',
    ]),
    explanationCol: findOptionalHeader([
      'explanation',
      'notes',
      'description',
      'intuition',
      'context',
      'detail',
    ]),
    categoryCol: findOptionalHeader([
      'category',
      'chapter',
      'module',
      'unit',
      'subject',
      'tag',
    ]),
    conditionsCol: findOptionalHeader([
      'conditions',
      'condition',
      'assumptions',
      'assumption',
      'validity',
      'regime',
      'constraints',
    ]),
    derivationCol: findOptionalHeader([
      'derivation',
      'derive',
      'proof',
      'steps',
    ]),
  };
}

/**
 * Extracts variable definitions from a spreadsheet row.
 */
export function extractRowVariables(
  row: Record<string, any>,
  mapping: ColumnMapping
): VariableDefinition[] {
  const results: VariableDefinition[] = [];
  const keys = Object.keys(row);

  for (let i = 1; i <= 10; i++) {
    const symKey = keys.find(k =>
      new RegExp(`^(symbol|var_symbol|sym)[_\\s-]*${i}$`, 'i').test(k.trim())
    );
    const meanKey = keys.find(k =>
      new RegExp(`^(meaning|var_meaning|definition|desc)[_\\s-]*${i}$`, 'i').test(k.trim())
    );
    const unitKey = keys.find(k =>
      new RegExp(`^(unit|var_unit|units)[_\\s-]*${i}$`, 'i').test(k.trim())
    );

    if (symKey && meanKey) {
      const symbol = String(row[symKey] ?? '').trim().replace(/^\$+|\$+$/g, '');
      const meaning = String(row[meanKey] ?? '').trim();
      const unit = unitKey ? String(row[unitKey] ?? '').trim() : undefined;
      if (symbol && meaning) {
        results.push({ symbol, meaning, unit: unit || undefined });
      }
    }
  }

  for (let i = 1; i <= 10; i++) {
    const varKey = keys.find(k =>
      new RegExp(`^(variable|var)[_\\s-]*${i}$`, 'i').test(k.trim())
    );
    if (varKey) {
      const cellValue = String(row[varKey] ?? '').trim();
      if (cellValue) {
        const parsed = parseVariablesString(cellValue);
        for (const p of parsed) {
          if (!results.some(r => r.symbol === p.symbol)) {
            results.push(p);
          }
        }
      }
    }
  }

  if (mapping.variablesCol && row[mapping.variablesCol]) {
    const rawVars = String(row[mapping.variablesCol]).trim();
    if (rawVars) {
      const parsed = parseVariablesString(rawVars);
      for (const p of parsed) {
        if (!results.some(r => r.symbol === p.symbol)) {
          results.push(p);
        }
      }
    }
  }

  return results;
}

/**
 * Parses semicolon or newline separated variable strings:
 * Example: "F: Force [N]; m: Mass [kg]; a: Acceleration [m/s^2]"
 */
export function parseVariablesString(raw: string): VariableDefinition[] {
  if (!raw) return [];

  const entries = raw
    .split(/[;\n]+/)
    .map(s => s.trim())
    .filter(Boolean);

  return entries
    .map(entry => {
      const unitMatch = entry.match(/\[([^\]]+)\]|\(([^)]+)\)$/);
      const unit = unitMatch ? (unitMatch[1] || unitMatch[2]).trim() : undefined;
      const cleanEntry = entry.replace(/\[([^\]]+)\]|\(([^)]+)\)$/, '').trim();

      const sepMatch = cleanEntry.match(/^([^:=–-]+)[:=–-](.+)$/);
      if (sepMatch) {
        return {
          symbol: sepMatch[1].trim().replace(/^\$+|\$+$/g, ''),
          meaning: sepMatch[2].trim(),
          unit,
        };
      }

      return {
        symbol: cleanEntry.replace(/^\$+|\$+$/g, ''),
        meaning: 'Physical parameter / constant',
        unit,
      };
    })
    .filter(v => v.symbol.length > 0);
}

const SAMPLE_TEMPLATE_ROWS = [
  {
    Statement: 'Total *Lorentz Force* acting on a charged particle in electromagnetic fields',
    Formula: '\\vec{F} = q(\\vec{E} + \\vec{v} \\times \\vec{B})',
    Variable_1: '\\vec{F} : Total Lorentz force [N]',
    Variable_2: 'q : Electric charge [C]',
    Variable_3: '\\vec{E} : Electric field vector [V/m]',
    Variable_4: '\\vec{v} : Particle velocity [m/s]',
    Variable_5: '\\vec{B} : Magnetic flux density [T]',
    Conditions: 'Point charge q in inertial reference frame',
    Derivation: 'Superposition of electric force qE and magnetic Lorentz force q(v × B).',
    Explanation: 'Magnetic force is perpendicular to velocity and magnetic field, doing zero mechanical work.',
    Category: 'Electromagnetism',
  },
  {
    Statement: "Newton's *Universal Law of Gravitation* between two masses",
    Formula: 'F_g = G \\frac{m_1 m_2}{r^2}',
    Variable_1: 'F_g : Attractive gravitational force [N]',
    Variable_2: 'G : Gravitational constant [6.674 \\times 10^{-11} N\\cdot m^2/kg^2]',
    Variable_3: 'm_1, m_2 : Point masses [kg]',
    Variable_4: 'r : Center-to-center distance [m]',
    Variable_5: '',
    Conditions: 'Point masses or spherically symmetric bodies (r >= R_1 + R_2)',
    Derivation: 'Follows from Gauss flux law for Newtonian gravity over sphere area 4\\pi r^2.',
    Explanation: 'Inverse-square law; doubling separation reduces gravitational pull by a factor of 4.',
    Category: 'Gravitation',
  },
  {
    Statement: 'Angular frequency of a *Simple Harmonic Oscillator* (mass-spring)',
    Formula: '\\omega = \\sqrt{\\frac{k}{m}}',
    Variable_1: '\\omega : Angular frequency [rad/s]',
    Variable_2: 'k : Spring stiffness constant [N/m]',
    Variable_3: 'm : Oscillating mass [kg]',
    Variable_4: '',
    Variable_5: '',
    Conditions: 'Small displacements within Hookean elastic limit, zero damping',
    Derivation: 'Solve m d^2x/dt^2 + kx = 0 with ansatz x(t) = A cos(\\omega t).',
    Explanation: 'Independent of oscillation amplitude in the linear Hookean regime.',
    Category: 'Oscillations',
  },
  {
    Statement: 'Heisenberg *Uncertainty Principle* for position and momentum',
    Formula: '\\Delta x \\cdot \\Delta p \\ge \\frac{\\hbar}{2}',
    Variable_1: '\\Delta x : Position uncertainty [m]',
    Variable_2: '\\Delta p : Momentum uncertainty [kg\\cdot m/s]',
    Variable_3: '\\hbar : Reduced Planck constant [J\\cdot s]',
    Variable_4: '',
    Variable_5: '',
    Conditions: 'Canonical conjugate operators [x, p] = i\\hbar',
    Derivation: 'Robertson-Schrödinger inequality for non-commuting Hermitian observables.',
    Explanation: 'Fundamental quantum limit arising from non-commuting position and momentum operators.',
    Category: 'Quantum Mechanics',
  },
  {
    Statement: 'Ideal Gas Law (Plain Text Formula Example)',
    Formula: 'P * V = n * R * T',
    Variable_1: 'P : Absolute pressure [Pa]',
    Variable_2: 'V : Volume [m^3]',
    Variable_3: 'n : Amount of substance [mol]',
    Variable_4: 'R : Ideal gas constant [8.314 J/(mol\\cdot K)]',
    Variable_5: 'T : Absolute temperature [K]',
    Conditions: 'Low pressure, high temperature (non-interacting point particles)',
    Derivation: 'Combines Boyle, Charles, and Avogadro empirical gas laws.',
    Explanation: 'Plain text formulas also work if you prefer not writing LaTeX.',
    Category: 'Thermodynamics',
  },
];

const SAMPLE_COLUMN_WIDTHS = [
  { wch: 48 }, // Statement
  { wch: 38 }, // Formula
  { wch: 32 }, // Variable_1
  { wch: 32 }, // Variable_2
  { wch: 32 }, // Variable_3
  { wch: 32 }, // Variable_4
  { wch: 32 }, // Variable_5
  { wch: 36 }, // Conditions
  { wch: 42 }, // Derivation
  { wch: 52 }, // Explanation
  { wch: 20 }, // Category
];

/**
 * Generates and downloads a ready-to-use sample Excel (.xlsx) template
 */
export const downloadSampleExcelTemplate = (): void => {
  const worksheet = XLSX.utils.json_to_sheet(SAMPLE_TEMPLATE_ROWS);
  worksheet['!cols'] = SAMPLE_COLUMN_WIDTHS;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Physics Formulas');
  XLSX.writeFile(workbook, 'SynapseFormula_Template.xlsx');
};

/**
 * Generates and downloads a ready-to-use sample CSV (.csv) template
 */
export const downloadSampleCsvTemplate = (): void => {
  const worksheet = XLSX.utils.json_to_sheet(SAMPLE_TEMPLATE_ROWS);
  const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
  const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'SynapseFormula_Template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
