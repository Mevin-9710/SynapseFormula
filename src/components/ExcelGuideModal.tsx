import React from 'react';
import { X, Download, HelpCircle, Check, Copy, FileSpreadsheet } from 'lucide-react';
import { downloadSampleExcelTemplate, downloadSampleCsvTemplate } from '../services/excelParser';
import { FormulaDisplay } from './FormulaDisplay';

interface ExcelGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExcelGuideModal: React.FC<ExcelGuideModalProps> = ({ isOpen, onClose }) => {
  const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  const sampleFormulas = [
    {
      type: 'LaTeX (Recommended)',
      formula: '\\vec{F} = q(\\vec{E} + \\vec{v} \\times \\vec{B})',
      excelText: '\\vec{F} = q(\\vec{E} + \\vec{v} \\times \\vec{B})',
      desc: 'Use standard LaTeX. In Excel or Google Sheets, type a normal single backslash (no double \\ required).',
    },
    {
      type: 'Fraction / Exponent',
      formula: 'F_g = G \\frac{m_1 m_2}{r^2}',
      excelText: 'F_g = G \\frac{m_1 m_2}{r^2}',
      desc: 'Use \\frac{numerator}{denominator} and ^2 for powers.',
    },
    {
      type: 'Square root & Greek',
      formula: '\\omega = \\sqrt{\\frac{k}{m}}',
      excelText: '\\omega = \\sqrt{\\frac{k}{m}}',
      desc: 'Greek symbols like \\omega, \\lambda, \\Delta, \\hbar render beautifully.',
    },
    {
      type: 'Plain Text (Also Supported)',
      formula: 'P * V = n * R * T',
      excelText: 'P * V = n * R * T',
      desc: 'If you prefer not writing LaTeX, standard math expressions render in clean monospace.',
    },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="glass-card rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col border border-black/10 shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-black/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-black" />
            <span className="text-sm font-bold text-black">
              Spreadsheet & Formula Guide
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-xl text-black/50 hover:text-black cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Quick Download Banner with both XLSX and CSV */}
          <div className="glass-panel p-3.5 rounded-xl border border-black/10 space-y-2 bg-black/[0.02]">
            <div>
              <p className="font-bold text-black text-xs">Download Starter Templates</p>
              <p className="text-[11px] text-black/60">
                Works with Google Sheets, Microsoft Excel (.xlsx), CSV, and TSV.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={downloadSampleExcelTemplate}
                className="glass-button-primary h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .xlsx</span>
              </button>
              <button
                onClick={downloadSampleCsvTemplate}
                className="glass-button h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer border border-black/10"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .csv</span>
              </button>
            </div>
          </div>

          {/* Supported File Types */}
          <div className="p-3 rounded-xl bg-black/5 border border-black/10 space-y-1.5">
            <p className="font-bold text-black text-xs">Supported Formats & Google Drive:</p>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">Google Sheets</span>
              <span className="px-2 py-0.5 rounded-full bg-black/10 text-black font-semibold">Excel (.xlsx, .xls)</span>
              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">CSV (.csv)</span>
              <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-semibold">TSV (.tsv)</span>
            </div>
            <p className="text-[11px] text-black/70 leading-relaxed pt-1">
              • <strong>Google Sheets:</strong> You can select any Google Sheet from your Google Drive; the app exports and reads it instantly.<br />
              • <strong>CSV / TSV / Excel:</strong> Upload directly from your device or select from Google Drive.
            </p>
          </div>

          {/* Section 1: Should formulas be in LaTeX? */}
          <div className="space-y-2">
            <h3 className="font-bold text-sm text-black flex items-center gap-1.5">
              <span>1. Should the formula be in LaTeX?</span>
            </h3>
            <p className="text-black/70 leading-relaxed">
              <strong className="text-black">Yes, LaTeX is recommended</strong> because it produces professional mathematical typography with fractions, vectors, Greek letters, and exponents.
            </p>
            <div className="p-2.5 rounded-xl bg-black/5 border border-black/5 space-y-1">
              <p className="font-semibold text-black">How to enter LaTeX in Excel:</p>
              <ul className="list-disc list-inside space-y-1 text-black/70 text-[11px]">
                <li>Type regular single backslashes in Excel (e.g. <code className="bg-white px-1 py-0.5 rounded font-mono text-black">\frac{'{a}'}{'{b}'}</code>).</li>
                <li>No need to double-escape backslashes.</li>
                <li>No need to wrap in dollar signs <code className="font-mono text-black">$$</code> (though if you do, the app automatically handles it).</li>
              </ul>
            </div>
            <p className="text-black/70 leading-relaxed text-[11px]">
              <strong className="text-black">Plain text is also 100% supported:</strong> If you don't know LaTeX, you can simply write <code className="font-mono bg-black/5 px-1 rounded text-black">F = m * a</code> or <code className="font-mono bg-black/5 px-1 rounded text-black">E = m * c^2</code>. The app renders both!
            </p>
          </div>

