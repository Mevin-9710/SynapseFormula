import React, { useMemo } from 'react';
import { renderLatexCached } from './FormulaDisplay';

interface FormattedTextProps {
  text: string;
  className?: string;
  as?: 'span' | 'p' | 'div' | 'h1' | 'h2' | 'h3';
  inlineMathClassName?: string;
}

export interface TextToken {
  type: 'text' | 'bold' | 'italic' | 'code' | 'inlineMath' | 'blockMath' | 'newline';
  content: string;
}

/**
 * Tokenizes text containing:
 * - Block math: $$...$$ or \[...\]
 * - Inline math: $...$ or \(...\)
 * - Markdown bold: **...**
 * - Markdown italic: *...*
 * - Markdown code: `...`
 * - Math equations with '=' containing symbols: e.g. v_{\text{rel}} = v1 + v2 = p/\mu
 * - Variables with subscripts/superscripts: v_{\text{rel}}, v_{\text{rel}}^2, m_1, p^2, etc.
 * - Standalone LaTeX commands: \mu, \frac{1}{2}, \vec{F}, \hbar, \omega, etc.
 * - Fractions/quotients: p/\mu, p^2/(2\mu)
 * - Newlines
 */
export function parseFormattedText(text: string): TextToken[] {
  if (!text) return [];

  const trimmed = text.trim();
  // Entire text is block math
  if (
    (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) ||
    (trimmed.startsWith('\\[') && trimmed.endsWith('\\]') && trimmed.length > 4)
  ) {
    return [{ type: 'blockMath', content: trimmed.slice(2, -2).trim() }];
  }

  // Regex matching all math forms, markdown tokens, and equations
  const tokenRegex =
    /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^\$\n]+?\$|\\\([\s\S]+?\\\)|\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`|(?:\b[a-zA-Z0-9_\^\{\}\\]+(?:_\{(?:[^{}]*|\{[^{}]*\})*\}|_[a-zA-Z0-9]+|\^\{(?:[^{}]*|\{[^{}]*\})*\}|\^[a-zA-Z0-9]+)?\s*=\s*[a-zA-Z0-9_\\\^\{\}\+\-\*\/\(\)\s=]+)|[a-zA-Z\\]+(?:_\{(?:[^{}]*|\{[^{}]*\})*\}|_[a-zA-Z0-9]+|\^\{(?:[^{}]*|\{[^{}]*\})*\}|\^[a-zA-Z0-9]+)+|\\[a-zA-Z]+(?:\{(?:[^{}]*|\{[^{}]*\})*\})*(?:_\{(?:[^{}]*|\{[^{}]*\})*\}|_[a-zA-Z0-9]+|\^\{(?:[^{}]*|\{[^{}]*\})*\}|\^[a-zA-Z0-9]+)*|[a-zA-Z0-9_\^\{\}\\]+\/[a-zA-Z0-9_\^\{\}\\\(\)]+|\n)/g;

  let lastIndex = 0;
  const tokens: TextToken[] = [];
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    const raw = match[0];
    if (raw === '\n') {
      tokens.push({ type: 'newline', content: '\n' });
    } else if (raw.startsWith('$$') && raw.endsWith('$$')) {
      tokens.push({ type: 'blockMath', content: raw.slice(2, -2).trim() });
    } else if (raw.startsWith('\\[') && raw.endsWith('\\]')) {
      tokens.push({ type: 'blockMath', content: raw.slice(2, -2).trim() });
    } else if (raw.startsWith('$') && raw.endsWith('$')) {
      tokens.push({ type: 'inlineMath', content: raw.slice(1, -1).trim() });
    } else if (raw.startsWith('\\(') && raw.endsWith('\\)')) {
      tokens.push({ type: 'inlineMath', content: raw.slice(2, -2).trim() });
    } else if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push({ type: 'bold', content: raw.slice(2, -2) });
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push({ type: 'italic', content: raw.slice(1, -1) });
    } else if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push({ type: 'code', content: raw.slice(1, -1) });
    } else {
      // It's a LaTeX macro, variable with subscript/superscript (e.g. v_{\text{rel}}), or math equation
      tokens.push({ type: 'inlineMath', content: raw.trim() });
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return tokens;
}

/**
 * Universal text and LaTeX math formatter.
 * Handles AI output, markdown headers, lists, code, and KaTeX mathematical formulas.
 */
export const FormattedText: React.FC<FormattedTextProps> = ({
  text,
  className = '',
  as: Component = 'span',
  inlineMathClassName = '',
}) => {
  if (!text) return null;

  // Split lines to properly support AI markdown headers (### ), bullet lists (- ), and block quotes
  const lines = useMemo(() => text.split('\n'), [text]);

  // If text is a single line, format directly for high performance
  if (lines.length <= 1) {
    return <FormattedLine text={text} Component={Component} className={className} inlineMathClassName={inlineMathClassName} />;
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      {lines.map((line, lineIdx) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) {
          return <div key={lineIdx} className="h-1.5" />;
        }

        // Markdown Header 3: ### Heading
        if (trimmedLine.startsWith('### ')) {
          return (
            <div key={lineIdx} className="font-bold text-[15px] pt-1.5 pb-0.5 text-foreground flex items-center gap-1.5">
              <FormattedLine text={trimmedLine.slice(4)} inlineMathClassName={inlineMathClassName} />
            </div>
          );
        }

        // Markdown Header 2: ## Heading
        if (trimmedLine.startsWith('## ')) {
          return (
            <div key={lineIdx} className="font-bold text-[16px] pt-2 pb-0.5 text-foreground">
              <FormattedLine text={trimmedLine.slice(3)} inlineMathClassName={inlineMathClassName} />
            </div>
          );
        }

        // Bullet Point: - item or * item
        if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
          return (
            <div key={lineIdx} className="flex items-start gap-2 pl-1 text-[14px] leading-relaxed">
              <span className="text-blue-500 font-bold shrink-0 mt-0.5">•</span>
              <div className="flex-1 min-w-0">
                <FormattedLine text={trimmedLine.slice(2)} inlineMathClassName={inlineMathClassName} />
              </div>
            </div>
          );
        }

        // Numbered List: 1. item
        const numMatch = trimmedLine.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={lineIdx} className="flex items-start gap-2 pl-1 text-[14px] leading-relaxed">
              <span className="font-mono text-xs font-bold text-blue-500 shrink-0 mt-1">{numMatch[1]}.</span>
              <div className="flex-1 min-w-0">
                <FormattedLine text={numMatch[2]} inlineMathClassName={inlineMathClassName} />
              </div>
            </div>
          );
        }

        return (
          <div key={lineIdx} className="leading-relaxed">
            <FormattedLine text={line} inlineMathClassName={inlineMathClassName} />
          </div>
        );
      })}
    </div>
  );
};

const FormattedLine: React.FC<{
  text: string;
  Component?: any;
  className?: string;
  inlineMathClassName?: string;
}> = ({ text, Component = 'span', className = '', inlineMathClassName = '' }) => {
  const tokens = useMemo(() => parseFormattedText(text), [text]);

  return (
    <Component className={className}>
      {tokens.map((token, idx) => {
        switch (token.type) {
          case 'blockMath': {
            const html = renderLatexCached(token.content, true);
            if (!html) return <span key={idx}>{token.content}</span>;
            return (
              <span
                key={idx}
                className="block my-2 overflow-x-auto text-center"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }
          case 'inlineMath': {
            let mathExpr = token.content;
            let trailingPunct = '';
            if (mathExpr.endsWith('.') || mathExpr.endsWith(',')) {
              trailingPunct = mathExpr.slice(-1);
              mathExpr = mathExpr.slice(0, -1);
            }

            const html = renderLatexCached(mathExpr, false);
            if (!html) {
              return (
                <span key={idx}>
                  {token.content}
                  {trailingPunct}
                </span>
              );
            }
            return (
              <React.Fragment key={idx}>
                <span
                  className={`inline-block align-baseline px-0.5 ${inlineMathClassName}`}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
                {trailingPunct}
              </React.Fragment>
            );
          }
          case 'bold': {
            const hasNested =
              token.content.includes('$') ||
              token.content.includes('\\') ||
              token.content.includes('*');
            return (
              <strong key={idx} className="font-bold text-foreground">
                {hasNested ? (
                  <FormattedLine text={token.content} inlineMathClassName={inlineMathClassName} />
                ) : (
                  token.content
                )}
              </strong>
            );
          }
          case 'italic': {
            const hasNested =
              token.content.includes('$') ||
              token.content.includes('\\') ||
              token.content.includes('*');
            return (
              <em key={idx} className="font-serif italic font-semibold px-0.5">
                {hasNested ? (
                  <FormattedLine text={token.content} inlineMathClassName={inlineMathClassName} />
                ) : (
                  token.content
                )}
              </em>
            );
          }
          case 'code':
            return (
              <code
                key={idx}
                className="font-mono text-xs px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10"
              >
                {token.content}
              </code>
            );
          case 'newline':
            return <br key={idx} />;
          case 'text':
          default:
            return <React.Fragment key={idx}>{token.content}</React.Fragment>;
        }
      })}
    </Component>
  );
};
export default FormattedText;
