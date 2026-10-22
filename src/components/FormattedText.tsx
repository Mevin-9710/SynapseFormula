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
 * Universal text formatter for flashcard questions (statements), explanations, conditions, and derivations.
 * Formats:
 * - LaTeX math: inline $...$, block $$...$$, subscripts (v_{\text{rel}}, m_1), powers (p^2), greek (\mu), fractions
 * - Markdown: *italic*, **bold**, `code`
 */
export const FormattedText: React.FC<FormattedTextProps> = ({
  text,
  className = '',
  as: Component = 'span',
  inlineMathClassName = '',
}) => {
  const tokens = useMemo(() => parseFormattedText(text), [text]);

  if (!text) return null;

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
            // Strip trailing period or comma if accidentally captured at boundary
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
              <strong key={idx} className="font-bold">
                {hasNested ? (
                  <FormattedText text={token.content} inlineMathClassName={inlineMathClassName} />
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
                  <FormattedText text={token.content} inlineMathClassName={inlineMathClassName} />
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