          {/* Section 2: Expected Columns */}
          <div className="space-y-2 pt-2 border-t border-black/10">
            <h3 className="font-bold text-sm text-black">
              2. What columns should the Excel file have?
            </h3>
            <p className="text-black/70 leading-relaxed">
              Your Excel sheet can have any column headers—the app automatically detects them, or you can map them:
            </p>

            <div className="space-y-2">
              <div className="p-2.5 rounded-xl bg-white border border-black/10 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-black">Statement</span>
                  <span className="text-[10px] uppercase font-bold text-black/60 bg-black/5 px-1.5 py-0.5 rounded">Required</span>
                </div>
                <p className="text-black/60 text-[11px]">
                  The law name, physical prompt, or theorem. (e.g. <em>"Total Lorentz Force on a charge"</em>). You can use asterisks for *italic highlights*.
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-black/10 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-black">Formula</span>
                  <span className="text-[10px] uppercase font-bold text-black/60 bg-black/5 px-1.5 py-0.5 rounded">Required</span>
                </div>
                <p className="text-black/60 text-[11px]">
                  The equation in LaTeX (e.g. <code className="font-mono text-black">\vec{'{F}'} = m \vec{'{a}'}</code>) or plain text.
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-black/10 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-black">Variable_1, Variable_2, ... (or Variables)</span>
                  <span className="text-[10px] font-semibold text-black/60 bg-black/5 px-1.5 py-0.5 rounded">Included in Template</span>
                </div>
                <p className="text-black/60 text-[11px] leading-relaxed">
                  Add what each variable means in dedicated columns (<code className="font-mono text-black bg-black/5 px-1 rounded">Variable_1</code>, <code className="font-mono text-black bg-black/5 px-1 rounded">Variable_2</code>, <code className="font-mono text-black bg-black/5 px-1 rounded">Variable_3</code>, etc.):<br />
                  <code className="font-mono text-black bg-black/5 px-1 rounded block mt-1">
                    \vec{'{F}'} : Net external force [N]
                  </code>
                  Or put them all in a single <code className="font-mono text-black bg-black/5 px-1 rounded">Variables</code> column separated by semicolons:<br />
                  <code className="font-mono text-black bg-black/5 px-1 rounded block mt-1">
                    F : Force [N]; m : Mass [kg]; a : Accel [m/s^2]
                  </code>
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-black/10 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-black">Explanation</span>
                  <span className="text-[10px] text-black/40">Optional</span>
                </div>
                <p className="text-black/60 text-[11px]">
                  Physical intuition, application domain, or notes shown after revealing.
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-black/10 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-black">Category</span>
                  <span className="text-[10px] text-black/40">Optional</span>
                </div>
                <p className="text-black/60 text-[11px]">
                  E.g. <em>"Mechanics"</em>, <em>"Electromagnetism"</em>, <em>"Quantum"</em>.
                </p>
              </div>
            </div>
          </div>

          {/* Section 3: Live Examples */}
          <div className="space-y-2 pt-2 border-t border-black/10">
            <h3 className="font-bold text-sm text-black">
              3. Examples you can copy & paste
            </h3>
            <div className="space-y-2">
              {sampleFormulas.map((item, idx) => (
                <div key={idx} className="p-2.5 rounded-xl bg-white border border-black/10 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-black text-[11px]">{item.type}</span>
                    <button
                      onClick={() => copyToClipboard(item.excelText, idx)}
                      className="text-[10px] text-black/50 hover:text-black flex items-center gap-1 cursor-pointer"
                    >
                      {copiedIndex === idx ? (
                        <>
                          <Check className="w-3 h-3 text-black" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="py-1 px-2 rounded-lg bg-black/[0.03] text-center overflow-x-auto">
                    <FormulaDisplay formula={item.formula} size="sm" />
                  </div>
                  <p className="text-[10px] text-black/50 font-mono bg-black/5 p-1 rounded break-all">
                    {item.excelText}
                  </p>
                  <p className="text-[10px] text-black/60">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-black/10 flex items-center gap-2 pb-safe">
          <button
            onClick={downloadSampleExcelTemplate}
            className="glass-button flex-1 h-11 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download Sample .xlsx
          </button>
          <button
            onClick={onClose}
            className="glass-button-primary flex-1 h-11 rounded-xl text-xs font-bold cursor-pointer"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
