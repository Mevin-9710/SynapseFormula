import { describe, it, expect } from 'vitest';
import { parseFormattedText } from '../FormattedText';

describe('parseFormattedText', () => {
  it('parses italic emphasis markdown', () => {
    const tokens = parseFormattedText('Total *Lorentz Force* on particle');
    expect(tokens).toEqual([
      { type: 'text', content: 'Total ' },
      { type: 'italic', content: 'Lorentz Force' },
      { type: 'text', content: ' on particle' },
    ]);
  });

  it('parses inline math with dollar delimiters', () => {
    const tokens = parseFormattedText('What is force $F = ma$ when mass is $m$?');
    expect(tokens).toEqual([
      { type: 'text', content: 'What is force ' },
      { type: 'inlineMath', content: 'F = ma' },
      { type: 'text', content: ' when mass is ' },
      { type: 'inlineMath', content: 'm' },
      { type: 'text', content: '?' },
    ]);
  });

  it('parses LaTeX vectors and symbols with and without dollar delimiters', () => {
    const tokensWithDollars = parseFormattedText('Particle with charge $q$ and velocity $\\vec{v}$');
    expect(tokensWithDollars).toEqual([
      { type: 'text', content: 'Particle with charge ' },
      { type: 'inlineMath', content: 'q' },
      { type: 'text', content: ' and velocity ' },
      { type: 'inlineMath', content: '\\vec{v}' },
    ]);

    const tokensWithoutDollars = parseFormattedText('Given \\vec{F} and frequency \\omega');
    expect(tokensWithoutDollars.some(t => t.type === 'inlineMath' && t.content === '\\vec{F}')).toBe(true);
    expect(tokensWithoutDollars.some(t => t.type === 'inlineMath' && t.content === '\\omega')).toBe(true);
  });

  it('parses bold text and code', () => {
    const tokens = parseFormattedText('Note: **Important** key `k = 1.38e-23`');
    expect(tokens).toEqual([
      { type: 'text', content: 'Note: ' },
      { type: 'bold', content: 'Important' },
      { type: 'text', content: ' key ' },
      { type: 'code', content: 'k = 1.38e-23' },
    ]);
  });

  it('handles empty or pure plain text', () => {
    expect(parseFormattedText('')).toEqual([]);
    expect(parseFormattedText('Newton Second Law')).toEqual([
      { type: 'text', content: 'Newton Second Law' },
    ]);
  });
});
