import React, { useState, useEffect } from 'react';
import {
  Search,
  FileSpreadsheet,
  RefreshCw,
  Upload,
  AlertCircle,
  ArrowRight,
  Download,
  HelpCircle,
  Terminal,
  Copy,
  Check,
  Cloud,
} from 'lucide-react';
import { listDriveExcelFiles, fetchDriveFileBinary } from '../services/drive';
import {
  parseWorkbookSummary,
  convertRowsToFlashcards,
  downloadSampleExcelTemplate,
  downloadSampleCsvTemplate,
  extractRowVariables,
  MAX_SPREADSHEET_FILE_BYTES,
} from '../services/excelParser';
import { VERCEL_MCP_ENDPOINT } from '../services/mcpService';
import { googleSignIn, getAccessToken } from '../services/auth';
import { Deck, DriveFileItem, ColumnMapping } from '../types';
import { FormulaDisplay } from './FormulaDisplay';
import { ExcelGuideModal } from './ExcelGuideModal';
import { BottomSheet } from './BottomSheet';

interface DrivePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeckCreated: (newDeck: Deck, cards: any[]) => void;
}

type ImportSourceTab = 'mcp' | 'drive' | 'local';

export const DrivePickerModal: React.FC<DrivePickerModalProps> = ({
  isOpen,
  onClose,
  onDeckCreated,
}) => {
  const [sourceTab, setSourceTab] = useState<ImportSourceTab>('mcp');
  const [step, setStep] = useState<'select' | 'configure'>('select');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  // External MCP Server State
  const [copiedMcpConfig, setCopiedMcpConfig] = useState(false);
  const [copiedMcpUrl, setCopiedMcpUrl] = useState(false);

  // Spreadsheet mapping state
  const [selectedFile, setSelectedFile] = useState<{
    id?: string;
    name: string;
    mimeType?: string;
    buffer: ArrayBuffer;
  } | null>(null);
  const [parsedSummary, setParsedSummary] = useState<any | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [deckName, setDeckName] = useState<string>('');
  const [mapping, setMapping] = useState<ColumnMapping>({
    statementCol: '',
    formulaCol: '',
    variablesCol: '',
    explanationCol: '',
    categoryCol: '',
    conditionsCol: '',
    derivationCol: '',
  });

  useEffect(() => {
    if (!isOpen) {
      resetState();
      return;
    }
    if (sourceTab === 'drive') {
      checkAuthAndLoad();
    }
  }, [isOpen, sourceTab]);

  const resetState = () => {
    setStep('select');
    setSelectedFile(null);
    setParsedSummary(null);
    setError(null);
  };

  const checkAuthAndLoad = async () => {
    setError(null);
    const token = await getAccessToken();
    if (token) {
      setIsAuthenticated(true);
      loadDriveFiles();
    } else {
      setIsAuthenticated(false);
    }
  };

  const handleSignIn = async () => {
    setIsAuthenticating(true);
    setError(null);
    try {
      const res = await googleSignIn();
      if (res?.accessToken) {
        setIsAuthenticated(true);
        loadDriveFiles();
      }
    } catch (err: any) {
      setError(err?.message || 'Google sign-in incomplete.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const loadDriveFiles = async () => {
    setIsLoadingFiles(true);
    setError(null);
    try {
      const files = await listDriveExcelFiles(searchQuery);
      setDriveFiles(files);
    } catch (err: any) {
      setError(err?.message || 'Could not load Google Drive files.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleSelectDriveFile = async (file: DriveFileItem) => {
    setError(null);
    if (file.size && Number(file.size) > MAX_SPREADSHEET_FILE_BYTES) {
      setError('Spreadsheet exceeds maximum file size limit (10 MB).');
      return;
    }
    setIsLoadingFiles(true);
    try {
      const buffer = await fetchDriveFileBinary(file.id, file.mimeType);
      const summary = parseWorkbookSummary(buffer);

      setSelectedFile({ id: file.id, name: file.name, mimeType: file.mimeType, buffer });
      setParsedSummary(summary);
      setSelectedSheet(summary.activeSheet);
      setDeckName(file.name.replace(/\.(xlsx|xls|csv|tsv|ods)$/i, ''));
      setMapping(summary.detectedMapping);
      setStep('configure');
    } catch (err: any) {
      setError(err?.message || 'Could not read spreadsheet file.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleLocalFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (file.size > MAX_SPREADSHEET_FILE_BYTES) {
      setError('File exceeds maximum allowed size of 10 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        const summary = parseWorkbookSummary(buffer);

        setSelectedFile({ name: file.name, mimeType: file.type, buffer });
        setParsedSummary(summary);
        setSelectedSheet(summary.activeSheet);
        setDeckName(file.name.replace(/\.(xlsx|xls|csv|tsv|ods)$/i, ''));
        setMapping(summary.detectedMapping);
        setStep('configure');
      } catch (err: any) {
        setError(err?.message || 'Failed to parse spreadsheet or CSV file.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSheetChange = (sheet: string) => {
    if (!selectedFile) return;
    try {
      const summary = parseWorkbookSummary(selectedFile.buffer, sheet);
      setParsedSummary(summary);
      setSelectedSheet(sheet);
      setMapping(summary.detectedMapping);
    } catch (err: any) {
      setError(err?.message || 'Failed to load worksheet.');
    }
  };

  const handleConfirmImport = () => {
    if (!selectedFile || !parsedSummary || !deckName.trim()) return;
    if (!mapping.statementCol || !mapping.formulaCol) {
      setError('Please select Statement and Formula columns.');
      return;
    }

    const deckId = `deck_${Date.now()}`;
    const cards = convertRowsToFlashcards(selectedFile.buffer, selectedSheet, mapping, deckId);

    if (cards.length === 0) {
      setError('No valid flashcards found.');
      return;
    }

    const isGSheet = selectedFile.mimeType === 'application/vnd.google-apps.spreadsheet';
    const isCsv = selectedFile.name.endsWith('.csv') || selectedFile.mimeType?.includes('csv');
    const sourceLabel = selectedFile.id
      ? isGSheet
        ? 'Google Sheets'
        : isCsv
        ? 'Google Drive (CSV)'
        : 'Google Drive (Excel)'
      : isCsv
      ? 'Local CSV'
      : 'Local Spreadsheet';

    const now = new Date().toISOString();
    const newDeck: Deck = {
      id: deckId,
      name: deckName.trim(),
      description: `Imported from ${sourceLabel} (${selectedSheet})`,
      sheetName: selectedSheet || 'Sheet1',
      googleDriveFileId: selectedFile.id,
      googleDriveFileName: selectedFile.name,
      googleDriveMimeType: selectedFile.mimeType,
      googleDriveModifiedTime: now,
      lastSyncedAt: now,
      createdAt: now,
      syncIntervalHours: 24,
      columnMapping: mapping,
      cardsCount: cards.length,
      sessionState: {
        lastCardId: cards[0].id,
        lastCardIndex: 0,
        stage: 'statement',
        remainingQueueIds: cards.map(c => c.id),
        totalInSession: cards.length,
        completedInSession: 0,
        lastStudiedAt: now,
      },
    };

    onDeckCreated(newDeck, cards);
    onClose();
  };

  const mcpConfigJson = JSON.stringify(
    {
      mcpServers: {
        synapseformula: {
          url: VERCEL_MCP_ENDPOINT,
          transport: 'http',
        },
      },
    },
    null,
    2
  );

  const handleCopyMcpConfig = () => {
    navigator.clipboard.writeText(mcpConfigJson);
    setCopiedMcpConfig(true);
    setTimeout(() => setCopiedMcpConfig(false), 2000);
  };

  const handleCopyMcpUrl = () => {
    navigator.clipboard.writeText(VERCEL_MCP_ENDPOINT);
    setCopiedMcpUrl(true);
    setTimeout(() => setCopiedMcpUrl(false), 2000);
  };

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title={
          <span className="flex items-center gap-2">
            {step === 'configure' ? (
              <FileSpreadsheet className="w-4 h-4" />
            ) : sourceTab === 'mcp' ? (
              <Terminal className="w-4 h-4" />
            ) : sourceTab === 'drive' ? (
              <Cloud className="w-4 h-4" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            <span>{step === 'configure' ? 'Map Columns' : 'Import Formula Deck'}</span>
          </span>
        }
        subtitle="External MCP, Google Drive Sheets/Excel, or local spreadsheet"
        footer={
          step === 'configure' ? (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep('select')}
                className="glass-button flex-1 min-h-[48px] px-4 rounded-xl text-[15px] font-semibold cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirmImport}
                className="glass-button-primary flex-1 min-h-[48px] px-5 rounded-xl text-[15px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Create Deck</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="glass-button w-full min-h-[48px] rounded-xl text-[15px] font-semibold cursor-pointer"
            >
              Close
            </button>
          )
        }
      >
        <div className="space-y-4">
          {/* Clean 3-Tab Switcher (only shown in 'select' step) */}
          {step === 'select' && (
            <div className="grid grid-cols-3 gap-2 p-1 rounded-2xl glass-panel">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSourceTab('mcp');
                }}
                className={`min-h-[44px] px-2 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  sourceTab === 'mcp'
                    ? 'glass-button-primary'
                    : 'text-secondary-contrast'
                }`}
              >
                <Terminal className="w-4 h-4 shrink-0" />
                <span>MCP</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSourceTab('drive');
                }}
                className={`min-h-[44px] px-2 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  sourceTab === 'drive'
                    ? 'glass-button-primary'
                    : 'text-secondary-contrast'
                }`}
              >
                <Cloud className="w-4 h-4 shrink-0" />
                <span>Drive</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSourceTab('local');
                }}
                className={`min-h-[44px] px-2 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  sourceTab === 'local'
                    ? 'glass-button-primary'
                    : 'text-secondary-contrast'
                }`}
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>File / CSV</span>
              </button>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl glass-panel text-[13px] font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="leading-snug">{error}</span>
            </div>
          )}

          {step === 'select' ? (
            <>
              {/* TAB 1: EXTERNAL MCP SERVER CONNECTION ONLY (4.1: No shared queue) */}
              {sourceTab === 'mcp' && (
                <div className="rounded-2xl glass-panel p-4 space-y-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Terminal className="w-4 h-4 shrink-0" />
                    <span className="text-[15px] font-bold truncate">
                      External MCP Server Link
                    </span>
                  </div>

                  <p className="text-[13px] text-secondary-contrast leading-relaxed">
                    Connect Gemini CLI, Claude Desktop, or Cursor to create decks via the{' '}
                    <code className="font-mono font-bold">create_formula_deck</code> MCP tool. It
                    returns a private 1-click <code className="font-mono">?mcp_deck=</code>{' '}
                    confirmation link (up to 200 formulas per deck):
                  </p>

                  {/* Hosted Vercel MCP Endpoint */}
                  <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15">
                    <code className="text-xs font-mono truncate">
                      {VERCEL_MCP_ENDPOINT}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyMcpUrl}
                      className="glass-button min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      {copiedMcpUrl ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy URL</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* MCP Client Config Snippet */}
                  <div className="space-y-2">
                    <pre className="p-3 rounded-xl bg-black text-emerald-300 text-xs overflow-x-auto font-mono leading-relaxed">
                      {mcpConfigJson}
                    </pre>
                    <button
                      type="button"
                      onClick={handleCopyMcpConfig}
                      className="glass-button w-full min-h-[44px] px-3 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {copiedMcpConfig ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Copied MCP JSON Config</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copy MCP JSON Config</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 2: GOOGLE DRIVE */}
              {sourceTab === 'drive' && (
                <>
                  {!isAuthenticated ? (
                    <div className="text-center py-6 px-4 glass-panel rounded-2xl space-y-3">
                      <Cloud className="w-8 h-8 mx-auto opacity-70" />
                      <p className="text-[15px] font-semibold max-w-xs mx-auto leading-relaxed">
                        Connect Google Drive to import and re-sync your physics spreadsheets.
                      </p>
                      <p className="text-[13px] text-secondary-contrast max-w-xs mx-auto leading-snug">
                        Uses read-only spreadsheet access (<code className="font-mono">drive.readonly</code>) strictly in memory so multi-sheet Excel & Google Sheets can be re-synced without modifying your Drive files.
                      </p>
                      <button
                        type="button"
                        onClick={handleSignIn}
                        disabled={isAuthenticating}
                        className="glass-button-primary w-full min-h-[48px] rounded-xl text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isAuthenticating ? 'Connecting...' : 'Sign in with Google Drive'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
                          <input
                            type="search"
                            enterKeyHint="search"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && loadDriveFiles()}
                            placeholder="Search Google Sheets, Excel, CSV..."
                            className="w-full min-h-[44px] pl-10 pr-3.5 py-2 rounded-xl text-base bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 focus:outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={loadDriveFiles}
                          aria-label="Refresh Drive files"
                          className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
                        >
                          <RefreshCw
                            className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin' : ''}`}
                          />
                        </button>
                      </div>

                      <div className="space-y-2 max-h-[280px] overflow-y-auto overscroll-contain">
                        {isLoadingFiles ? (
                          <div className="py-8 text-center text-[15px] text-secondary-contrast">
                            Loading Drive spreadsheets...
                          </div>
                        ) : driveFiles.length > 0 ? (
                          driveFiles.map(file => {
                            const isGSheet =
                              file.mimeType === 'application/vnd.google-apps.spreadsheet';
                            const isCsv =
                              file.name.endsWith('.csv') || file.mimeType?.includes('csv');

                            return (
                              <button
                                key={file.id}
                                type="button"
                                onClick={() => handleSelectDriveFile(file)}
                                className="glass-panel w-full text-left rounded-xl p-3.5 min-h-[54px] flex items-center justify-between cursor-pointer gap-2"
                              >
                                <div className="truncate pr-2 min-w-0">
                                  <p className="text-[15px] font-bold truncate">
                                    {file.name}
                                  </p>
                                  <p className="text-xs text-secondary-contrast mt-0.5">
                                    {isGSheet ? 'Google Sheet' : isCsv ? 'CSV' : 'Excel'} ·{' '}
                                    {new Date(file.modifiedTime).toLocaleDateString()}
                                  </p>
                                </div>
                                <span className="text-[13px] font-bold shrink-0">
                                  Select →
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="py-8 text-center text-[15px] text-secondary-contrast border border-dashed border-black/15 dark:border-white/15 rounded-xl">
                            No spreadsheets found in Drive.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* TAB 3: LOCAL FILE / TEMPLATES */}
              {sourceTab === 'local' && (
                <div className="space-y-3">
                  <label className="glass-panel rounded-2xl py-8 px-4 border border-dashed border-black/25 dark:border-white/25 flex flex-col items-center justify-center gap-2.5 cursor-pointer text-center">
                    <div className="w-11 h-11 rounded-xl bg-black/5 dark:bg-white/10 flex items-center justify-center">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[15px] font-bold">
                        Choose Spreadsheet or CSV File (≤10 MB)
                      </p>
                      <p className="text-[13px] text-secondary-contrast mt-0.5">
                        Supports .xlsx, .csv, .tsv, and .ods with LaTeX, Conditions & Derivations
                      </p>
                    </div>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,.tsv,.ods,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      onChange={handleLocalFileUpload}
                      className="hidden"
                    />
                  </label>

                  {/* Template & Format Bar (all buttons >= 44px) */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={downloadSampleExcelTemplate}
                      className="glass-button min-h-[44px] px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>.XLSX</span>
                    </button>
                    <button
                      type="button"
                      onClick={downloadSampleCsvTemplate}
                      className="glass-button min-h-[44px] px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>.CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsGuideOpen(true)}
                      className="glass-button min-h-[44px] px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Guide</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Configure Step for Drive or Local Spreadsheets (all inputs/selects 16px text-base) */
            <div className="space-y-3 text-[13px]">
              <div>
                <label className="block text-[13px] font-bold mb-1">Deck Title</label>
                <input
                  type="text"
                  value={deckName}
                  onChange={e => setDeckName(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl text-base bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[13px] font-bold mb-1">
                  Worksheet Tab (Saved for Drive Re-Sync)
                </label>
                <select
                  value={selectedSheet}
                  onChange={e => handleSheetChange(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl text-base bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 focus:outline-none"
                >
                  {parsedSummary?.sheetNames.map((s: string) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <div>
                  <label className="block text-xs font-bold mb-1">Statement Column *</label>
                  <select
                    value={mapping.statementCol}
                    onChange={e => setMapping({ ...mapping, statementCol: e.target.value })}
                    className="w-full min-h-[44px] px-2.5 rounded-xl text-base bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15"
                  >
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Formula Column *</label>
                  <select
                    value={mapping.formulaCol}
                    onChange={e => setMapping({ ...mapping, formulaCol: e.target.value })}
                    className="w-full min-h-[44px] px-2.5 rounded-xl text-base bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15"
                  >
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold mb-1">Variables Column</label>
                  <select
                    value={mapping.variablesCol || ''}
                    onChange={e =>
                      setMapping({ ...mapping, variablesCol: e.target.value || undefined })
                    }
                    className="w-full min-h-[44px] px-2.5 rounded-xl text-base bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15"
                  >
                    <option value="">(Auto-detect Variable_1...5)</option>
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Conditions Column</label>
                  <select
                    value={mapping.conditionsCol || ''}
                    onChange={e =>
                      setMapping({ ...mapping, conditionsCol: e.target.value || undefined })
                    }
                    className="w-full min-h-[44px] px-2.5 rounded-xl text-base bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15"
                  >
                    <option value="">(None)</option>
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold mb-1">Derivation Column</label>
                  <select
                    value={mapping.derivationCol || ''}
                    onChange={e =>
                      setMapping({ ...mapping, derivationCol: e.target.value || undefined })
                    }
                    className="w-full min-h-[44px] px-2.5 rounded-xl text-base bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15"
                  >
                    <option value="">(None)</option>
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Explanation Column</label>
                  <select
                    value={mapping.explanationCol || ''}
                    onChange={e =>
                      setMapping({ ...mapping, explanationCol: e.target.value || undefined })
                    }
                    className="w-full min-h-[44px] px-2.5 rounded-xl text-base bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15"
                  >
                    <option value="">(None)</option>
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Card Preview */}
              {parsedSummary?.sampleRows &&
                parsedSummary.sampleRows.length > 0 &&
                (() => {
                  const sampleRow = parsedSummary.sampleRows[0];
                  const sampleVars = extractRowVariables(sampleRow, mapping);
                  const sampleCond = mapping.conditionsCol ? sampleRow[mapping.conditionsCol] : '';
                  const sampleDeriv = mapping.derivationCol ? sampleRow[mapping.derivationCol] : '';
                  return (
                    <div className="space-y-1.5 pt-2">
                      <span className="text-xs text-secondary-contrast uppercase font-bold block">
                        Card Preview (Row 1)
                      </span>
                      <div className="p-3.5 rounded-2xl glass-panel space-y-2">
                        <p className="font-bold text-[15px] break-words leading-snug">
                          {sampleRow[mapping.statementCol] || 'No statement selected'}
                        </p>
                        <div className="py-2 px-3 rounded-xl bg-white/90 dark:bg-zinc-900/90 text-center">
                          <FormulaDisplay
                            formula={sampleRow[mapping.formulaCol] || ''}
                            size="sm"
                          />
                        </div>
                        {sampleCond && (
                          <p className="text-[13px] px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/10">
                            <strong>Conditions:</strong> {sampleCond}
                          </p>
                        )}
                        {sampleDeriv && (
                          <p className="text-[13px] text-secondary-contrast px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/10">
                            <strong>Derivation:</strong> {sampleDeriv}
                          </p>
                        )}
                        {sampleVars.length > 0 && (
                          <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-1">
                            <span className="text-xs font-semibold text-secondary-contrast block">
                              Detected Variables ({sampleVars.length}):
                            </span>
                            {sampleVars.map((v, idx) => (
                              <div key={idx} className="text-[13px] flex items-baseline gap-1.5">
                                <span className="font-bold shrink-0">
                                  <FormulaDisplay
                                    formula={v.symbol}
                                    displayMode={false}
                                    size="xs"
                                  />
                                </span>
                                <span>— {v.meaning}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
            </div>
          )}
        </div>
      </BottomSheet>

      <ExcelGuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </>
  );
};
