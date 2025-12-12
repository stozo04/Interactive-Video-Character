import React, { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { WhiteboardAction } from '../services/whiteboardModes';

// ============================================================================
// TYPES
// ============================================================================

export type DrawingTool = 'pen' | 'highlighter' | 'marker' | 'eraser';
export type WhiteboardMode = 'freeform' | 'tictactoe' | 'pictionary';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  tool: DrawingTool;
  color: string;
  filled?: boolean;
}

type TextStyle = 'handwriting' | 'bold' | 'fancy' | 'playful' | 'chalk';

interface TextElement {
  id: string;
  text: string;
  x: number; // percentage (0-100)
  y: number; // percentage (0-100)
  color: string;
  size: number; // percentage (0-100)
  style: TextStyle;
}

interface TextAnimState {
  currentCharIndex: number; // which character is currently being "drawn"
  charDrawProgress: number; // 0-100, how much of current char is drawn (top to bottom)
  isAnimating: boolean;
}

// Font configurations for different text styles
const TEXT_STYLE_FONTS: Record<TextStyle, string> = {
  handwriting: '"Comic Sans MS", "Marker Felt", cursive',
  bold: '"Impact", "Arial Black", sans-serif',
  fancy: '"Brush Script MT", "Lucida Handwriting", cursive',
  playful: '"Fredoka One", "Bubblegum Sans", "Comic Sans MS", cursive',
  chalk: '"Chalkduster", "Comic Sans MS", cursive'
};


interface ToolConfig {
  name: string;
  icon: string;
  strokeWidth: number;
  opacity: number;
}

const TOOL_CONFIGS: Record<DrawingTool, ToolConfig> = {
  pen: { name: 'Pen', icon: '🖊️', strokeWidth: 3, opacity: 1.0 },
  highlighter: { name: 'Highlighter', icon: '🖍️', strokeWidth: 25, opacity: 0.4 },
  marker: { name: 'Marker', icon: '🖌️', strokeWidth: 10, opacity: 1.0 },
  eraser: { name: 'Eraser', icon: '🧹', strokeWidth: 20, opacity: 1.0 },
};

const DEFAULT_COLORS = [
  '#000000', // Black
  '#FFFFFF', // White
  '#FF3B30', // Red
  '#FF9500', // Orange
  '#FFCC00', // Yellow
  '#34C759', // Green
  '#007AFF', // Blue
  '#AF52DE', // Purple
  '#FF2D55', // Pink
];

const MAX_UNDO_SNAPSHOTS = 50;

// Human-like AI stroke reveal timing.
// We animate with a predictable total "time budget" so a fast model response
// doesn't still feel like it takes forever before anything useful appears.
const AI_TOTAL_STROKE_TIME_MS = 1400;       // total time across all strokes (excludes pauses)
const AI_MIN_STROKE_TIME_MS = 220;          // per-stroke minimum time
const AI_MAX_STROKE_TIME_MS = 900;          // per-stroke cap time
const AI_PAUSE_BETWEEN_STROKES_MS = 140;    // small pause between strokes

function parseColorToHexOrFallback(color?: string, fallback: string = '#007AFF') {
  if (!color) return fallback;
  // Canvas supports CSS color names; keep as-is unless it's "gold" (inconsistent across browsers)
  if (color.toLowerCase() === 'gold') return '#FFD700';
  return color;
}

function makeHeartPoints(cx: number, cy: number, sizePx: number, steps: number = 140): Point[] {
  // Parametric heart curve (scaled to sizePx)
  // x = 16 sin^3 t
  // y = 13 cos t - 5 cos 2t - 2 cos 3t - cos 4t
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);

    // Normalize rough bounds (~[-16..16], ~[-17..13])
    const nx = x / 16;
    const ny = -y / 17; // invert so heart points down in canvas coordinates

    pts.push({
      x: cx + nx * sizePx,
      y: cy + ny * sizePx,
    });
  }
  return pts;
}

function looksLikeHeartPolygon(points: Array<{ x: number; y: number }>, centerX: number, centerY: number) {
  if (points.length < 6 || points.length > 12) return false;
  const first = points[0];
  const last = points[points.length - 1];
  const closed = Math.hypot(first.x - last.x, first.y - last.y) < 2.5;
  if (!closed) return false;

  let minX = points[0].x, maxX = points[0].x, minY = points[0].y, maxY = points[0].y;
  let minYPt = points[0], maxYPt = points[0], minXPt = points[0], maxXPt = points[0];
  for (const p of points) {
    if (p.x < minX) { minX = p.x; minXPt = p; }
    if (p.x > maxX) { maxX = p.x; maxXPt = p; }
    if (p.y < minY) { minY = p.y; minYPt = p; }
    if (p.y > maxY) { maxY = p.y; maxYPt = p; }
  }

  // Heart-ish polygons often have top and bottom points near center X.
  const topCentered = Math.abs(minYPt.x - centerX) < 6;
  const bottomCentered = Math.abs(maxYPt.x - centerX) < 6;

  // And left/right roughly symmetric around center X.
  const leftRightSym = Math.abs((centerX - minX) - (maxX - centerX)) < 8;

  // And a decent vertical span
  const tallEnough = (maxY - minY) > 10;

  // Plus left/right extremes are not at extreme top/bottom (avoid triangles/diamonds)
  const lrNotAtExtremes =
    Math.abs(minXPt.y - centerY) < (maxY - minY) * 0.6 &&
    Math.abs(maxXPt.y - centerY) < (maxY - minY) * 0.6;

  return topCentered && bottomCentered && leftRightSym && tallEnough && lrNotAtExtremes;
}

