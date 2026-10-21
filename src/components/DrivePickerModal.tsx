import React, { useState, useEffect } from 'react';
import {
  X,
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
} from '../services/excelParser';
import {
  VERCEL_MCP_ENDPOINT,
  pullPendingExternalMcpDecks,
} from '../services/mcpService';
import { googleSignIn, getAccessToken } from '../services/auth';
import { Deck, DriveFileItem, ColumnMapping } from '../types';
import { FormulaDisplay } from './FormulaDisplay';
import { ExcelGuideModal } from './ExcelGuideModal';

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
  const [isSyncingMcpQueue, setIsSyncingMcpQueue] = useState(false);

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

    const newDeck: Deck = {
      id: deckId,
      name: deckName.trim(),
      description: `Imported from ${sourceLabel} (${selectedSheet})`,
      googleDriveFileId: selectedFile.id,
      googleDriveFileName: selectedFile.name,
      googleDriveMimeType: selectedFile.mimeType,
      googleDriveModifiedTime: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
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
        lastStudiedAt: new Date().toISOString(),
      },
    };

    onDeckCreated(newDeck, cards);
    onClose();
  };

  const handleSyncExternalMcpQueue = async () => {
    setError(null);
    setIsSyncingMcpQueue(true);
    try {
      const pending = await pullPendingExternalMcpDecks();
      if (pending.length === 0) {
        setError('No queued decks found on the MCP endpoint yet.');
      } else {
        for (const item of pending) {
          onDeckCreated(item.deck, item.cards);
        }
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'Could not sync from MCP endpoint.');
    } finally {
      setIsSyncingMcpQueue(false);
    }
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-xs">
      <div className="glass-card rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col border border-black/10 shadow-2xl animate-in slide-in-from-bottom duration-200">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-black/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step === 'configure' ? (
              <FileSpreadsheet className="w-4 h-4 text-black" />
            ) : sourceTab === 'mcp' ? (
              <Terminal className="w-4 h-4 text-indigo-600" />
            ) : sourceTab === 'drive' ? (
              <Cloud className="w-4 h-4 text-black" />
            ) : (
              <Upload className="w-4 h-4 text-black" />
            )}
            <span className="text-sm font-bold text-black">
              {step === 'configure' ? 'Map Columns' : 'Add Formula Deck'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-xl text-black/50 hover:text-black cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Clean 3-Tab Switcher (only shown in 'select' step) */}
        {step === 'select' && (
          <div className="px-4 pt-3">
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/[0.05] border border-black/5">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSourceTab('mcp');
                }}
                className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  sourceTab === 'mcp'
                    ? 'bg-white text-indigo-600 shadow-2xs border border-black/5'
                    : 'text-black/55 hover:text-black'
                }`}
              >
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span>External MCP</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSourceTab('drive');
                }}
                className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  sourceTab === 'drive'
                    ? 'bg-white text-black shadow-2xs border border-black/5'
                    : 'text-black/55 hover:text-black'
                }`}
              >
                <Cloud className="w-3.5 h-3.5 shrink-0" />
                <span>Drive</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSourceTab('local');
                }}
                className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  sourceTab === 'local'
                    ? 'bg-white text-black shadow-2xs border border-black/5'
                    : 'text-black/55 hover:text-black'
                }`}
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span>File / CSV</span>
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-red-50 text-xs text-red-900 flex items-center gap-2 border border-red-200">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {step === 'select' ? (
            <>
              {/* TAB 1: EXTERNAL MCP SERVER CONNECTION ONLY */}
              {sourceTab === 'mcp' && (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Terminal className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span className="text-xs font-bold text-black truncate">
                          External MCP Server Link
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleSyncExternalMcpQueue}
                        disabled={isSyncingMcpQueue}
                        className="glass-button-primary px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${isSyncingMcpQueue ? 'animate-spin' : ''}`}
                        />
                        <span>Pull MCP Queue</span>
                      </button>
                    </div>

                    <p className="text-[11px] text-black/65 leading-relaxed">
                      Connect Gemini CLI, Claude Desktop, or Cursor to directly create decks via the <code className="font-mono font-bold text-indigo-700">create_formula_deck</code> MCP tool on your hosted Vercel domain:
                    </p>

                    {/* Hosted Vercel MCP Endpoint Pill */}
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white border border-black/10">
                      <code className="text-[11px] font-mono text-black truncate">
                        {VERCEL_MCP_ENDPOINT}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyMcpUrl}
                        className="glass-button px-2 py-1 rounded-md text-[10px] font-bold text-black flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        {copiedMcpUrl ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span>Copied URL</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy URL</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* MCP Client Config Snippet */}
                    <div className="relative">
                      <pre className="p-3 rounded-xl bg-black text-emerald-300 text-[10px] overflow-x-auto font-mono leading-relaxed">
                        {mcpConfigJson}
                      </pre>
                      <button
                        type="button"
                        onClick={handleCopyMcpConfig}
                        className="absolute top-2 right-2 px-2 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        {copiedMcpConfig ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Config</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: GOOGLE DRIVE */}
              {sourceTab === 'drive' && (
                <>
                  {!isAuthenticated ? (
                    <div className="text-center py-8 px-4 glass-panel rounded-2xl border border-black/10 space-y-3">
                      <Cloud className="w-7 h-7 text-black/50 mx-auto" />
                      <p className="text-xs text-black/70 max-w-xs mx-auto leading-relaxed">
                        Sign in with Google to import from Google Sheets, Excel, or CSV files and auto-sync changes.
                      </p>
                      <button
                        onClick={handleSignIn}
                        disabled={isAuthenticating}
                        className="glass-button-primary w-full h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isAuthenticating ? 'Connecting...' : 'Sign in with Google Drive'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && loadDriveFiles()}
                            placeholder="Search Google Sheets, Excel, CSV..."
                            className="w-full pl-8 pr-3 py-2 rounded-xl text-xs bg-white border border-black/15 focus:outline-none"
                          />
                        </div>
                        <button
                          onClick={loadDriveFiles}
                          className="p-2 glass-button rounded-xl text-black cursor-pointer"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`}
                          />
                        </button>
                      </div>

                      <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                        {isLoadingFiles ? (
                          <div className="py-8 text-center text-xs text-black/50">
                            Loading Drive spreadsheets...
                          </div>
                        ) : driveFiles.length > 0 ? (
                          driveFiles.map(file => {
                            const isGSheet =
                              file.mimeType === 'application/vnd.google-apps.spreadsheet';
                            const isCsv =
                              file.name.endsWith('.csv') || file.mimeType?.includes('csv');

                            return (
                              <div
                                key={file.id}
                                onClick={() => handleSelectDriveFile(file)}
                                className="glass-panel rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-black/5 transition-colors gap-2"
                              >
                                <div className="truncate pr-2 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <p className="text-xs font-bold text-black truncate">
                                      {file.name}
                                    </p>
                                    <span
                                      className={`shrink-0 px-1.5 py-0.2 rounded text-[9px] font-semibold ${
                                        isGSheet
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : isCsv
                                          ? 'bg-sky-100 text-sky-800'
                                          : 'bg-black/10 text-black'
                                      }`}
                                    >
                                      {isGSheet ? 'Sheet' : isCsv ? 'CSV' : 'Excel'}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-black/40">
                                    {new Date(file.modifiedTime).toLocaleDateString()}
                                  </p>
                                </div>
                                <span className="text-[11px] font-bold text-black shrink-0">
                                  Select →
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="py-8 text-center text-xs text-black/50 border border-dashed border-black/15 rounded-xl">
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
                  <label className="glass-panel rounded-2xl py-8 px-4 border border-dashed border-black/25 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-black/[0.03] transition-colors text-center">
                    <div className="w-10 h-10 rounded-xl bg-black/5 flex items-center justify-center text-black">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-black">
                        Choose Spreadsheet or CSV File
                      </p>
                      <p className="text-[11px] text-black/50 mt-0.5">
                        Supports .xlsx, .csv, .tsv, and .ods with LaTeX & variable meanings
                      </p>
                    </div>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,.tsv,.ods,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      onChange={handleLocalFileUpload}
                      className="hidden"
                    />
                  </label>

                  {/* Compact Template & Format Bar */}
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-black/[0.02] border border-black/10">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={downloadSampleExcelTemplate}
                        className="glass-button px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-black flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>.XLSX Template</span>
                      </button>
                      <button
                        type="button"
                        onClick={downloadSampleCsvTemplate}
                        className="glass-button px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-black flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>.CSV Template</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsGuideOpen(true)}
                      className="text-[11px] font-bold text-black/70 hover:text-black flex items-center gap-1 px-2 py-1 cursor-pointer"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>Format Guide</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Configure Step for Drive or Local Spreadsheets */
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-black mb-1">Deck Title</label>
                <input
                  type="text"
                  value={deckName}
                  onChange={e => setDeckName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-white border border-black/15 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-black mb-1">
                  Worksheet Tab
                </label>
                <select
                  value={selectedSheet}
                  onChange={e => handleSheetChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-white border border-black/15 focus:outline-none"
                >
                  {parsedSummary?.sheetNames.map((s: string) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block text-[10px] font-bold text-black mb-1">
                    Statement Column *
                  </label>
                  <select
                    value={mapping.statementCol}
                    onChange={e => setMapping({ ...mapping, statementCol: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg text-xs bg-white border border-black/15"
                  >
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-black mb-1">
                    Formula Column *
                  </label>
                  <select
                    value={mapping.formulaCol}
                    onChange={e => setMapping({ ...mapping, formulaCol: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg text-xs bg-white border border-black/15"
                  >
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-black mb-1">
                    Variables Column
                  </label>
                  <select
                    value={mapping.variablesCol || ''}
                    onChange={e =>
                      setMapping({ ...mapping, variablesCol: e.target.value || undefined })
                    }
                    className="w-full px-2 py-1.5 rounded-lg text-xs bg-white border border-black/15"
                  >
                    <option value="">(Auto-detect Symbol_1...5 or None)</option>
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-black mb-1">
                    Explanation Column
                  </label>
                  <select
                    value={mapping.explanationCol || ''}
                    onChange={e =>
                      setMapping({ ...mapping, explanationCol: e.target.value || undefined })
                    }
                    className="w-full px-2 py-1.5 rounded-lg text-xs bg-white border border-black/15"
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
                  const sampleVars = extractRowVariables(parsedSummary.sampleRows[0], mapping);
                  return (
                    <div className="space-y-1.5 pt-2">
                      <span className="text-[10px] text-black/50 uppercase font-bold block">
                        Card Preview (Row 1)
                      </span>
                      <div className="p-3 rounded-xl bg-white border border-black/10 space-y-2 shadow-2xs">
                        <p className="font-bold text-black break-words leading-snug">
                          {parsedSummary.sampleRows[0][mapping.statementCol] ||
                            'No statement selected'}
                        </p>
                        <div className="py-1 px-2 rounded-lg bg-black/[0.03] text-center overflow-x-auto">
                          <FormulaDisplay
                            formula={parsedSummary.sampleRows[0][mapping.formulaCol] || ''}
                            size="sm"
                          />
                        </div>
                        {sampleVars.length > 0 && (
                          <div className="pt-1.5 border-t border-black/5 space-y-1">
                            <span className="text-[10px] font-semibold text-black/50 block">
                              Detected Variable Meanings ({sampleVars.length}):
                            </span>
                            {sampleVars.map((v, idx) => (
                              <div
                                key={idx}
                                className="text-[11px] flex items-baseline gap-1.5 text-black/80"
                              >
                                <span className="font-bold text-black shrink-0">
                                  <FormulaDisplay
                                    formula={v.symbol}
                                    displayMode={false}
                                    size="xs"
                                  />
                                </span>
                                <span>— {v.meaning}</span>
                                {v.unit && (
                                  <span className="text-[10px] text-black/50 font-mono">
                                    [{v.unit}]
                                  </span>
                                )}
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

        {/* Modal Footer */}
        <div className="p-3 border-t border-black/10 flex items-center justify-between pb-safe">
          {step === 'configure' ? (
            <>
              <button
                onClick={() => setStep('select')}
                className="glass-button h-11 px-4 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={handleConfirmImport}
                className="glass-button-primary h-11 px-5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                Create Deck
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="glass-button w-full h-11 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Close
            </button>
          )}
        </div>
      </div>

      <ExcelGuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </div>
  );
};
