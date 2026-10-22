import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Eraser, RotateCcw, PenTool, Undo2 } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  tool: 'pen' | 'eraser';
  points: Point[];
}

interface ScratchpadProps {
  className?: string;
  onClose?: () => void;
}

/**
 * Pointer-Events Drawing Pad (5.13):
 * - pointerdown / pointermove / pointerup + setPointerCapture
 * - touch-action: none and overscroll-behavior: contain so page never scrolls or pulls-to-refresh
 * - Palm rejection for stylus (ignores touch pointers when pen pointer is active or recently used)
 * - devicePixelRatio scaling with stroke-stack Undo & Clear buttons (all >= 44x44px)
 */
export const Scratchpad: React.FC<ScratchpadProps> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const lastPenTimeRef = useRef<number>(0);

  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [strokeCount, setStrokeCount] = useState(0);

  const redrawAllStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const isDark =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const inkColor = isDark ? '#f5f7fa' : '#0f1115';

    const allStrokes = currentStrokeRef.current
      ? [...strokesRef.current, currentStrokeRef.current]
      : strokesRef.current;

    for (const stroke of allStrokes) {
      if (stroke.points.length === 0) continue;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke.tool === 'eraser' ? 22 : 2.25;
      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = inkColor;
      }

      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      if (stroke.points.length === 1) {
        ctx.lineTo(stroke.points[0].x + 0.1, stroke.points[0].y + 0.1);
      }
      ctx.stroke();
      ctx.restore();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      redrawAllStrokes();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [redrawAllStrokes]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Stylus palm rejection: if user is using a stylus, ignore simultaneous or immediate palm touch
    if (e.pointerType === 'pen') {
      lastPenTimeRef.current = Date.now();
    } else if (e.pointerType === 'touch') {
      if (Date.now() - lastPenTimeRef.current < 1800) {
        return;
      }
    }

    if (activePointerIdRef.current !== null && e.pointerType !== 'pen') {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore if unsupported in synthetic test env
    }

    const rect = canvas.getBoundingClientRect();
    const pt: Point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    activePointerIdRef.current = e.pointerId;
    currentStrokeRef.current = {
      tool,
      points: [pt],
    };
    redrawAllStrokes();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId || !currentStrokeRef.current) return;
    if (e.pointerType === 'pen') {
      lastPenTimeRef.current = Date.now();
    }

    e.preventDefault();
    e.stopPropagation();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    currentStrokeRef.current.points.push({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    redrawAllStrokes();
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const canvas = canvasRef.current;
    if (canvas) {
      try {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    }

    if (currentStrokeRef.current && currentStrokeRef.current.points.length > 0) {
      strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
      setStrokeCount(strokesRef.current.length);
    }
    currentStrokeRef.current = null;
    activePointerIdRef.current = null;
    redrawAllStrokes();
  };

  const handleUndoStroke = () => {
    if (strokesRef.current.length === 0) return;
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    redrawAllStrokes();
  };

  const handleClearCanvas = () => {
    strokesRef.current = [];
    currentStrokeRef.current = null;
    setStrokeCount(0);
    redrawAllStrokes();
  };

  return (
    <div
      className={`glass-panel rounded-2xl p-3 flex flex-col gap-2 overscroll-contain select-none ${className}`}
    >
      {/* Toolbar: all interactive targets >= 44x44px with 8px gap */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTool('pen')}
            aria-label="Pen tool"
            className={`min-h-[44px] min-w-[44px] px-3 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
              tool === 'pen' ? 'glass-button-primary' : 'glass-button'
            }`}
          >
            <PenTool className="w-4 h-4" />
            <span>Pen</span>
          </button>

          <button
            type="button"
            onClick={() => setTool('eraser')}
            aria-label="Eraser tool"
            className={`min-h-[44px] min-w-[44px] px-3 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
              tool === 'eraser' ? 'glass-button-primary' : 'glass-button'
            }`}
          >
            <Eraser className="w-4 h-4" />
            <span>Erase</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleUndoStroke}
            disabled={strokeCount === 0}
            aria-label="Undo stroke"
            className="glass-button min-h-[44px] min-w-[44px] px-3 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
          >
            <Undo2 className="w-4 h-4" />
            <span>Undo</span>
          </button>

          <button
            type="button"
            onClick={handleClearCanvas}
            disabled={strokeCount === 0}
            aria-label="Clear drawing pad"
            className="glass-button min-h-[44px] min-w-[44px] px-3 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Drawing Surface */}
      <div className="relative w-full h-44 rounded-xl bg-white/90 dark:bg-zinc-900/90 border border-black/15 dark:border-white/15 overflow-hidden touch-none overscroll-contain">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          className="w-full h-full block cursor-crosshair touch-none select-none"
        />
        {strokeCount === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-muted-contrast">
            Write formula or derivation here (stylus & finger supported)
          </div>
        )}
      </div>
    </div>
  );
};
