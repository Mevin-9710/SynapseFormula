import React, { useMemo, useRef, useState, useEffect } from 'react';
import katex from 'katex';

interface FormulaDisplayProps {
  formula: string;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  displayMode?: boolean;
}

const katexRenderCache = new Map<string, string>();

export function cleanLatexString(raw: string): string {
  let clean = raw.trim();
  if (clean.startsWith('$$') && clean.endsWith('$$') && clean.length > 4) {
    clean = clean.slice(2, -2).trim();
  } else if (clean.startsWith('$') && clean.endsWith('$') && clean.length > 2) {
    clean = clean.slice(1, -1).trim();
  } else if (clean.startsWith('\\(') && clean.endsWith('\\)') && clean.length > 4) {
    clean = clean.slice(2, -2).trim();
  } else if (clean.startsWith('\\[') && clean.endsWith('\\]') && clean.length > 4) {
    clean = clean.slice(2, -2).trim();
  }
  return clean;
}

export function renderLatexCached(formula: string, displayMode = true): string | null {
  if (!formula) return null;
  const clean = cleanLatexString(formula);
  const cacheKey = `${displayMode ? 'D' : 'I'}:${clean}`;
  const cached = katexRenderCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const html = katex.renderToString(clean, {
      throwOnError: false,
      displayMode,
      strict: false,
      trust: false,
      maxExpand: 1000,
      maxSize: 20,
    });
    if (katexRenderCache.size > 600) {
      const firstKey = katexRenderCache.keys().next().value;
      if (firstKey) katexRenderCache.delete(firstKey);
    }
    katexRenderCache.set(cacheKey, html);
    return html;
  } catch {
    return null;
  }
}

/**
 * Preloads the next card's formula render into the KaTeX cache (5.24)
 * so switching cards has zero flash.
 */
export function preloadFormulaRender(formula?: string, displayMode = true): void {
  if (!formula) return;
  renderLatexCached(formula, displayMode);
}

/**
 * Renders mathematical formulas using KaTeX with responsive clamp() sizing,
 * pinch-zoom support, and a horizontal scroll fallback with a visible fade hint (5.11).
 */
export const FormulaDisplay: React.FC<FormulaDisplayProps> = ({
  formula,
  className = '',
  size = 'lg',
  displayMode = true,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hasRightOverflow, setHasRightOverflow] = useState(false);

  const sizeClasses: Record<NonNullable<FormulaDisplayProps['size']>, string> = {
    xs: 'text-xs',
    sm: 'formula-clamp-sm',
    md: 'formula-clamp-md',
    lg: 'formula-clamp-lg',
    xl: 'formula-clamp-lg font-semibold',
  };

  const renderedHtml = useMemo(
    () => renderLatexCached(formula, displayMode),
    [formula, displayMode]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const checkOverflow = () => {
      const isOverflowing = el.scrollWidth - el.clientWidth > 12;
      const isAtEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      setHasRightOverflow(isOverflowing && !isAtEnd);
    };
    checkOverflow();
    el.addEventListener('scroll', checkOverflow, { passive: true });
    window.addEventListener('resize', checkOverflow);
    return () => {
      el.removeEventListener('scroll', checkOverflow);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [renderedHtml, formula]);

  if (renderedHtml) {
    if (!displayMode) {
      return (
        <span
          className={`inline-block max-w-full align-middle select-all ${sizeClasses[size]} ${className}`}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      );
    }

    return (
      <div className="relative max-w-full">
        <div
          ref={scrollRef}
          className={`formula-scroll-fade max-w-full overflow-x-auto align-middle select-all py-1 ${sizeClasses[size]} ${className}`}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
        {hasRightOverflow && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 bottom-0 w-6 bg-gradient-to-l from-white dark:from-[#1a1d24] to-transparent"
          />
        )}
      </div>
    );
  }

  return (
    <span className={`font-mono font-semibold select-all ${sizeClasses[size]} ${className}`}>
      {formula}
    </span>
  );
};
