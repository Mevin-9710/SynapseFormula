import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Send,
  X,
  RotateCcw,
  Bot,
  User as UserIcon,
  Check,
  Move,
  Maximize2
} from 'lucide-react';
import { Flashcard } from '../types';
import { FormulaDisplay } from './FormulaDisplay';
import { FormattedText } from './FormattedText';

interface DoubtMessage {
  role: 'user' | 'model';
  text: string;
  target?: string;
}

interface RectBox {
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  w: number; // percentage 0-100
  h: number; // percentage 0-100
}

interface DoubtAssistantProps {
  deckTitle: string;
  card: Flashcard;
  allDeckCards?: Flashcard[];
  isRevealed: boolean;
  onClose: () => void;
}

export const DoubtAssistant: React.FC<DoubtAssistantProps> = ({
  deckTitle,
  card,
  allDeckCards = [],
  isRevealed,
  onClose,
}) => {
  // 4-Sided Selector Box (default over main formula area)
  const [selectorBox, setSelectorBox] = useState<RectBox>({
    x: 8,
    y: 20,
    w: 84,
    h: 55,
  });

  const [activePreset, setActivePreset] = useState<string>('Formula');
  const [selectedTargetLabel, setSelectedTargetLabel] = useState<string>('Main Formula');
  const [inputQuestion, setInputQuestion] = useState<string>('');
  const [messages, setMessages] = useState<DoubtMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Interaction dragging states for 4-sided selector
  const [isInteracting, setIsInteracting] = useState<boolean>(false);
  const interactionModeRef = useRef<'new' | 'move' | 'nw' | 'ne' | 'sw' | 'se' | null>(null);
  const startPointerRef = useRef<{ clientX: number; clientY: number; box: RectBox } | null>(null);
  const selectorContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Available symbols from card variables & formula
  const availableSymbols = [
    ...(card.variables?.map(v => v.symbol) || []),
    ...(card.formula ? [card.formula] : []),
  ].filter(Boolean);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Initial welcome message
  useEffect(() => {
    setMessages([
      {
        role: 'model',
        text: `Hello! I'm your AI Formula Tutor for **${deckTitle}**.\n\nUse the **4-sided selector** above to highlight any part of the formula or question you have a doubt about, or ask me directly below!`,
      },
    ]);
  }, [card.id, deckTitle]);

  // Preset positioning for the 4-sided selector
  const applyPreset = (presetName: string, targetLabel: string, box: RectBox) => {
    setActivePreset(presetName);
    setSelectedTargetLabel(targetLabel);
    setSelectorBox(box);
  };

  // Pointer drag events for 4-sided selector
  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: 'new' | 'move' | 'nw' | 'ne' | 'sw' | 'se' = 'new'
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const container = selectorContainerRef.current;
    if (!container) return;

    interactionModeRef.current = mode;
    startPointerRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      box: { ...selectorBox },
    };
    setIsInteracting(true);

    if (mode === 'new') {
      const rect = container.getBoundingClientRect();
      const startX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const startY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      setSelectorBox({
        x: startX,
        y: startY,
        w: 4,
        h: 4,
      });
      setSelectedTargetLabel('Custom 4-sided area');
      setActivePreset('custom');
    }

    // Capture pointer to handle dragging smoothly even outside container
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isInteracting || !startPointerRef.current || !selectorContainerRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const container = selectorContainerRef.current;
    const rect = container.getBoundingClientRect();
    const mode = interactionModeRef.current;
    const start = startPointerRef.current;

    const deltaX = ((e.clientX - start.clientX) / rect.width) * 100;
    const deltaY = ((e.clientY - start.clientY) / rect.height) * 100;

    if (mode === 'move') {
      const newX = Math.max(0, Math.min(100 - start.box.w, start.box.x + deltaX));
      const newY = Math.max(0, Math.min(100 - start.box.h, start.box.y + deltaY));
      setSelectorBox({
        x: Math.round(newX),
        y: Math.round(newY),
        w: start.box.w,
        h: start.box.h,
      });
    } else if (mode === 'new') {
      const curX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const curY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      const x = Math.min(start.box.x, curX);
      const y = Math.min(start.box.y, curY);
      const w = Math.max(4, Math.abs(curX - start.box.x));
      const h = Math.max(4, Math.abs(curY - start.box.y));
      setSelectorBox({
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      });
    } else if (mode === 'se') {
      const newW = Math.max(8, Math.min(100 - start.box.x, start.box.w + deltaX));
      const newH = Math.max(8, Math.min(100 - start.box.y, start.box.h + deltaY));
      setSelectorBox(prev => ({ ...prev, w: Math.round(newW), h: Math.round(newH) }));
    } else if (mode === 'nw') {
      const newX = Math.max(0, Math.min(start.box.x + start.box.w - 8, start.box.x + deltaX));
      const newY = Math.max(0, Math.min(start.box.y + start.box.h - 8, start.box.y + deltaY));
      const newW = start.box.w - (newX - start.box.x);
      const newH = start.box.h - (newY - start.box.y);
      setSelectorBox({ x: Math.round(newX), y: Math.round(newY), w: Math.round(newW), h: Math.round(newH) });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isInteracting) return;
    setIsInteracting(false);
    interactionModeRef.current = null;
    startPointerRef.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // Send question to AI Assistant
  const handleSendQuestion = async (customPrompt?: string) => {
    const questionText = (customPrompt || inputQuestion).trim();
    if (!questionText || isLoading) return;

    setInputQuestion('');
    const newHistory: DoubtMessage[] = [
      ...messages,
      { role: 'user', text: questionText, target: selectedTargetLabel },
    ];
    setMessages(newHistory);
    setIsLoading(true);

    try {
      const deckFormulasSummary = allDeckCards
        .filter(c => c.id !== card.id)
        .slice(0, 8)
        .map(c => `${c.statement}: ${c.formula}`);

      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckTitle,
          cardStatement: card.statement,
          cardFormula: card.formula,
          cardConditions: card.conditions,
          cardDerivation: card.derivation,
          cardExplanation: card.explanation,
          cardVariables: card.variables,
          deckFormulasSummary,
          circledTarget: selectedTargetLabel || 'Formula',
          question: questionText,
          chatHistory: newHistory.map(m => ({ role: m.role, text: m.text })),
        }),
      });

      const data = await res.json();
      if (data?.answer) {
        setMessages(prev => [
          ...prev,
          { role: 'model', text: data.answer },
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          { role: 'model', text: 'I examined your card and deck context. What specific term would you like me to clarify?' },
        ]);
      }
    } catch (err: any) {
      console.error('Failed to query assistant:', err);
      setMessages(prev => [
        ...prev,
        {
          role: 'model',
          text: `**Formula Guidance**: For $${card.formula}$, remember the validity conditions: ${card.conditions || 'Standard physics realm'}. Check the variable definitions in the card details!`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full space-y-4 pt-2">
      {/* 4-Sided Selector Container over Card Content */}
      <div className="p-3.5 rounded-2xl glass-card border border-blue-500/35 space-y-3">
        {/* Header & Quick Preset Selector */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-500 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-blue-500 block">
                4-Sided Doubt Selector
              </span>
              <span className="text-[12px] text-secondary-contrast">
                Drag anywhere to position the 4-sided box
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => applyPreset('Formula', 'Main Formula', { x: 8, y: 22, w: 84, h: 56 })}
              className="glass-button min-h-[30px] px-2.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
              title="Reset selector to center"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="glass-button min-h-[30px] px-2 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
              title="Exit Doubt Mode"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 4-Sided Interactive Drag Canvas & Card Area */}
        <div
          ref={selectorContainerRef}
          onPointerDown={e => handlePointerDown(e, 'new')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="relative min-h-[170px] rounded-xl overflow-hidden border border-black/15 dark:border-white/15 bg-white/95 dark:bg-zinc-900/95 p-4 select-none touch-none cursor-crosshair"
        >
          {/* Card Formula Display Beneath */}
          <div className="space-y-3 pointer-events-none">
            <div className="text-xs text-secondary-contrast font-medium">
              <FormattedText text={card.statement} />
            </div>
            <div className="py-2 px-3 text-center">
              <FormulaDisplay formula={card.formula} size="lg" />
            </div>
            {card.conditions && (
              <div className="text-[11px] text-secondary-contrast px-2 py-1 rounded bg-black/5 dark:bg-white/5">
                <strong>Conditions:</strong> <FormattedText text={card.conditions} />
              </div>
            )}
          </div>

          {/* The 4-Sided Rectangular Selector Box */}
          <div
            style={{
              left: `${selectorBox.x}%`,
              top: `${selectorBox.y}%`,
              width: `${selectorBox.w}%`,
              height: `${selectorBox.h}%`,
            }}
            onPointerDown={e => handlePointerDown(e, 'move')}
            className="absolute rounded-lg border-2 border-blue-500 bg-blue-500/15 shadow-[0_0_15px_rgba(59,130,246,0.35)] cursor-move transition-shadow"
          >
            {/* Top Side Label */}
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow flex items-center gap-1 pointer-events-none">
              <Move className="w-2.5 h-2.5" />
              <span>4-Sided Box: {selectedTargetLabel}</span>
            </div>

            {/* 4 Corner Handles for Precision Resizing */}
            <div
              onPointerDown={e => handlePointerDown(e, 'nw')}
              className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white dark:border-black cursor-nwse-resize shadow"
              title="Resize Top-Left"
            />
            <div
              onPointerDown={e => handlePointerDown(e, 'ne')}
              className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white dark:border-black cursor-nesw-resize shadow"
              title="Resize Top-Right"
            />
            <div
              onPointerDown={e => handlePointerDown(e, 'sw')}
              className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white dark:border-black cursor-nesw-resize shadow"
              title="Resize Bottom-Left"
            />
            <div
              onPointerDown={e => handlePointerDown(e, 'se')}
              className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white dark:border-black cursor-nwse-resize shadow"
              title="Resize Bottom-Right"
            />
          </div>
        </div>

        {/* Quick Snap Chips for the 4-Sided Box */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold text-secondary-contrast uppercase tracking-wider block">
            Snap 4-Sided Selector to:
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => applyPreset('Formula', 'Main Formula', { x: 8, y: 22, w: 84, h: 56 })}
              className={`min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                activePreset === 'Formula'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'glass-button text-foreground'
              }`}
            >
              <span>Main Formula</span>
              {activePreset === 'Formula' && <Check className="w-3 h-3" />}
            </button>

            <button
              type="button"
              onClick={() => applyPreset('Statement', 'Question Statement', { x: 4, y: 4, w: 92, h: 32 })}
              className={`min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                activePreset === 'Statement'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'glass-button text-foreground'
              }`}
            >
              <span>Question</span>
              {activePreset === 'Statement' && <Check className="w-3 h-3" />}
            </button>

            {availableSymbols.map((sym, idx) => {
              const isSelected = activePreset === sym;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => applyPreset(sym, `Symbol: ${sym}`, { x: 20 + (idx * 15) % 50, y: 25, w: 40, h: 45 })}
                  className={`min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'glass-button text-foreground'
                  }`}
                >
                  <FormulaDisplay formula={sym} displayMode={false} size="xs" />
                  {isSelected && <Check className="w-3 h-3 ml-0.5" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* AI Assistant Chat & Input Area Below Card */}
      <div className="p-3.5 rounded-2xl glass-card space-y-3">
        {/* Chat Messages with LaTeX and Markdown Rendering */}
        <div className="max-h-[260px] overflow-y-auto space-y-3 pr-1 text-[14px]">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'model' && (
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5" />
                </div>
              )}
              <div
                className={`p-3 rounded-2xl max-w-[88%] leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-none'
                    : 'bg-black/5 dark:bg-white/10 rounded-bl-none text-foreground'
                }`}
              >
                {m.target && m.role === 'user' && (
                  <div className="text-[11px] opacity-80 pb-1 mb-1 border-b border-white/20 font-mono">
                    Target: {m.target}
                  </div>
                )}
                <FormattedText text={m.text} />
              </div>
              {m.role === 'user' && (
                <div className="w-6 h-6 rounded-full bg-black/10 dark:bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
                  <UserIcon className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-2.5 items-center text-secondary-contrast text-xs">
              <Bot className="w-4 h-4 text-blue-500 animate-spin" />
              <span>Analyzing selection with {deckTitle} deck context...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleSendQuestion(`What does the selected area physically represent in this formula?`)}
            className="glass-button min-h-[30px] px-2.5 rounded-lg whitespace-nowrap text-secondary-contrast hover:text-foreground cursor-pointer shrink-0"
          >
            Explain meaning
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleSendQuestion(`Why is this term formatted/squared this way in the formula?`)}
            className="glass-button min-h-[30px] px-2.5 rounded-lg whitespace-nowrap text-secondary-contrast hover:text-foreground cursor-pointer shrink-0"
          >
            Why this power/sign?
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleSendQuestion('How is this formula derived step-by-step?')}
            className="glass-button min-h-[30px] px-2.5 rounded-lg whitespace-nowrap text-secondary-contrast hover:text-foreground cursor-pointer shrink-0"
          >
            Derivation
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleSendQuestion('What are the units and validity limits?')}
            className="glass-button min-h-[30px] px-2.5 rounded-lg whitespace-nowrap text-secondary-contrast hover:text-foreground cursor-pointer shrink-0"
          >
            Units & limits
          </button>
        </div>

        {/* Input Text Box & Send Button */}
        <form
          onSubmit={e => {
            e.preventDefault();
            handleSendQuestion();
          }}
          className="flex items-center gap-2 pt-1"
        >
          <input
            type="text"
            value={inputQuestion}
            onChange={e => setInputQuestion(e.target.value)}
            placeholder={`Ask about ${selectedTargetLabel}...`}
            className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!inputQuestion.trim() || isLoading}
            className="glass-button-primary min-h-[44px] min-w-[44px] px-3 rounded-xl font-bold flex items-center justify-center cursor-pointer disabled:opacity-50"
            title="Send doubt to AI Assistant"
            aria-label="Send doubt"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Done / Return to Review Button */}
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={onClose}
            className="glass-button min-h-[38px] px-4 rounded-xl text-xs font-bold text-secondary-contrast hover:text-foreground cursor-pointer"
          >
            Done with Doubt · Return to Flashcards
          </button>
        </div>
      </div>
    </div>
  );
};
export default DoubtAssistant;
