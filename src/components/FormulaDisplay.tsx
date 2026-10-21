import React, { useMemo } from 'react';
import katex from 'katex';

interface FormulaDisplayProps {
  formula: string;
  className?: string;
  displayMode?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export const FormulaDisplay: React.FC<FormulaDisplayProps> = ({
  formula,
  className = '',
  displayMode = true,
  size = 'lg',
}) => {
  const renderedHtml = useMemo(() => {
    if (!formula) return null;
    const cleanFormula = formula
      .replace(/^["']|["']$/g, '')
      .replace(/^\$\$([\s\S]*)\$\$$/, '$1')
      .replace(/^\$([\s\S]*)\$$/, '$1')
      .trim();

    try {
      return katex.renderToString(cleanFormula, {
        displayMode,
        throwOnError: true,
        output: 'htmlAndMathml',
      });
    } catch {
      // Try mild recovery: replace standalone * with \cdot
      try {
        const recovered = cleanFormula.replace(/\s\*\s|\*/g, ' \\cdot ');
        return katex.renderToString(recovered, {
          displayMode,
          throwOnError: true,
          output: 'htmlAndMathml',
        });
      } catch {
        return null;
      }
    }
  }, [formula, displayMode]);

  const sizeClasses = {
    xs: 'text-[11px]',
    sm: displayMode ? 'text-xs sm:text-sm py-1' : 'text-xs inline-block',
    md: displayMode ? 'text-sm sm:text-base py-1.5' : 'text-sm inline-block',
    lg: displayMode ? 'text-lg sm:text-2xl py-2' : 'text-sm sm:text-base inline-block',
    xl: displayMode ? 'text-xl sm:text-3xl py-2.5' : 'text-base sm:text-lg inline-block',
  }[size];

  if (renderedHtml) {
    return (
      <span
        className={`flashpoint-mono text-black font-mono tracking-tight select-all max-w-full ${
          displayMode ? 'block overflow-x-auto overflow-y-hidden text-center scrollbar-none' : 'inline-flex items-center justify-center'
        } ${sizeClasses} ${className}`}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    );
  }

  return (
    <span
      className={`flashpoint-mono font-mono text-black font-semibold tracking-wide select-all max-w-full ${
        displayMode ? 'block text-center overflow-x-auto overflow-y-hidden scrollbar-none' : 'inline-block'
      } ${sizeClasses} ${className}`}
    >
      {formula}
    </span>
  );
};
