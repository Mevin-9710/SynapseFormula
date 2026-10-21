import React, { useState, useEffect } from 'react';
import { X, Search, FileSpreadsheet, RefreshCw, Upload, AlertCircle, ArrowRight, Download, HelpCircle, BookOpen } from 'lucide-react';
import { listDriveExcelFiles, fetchDriveFileBinary } from '../services/drive';
import { parseWorkbookSummary, convertRowsToFlashcards, downloadSampleExcelTemplate, downloadSampleCsvTemplate } from '../services/excelParser';
import { googleSignIn, getAccessToken } from '../services/auth';
import { Deck, DriveFileItem, ColumnMapping } from '../types';
import { FormulaDisplay } from './FormulaDisplay';
import { ExcelGuideModal } from './ExcelGuideModal';

interface DrivePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeckCreated: (newDeck: Deck, cards: any[]) => void;
}

export const DrivePickerModal: React.FC<DrivePickerModalProps> = ({
  isOpen,
  onClose,
  onDeckCreated,
}) => {
  const [step, setStep] = useState<'select' | 'configure'>('select');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const [selectedFile, setSelectedFile] = useState<{ id?: string; name: string; mimeType?: string; buffer: ArrayBuffer } | null>(null);
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
    checkAuthAndLoad();
  }, [isOpen]);

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
    reader.onload = (event) => {
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

  const handleDownloadSample = () => {
    downloadSampleExcelTemplate();
  };

  const handleConfirmImport = () => {
    if (!selectedFile || !parsedSummary || !deckName.trim()) return;
    if (!mapping.statementCol || !mapping.formulaCol) {
      setError('Please select Statement and Formula columns.');
      return;
    }

    const deckId = `deck_${Date.now()}`;
    const cards = convertRowsToFlashcards(
      selectedFile.buffer,
      selectedSheet,
      mapping,
      deckId
    );

    if (cards.length === 0) {
      setError('No valid flashcards found.');
      return;
    }

    const isGSheet = selectedFile.mimeType === 'application/vnd.google-apps.spreadsheet';
    const isCsv = selectedFile.name.endsWith('.csv') || selectedFile.mimeType?.includes('csv');
    const sourceLabel = selectedFile.id
      ? isGSheet ? 'Google Sheets' : isCsv ? 'Google Drive (CSV)' : 'Google Drive (Excel)'
      : isCsv ? 'Local CSV' : 'Local Spreadsheet';

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-xs">
      <div className="glass-card rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col border border-black/10 shadow-2xl animate-in slide-in-from-bottom duration-200">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-black/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-black" />
            <span className="text-sm font-bold text-black">
              {step === 'select' ? 'Connect Excel' : 'Map Columns'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-xl text-black/50 hover:text-black cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-black/5 text-xs text-black flex items-center gap-2 border border-black/10">
            <AlertCircle className="w-4 h-4 shrink-0 text-black" />
            <span className="truncate">{error}</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {step === 'select' ? (
            <>
              {!isAuthenticated ? (
                <div className="text-center py-6 px-3 glass-panel rounded-2xl border border-black/10 space-y-3">
                  <p className="text-xs text-black/70">
                    Sign in with Google to read your Drive Excel spreadsheets and enable 24h updates.
                  </p>
                  <button
                    onClick={handleSignIn}
                    disabled={isAuthenticating}
                    className="glass-button-primary w-full h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isAuthenticating ? 'Connecting...' : 'Sign in with Google'}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Search */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && loadDriveFiles()}
                        placeholder="Search Google Sheets, Excel, CSV..."
                        className="w-full pl-8 pr-3 py-2 rounded-xl text-xs bg-white border border-black/15 focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={loadDriveFiles}
                      className="p-2 glass-button rounded-xl text-black cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {/* List */}
                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                    {isLoadingFiles ? (
                      <div className="py-6 text-center text-xs text-black/50">
                        Loading files...
                      </div>
                    ) : driveFiles.length > 0 ? (
                      driveFiles.map(file => {
                        const isGSheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';
                        const isCsv = file.name.endsWith('.csv') || file.mimeType?.includes('csv');
                        const isTsv = file.name.endsWith('.tsv') || file.mimeType?.includes('tab-separated');

                        return (
                          <div
                            key={file.id}
                            onClick={() => handleSelectDriveFile(file)}
                            className="glass-panel rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-black/5 transition-colors gap-2"
                          >
                            <div className="truncate pr-2 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <p className="text-xs font-bold text-black truncate">{file.name}</p>
                                {isGSheet && (
                                  <span className="shrink-0 px-1.5 py-0.2 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-800">
                                    Sheet
                                  </span>
                                )}
                                {isCsv && (
                                  <span className="shrink-0 px-1.5 py-0.2 rounded text-[9px] font-semibold bg-blue-100 text-blue-800">
                                    CSV
                                  </span>
                                )}
                                {isTsv && (
                                  <span className="shrink-0 px-1.5 py-0.2 rounded text-[9px] font-semibold bg-purple-100 text-purple-800">
                                    TSV
                                  </span>
                                )}
                                {!isGSheet && !isCsv && !isTsv && (
                                  <span className="shrink-0 px-1.5 py-0.2 rounded text-[9px] font-semibold bg-black/10 text-black">
                                    Excel
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-black/40">
                                {new Date(file.modifiedTime).toLocaleDateString()}
                              </p>
                            </div>
                            <span className="text-[11px] font-bold text-black shrink-0">Select</span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="py-6 text-center text-xs text-black/50 border border-dashed border-black/15 rounded-xl">
                        No Google Sheets, Excel, or CSV files found in Drive.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Local File Upload */}
              <div className="pt-2 border-t border-black/10 space-y-2">
                <label className="glass-panel rounded-xl p-3 border border-dashed border-black/20 flex items-center justify-center gap-2 cursor-pointer hover:bg-black/5 transition-colors text-xs text-black font-semibold">
                  <Upload className="w-4 h-4" />
                  <span>Upload File (.xlsx, .csv, .tsv, .ods)</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.tsv,.ods,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    onChange={handleLocalFileUpload}
                    className="hidden"
                  />
                </label>

                {/* Template & Format Guide Actions */}
                <div className="p-3 rounded-xl bg-black/[0.02] border border-black/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-black flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 text-black/60" />
                      Spreadsheet & Formula Guide
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsGuideOpen(true)}
                      className="text-[11px] font-bold text-black hover:underline cursor-pointer"
                    >
                      View Guide →
                    </button>
                  </div>
                  <p className="text-[11px] text-black/60 leading-relaxed">
                    Works with <strong className="text-black">Google Sheets, Excel, & CSV</strong>. Formulas can be in standard LaTeX (e.g. <code className="font-mono text-black font-semibold">\vec{'{F}'} = m\vec{'{a}'}</code>) or plain text.
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={downloadSampleExcelTemplate}
                      className="glass-button h-9 rounded-lg text-xs font-semibold text-black flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Template (.xlsx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={downloadSampleCsvTemplate}
                      className="glass-button h-9 rounded-lg text-xs font-semibold text-black flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Template (.csv)</span>
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* Configure Step */
            <div className="space-y-3 text-xs">
              <div className="p-2.5 rounded-xl bg-black/[0.03] border border-black/5 flex items-start justify-between gap-2 text-[11px]">
                <div className="text-black/70 leading-relaxed">
                  <strong className="text-black">Formulas:</strong> Both LaTeX (<code className="font-mono text-black">\vec{'{F}'}=m\vec{'{a}'}</code>) and plain text (<code className="font-mono text-black">F=m*a</code>) are supported.
                </div>
                <button
                  type="button"
                  onClick={() => setIsGuideOpen(true)}
                  className="text-black font-bold hover:underline shrink-0 flex items-center gap-1 pt-0.5 cursor-pointer"
                >
                  <HelpCircle className="w-3 h-3" />
                  Guide
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-black mb-1">
                  Deck Title
                </label>
                <input
                  type="text"
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-white border border-black/15 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-black mb-1">
                  Worksheet Tab
                </label>
                <select
                  value={selectedSheet}
                  onChange={(e) => handleSheetChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-white border border-black/15 focus:outline-none"
                >
                  {parsedSummary?.sheetNames.map((s: string) => (
                    <option key={s} value={s}>{s}</option>
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
                    onChange={(e) => setMapping({ ...mapping, statementCol: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg text-xs bg-white border border-black/15"
                  >
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-black mb-1">
                    Formula Column *
                  </label>
                  <select
                    value={mapping.formulaCol}
                    onChange={(e) => setMapping({ ...mapping, formulaCol: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg text-xs bg-white border border-black/15"
                  >
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>{h}</option>
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
                    onChange={(e) => setMapping({ ...mapping, variablesCol: e.target.value || undefined })}
                    className="w-full px-2 py-1.5 rounded-lg text-xs bg-white border border-black/15"
                  >
                    <option value="">(None)</option>
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-black mb-1">
                    Explanation Column
                  </label>
                  <select
                    value={mapping.explanationCol || ''}
                    onChange={(e) => setMapping({ ...mapping, explanationCol: e.target.value || undefined })}
                    className="w-full px-2 py-1.5 rounded-lg text-xs bg-white border border-black/15"
                  >
                    <option value="">(None)</option>
                    {parsedSummary?.headers.map((h: string) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Stacked Preview for 9:16 mobile viewports */}
              {parsedSummary?.sampleRows && parsedSummary.sampleRows.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <span className="text-[10px] text-black/50 uppercase font-bold block">
                    Card Preview (Row 1)
                  </span>
                  <div className="p-3 rounded-xl bg-white border border-black/10 space-y-1.5 shadow-2xs">
                    <p className="font-bold text-black break-words leading-snug">
                      {parsedSummary.sampleRows[0][mapping.statementCol] || 'No statement selected'}
                    </p>
                    <div className="py-1 px-2 rounded-lg bg-black/[0.03] text-center overflow-x-auto">
                      <FormulaDisplay formula={parsedSummary.sampleRows[0][mapping.formulaCol] || ''} size="sm" />
                    </div>
                  </div>
                </div>
              )}
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
              Cancel
            </button>
          )}
        </div>
      </div>

      <ExcelGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
    </div>
  );
};
