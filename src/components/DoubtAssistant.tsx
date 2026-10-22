import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Send,
  X,
  RotateCcw,
  Bot,
  User as UserIcon,
  HelpCircle,
  Check,
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
  const [circledTarget, setCircledTarget] = useState<string>('');
  const [inputQuestion, setInputQuestion] = useState<string>('');
  const [messages, setMessages] = useState<DoubtMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [hasDrawnCircle, setHasDrawnCircle] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Available symbols from card variables & formula for 1-tap targeting
  const availableSymbols = [
    ...(card.variables?.map(v => v.symbol) || []),
    ...(card.formula ? [card.formula] : []),
  ].filter(Boolean);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Set initial welcome prompt
  useEffect(() => {
    const initialTarget = card.variables?.[0]?.symbol || 'formula';
    setCircledTarget(initialTarget);
    setMessages([
      {
        role: 'model',
        text: `Hello! I'm your AI Formula Tutor for **${deckTitle}**.\n\nYou can **circle with your finger/mouse** on the card above, or tap any symbol chip to target what you have a doubt about. What would you like help understanding?`,
      },
    ]);
  }, [card.id, deckTitle]);

  // Canvas drawing handlers for freehand circling
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    setIsDrawing(true);
    setHasDrawnCircle(true);
    pointsRef.current = [{ x, y }];

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    pointsRef.current.push({ x, y });

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Connect end to start to form a closed circle loop
    if (pointsRef.current.length > 2) {
      const first = pointsRef.current[0];
      ctx.lineTo(first.x, first.y);
      ctx.stroke();

      // Soft semi-transparent highlight fill
      ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
      ctx.fill();

      // Set target description
      if (!circledTarget || circledTarget === 'formula') {
        setCircledTarget(card.variables?.[0]?.symbol || 'Selected part of formula');
      }
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    pointsRef.current = [];
    setHasDrawnCircle(false);
  };

  const handleSendQuestion = async (customPrompt?: string) => {
    const questionText = (customPrompt || inputQuestion).trim();
    if (!questionText || isLoading) return;

    setInputQuestion('');
    const newHistory: DoubtMessage[] = [
      ...messages,
      { role: 'user', text: questionText, target: circledTarget },
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
          circledTarget: circledTarget || 'Formula',
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
          { role: 'model', text: 'I examined your card and deck context. Please ask again or specify which variable you need explained!' },
        ]);
      }
    } catch (err: any) {
      console.error('Failed to query assistant:', err);
      setMessages(prev => [
        ...prev,
        {
          role: 'model',
          text: `**Formula Guidance**: For $${card.formula}$, remember the validity conditions: ${card.conditions || 'Standard physics realm'}. Check the variable definitions in the card details above!`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full space-y-4 pt-2">
      {/* Circling Canvas Overlay & Symbol Selector Bar */}
      <div className="p-3.5 rounded-2xl glass-card border border-blue-500/30 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-500 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-blue-500 block">
                Circle Your Doubt
              </span>
              <span className="text-[12px] text-secondary-contrast">
                Draw a loop on the formula or pick a target symbol
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {hasDrawnCircle && (
              <button
                type="button"
                onClick={clearCanvas}
                className="glass-button min-h-[32px] px-2.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                title="Clear drawn circle"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Re-circle</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="glass-button min-h-[32px] px-2 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
              title="Close assistant"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Circling Canvas over Card Formula */}
        <div className="relative rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-white/90 dark:bg-zinc-900/90 py-3 px-2 text-center select-none touch-none">
          <canvas
            ref={canvasRef}
            width={400}
            height={110}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            className="absolute inset-0 w-full h-full z-10 cursor-crosshair"
          />
          <div className="pointer-events-none relative z-0 py-1">
            <FormulaDisplay formula={card.formula} size="lg" />
          </div>
          {!hasDrawnCircle && (
            <div className="pointer-events-none absolute bottom-1 right-2 z-20 text-[10px] font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full">
              Draw circle here
            </div>
          )}
        </div>

        {/* Quick Target Chips */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold text-secondary-contrast uppercase tracking-wider block">
            Targeting Symbol / Term:
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {availableSymbols.map((sym, idx) => {
              const isSelected = circledTarget === sym;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCircledTarget(sym)}
                  className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
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
            <button
              type="button"
              onClick={() => setCircledTarget('Derivation and proof')}
              className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                circledTarget === 'Derivation and proof'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'glass-button text-foreground'
              }`}
            >
              Derivation
            </button>
          </div>
        </div>
      </div>

      {/* AI Chatbot Area */}
      <div className="p-3.5 rounded-2xl glass-card space-y-3">
        {/* Chat Messages */}
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
                    : 'bg-black/5 dark:bg-white/10 rounded-bl-none'
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
              <span>Analyzing formula with {deckTitle} deck context...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleSendQuestion(`What does ${circledTarget || 'this variable'} physically represent?`)}
            className="glass-button min-h-[30px] px-2.5 rounded-lg whitespace-nowrap text-secondary-contrast hover:text-foreground cursor-pointer shrink-0"
          >
            Explain meaning
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleSendQuestion(`Why is ${circledTarget || 'this term'} formatted/squared this way in the formula?`)}
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
            placeholder={`Ask about ${circledTarget || 'this formula'}...`}
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
