import React from 'react';
import { Download, Check, Copy, FileSpreadsheet } from 'lucide-react';
import { downloadSampleExcelTemplate, downloadSampleCsvTemplate } from '../services/excelParser';
import { FormulaDisplay } from './FormulaDisplay';
import { BottomSheet } from './BottomSheet';

interface ExcelGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExcelGuideModal: React.FC<ExcelGuideModalProps> = ({ isOpen, onClose }) => {
  const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

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
      desc: 'Greek symbols like \\omega, \\lambda, \\Delta, \\hbar render cleanly.',
    },
    {
      type: 'Plain Text (Also Supported)',
      formula: 'P * V = n * R * T',
      excelText: 'P * V = n * R * T',
      desc: 'Standard math expressions render in clean monospace.',
    },
  ];

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      zIndexClass="z-[70]"
      title={
        <span className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" />
          <span>Spreadsheet & Formula Guide</span>
        </span>
      }
      subtitle="Supported columns, LaTeX formatting & starter templates"
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadSampleExcelTemplate}
            className="glass-button flex-1 min-h-[48px] rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Sample .xlsx</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="glass-button-primary flex-1 min-h-[48px] rounded-xl text-[15px] font-bold cursor-pointer"
          >
            Got It
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-[13px]">
        {/* Quick Download Banner with both XLSX and CSV */}
        <div className="glass-panel p-3.5 rounded-2xl space-y-2.5">
          <div>
            <p className="font-bold text-[15px]">Download Starter Templates</p>
            <p className="text-[13px] text-secondary-contrast">
              Works with Google Sheets, Microsoft Excel (.xlsx), CSV, and TSV.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={downloadSampleExcelTemplate}
              className="glass-button-primary min-h-[44px] rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download .xlsx</span>
            </button>
            <button
              type="button"
              onClick={downloadSampleCsvTemplate}
              className="glass-button min-h-[44px] rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download .csv</span>
            </button>
          </div>
        </div>

        {/* Section 1: Columns */}
        <div className="space-y-2.5">
          <h3 className="font-bold text-[15px]">1. Supported Spreadsheet Columns</h3>
          <p className="text-[13px] text-secondary-contrast leading-relaxed">
            Columns are auto-detected or can be mapped during import:
          </p>

          <div className="space-y-2">
            <div className="p-3 rounded-xl glass-panel space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[15px]">Statement</span>
                <span className="text-xs font-bold text-secondary-contrast">Required</span>
              </div>
              <p className="text-[13px] text-secondary-contrast">
                Law name, physical prompt, or theorem. Use asterisks for *italic highlights*.
              </p>
            </div>

            <div className="p-3 rounded-xl glass-panel space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[15px]">Formula</span>
                <span className="text-xs font-bold text-secondary-contrast">Required</span>
              </div>
              <p className="text-[13px] text-secondary-contrast">
                Equation in LaTeX (e.g. <code className="font-mono">\vec{'{F}'} = m \vec{'{a}'}</code>) or plain text.
              </p>
            </div>

            <div className="p-3 rounded-xl glass-panel space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[15px]">Variable_1 ... Variable_5 (or Variables)</span>
                <span className="text-xs text-secondary-contrast">Optional</span>
              </div>
              <p className="text-[13px] text-secondary-contrast">
                Format: <code className="font-mono">F : Force [N]; m : Mass [kg]</code>
              </p>
            </div>

            <div className="p-3 rounded-xl glass-panel space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[15px]">Conditions & Derivation</span>
                <span className="text-xs text-secondary-contrast">Optional</span>
              </div>
              <p className="text-[13px] text-secondary-contrast">
                Shown after reveal (e.g. <em>"Constant acceleration only"</em> and derivation steps).
              </p>
            </div>
          </div>
        </div>

        {/* Section 2: Examples */}
        <div className="space-y-2.5 pt-2 border-t border-black/10 dark:border-white/10">
          <h3 className="font-bold text-[15px]">2. Copyable LaTeX Examples</h3>
          <div className="space-y-2.5">
            {sampleFormulas.map((item, idx) => (
              <div key={idx} className="p-3 rounded-xl glass-panel space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[13px]">{item.type}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(item.excelText, idx)}
                    className="glass-button min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedIndex === idx ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="py-2 px-3 rounded-xl bg-white/90 dark:bg-zinc-900/90 border border-black/10 dark:border-white/10 text-center">
                  <FormulaDisplay formula={item.formula} size="sm" />
                </div>
                <p className="text-xs font-mono p-2 rounded-lg bg-black/5 dark:bg-white/10 break-all">
                  {item.excelText}
                </p>
                <p className="text-xs text-secondary-contrast">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
};
