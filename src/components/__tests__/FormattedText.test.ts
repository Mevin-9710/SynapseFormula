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

  it('parses screenshot 1 question with reduced mass and relative separation speed', () => {
    const q = 'energy, the energy equates that of the *reduced mass* \\mu moving at the *relative separation speed* v_{\\text{rel}}.';
    const tokens = parseFormattedText(q);
    
    // Check that *reduced mass* is italic
    expect(tokens.some(t => t.type === 'italic' && t.content === 'reduced mass')).toBe(true);
    // Check that \mu is math
    expect(tokens.some(t => t.type === 'inlineMath' && t.content === '\\mu')).toBe(true);
    // Check that *relative separation speed* is italic
    expect(tokens.some(t => t.type === 'italic' && t.content === 'relative separation speed')).toBe(true);
    // Check that v_{\text{rel}} is math
    expect(tokens.some(t => t.type === 'inlineMath' && t.content.includes('v_{\\text{rel}}'))).toBe(true);
  });

  it('parses screenshot 2 derivation with equations, subscripts, and fractions', () => {
    const deriv = 'From m1 v1 = m2 v2 = p, v_{\\text{rel}} = v1 + v2 = p/\\mu and K = p^2/(2m1) + p^2/(2m2) = p^2/(2\\mu) = \\frac{1}{2} \\mu v_{\\text{rel}}^2.';
    const tokens = parseFormattedText(deriv);

    // v_{\text{rel}} = v1 + v2 = p/\mu must be parsed as math
    expect(tokens.some(t => t.type === 'inlineMath' && t.content.includes('v_{\\text{rel}}'))).toBe(true);
    // K = ... = \frac{1}{2} \mu v_{\text{rel}}^2 must be parsed as math
    expect(tokens.some(t => t.type === 'inlineMath' && t.content.includes('\\frac{1}{2}'))).toBe(true);
  });

  it('parses variables with subscripts and superscripts', () => {
    const tokens = parseFormattedText('Let v_{\\text{rel}} and v_{\\text{rel}}^2 be given with m_1 and p^2');
    expect(tokens.some(t => t.type === 'inlineMath' && t.content === 'v_{\\text{rel}}')).toBe(true);
    expect(tokens.some(t => t.type === 'inlineMath' && t.content === 'v_{\\text{rel}}^2')).toBe(true);
    expect(tokens.some(t => t.type === 'inlineMath' && t.content === 'm_1')).toBe(true);
    expect(tokens.some(t => t.type === 'inlineMath' && t.content === 'p^2')).toBe(true);
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

  it('parses AI response with formulas and bold headers', () => {
    const aiText = '### Analysis for circled part: `v_{\\text{rel}}`\n\n- **Physical Meaning**: Magnitude of relative velocity between fragments\n- **Governing Formula**: $K = \\frac{1}{2} \\mu v_{\\text{rel}}^2$\n\nNotice that $\\mu$ is the reduced mass.';
    const tokens = parseFormattedText(aiText);
    expect(tokens.some(t => t.type === 'inlineMath' && t.content.includes('\\frac{1}{2}'))).toBe(true);
    expect(tokens.some(t => t.type === 'inlineMath' && t.content.includes('\\mu'))).toBe(true);
    expect(tokens.some(t => t.type === 'bold')).toBe(true);
  });
});
