import React, { useRef, useState, useEffect } from 'react';
import { Eraser, RotateCcw, PenTool, Type } from 'lucide-react';

interface ScratchpadProps {
  onFormulaTyped?: (text: string) => void;
  className?: string;
}

export const Scratchpad: React.FC<ScratchpadProps> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typedFormula, setTypedFormula] = useState('');

  useEffect(() => {
    if (mode !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = tool === 'eraser' ? 20 : 2;
    ctx.strokeStyle = '#000000';
  }, [mode]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    ctx.lineWidth = tool === 'eraser' ? 24 : 2;
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#000000';
    }

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className={`glass-card rounded-2xl p-3 flex flex-col border border-black/10 shadow-xs ${className}`}>
      {/* Header with Tools */}
      <div className="flex items-center justify-between pb-2 border-b border-black/5 text-xs">
        <div className="flex items-center gap-1 bg-black/5 p-0.5 rounded-lg">
          <button
            onClick={() => setMode('draw')}
            className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
              mode === 'draw' ? 'bg-white text-black shadow-xs' : 'text-black/50'
            }`}
          >
            Draw
          </button>
          <button
            onClick={() => setMode('type')}
            className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
              mode === 'type' ? 'bg-white text-black shadow-xs' : 'text-black/50'
            }`}
          >
            Type
          </button>
        </div>

        {mode === 'draw' ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTool('pen')}
              className={`p-1.5 rounded-lg border text-xs cursor-pointer ${
                tool === 'pen' ? 'bg-black text-white border-black' : 'glass-button text-black'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setTool('eraser')}
              className={`p-1.5 rounded-lg border text-xs cursor-pointer ${
                tool === 'eraser' ? 'bg-black text-white border-black' : 'glass-button text-black'
              }`}
            >
              <Eraser className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={clearCanvas}
              className="p-1.5 rounded-lg glass-button text-black text-xs cursor-pointer"
              title="Clear"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          typedFormula && (
            <button
              onClick={() => setTypedFormula('')}
              className="text-xs text-black/50 hover:text-black cursor-pointer"
            >
              Clear
            </button>
          )
        )}
      </div>

      {/* Surface */}
      <div className="mt-2 relative flex-1 min-h-[140px] rounded-xl bg-white border border-black/10 overflow-hidden">
        {mode === 'draw' ? (
          <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            className="w-full h-full cursor-crosshair touch-none absolute inset-0"
          />
        ) : (
          <textarea
            value={typedFormula}
            onChange={(e) => setTypedFormula(e.target.value)}
            placeholder="Type formula (e.g. F = ma or \lambda = h/p)..."
            className="w-full h-full p-3 resize-none outline-none text-xs bg-transparent text-black placeholder:text-black/30"
          />
        )}
      </div>
    </div>
  );
};