// ============================================================================
// WHITEBOARD COMPONENT
// ============================================================================

interface WhiteboardProps {
  mode?: WhiteboardMode;
  onCapture?: (base64: string, message?: string) => void;
  disabled?: boolean;
  aiDrawingAction?: WhiteboardAction | null;
  onAiDrawingComplete?: () => void;
}

export interface WhiteboardHandle {
  capture: () => string | null;
}

export const Whiteboard = forwardRef<WhiteboardHandle, WhiteboardProps>(({
  mode = 'freeform',
  onCapture,
  disabled = false,
  aiDrawingAction,
  onAiDrawingComplete,
}, ref) => {
  const WB_DEBUG =
    typeof window !== 'undefined' &&
    window.localStorage?.getItem('debug:whiteboard') === '1';
  const wbNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const wbLog = (...args: any[]) => {
    if (WB_DEBUG) console.log(...args);
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Drawing state
  const [currentTool, setCurrentTool] = useState<DrawingTool>('pen');
  const [currentColor, setCurrentColor] = useState('#000000');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  // Undo stack now stores complete canvas state (strokes + text)
  const [undoStack, setUndoStack] = useState<{ strokes: Stroke[]; textElements: TextElement[] }[]>([]);
  const [textElements, setTextElements] = useState<TextElement[]>([]);
  
  // Canvas dimensions
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 400 });

  // Refs to avoid stale closures + reduce render churn during drawing
  const strokesRef = useRef<Stroke[]>([]);
  const textElementsRef = useRef<TextElement[]>([]);
  const currentToolRef = useRef<DrawingTool>('pen');
  const currentColorRef = useRef<string>('#000000');
  const canvasSizeRef = useRef(canvasSize);
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<Point[]>([]);
  const renderRafRef = useRef<number | null>(null);
  const textAnimRafRef = useRef<number | null>(null);
  const textAnimLastTsRef = useRef<number | null>(null);
  const textAnimStateRef = useRef<Record<string, TextAnimState>>({});

  // AI stroke animation (separate from user drawing)
  const aiPreviewStrokesRef = useRef<Stroke[]>([]);
  const aiStrokeRafRef = useRef<number | null>(null);
  const aiStrokeLastTsRef = useRef<number | null>(null);
  const aiStrokeHoldUntilRef = useRef<number | null>(null);
  const aiStrokeQueueRef = useRef<Array<{ full: Stroke; progress: number; pointsPerMs: number }>>([]);
  const aiAnimStartedAtRef = useRef<number | null>(null);

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { textElementsRef.current = textElements; }, [textElements]);
  useEffect(() => { currentToolRef.current = currentTool; }, [currentTool]);
  useEffect(() => { currentColorRef.current = currentColor; }, [currentColor]);
  useEffect(() => { canvasSizeRef.current = canvasSize; }, [canvasSize]);

  const pushUndoSnapshot = useCallback(() => {
    const snapshot = {
      strokes: [...strokesRef.current],
      textElements: [...textElementsRef.current],
    };
    setUndoStack(prev => {
      const next = [...prev, snapshot];
      return next.length > MAX_UNDO_SNAPSHOTS ? next.slice(next.length - MAX_UNDO_SNAPSHOTS) : next;
    });
  }, []);

  // ============================================================================
  // CANVAS SETUP & RESIZE
  // ============================================================================

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Leave room for toolbar
        setCanvasSize({
          width: Math.floor(rect.width - 20),
          height: Math.floor(Math.min(rect.height - 80, 500)),
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // ============================================================================
  // DRAWING LOGIC
  // ============================================================================

  const getCanvasCoordinates = useCallback((e: React.MouseEvent | React.TouchEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();

    // Canvas backing store is DPR-scaled (canvas.width/height), but we render in CSS pixels
    // via ctx.setTransform(dpr, 0, 0, dpr, 0, 0). Therefore pointer coordinates must be
    // converted from screen/CSS space to *canvas CSS pixel space*.
    //
    // Using rect->css scaling makes this robust even if the canvas is visually scaled
    // (e.g. zoom, transforms, fractional layout sizing).
    const { width: cssW, height: cssH } = canvasSizeRef.current;
    const scaleX = rect.width > 0 ? cssW / rect.width : 1;
    const scaleY = rect.height > 0 ? cssH / rect.height : 1;

    if ('touches' in e) {
      const touch = e.touches[0] ?? e.changedTouches?.[0];
      if (!touch) return null;
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width: cssW, height: cssH } = canvasSizeRef.current;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    // Ensure canvas is sized for DPR (backing store) but drawn in CSS pixels
    const desiredW = Math.floor(cssW * dpr);
    const desiredH = Math.floor(cssH * dpr);
    if (canvas.width !== desiredW || canvas.height !== desiredH) {
      canvas.width = desiredW;
      canvas.height = desiredH;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear canvas with white background
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cssW, cssH);

    // Draw grid overlay for Tic-Tac-Toe mode
    if (mode === 'tictactoe') {
      ctx.strokeStyle = '#E0E0E0';
      ctx.lineWidth = 3;

      const cellWidth = cssW / 3;
      const cellHeight = cssH / 3;

      ctx.beginPath();
      // Vertical lines
      ctx.moveTo(cellWidth, 0);
      ctx.lineTo(cellWidth, cssH);
      ctx.moveTo(cellWidth * 2, 0);
      ctx.lineTo(cellWidth * 2, cssH);
      // Horizontal lines
      ctx.moveTo(0, cellHeight);
      ctx.lineTo(cssW, cellHeight);
      ctx.moveTo(0, cellHeight * 2);
      ctx.lineTo(cssW, cellHeight * 2);
      ctx.stroke();
    }

    const drawStrokeToContext = (stroke: Stroke) => {
      if (stroke.points.length < 2) return;

      const config = TOOL_CONFIGS[stroke.tool];
      ctx.globalAlpha = config.opacity;
      ctx.lineWidth = config.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
      }

      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }

      // For filled shapes, ensure the path is closed before fill.
      if (stroke.filled && stroke.tool !== 'eraser') {
        ctx.closePath();
      }

      ctx.stroke();

      if (stroke.filled && stroke.tool !== 'eraser') {
        ctx.fillStyle = stroke.color;
        ctx.fill();
      }
    };

    // Render saved strokes
    strokesRef.current.forEach(drawStrokeToContext);

    // Render in-progress stroke (stored in ref to avoid React re-render per move)
    if (currentStrokeRef.current.length > 1) {
      drawStrokeToContext({
        points: currentStrokeRef.current,
        tool: currentToolRef.current,
        color: currentColorRef.current,
      });
    }

    // Render in-progress AI strokes (animated reveal)
    aiPreviewStrokesRef.current.forEach(drawStrokeToContext);

    // Reset composite operation
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Render text elements with character-by-character "drawing" animation
    textElementsRef.current.forEach(textEl => {
      const x = (textEl.x / 100) * cssW;
      const y = (textEl.y / 100) * cssH;
      const fontSize = Math.max(24, (textEl.size / 100) * cssH * 1.5);

      const fontFamily = TEXT_STYLE_FONTS[textEl.style] || TEXT_STYLE_FONTS.handwriting;
      ctx.font = `bold ${fontSize}px ${fontFamily}`;

      const anim = textAnimStateRef.current[textEl.id] || {
        currentCharIndex: textEl.text.length,
        charDrawProgress: 100,
        isAnimating: false,
      };

      // Calculate the full text width for centering
      const fullTextWidth = ctx.measureText(textEl.text).width;
      const textLeftEdge = x - fullTextWidth / 2;

      let currentX = textLeftEdge;

      for (let i = 0; i < textEl.text.length; i++) {
        const char = textEl.text[i];
        const charWidth = ctx.measureText(char).width;

        if (i < anim.currentCharIndex) {
          ctx.fillStyle = textEl.color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(char, currentX, y);
        } else if (i === anim.currentCharIndex && anim.isAnimating) {
          ctx.save();

          const revealHeight = (anim.charDrawProgress / 100) * fontSize * 2;
          ctx.beginPath();
          ctx.rect(currentX - 2, y - fontSize, charWidth + 4, revealHeight);
          ctx.clip();

          ctx.fillStyle = textEl.color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(char, currentX, y);
          ctx.restore();

          // Pen tip
          const strokePhase = (anim.charDrawProgress / 100) * Math.PI * 3;
          const baseY = y - fontSize + revealHeight;
          const oscillation = Math.sin(strokePhase) * (fontSize * 0.15);
          const penY = baseY + oscillation;
          const penX = currentX + (anim.charDrawProgress / 100) * charWidth;

          ctx.fillStyle = textEl.color;
          ctx.beginPath();
          ctx.arc(penX, penY, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          ctx.arc(penX - 3, penY - oscillation * 0.5, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        currentX += charWidth;
      }
    });
  }, [mode]);

  const scheduleRender = useCallback(() => {
    if (renderRafRef.current != null) return;
    renderRafRef.current = window.requestAnimationFrame(() => {
      renderRafRef.current = null;
      renderCanvas();
    });
  }, [renderCanvas]);

  const cancelAiStrokeAnimation = useCallback(() => {
    if (aiStrokeRafRef.current != null) {
      window.cancelAnimationFrame(aiStrokeRafRef.current);
      aiStrokeRafRef.current = null;
    }
    aiStrokeLastTsRef.current = null;
    aiStrokeHoldUntilRef.current = null;
    aiStrokeQueueRef.current = [];
    aiPreviewStrokesRef.current = [];
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    e.preventDefault();

    const point = getCanvasCoordinates(e);
    if (!point) return;

    isDrawingRef.current = true;
    currentStrokeRef.current = [point];
    scheduleRender();
  }, [disabled, getCanvasCoordinates, scheduleRender]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current || disabled) return;
    e.preventDefault();

    const point = getCanvasCoordinates(e);
    if (!point) return;

    currentStrokeRef.current.push(point);
    scheduleRender();
  }, [disabled, getCanvasCoordinates, scheduleRender]);

  const stopDrawing = useCallback(() => {
    if (!isDrawingRef.current) return;

    const points = currentStrokeRef.current;
    if (points.length > 0) {
      const newStroke: Stroke = {
        points: [...points],
        tool: currentToolRef.current,
        color: currentColorRef.current,
      };

      pushUndoSnapshot();
      setStrokes(prev => [...prev, newStroke]);
    }

    isDrawingRef.current = false;
    currentStrokeRef.current = [];
    scheduleRender();
  }, [pushUndoSnapshot, scheduleRender]);

  // ============================================================================
  // RENDERING
  // ============================================================================

  useEffect(() => {
    scheduleRender();
  }, [scheduleRender, strokes, textElements, mode, canvasSize]);

  // ============================================================================
  // WRITING ANIMATION FOR TEXT ELEMENTS (Character by Character)
  // ============================================================================
  
  const stepTextAnimation = useCallback((ts: number) => {
    const last = textAnimLastTsRef.current ?? ts;
    const deltaMs = Math.min(50, Math.max(0, ts - last)); // clamp to avoid big jumps
    textAnimLastTsRef.current = ts;

    const progressPerMs = 0.15; // ~0.666s per character at 60fps equivalent

    let anyAnimating = false;
    const elements = textElementsRef.current;

    for (const el of elements) {
      const anim = textAnimStateRef.current[el.id];
      if (!anim?.isAnimating) continue;

      anyAnimating = true;
      const newProgress = anim.charDrawProgress + deltaMs * progressPerMs;

      if (newProgress >= 100) {
        const nextCharIndex = anim.currentCharIndex + 1;
        if (nextCharIndex >= el.text.length) {
          textAnimStateRef.current[el.id] = {
            currentCharIndex: el.text.length,
            charDrawProgress: 100,
            isAnimating: false,
          };
        } else {
          textAnimStateRef.current[el.id] = {
            ...anim,
            currentCharIndex: nextCharIndex,
            charDrawProgress: 0,
            isAnimating: true,
          };
        }
      } else {
        anim.charDrawProgress = newProgress;
      }
    }

    scheduleRender();

    if (anyAnimating) {
      textAnimRafRef.current = window.requestAnimationFrame(stepTextAnimation);
    } else {
      textAnimRafRef.current = null;
      textAnimLastTsRef.current = null;
    }
  }, [scheduleRender]);

  useEffect(() => {
    const hasAnimating = Object.values(textAnimStateRef.current).some(s => (s as TextAnimState | undefined)?.isAnimating);
    if (hasAnimating && textAnimRafRef.current == null) {
      textAnimRafRef.current = window.requestAnimationFrame(stepTextAnimation);
    }

    return () => {
      if (textAnimRafRef.current != null) {
        window.cancelAnimationFrame(textAnimRafRef.current);
        textAnimRafRef.current = null;
      }
      textAnimLastTsRef.current = null;
    };
  }, [stepTextAnimation, textElements]);

  // ============================================================================
  // AI DRAWING (for Tic-Tac-Toe)
  // ============================================================================

  const stepAiStrokeAnimation = useCallback((ts: number) => {
    const holdUntil = aiStrokeHoldUntilRef.current;
    if (holdUntil != null && ts < holdUntil) {
      scheduleRender();
      return;
    }

    const last = aiStrokeLastTsRef.current ?? ts;
    const deltaMs = Math.min(50, Math.max(0, ts - last));
    aiStrokeLastTsRef.current = ts;

    const queue = aiStrokeQueueRef.current;
    if (queue.length === 0) {
      // Nothing to animate.
      aiStrokeLastTsRef.current = null;
      aiStrokeHoldUntilRef.current = null;
      return;
    }

    const current = queue[0];
    const fullPoints = current.full.points;

    // Reveal points gradually. Ensure at least 1 point per frame to keep it moving.
    const advance = Math.max(1, Math.floor(deltaMs * current.pointsPerMs));
    current.progress = Math.min(fullPoints.length, current.progress + advance);

    // Ensure preview strokes array matches queue length.
    if (aiPreviewStrokesRef.current.length !== queue.length) {
      aiPreviewStrokesRef.current = queue.map(q => ({ ...q.full, points: q.full.points.slice(0, 1) }));
    }

    // Update the first preview stroke points (mutate is fine; this is ref-driven rendering)
    aiPreviewStrokesRef.current[0] = {
      ...aiPreviewStrokesRef.current[0],
      points: fullPoints.slice(0, current.progress),
    };

    // If the current stroke is finished, move to next after a small pause.
    if (current.progress >= fullPoints.length) {
      // Lock it to full points
      aiPreviewStrokesRef.current[0] = { ...current.full, points: fullPoints };

      // Remove completed stroke from queue and preview, then pause
      queue.shift();
      aiPreviewStrokesRef.current.shift();
      aiStrokeHoldUntilRef.current = ts + AI_PAUSE_BETWEEN_STROKES_MS;
    }

    scheduleRender();
  }, [scheduleRender]);

  const estimateStrokeLengthPx = useCallback((pts: Point[]) => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
  }, []);

  const startAiStrokeAnimation = useCallback((strokesToAnimate: Stroke[], onDone: () => void) => {
    cancelAiStrokeAnimation();

    aiAnimStartedAtRef.current = wbNow();
    const lengths = strokesToAnimate.map(s => estimateStrokeLengthPx(s.points));
    const totalLen = lengths.reduce((a, b) => a + b, 0);

    // Allocate a time budget proportionally by stroke length.
    // If totalLen is tiny (e.g. small rect), fall back to equal weights.
    const weights = totalLen > 0.001
      ? lengths.map(l => l / totalLen)
      : strokesToAnimate.map(() => 1 / Math.max(1, strokesToAnimate.length));

    // Initialize queue with per-stroke points/ms derived from the allocated time.
    aiStrokeQueueRef.current = strokesToAnimate.map((s, idx) => {
      const allocatedMs = Math.max(
        AI_MIN_STROKE_TIME_MS,
        Math.min(AI_MAX_STROKE_TIME_MS, AI_TOTAL_STROKE_TIME_MS * weights[idx]),
      );
      const pointsPerMs = s.points.length / Math.max(1, allocatedMs);
      wbLog('✍️ [Whiteboard] AI stroke budget', {
        idx,
        points: s.points.length,
        lenPx: Math.round(lengths[idx]),
        allocatedMs: Math.round(allocatedMs),
        pointsPerMs: Number(pointsPerMs.toFixed(3)),
        filled: !!s.filled,
      });
      return {
        full: s,
        progress: Math.min(1, s.points.length),
        pointsPerMs,
      };
    });

    aiPreviewStrokesRef.current = strokesToAnimate.map(s => ({
      ...s,
      points: s.points.slice(0, Math.min(1, s.points.length)),
    }));

    // RAF loop
    const tick = (ts: number) => {
      stepAiStrokeAnimation(ts);

      if (aiStrokeQueueRef.current.length === 0) {
        aiPreviewStrokesRef.current = [];
        scheduleRender();
        onDone();
        wbLog('✍️ [Whiteboard] AI stroke animation done', {
          dtMs: aiAnimStartedAtRef.current != null ? Math.round(wbNow() - aiAnimStartedAtRef.current) : null,
        });
        aiStrokeRafRef.current = null;
        aiStrokeLastTsRef.current = null;
        aiStrokeHoldUntilRef.current = null;
        aiAnimStartedAtRef.current = null;
        return;
      }

      aiStrokeRafRef.current = window.requestAnimationFrame(tick);
    };

    aiStrokeRafRef.current = window.requestAnimationFrame(tick);
  }, [cancelAiStrokeAnimation, estimateStrokeLengthPx, scheduleRender, stepAiStrokeAnimation]);

  useEffect(() => {
    if (!aiDrawingAction) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const newStrokes: Stroke[] = [];
    const { width: cssW, height: cssH } = canvasSizeRef.current;
    const tAction0 = wbNow();

    // 1. Handle Tic-Tac-Toe Moves
    if (mode === 'tictactoe' && aiDrawingAction.type === 'mark_cell' && typeof aiDrawingAction.position === 'number') {
      const cellWidth = cssW / 3;
      const cellHeight = cssH / 3;
      const position = aiDrawingAction.position;
      
      const col = position % 3;
      const row = Math.floor(position / 3);
      
      const centerX = col * cellWidth + cellWidth / 2;
      const centerY = row * cellHeight + cellHeight / 2;
      const radius = Math.min(cellWidth, cellHeight) * 0.35;

      const circlePoints: Point[] = [];
      for (let angle = 0; angle <= Math.PI * 2; angle += 0.1) {
        circlePoints.push({
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        });
      }

      newStrokes.push({
        points: circlePoints,
        tool: 'marker',
        color: '#007AFF',
      });
    }

    // 2. Handle Generic Shape Drawing
    let didDrawSomething = false;
    
    if (aiDrawingAction.draw_shapes && aiDrawingAction.draw_shapes.length > 0) {
      aiDrawingAction.draw_shapes.forEach(shapeCmd => {
        const x = (shapeCmd.x / 100) * cssW;
        const y = (shapeCmd.y / 100) * cssH;
        const color = parseColorToHexOrFallback(shapeCmd.color, '#007AFF'); // Default to AI Blue
        
        let points: Point[] = [];

        if (shapeCmd.shape === 'circle') {
          const size = shapeCmd.size ? (shapeCmd.size / 100) * Math.min(cssW, cssH) : 20;
          for (let angle = 0; angle <= Math.PI * 2; angle += 0.1) {
            points.push({
              x: x + Math.cos(angle) * size,
              y: y + Math.sin(angle) * size,
            });
          }
        } 
        else if (shapeCmd.shape === 'heart') {
          const sizePx = shapeCmd.size
            ? (shapeCmd.size / 100) * Math.min(cssW, cssH)
            : Math.min(cssW, cssH) * 0.12;
          points = makeHeartPoints(x, y, sizePx, 160);
        }
        else if (shapeCmd.shape === 'line' || shapeCmd.shape === 'rect') {
            // Lines and Rects are drawn as straight strokes
            // For rect, we draw 4 lines
            const x2 = shapeCmd.x2 ? (shapeCmd.x2 / 100) * cssW : x;
            const y2 = shapeCmd.y2 ? (shapeCmd.y2 / 100) * cssH : y;

            if (shapeCmd.shape === 'line') {
                // Generate a hand-drawn style line with wobble
                const dist = Math.sqrt(Math.pow(x2 - x, 2) + Math.pow(y2 - y, 2));
                const segments = Math.max(3, Math.floor(dist / 5)); 
                
                for (let i = 0; i <= segments; i++) {
                    const t = i / segments;
                    let px = x + (x2 - x) * t;
                    let py = y + (y2 - y) * t;
                    
                    // Add noise to intermediate points
                    if (i > 0 && i < segments) {
                        const noise = 2.5; // Increased noise for visible wobble
                        px += (Math.random() - 0.5) * noise;
                        py += (Math.random() - 0.5) * noise;
                    }
                    points.push({ x: px, y: py });
                }
            } else {
                // Rect
                points.push({ x, y });
                points.push({ x: x2, y });
                points.push({ x: x2, y: y2 });
                points.push({ x, y: y2 });
                points.push({ x, y }); // Close loop
            }
        }
        else if (shapeCmd.shape === 'path') {
           if (shapeCmd.points && shapeCmd.points.length > 0) {
             const raw = shapeCmd.points.map(p => ({
               x: (p.x / 100) * cssW,
               y: (p.y / 100) * cssH,
             }));

             // Fallback: if the model tries to do a filled "heart" with a tiny polygon,
             // replace it with a proper heart curve so it looks correct.
             const wantsFill = !!((shapeCmd as any).fill ?? (shapeCmd as any).filled);
             if (wantsFill) {
               const centerX = raw.reduce((s, p) => s + p.x, 0) / raw.length;
               const centerY = raw.reduce((s, p) => s + p.y, 0) / raw.length;
               if (looksLikeHeartPolygon(raw, centerX, centerY)) {
                 const minY = Math.min(...raw.map(p => p.y));
                 const maxY = Math.max(...raw.map(p => p.y));
                 const sizePx = Math.max(20, (maxY - minY) * 0.65);
                 points = makeHeartPoints(centerX, centerY, sizePx, 160);
               } else {
                 points = raw;
               }
             } else {
               points = raw;
             }
           }
        }
        else if (shapeCmd.shape === 'point') {
           points.push({ x, y });
           points.push({ x: x + 1, y: y + 1 });
        }
        else if (shapeCmd.shape === 'text' && shapeCmd.text) {
           // Store text element to be rendered in renderCanvas with writing animation
           const style = (shapeCmd.style as TextStyle) || 'handwriting';
           const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
             ? crypto.randomUUID()
             : `text_${Date.now()}_${Math.random().toString(16).slice(2)}`;

           const textEl: TextElement = {
             id,
             text: shapeCmd.text,
             x: shapeCmd.x,  // Keep as percentage
             y: shapeCmd.y,  // Keep as percentage
             color: color,
             size: shapeCmd.size || 8,
             style: style,
           };
           setTextElements(prev => [...prev, textEl]);
           textAnimStateRef.current[id] = {
             currentCharIndex: 0,
             charDrawProgress: 0,
             isAnimating: true,
           };
           didDrawSomething = true;
           return;
        }

        if (points.length > 0) {
            newStrokes.push({
                points,
                tool: 'marker',
                color,
                filled: !!((shapeCmd as any).fill ?? (shapeCmd as any).filled)
            });
        }
      });
    }

    if (newStrokes.length > 0 || didDrawSomething) {
      const totalPoints = newStrokes.reduce((sum, s) => sum + (s.points?.length ?? 0), 0);
      wbLog('✍️ [Whiteboard] aiDrawingAction received', {
        type: (aiDrawingAction as any)?.type,
        strokes: newStrokes.length,
        totalPoints,
        textOnly: newStrokes.length === 0 && didDrawSomething,
      });
      pushUndoSnapshot();

      // Text-only actions can complete immediately (text has its own animation)
      if (newStrokes.length === 0) {
        onAiDrawingComplete?.();
        scheduleRender();
        wbLog('✍️ [Whiteboard] text-only action complete', { dtMs: Math.round(wbNow() - tAction0) });
        return;
      }

      // Animate AI strokes slowly, then commit them to state.
      startAiStrokeAnimation(newStrokes, () => {
        setStrokes(prev => [...prev, ...newStrokes]);
        onAiDrawingComplete?.();
        scheduleRender();
        wbLog('✍️ [Whiteboard] strokes committed', { dtMs: Math.round(wbNow() - tAction0), strokes: newStrokes.length });
      });
    }

    return () => {
      // If the action changes/unmounts mid-animation, stop the animation cleanly.
      cancelAiStrokeAnimation();
    };
  }, [
    aiDrawingAction,
    mode,
    onAiDrawingComplete,
    pushUndoSnapshot,
    scheduleRender,
    startAiStrokeAnimation,
    cancelAiStrokeAnimation,
  ]);

  // ============================================================================
  // ACTIONS
  // ============================================================================

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    
    const previousState = undoStack[undoStack.length - 1];
    // Restore both strokes and text elements
    setStrokes(previousState.strokes);
    setTextElements(previousState.textElements);
    setUndoStack(prev => prev.slice(0, -1));
    // Stop any text animations on undo (render full restored state)
    textAnimStateRef.current = {};
    cancelAiStrokeAnimation();
    scheduleRender();
  };

  const handleClear = () => {
    // Save current state for undo (both strokes and text)
    pushUndoSnapshot();
    setStrokes([]);
    setTextElements([]);
    textAnimStateRef.current = {};
    cancelAiStrokeAnimation();
    scheduleRender();
  };

  const generateImage = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    // Render a clean capture (includes grid for game modes)
    const tempCanvas = document.createElement('canvas');
    const { width: cssW, height: cssH } = canvasSizeRef.current;
    tempCanvas.width = cssW;
    tempCanvas.height = cssH;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;

    // White background
    tempCtx.fillStyle = '#FFFFFF';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Draw grid if in tictactoe mode
    if (mode === 'tictactoe') {
      tempCtx.strokeStyle = '#333333';
      tempCtx.lineWidth = 3;
      
      const cellWidth = tempCanvas.width / 3;
      const cellHeight = tempCanvas.height / 3;
      
      tempCtx.beginPath();
      tempCtx.moveTo(cellWidth, 0);
      tempCtx.lineTo(cellWidth, tempCanvas.height);
      tempCtx.moveTo(cellWidth * 2, 0);
      tempCtx.lineTo(cellWidth * 2, tempCanvas.height);
      tempCtx.moveTo(0, cellHeight);
      tempCtx.lineTo(tempCanvas.width, cellHeight);
      tempCtx.moveTo(0, cellHeight * 2);
      tempCtx.lineTo(tempCanvas.width, cellHeight * 2);
      tempCtx.stroke();
    }

    // Copy strokes
    strokesRef.current.forEach(stroke => {
      if (stroke.points.length < 2) return;
      
      const config = TOOL_CONFIGS[stroke.tool];
      tempCtx.globalAlpha = config.opacity;
      tempCtx.lineWidth = config.strokeWidth;
      tempCtx.lineCap = 'round';
      tempCtx.lineJoin = 'round';

      if (stroke.tool === 'eraser') {
        tempCtx.globalCompositeOperation = 'destination-out';
        tempCtx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        tempCtx.globalCompositeOperation = 'source-over';
        tempCtx.strokeStyle = stroke.color;
      }
      
      tempCtx.beginPath();
      tempCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        tempCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      if (stroke.filled && stroke.tool !== 'eraser') {
        tempCtx.closePath();
      }
      tempCtx.stroke();
      
      // Handle filled shapes (match main canvas rendering)
      if (stroke.filled && stroke.tool !== 'eraser') {
        tempCtx.fillStyle = stroke.color;
        tempCtx.fill();
      }
    });

    // Include any in-progress AI animation strokes in captures (what the user is seeing)
    aiPreviewStrokesRef.current.forEach(stroke => {
      if (stroke.points.length < 2) return;

      const config = TOOL_CONFIGS[stroke.tool];
      tempCtx.globalAlpha = config.opacity;
      tempCtx.lineWidth = config.strokeWidth;
      tempCtx.lineCap = 'round';
      tempCtx.lineJoin = 'round';

      if (stroke.tool === 'eraser') {
        tempCtx.globalCompositeOperation = 'destination-out';
        tempCtx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        tempCtx.globalCompositeOperation = 'source-over';
        tempCtx.strokeStyle = stroke.color;
      }

      tempCtx.beginPath();
      tempCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        tempCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      if (stroke.filled && stroke.tool !== 'eraser') {
        tempCtx.closePath();
      }
      tempCtx.stroke();

      if (stroke.filled && stroke.tool !== 'eraser') {
        tempCtx.fillStyle = stroke.color;
        tempCtx.fill();
      }
    });

    // Copy text elements (show full text, not animated)
    tempCtx.globalAlpha = 1;
    tempCtx.globalCompositeOperation = 'source-over';
    textElementsRef.current.forEach(textEl => {
      const x = (textEl.x / 100) * tempCanvas.width;
      const y = (textEl.y / 100) * tempCanvas.height;
      const fontSize = Math.max(24, (textEl.size / 100) * tempCanvas.height * 1.5);
      
      const fontFamily = TEXT_STYLE_FONTS[textEl.style] || TEXT_STYLE_FONTS.handwriting;
      tempCtx.font = `bold ${fontSize}px ${fontFamily}`;
      tempCtx.fillStyle = textEl.color;
      tempCtx.textAlign = 'center';
      tempCtx.textBaseline = 'middle';
      // Always show full text in captures (not the animated partial text)
      tempCtx.fillText(textEl.text, x, y);
    });

    return tempCanvas.toDataURL('image/png').split(',')[1];
  }, [mode]);

  useImperativeHandle(ref, () => ({
    capture: generateImage,
  }));

  const handleCapture = () => {
    if (!onCapture) return;
    const base64 = generateImage();
    if (!base64) return;
    
    let defaultMessage = '';
    if (mode === 'tictactoe') {
      defaultMessage = "It's your turn! Look at the board and make your move.";
    } else if (mode === 'pictionary') {
      defaultMessage = "What do you think I'm drawing?";
    }
    
    onCapture(base64, defaultMessage);
  };

  // ============================================================================
  // RENDER UI
  // ============================================================================

  return (
    <div 
      ref={containerRef}
      className="flex flex-col h-full bg-gray-900 rounded-xl overflow-hidden"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-800 border-b border-gray-700">
        {/* Tool Selection */}
        <div className="flex gap-1 bg-gray-700 rounded-lg p-1">
          {(Object.keys(TOOL_CONFIGS) as DrawingTool[]).map((tool) => (
            <button
              key={tool}
              onClick={() => setCurrentTool(tool)}
              className={`
                px-3 py-2 rounded-md text-lg transition-all
                ${currentTool === tool 
                  ? 'bg-indigo-600 shadow-lg' 
                  : 'hover:bg-gray-600'
                }
              `}
              title={TOOL_CONFIGS[tool].name}
            >
              {TOOL_CONFIGS[tool].icon}
            </button>
          ))}
        </div>

        {/* Color Picker - disabled for eraser */}
        {currentTool !== 'eraser' && (
          <div className="flex gap-1 ml-2">
            {DEFAULT_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setCurrentColor(color)}
                className={`
                  w-7 h-7 rounded-full transition-transform
                  ${currentColor === color ? 'ring-2 ring-white scale-110' : 'hover:scale-105'}
                `}
                style={{ 
                  backgroundColor: color,
                  border: color === '#FFFFFF' ? '1px solid #666' : 'none'
                }}
              />
            ))}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ↩️ Undo
          </button>
          <button
            onClick={handleClear}
            disabled={strokes.length === 0 && textElements.length === 0}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🗑️ Clear
          </button>
          <button
            onClick={handleCapture}
            disabled={!onCapture || disabled}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            📷 Send to AI
          </button>
        </div>
      </div>

      {/* Mode Indicator */}
      <div className="px-3 py-1.5 bg-gray-800/50 text-sm text-gray-400 flex items-center gap-2">
        <span className="font-medium">
          {mode === 'tictactoe' && '🎮 Tic-Tac-Toe Mode'}
          {mode === 'pictionary' && '🎨 Pictionary Mode'}
          {mode === 'freeform' && '✏️ Freeform Mode'}
        </span>
        {mode === 'tictactoe' && (
          <span className="text-xs text-gray-500">• Draw your X, then send to AI</span>
        )}
        {mode === 'pictionary' && (
          <span className="text-xs text-gray-500">• Draw something for the AI to guess!</span>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 flex items-center justify-center bg-gray-900">
        <canvas
          ref={canvasRef}
          className={`
            bg-white rounded-lg shadow-2xl cursor-crosshair
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          style={{ touchAction: 'none' }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
    </div>
  );
});
export default Whiteboard;
