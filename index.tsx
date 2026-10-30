import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Upload, FileDown, RefreshCcw, FileText, Activity, Map as MapIcon, ChevronRight, BarChart3, AlertCircle, Maximize2, Info, Target, Filter, X, LayoutGrid, Scissors, Zap, Flag, Trash2, RotateCcw, Eye, ChevronLeft, Play, Users, User, Move, Settings2, Settings, Plus, Minus, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Timer, Ruler, Hash, Ban, CheckSquare, Square, Flame, FileSpreadsheet, Trophy, Search, ZoomIn, ZoomOut, Maximize, MousePointer2, Download, GraduationCap, Layers, Star, Briefcase, Clock } from 'lucide-react';

// --- Types ---

interface Point {
  x: number;
  y: number;
  t?: number;
}

interface LineSegment {
  points: Point[];
  nodesVisited: number[];
  type: string;
}

interface ProcessedTrial {
  subjectId: string;
  trialId: string | number;
  points: Point[];
  basePoints?: Point[];
  smoothedPoints: Point[];
  startPoint: Point;
  lines: LineSegment[];
  breakPoints: Point[];
  trial_time_ms: number;
}

interface GridNode {
  id: number;
  x: number;
  y: number;
  rawX: number;
  rawY: number;
  w: number;
  h: number;
}

interface Calibration {
  offsetX: number;
  offsetY: number;
  scale: number;
  hitPadding: number;
}

interface SubjectData {
  id: string;
  nodes: GridNode[];
  cellSize: { w: number, h: number };
  calibration: Calibration;
  isSolved?: boolean;
  lastName: string;
  firstName: string;
  age: string;
  experience: string;
  gender: string;
  solvedBefore?: string;
  insight?: string;
  totalTaskTime?: number;
  surveyScales?: Record<string, number>;
}

interface HeatPoint {
  x: number;
  y: number;
  subjectId: string;
  trialId: string | number;
}

interface HeatLine {
  points: { x: number, y: number }[];
  subjectId: string;
  trialId: string | number;
}

// --- Constants ---
const CANVAS_SIZE = 800; 
const DOT_RADIUS = 6;
const ANGLE_THRESHOLD_SPLIT = 30; // Threshold for bend detection (degrees)
const MIN_LINE_LENGTH = 100;      // Minimum length to be considered a valid line (pixels)
const LOOKAHEAD_MIN_LENGTH = 50;   // Minimum length after bend to justify a split (pixels)
const SMOOTHING_WINDOW = 3; 

// --- Helper Components ---

const GlobalHeatMap: React.FC<{ 
  title: string; 
  icon: React.ReactNode; 
  points: HeatPoint[]; 
  normalizedNodes: { id: number, x: number, y: number }[];
  badge?: string;
  color?: 'blue' | 'emerald' | 'amber';
}> = ({ title, icon, points, normalizedNodes, badge, color = 'blue' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredPoint, setHoveredPoint] = useState<HeatPoint | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  
  const size = 400;

  const colorConfig = {
    blue: { primary: 'rgba(37, 99, 235, 0.25)', marker: 'rgba(239, 68, 68, 0.6)', text: 'text-blue-500' },
    emerald: { primary: 'rgba(16, 185, 129, 0.25)', marker: 'rgba(239, 68, 68, 0.6)', text: 'text-emerald-500' },
    amber: { primary: 'rgba(245, 158, 11, 0.35)', marker: 'rgba(59, 130, 246, 0.6)', text: 'text-amber-500' }
  };

  const currentTheme = colorConfig[color];

  const drawHeatmap = (ctx: CanvasRenderingContext2D, width: number, height: number, z: number, off: {x: number, y: number}, isExport: boolean = false) => {
    const scaleFactor = isExport ? width / size : 1;
    const center = width / 2;
    
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    const dotR = 5 * scaleFactor;
    
    // Draw Presented Grid Nodes on Background
    ctx.fillStyle = '#e2e8f0';
    normalizedNodes.forEach(node => {
      ctx.beginPath();
      const posX = center + off.x * scaleFactor + (node.x * z * scaleFactor);
      const posY = center + off.y * scaleFactor + (node.y * z * scaleFactor);
      ctx.arc(posX, posY, dotR, 0, Math.PI * 2);
      ctx.fill();
      
      // Numbering
      ctx.fillStyle = '#94a3b8';
      ctx.font = `bold ${9 * scaleFactor}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(node.id.toString(), posX, posY - (12 * scaleFactor));
      ctx.fillStyle = '#e2e8f0';
    });

    ctx.globalCompositeOperation = 'multiply';
    points.forEach(p => {
      const radius = 25 * z * scaleFactor;
      const posX = center + off.x * scaleFactor + p.x * z * scaleFactor;
      const posY = center + off.y * scaleFactor + p.y * z * scaleFactor;
      
      const grad = ctx.createRadialGradient(posX, posY, 0, posX, posY, radius);
      grad.addColorStop(0, currentTheme.primary);
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(posX, posY, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';

    points.forEach(p => {
      const posX = center + off.x * scaleFactor + p.x * z * scaleFactor;
      const posY = center + off.y * scaleFactor + p.y * z * scaleFactor;
      ctx.beginPath();
      ctx.arc(posX, posY, 2.5 * scaleFactor, 0, Math.PI * 2);
      ctx.fillStyle = currentTheme.marker;
      ctx.fill();
    });
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawHeatmap(ctx, size, size, zoom, offset);
    
    if (hoveredPoint) {
      const center = size / 2;
      const posX = center + offset.x + hoveredPoint.x * zoom;
      const posY = center + offset.y + hoveredPoint.y * zoom;
      ctx.beginPath();
      ctx.arc(posX, posY, 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [points, normalizedNodes, zoom, offset, hoveredPoint, color]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }

    const center = size / 2;
    const localX = (x - center - offset.x) / zoom;
    const localY = (y - center - offset.y) / zoom;
    
    let closest: HeatPoint | null = null;
    let minDist = 20 / zoom; 

    points.forEach(p => {
      const d = Math.sqrt(Math.pow(p.x - localX, 2) + Math.pow(p.y - localY, 2));
      if (d < minDist) {
        minDist = d;
        closest = p;
      }
    });
    setHoveredPoint(closest);
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.2, Math.min(10, z * delta)));
  };

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const exportHighRes = () => {
    const exportSize = 2400; // 600 DPI for 4x4 inch
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = exportSize;
    offscreenCanvas.height = exportSize;
    const ctx = offscreenCanvas.getContext('2d');
    if (!ctx) return;

    drawHeatmap(ctx, exportSize, exportSize, zoom, offset, true);

    const link = document.createElement('a');
    link.download = `${title.replace(/\s+/g, '_')}_${badge ? badge.replace(/\s+/g, '_') : ''}_600dpi.png`;
    link.href = offscreenCanvas.toDataURL('image/png', 1.0);
    link.click();
  };

  return (
    <div className="bg-white p-6 rounded-[32px] shadow-xl border border-slate-100 flex flex-col items-center relative group select-none transition-all hover:shadow-2xl hover:border-slate-200">
      <div className="flex justify-between items-center mb-4 w-full">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className={`p-2 bg-slate-50 rounded-xl shrink-0 ${currentTheme.text}`}>{icon}</div>
          <div className="flex flex-col min-w-0">
             <h3 className="text-sm font-bold text-slate-700 truncate">{title}</h3>
             {badge && <span className="text-[9px] font-black uppercase text-indigo-500 tracking-tighter truncate opacity-70">{badge}</span>}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={exportHighRes} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all" title="Скачать PNG (600 DPI)"><Download size={14} /></button>
          <button onClick={() => setZoom(z => Math.max(0.2, z * 0.8))} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><ZoomOut size={14} /></button>
          <button onClick={resetView} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><Maximize size={14} /></button>
          <button onClick={() => setZoom(z => Math.min(10, z * 1.2))} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><ZoomIn size={14} /></button>
        </div>
      </div>
      
      <div className="relative w-full aspect-square overflow-hidden rounded-2xl border border-slate-100 shadow-inner cursor-grab active:cursor-grabbing">
        <canvas 
          ref={canvasRef} 
          width={size} 
          height={size} 
          className="w-full h-full bg-slate-50"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
        
        {hoveredPoint && (
          <div 
            className="absolute z-50 bg-slate-900/90 backdrop-blur-sm text-white px-3 py-2 rounded-xl text-[10px] font-bold shadow-2xl pointer-events-none animate-in fade-in zoom-in duration-100"
            style={{ 
                left: mousePos.x + 10, 
                top: mousePos.y + 10,
                transform: mousePos.x > size * 0.7 ? 'translateX(-100%)' : ''
            }}
          >
            <div className="text-blue-400 mb-1 flex items-center gap-1"><User size={10}/> {hoveredPoint.subjectId}</div>
            <div className="text-slate-300">Проба: #{hoveredPoint.trialId}</div>
            <div className="text-slate-500 font-mono mt-1 border-t border-slate-700 pt-1">
              REL X: {hoveredPoint.x.toFixed(1)} <br/>
              REL Y: {hoveredPoint.y.toFixed(1)}
            </div>
          </div>
        )}

        <div className="absolute top-4 right-4 bg-white/60 backdrop-blur-md px-2 py-1 rounded-lg text-[9px] font-black uppercase text-slate-400 border border-white/40">
           Zoom: {zoom.toFixed(1)}x
        </div>
      </div>
      
      <div className="mt-4 flex justify-between w-full px-1">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"><Activity size={10}/> Проб: {points.length}</div>
        <div className="text-[10px] font-bold text-blue-500/50 uppercase tracking-widest flex items-center gap-1"><Move size={10}/> Drag to Pan</div>
      </div>
    </div>
  );
};

const GlobalLineMap: React.FC<{ 
  title: string; 
  icon: React.ReactNode; 
  lines: HeatLine[]; 
  normalizedNodes: { id: number, x: number, y: number }[];
  badge?: string;
  color?: 'blue' | 'emerald' | 'amber';
}> = ({ title, icon, lines, normalizedNodes, badge, color = 'blue' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const size = 400;

  const colorConfig = {
    blue: { line: 'rgba(14, 165, 233, 0.15)', text: 'text-sky-500' },
    emerald: { line: 'rgba(52, 211, 153, 0.15)', text: 'text-emerald-500' },
    amber: { line: 'rgba(251, 191, 36, 0.15)', text: 'text-amber-500' }
  };

  const currentTheme = colorConfig[color];

  const drawLineMap = (ctx: CanvasRenderingContext2D, width: number, height: number, z: number, off: {x: number, y: number}, isExport: boolean = false) => {
    const scaleFactor = isExport ? width / size : 1;
    const center = width / 2;
    
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    const dotR = 5 * scaleFactor;
    
    // Draw Presented Grid Nodes on Background
    ctx.fillStyle = '#e2e8f0';
    normalizedNodes.forEach(node => {
      ctx.beginPath();
      const posX = center + off.x * scaleFactor + (node.x * z * scaleFactor);
      const posY = center + off.y * scaleFactor + (node.y * z * scaleFactor);
      ctx.arc(posX, posY, dotR, 0, Math.PI * 2);
      ctx.fill();
      
      // Numbering
      ctx.fillStyle = '#94a3b8';
      ctx.font = `bold ${9 * scaleFactor}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(node.id.toString(), posX, posY - (12 * scaleFactor));
      ctx.fillStyle = '#e2e8f0';
    });

    // Draw lines
    ctx.lineWidth = 2 * scaleFactor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = currentTheme.line;

    lines.forEach(line => {
      if (line.points.length < 2) return;
      ctx.beginPath();
      line.points.forEach((p, i) => {
        const posX = center + off.x * scaleFactor + p.x * z * scaleFactor;
        const posY = center + off.y * scaleFactor + p.y * z * scaleFactor;
        if (i === 0) ctx.moveTo(posX, posY);
        else ctx.lineTo(posX, posY);
      });
      ctx.stroke();
    });
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawLineMap(ctx, size, size, zoom, offset);
  }, [lines, normalizedNodes, zoom, offset, color]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.2, Math.min(10, z * delta)));
  };

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const exportHighRes = () => {
    const exportSize = 2400; // 600 DPI for 4x4 inch
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = exportSize;
    offscreenCanvas.height = exportSize;
    const ctx = offscreenCanvas.getContext('2d');
    if (!ctx) return;

    drawLineMap(ctx, exportSize, exportSize, zoom, offset, true);

    const link = document.createElement('a');
    link.download = `${title.replace(/\s+/g, '_')}_${badge ? badge.replace(/\s+/g, '_') : ''}_600dpi.png`;
    link.href = offscreenCanvas.toDataURL('image/png', 1.0);
    link.click();
  };

  return (
    <div className="bg-white p-6 rounded-[32px] shadow-xl border border-slate-100 flex flex-col items-center relative group select-none transition-all hover:shadow-2xl hover:border-slate-200">
      <div className="flex justify-between items-center mb-4 w-full">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className={`p-2 bg-slate-50 rounded-xl shrink-0 ${currentTheme.text}`}>{icon}</div>
          <div className="flex flex-col min-w-0">
             <h3 className="text-sm font-bold text-slate-700 truncate">{title}</h3>
             {badge && <span className="text-[9px] font-black uppercase text-indigo-500 tracking-tighter truncate opacity-70">{badge}</span>}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={exportHighRes} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all" title="Скачать PNG (600 DPI)"><Download size={14} /></button>
          <button onClick={() => setZoom(z => Math.max(0.2, z * 0.8))} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><ZoomOut size={14} /></button>
          <button onClick={resetView} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><Maximize size={14} /></button>
          <button onClick={() => setZoom(z => Math.min(10, z * 1.2))} className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-white border border-transparent hover:border-slate-100 transition-all"><ZoomIn size={14} /></button>
        </div>
      </div>
      
      <div className="relative w-full aspect-square overflow-hidden rounded-2xl border border-slate-100 shadow-inner cursor-grab active:cursor-grabbing">
        <canvas 
          ref={canvasRef} 
          width={size} 
          height={size} 
          className="w-full h-full bg-slate-50"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
        
        <div className="absolute top-4 right-4 bg-white/60 backdrop-blur-md px-2 py-1 rounded-lg text-[9px] font-black uppercase text-slate-400 border border-white/40">
           Zoom: {zoom.toFixed(1)}x
        </div>
      </div>
      
      <div className="mt-4 flex justify-between w-full px-1">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"><Activity size={10}/> Линий: {lines.length}</div>
        <div className="text-[10px] font-bold text-blue-500/50 uppercase tracking-widest flex items-center gap-1"><Move size={10}/> Drag to Pan</div>
      </div>
    </div>
  );
};

// --- Helper Functions ---

const smoothPoints = (points: Point[], windowSize: number): Point[] => {
  if (points.length < windowSize) return points;
  const smoothed: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let j = Math.max(0, i - Math.floor(windowSize / 2)); j <= Math.min(points.length - 1, i + Math.floor(windowSize / 2)); j++) {
      const p = points[j];
      if (p) {
        sumX += p.x;
        sumY += p.y;
        count++;
      }
    }
    smoothed.push({ x: sumX / count, y: sumY / count, t: points[i].t });
  }
  return smoothed;
};

const getAngle = (p1?: Point, p2?: Point, p3?: Point): number => {
  if (!p1 || !p2 || !p3) return 0;
  const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
  const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  if (mag1 < 0.001 || mag2 < 0.001) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI; 
};

const calculateDistance = (p1: Point, p2: Point): number => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

const distToSegment = (p: Point, a: Point, b: Point): number => {
  const l2 = Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2);
  if (l2 === 0) return Math.sqrt(Math.pow(p.x - a.x, 2) + Math.pow(p.y - a.y, 2));
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(Math.pow(p.x - (a.x + t * (b.x - a.x)), 2) + Math.pow(p.y - (a.y + t * (b.y - a.y)), 2));
};

const classifyLine = (nodesVisited: number[]): string => {
  const nodes = Array.from(new Set(nodesVisited)).sort((a, b) => a - b);
  
  if (nodes.length === 0) return 'внешняя';
  if (nodes.length === 1) return 'касательная';

  const isSubsetOfPattern = (pattern: number[]) => 
    nodes.length >= 2 && nodes.every(n => pattern.includes(n));

  const sides = [[1, 2, 3], [1, 4, 7], [7, 8, 9], [3, 6, 9]];
  if (sides.some(isSubsetOfPattern)) return 'боковая';

  const diagonals = [[1, 5, 9], [3, 5, 7]];
  if (diagonals.some(isSubsetOfPattern)) return 'диагональная';

  const central = [[2, 5, 8], [4, 5, 6]];
  if (central.some(isSubsetOfPattern)) return 'центральная';

  const chords = [[2, 4], [2, 6], [6, 8], [4, 8]];
  if (chords.some(isSubsetOfPattern)) return 'хордовая';

  const longChords = [[1, 8], [3, 8], [1, 6], [7, 6], [4, 9], [3, 4], [2, 7], [2, 9]];
  if (longChords.some(isSubsetOfPattern)) return 'хорды_длинные';

  return 'прочая';
};

const parseNum = (str: string): number => {
  if (!str) return NaN;
  return parseFloat(str.replace(',', '.').replace(/\s/g, ''));
};

const detectDelimiter = (line: string): string => {
  const commaCount = (line.match(/,/g) || []).length;
  const semicolonCount = (line.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ';' : ',';
};

const decodeBuffer = (buffer: ArrayBuffer): string => {
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    return utf8Decoder.decode(buffer);
  } catch {
    const winDecoder = new TextDecoder('windows-1251');
    return winDecoder.decode(buffer);
  }
};

const App: React.FC = () => {
  const [processedData, setProcessedData] = useState<ProcessedTrial[]>([]);
  const [subjects, setSubjects] = useState<SubjectData[]>([]);
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);
  
  const [angleThreshold, setAngleThreshold] = useState(ANGLE_THRESHOLD_SPLIT);
  const [minLineLength, setMinLineLength] = useState(MIN_LINE_LENGTH);
  const [debouncedAngle, setDebouncedAngle] = useState(ANGLE_THRESHOLD_SPLIT);
  const [debouncedMinLen, setDebouncedMinLen] = useState(MIN_LINE_LENGTH);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedAngle(angleThreshold);
      setDebouncedMinLen(minLineLength);
    }, 400);
    return () => clearTimeout(timer);
  }, [angleThreshold, minLineLength]);

  const performSegmentation = useCallback((points: Point[], angle: number, minLen: number) => {
    const smoothed = smoothPoints(points, SMOOTHING_WINDOW);
    const breakIndices: number[] = [0];
    const windowSize = 3; 
    
    // Precompute cumulative distances for O(1) lookahead calculation
    const cumDist = new Float64Array(smoothed.length);
    for (let m = 1; m < smoothed.length; m++) {
      cumDist[m] = cumDist[m - 1] + calculateDistance(smoothed[m - 1], smoothed[m]);
    }

    for (let i = windowSize; i < smoothed.length - windowSize; i++) {
      const ang = getAngle(smoothed[i - windowSize], smoothed[i], smoothed[i + windowSize]);
      
      if (ang >= angle) {
        let nextSplitIdx = smoothed.length - 1;
        for (let j = i + 1; j < smoothed.length - windowSize; j++) {
          const nextAngle = getAngle(smoothed[j - windowSize], smoothed[j], smoothed[j + windowSize]);
          if (nextAngle >= angle) {
            nextSplitIdx = j;
            break;
          }
        }

        const distToNext = cumDist[nextSplitIdx] - cumDist[i];

        if (distToNext >= LOOKAHEAD_MIN_LENGTH) {
          if (i - breakIndices[breakIndices.length - 1] > windowSize) {
              breakIndices.push(i);
          }
        }
      }
    }
    breakIndices.push(smoothed.length - 1);
    
    const lines: LineSegment[] = [];
    const breakPoints: Point[] = [];

    for (let k = 0; k < breakIndices.length - 1; k++) {
      const start = breakIndices[k];
      const end = breakIndices[k + 1];
      const segPoints = smoothed.slice(start, end + 1);
      if (segPoints.length < 2) continue;

      const segLength = cumDist[end] - cumDist[start];
      if (segLength < minLen) continue;

      lines.push({
        points: segPoints,
        nodesVisited: [],
        type: 'прочая'
      });
      
      if (k > 0) breakPoints.push(smoothed[start]);
    }
    return { lines, breakPoints, smoothed };
  }, []);

  const calibrateTrial = useCallback((
    trial: ProcessedTrial,
    cal: Calibration,
    nodes: GridNode[],
    angle: number,
    minLen: number
  ): ProcessedTrial => {
    const basePoints = trial.basePoints || trial.points;
    const { offsetX, offsetY, scale, hitPadding } = cal;
    const center = CANVAS_SIZE / 2;

    const calibratedPoints: Point[] = basePoints.map(p => ({
      x: center + (p.x - center) * scale + offsetX,
      y: center + (p.y - center) * scale + offsetY,
      t: p.t
    }));

    const { lines, breakPoints, smoothed } = performSegmentation(calibratedPoints, angle, minLen);

    const updatedLines: LineSegment[] = lines.map(line => {
      const visited: number[] = [];
      for (let i = 0; i < line.points.length - 1; i++) {
        const p1 = line.points[i];
        const p2 = line.points[i + 1];
        nodes.forEach(node => {
          const rx = (node.w / 2) + (hitPadding ?? 15);
          const ry = (node.h / 2) + (hitPadding ?? 15);
          const d = distToSegment(
            { x: node.x / rx, y: node.y / ry },
            { x: p1.x / rx, y: p1.y / ry },
            { x: p2.x / rx, y: p2.y / ry }
          );
          if (d <= 1.0) {
            if (visited[visited.length - 1] !== node.id) visited.push(node.id);
          }
        });
      }
      return {
        ...line,
        nodesVisited: visited,
        type: classifyLine(visited)
      };
    });

    return {
      ...trial,
      basePoints,
      points: calibratedPoints,
      smoothedPoints: smoothed,
      startPoint: calibratedPoints[0] || trial.startPoint,
      breakPoints,
      lines: updatedLines
    };
  }, [performSegmentation]);


  useEffect(() => {
    if (processedData.length === 0) return;
    setProcessedData(prev => {
      return prev.map(trial => {
        const sub = subjects.find(s => s.id === trial.subjectId);
        if (!sub) return trial;
        return calibrateTrial(trial, sub.calibration, sub.nodes, debouncedAngle, debouncedMinLen);
      });
    });
  }, [debouncedAngle, debouncedMinLen, calibrateTrial]);
  const [manualOverrides, setManualOverrides] = useState<Set<string>>(new Set());
  const [excludedLines, setExcludedLines] = useState<Set<string>>(new Set());
  const [subjectGroups, setSubjectGroups] = useState<Record<string, string>>({});
  const [selectedTrialId, setSelectedTrialId] = useState<string | number | null>(null);
  const [hoveredTrialId, setHoveredTrialId] = useState<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [viewScale, setViewScale] = useState(1);
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterStartNode, setFilterStartNode] = useState<number | null>(null);
  const [filterFinishNode, setFilterFinishNode] = useState<number | null>(null);
  const [filterOverridesOnly, setFilterOverridesOnly] = useState(false);
  const [showBreaks, setShowBreaks] = useState(true);
  const [usePhasedMode, setUsePhasedMode] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showFinishHeatmap, setShowFinishHeatmap] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isDraggingGrid, setIsDraggingGrid] = useState(false);
  const [dragStartMouse, setDragStartMouse] = useState({ x: 0, y: 0 });
  const [dragStartCalibration, setDragStartCalibration] = useState({ offsetX: 0, offsetY: 0 });
  const [isHoveringAnyNode, setIsHoveringAnyNode] = useState(false);
  const [animationTick, setAnimationTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);

  const activeSubject = useMemo(() => subjects.find(s => s.id === activeSubjectId), [subjects, activeSubjectId]);
  
  const activeNodes = useMemo(() => {
    if (!activeSubject) return [];
    return activeSubject.nodes;
  }, [activeSubject]);

  const activeCellSize = useMemo(() => {
    if (!activeSubject) return { w: 116, h: 116 };
    return activeSubject.cellSize;
  }, [activeSubject]);

  const addLog = (msg: string) => setLog(prev => [...prev.slice(-10), msg]);

  useEffect(() => {
    if (isCalibrating) {
      const animate = (time: number) => {
        setAnimationTick(time);
        requestRef.current = requestAnimationFrame(animate);
      };
      requestRef.current = requestAnimationFrame(animate);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isCalibrating]);

  const recalculateNodesVisited = (trials: ProcessedTrial[], nodes: GridNode[], hitPadding: number) => {
    return trials.map(trial => {
      const updatedLines = trial.lines.map(line => {
        const visited: number[] = [];
        for (let i = 0; i < line.points.length - 1; i++) {
          const p1 = line.points[i];
          const p2 = line.points[i + 1];
          nodes.forEach(node => {
            const rx = (node.w / 2) + hitPadding;
            const ry = (node.h / 2) + hitPadding;
            
            const d = distToSegment(
              { x: node.x / rx, y: node.y / ry },
              { x: p1.x / rx, y: p1.y / ry },
              { x: p2.x / rx, y: p2.y / ry }
            );
            if (d <= 1.0) {
              if (visited[visited.length - 1] !== node.id) visited.push(node.id);
            }
          });
        }
        return {
          ...line,
          nodesVisited: visited,
          type: classifyLine(visited)
        };
      });
      return { ...trial, lines: updatedLines };
    });
  };

  const handleCalibrationChange = useCallback((changes: Partial<Calibration> | ((prev: Calibration) => Partial<Calibration>)) => {
    if (!activeSubjectId) return;
    setSubjects(prev => prev.map(s => {
      if (s.id === activeSubjectId) {
        const newChanges = typeof changes === 'function' ? changes(s.calibration) : changes;
        const newCalibration = { ...s.calibration, ...newChanges };
        return { ...s, calibration: newCalibration };
      }
      return s;
    }));
  }, [activeSubjectId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isCalibrating || !activeSubject) return;
      
      // If user is typing in an input, don't trigger global shortcuts
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const step = e.shiftKey ? 10 : 1;
      
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleCalibrationChange(prev => ({ offsetX: prev.offsetX - step }));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleCalibrationChange(prev => ({ offsetX: prev.offsetX + step }));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleCalibrationChange(prev => ({ offsetY: prev.offsetY - step }));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleCalibrationChange(prev => ({ offsetY: prev.offsetY + step }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCalibrating, activeSubject, handleCalibrationChange]);

  // Mouse handlers for solution dragging in calibration mode
  const handleMainCanvasMouseDown = (e: React.MouseEvent) => {
    if (!isCalibrating || !activeSubject) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = (e.clientX - rect.left) * (CANVAS_SIZE / rect.width);
    const mouseY = (e.clientY - rect.top) * (CANVAS_SIZE / rect.height);

    setIsDraggingGrid(true);
    setDragStartMouse({ x: mouseX, y: mouseY });
    setDragStartCalibration({ 
      offsetX: activeSubject.calibration.offsetX, 
      offsetY: activeSubject.calibration.offsetY 
    });
  };

  const handleMainCanvasMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = (e.clientX - rect.left) * (CANVAS_SIZE / rect.width);
    const mouseY = (e.clientY - rect.top) * (CANVAS_SIZE / rect.height);

    if (isCalibrating && isDraggingGrid) {
      const dx = mouseX - dragStartMouse.x;
      const dy = mouseY - dragStartMouse.y;

      handleCalibrationChange({
        offsetX: Math.round(dragStartCalibration.offsetX + dx),
        offsetY: Math.round(dragStartCalibration.offsetY + dy)
      });
    }
  };

  const handleMainCanvasMouseUp = () => {
    setIsDraggingGrid(false);
  };

  const toggleSubjectSolved = (subjectId: string) => {
    setSubjects(prev => prev.map(s => {
        if (s.id === subjectId) {
            return { ...s, isSolved: !s.isSolved };
        }
        return s;
    }));
  };

  useEffect(() => {
    if (activeSubject && activeSubject.nodes.length > 0) {
      setProcessedData(prev => {
        return prev.map(trial => {
          if (trial.subjectId !== activeSubjectId) return trial;
          return calibrateTrial(trial, activeSubject.calibration, activeSubject.nodes, debouncedAngle, debouncedMinLen);
        });
      });
    }
  }, [activeSubject?.calibration, activeSubjectId, calibrateTrial, debouncedAngle, debouncedMinLen]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setError(null);
    setLog([`Выбрано файлов: ${files.length}`]);

    const newTrials: ProcessedTrial[] = [];
    const newSubjects: SubjectData[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const subjectName = file.name.replace(/\.csv$/i, '');
      
      try {
        const buffer = await file.arrayBuffer();
        const content = decodeBuffer(buffer).replace(/^\uFEFF/, '');
        const results = processCSV(content, subjectName);
        
        if (results.trials.length > 0) {
           newTrials.push(...results.trials);
        }
        
        newSubjects.push({
          id: subjectName,
          nodes: results.nodes,
          cellSize: results.cellSize,
          calibration: { offsetX: 0, offsetY: 0, scale: 1.0, hitPadding: 15 },
          isSolved: false,
          lastName: results.metadata.lastName,
          firstName: results.metadata.firstName,
          age: results.metadata.age,
          gender: results.metadata.gender,
          experience: 'Не загружен',
          solvedBefore: results.metadata.solvedBefore,
          insight: results.metadata.insight,
          totalTaskTime: results.metadata.totalTaskTime,
          surveyScales: results.metadata.surveyScales
        });

        if (results.metadata.group) {
          setSubjectGroups(prev => ({ ...prev, [subjectName]: results.metadata.group }));
        }
      } catch (err) {
        console.error(err);
        addLog(`Ошибка в файле ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (newSubjects.length > 0) {
      setProcessedData(prev => [...prev, ...newTrials]);
      setSubjects(prev => {
        const existingIds = new Set(prev.map(s => s.id));
        const filteredNew = newSubjects.filter(ns => !existingIds.has(ns.id));
        return [...prev, ...filteredNew];
      });
      if (!activeSubjectId && newSubjects.length > 0) setActiveSubjectId(newSubjects[0].id);
      
      addLog(`Загружено участников: ${newSubjects.length}. Валидных проб: ${newTrials.length}.`);
    } else {
      addLog("Ни один файл не был успешно обработан.");
    }
  };

  const handleCalibrationFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const buffer = await file.arrayBuffer();
    const content = decodeBuffer(buffer).replace(/^\uFEFF/, '');
    
    const rawLines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (rawLines.length < 2) {
      addLog("Файл калибровки пуст или некорректен.");
      return;
    }

    const delimiter = detectDelimiter(rawLines[0]);
    const headers = rawLines[0].split(delimiter).map(h => h.trim().toLowerCase());
    
    const sIdIdx = headers.indexOf("subjectid");
    const oxIdx = headers.indexOf("calibrationoffsetx");
    const oyIdx = headers.indexOf("calibrationoffsety");
    const scaleIdx = headers.indexOf("calibrationscale");
    const aoiIdx = headers.indexOf("aoi");
    const solvedIdx = headers.indexOf("issolved");

    if (sIdIdx === -1 || oxIdx === -1 || oyIdx === -1 || scaleIdx === -1) {
      addLog("Неверный формат заголовков в файле калибровки.");
      return;
    }

    let updatedCount = 0;
    
    setSubjects(prev => {
        const next = [...prev];
        for (let i = 1; i < rawLines.length; i++) {
            const cols = rawLines[i].split(delimiter);
            const subjectId = cols[sIdIdx]?.trim();
            const ox = parseNum(cols[oxIdx]);
            const oy = parseNum(cols[oyIdx]);
            const scale = parseNum(cols[scaleIdx]);
            const aoi = aoiIdx !== -1 ? parseNum(cols[aoiIdx]) : NaN;

            if (subjectId && !isNaN(ox) && !isNaN(oy) && !isNaN(scale)) {
                const idx = next.findIndex(s => s.id === subjectId);
                if (idx !== -1) {
                    const updatedSubject = { ...next[idx] };
                    updatedSubject.calibration = { 
                      offsetX: ox, 
                      offsetY: oy, 
                      scale: scale,
                      hitPadding: !isNaN(aoi) ? aoi : (next[idx].calibration.hitPadding ?? 15)
                    };
                    
                    if (solvedIdx !== -1 && cols[solvedIdx]) {
                        const rawVal = cols[solvedIdx].trim().toLowerCase();
                        updatedSubject.isSolved = (rawVal === 'true' || rawVal === '1' || rawVal === 'yes');
                    }
                    
                    next[idx] = updatedSubject;
                    updatedCount++;
                }
            }
        }
        return next;
    });

    addLog(`Обновлена калибровка и статус решения для ${updatedCount} испытуемых.`);
    e.target.value = "";
  };

  const handleExperienceFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const buffer = await file.arrayBuffer();
    const content = decodeBuffer(buffer).replace(/^\uFEFF/, '');
    
    const rawLines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (rawLines.length < 2) {
      addLog("Файл опыта пуст.");
      return;
    }

    const delimiter = detectDelimiter(rawLines[0]);

    // Helper function to remove surrounding quotes and unescape doubled quotes
    const clean = (val: string) => {
      if (!val) return "";
      let s = val.trim();
      // Handle values like "filename.csv" or "no"
      if (s.startsWith('"') && s.endsWith('"')) {
        s = s.slice(1, -1);
      }
      return s.replace(/""/g, '"').trim();
    };

    // Correctly parse headers by cleaning them from potential quotes
    const headers = rawLines[0].split(delimiter).map(h => clean(h).toLowerCase());
    
    const fileIdx = headers.indexOf("file");
    const expIdx = headers.indexOf("experience");

    if (fileIdx === -1 || expIdx === -1) {
      addLog("CSV опыта должен содержать столбцы 'File' и 'Experience'.");
      return;
    }

    let updatedCount = 0;
    
    setSubjects(prev => {
        const next = [...prev];
        for (let i = 1; i < rawLines.length; i++) {
            const cols = rawLines[i].split(delimiter);
            const fileName = clean(cols[fileIdx] || '');
            const experience = clean(cols[expIdx] || '');

            if (fileName && experience) {
                // Match by ID which is the filename without extension
                const targetId = fileName.replace(/\.csv$/i, '');
                // Also check with extension just in case Subject ID was stored differently
                const idx = next.findIndex(s => s.id === targetId || s.id === fileName);
                if (idx !== -1) {
                    next[idx] = { ...next[idx], experience };
                    updatedCount++;
                }
            }
        }
        return next;
    });

    addLog(`Обновлен опыт для ${updatedCount} испытуемых.`);
    e.target.value = "";
  };

  useEffect(() => {
    setViewScale(1);
  }, [activeSubjectId]);

  const processCSV = (csv: string, subjectId: string) => {
    const rawLines = csv.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (rawLines.length < 10) throw new Error("Файл слишком короткий или поврежден.");

    const delimiter = detectDelimiter(rawLines[0]);
    
    // Check if the first line is a header
    const firstLineLower = rawLines[0].toLowerCase();
    const hasHeader = firstLineLower.includes('iselement') || 
                      firstLineLower.includes('trialnumber') || 
                      firstLineLower.includes('gender') || 
                      firstLineLower.includes('totaltasktime');

    let colMap: Record<string, number> = {};
    let scaleCols: { name: string, idx: number }[] = [];

    let isElemIdx = 0;
    let trialIdx = 1;
    let lineLengthIdx = 2;
    let xIdx = 3;
    let yIdx = 4;
    let time2Idx = 6;
    let genderIdx = -1;
    let ageIdx = -1;
    let solvedBeforeIdx = -1;
    let insightIdx = -1;
    let totalTaskTimeIdx = -1;
    let groupIdx = -1;
    let surnameIdx = -1;
    let firstnameIdx = -1;
    let nameIdx = -1;

    if (hasHeader) {
      const headerCols = rawLines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
      headerCols.forEach((col, idx) => {
        colMap[col.toLowerCase()] = idx;
      });

      isElemIdx = colMap['iselement'] ?? 0;
      trialIdx = colMap['trialnumber'] ?? colMap['trial'] ?? 1;
      lineLengthIdx = colMap['linelength'] ?? 2;
      xIdx = colMap['x'] ?? 3;
      yIdx = colMap['y'] ?? 4;
      time2Idx = colMap['time2'] ?? colMap['time1'] ?? 6;
      genderIdx = colMap['gender'] ?? -1;
      ageIdx = colMap['age'] ?? -1;
      solvedBeforeIdx = colMap['solvedbefore'] ?? -1;
      insightIdx = colMap['insight'] ?? -1;
      totalTaskTimeIdx = colMap['totaltasktime'] ?? -1;
      groupIdx = colMap['group'] ?? -1;

      for (const k of ['surname', 'lastname', 'last_name', 'фамилия', 'фамилия_испытуемого', 'secondname', 'second_name', 'familyname', 'family_name']) {
        if (colMap[k] !== undefined) { surnameIdx = colMap[k]; break; }
      }
      for (const k of ['firstname', 'first_name', 'имя', 'имя_испытуемого', 'forename', 'givenname', 'given_name']) {
        if (colMap[k] !== undefined) { firstnameIdx = colMap[k]; break; }
      }
      for (const k of ['name', 'фио', 'fio', 'full_name', 'fullname', 'subject_name', 'participant_name']) {
        if (colMap[k] !== undefined) { nameIdx = colMap[k]; break; }
      }

      // Identify scale columns (Russian scale names, slider1..sliderN, or any custom scales)
      const knownStandardCols = new Set([
        'iselement', 'trialnumber', 'linelength', 'x', 'y', 'time1', 'time2',
        'group', 'isinverted', 'inertiastep', 'inertiainc', 'inertiasmoothing',
        'mirrorsize', 'mirrorthickness', 'mirrorduration',
        'solvedbefore', 'insight', 'gender', 'age', 'trialduration', 'totaltasktime',
        'surname', 'lastname', 'last_name', 'фамилия', 'фамилия_испытуемого',
        'secondname', 'second_name', 'familyname', 'family_name',
        'firstname', 'first_name', 'имя', 'имя_испытуемого', 'forename', 'givenname', 'given_name',
        'name', 'фио', 'fio', 'full_name', 'fullname', 'subject_name', 'participant_name'
      ]);

      headerCols.forEach((col, idx) => {
        const lower = col.toLowerCase();
        if (!knownStandardCols.has(lower) || lower.startsWith('slider') || ['удовольствие', 'удивление', 'внезапность', 'облегчение', 'уверенность', 'драйв'].includes(lower)) {
          if (!['0', '1', '2', '3', '4', '5', '6', '7'].includes(col)) {
            scaleCols.push({ name: col, idx });
          }
        }
      });
    }

    // Extract 9 dots: Rows where isElement === '1' and dot has valid dimensions
    const rawCoords: { id: number, x: number, y: number, h: number, w: number }[] = [];
    let dotId = 1;

    for (let i = hasHeader ? 1 : 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const cols = line.split(delimiter);
      if (cols[isElemIdx] === '1') {
        const x = parseNum(cols[1]);
        const y = parseNum(cols[2]);
        const w = parseNum(cols[3]); // Column width
        const h = parseNum(cols[4]); // Column height

        if (!isNaN(x) && !isNaN(y) && (w > 5 || isNaN(w))) {
          rawCoords.push({ 
            id: dotId++, 
            x, 
            y, 
            h: isNaN(h) || h === 0 ? DOT_RADIUS * 2 : h, 
            w: isNaN(w) || w === 0 ? DOT_RADIUS * 2 : w 
          });
          if (rawCoords.length === 9) break;
        }
      }
    }

    if (rawCoords.length < 9) {
      throw new Error("Не удалось найти координаты 9 точек в файле (требуется 9 элементов с кодом 1).");
    }

    const uniqueX = Array.from(new Set(rawCoords.map(c => c.x))).sort((a, b) => a - b);
    const uniqueY = Array.from(new Set(rawCoords.map(c => c.y))).sort((a, b) => a - b);
    const dx = uniqueX.length > 1 ? (uniqueX[uniqueX.length - 1] - uniqueX[0]) / (uniqueX.length - 1) : 116;
    const dy = uniqueY.length > 1 ? (uniqueY[uniqueY.length - 1] - uniqueY[0]) / (uniqueY.length - 1) : 116;

    // 9 dots stably centered on canvas:
    const dot5 = rawCoords.find(c => c.id === 5) || rawCoords[4];
    const rawCenterX = dot5.x + dot5.w / 2;
    const rawCenterY = dot5.y + dot5.h / 2;
    const centerCanvas = CANVAS_SIZE / 2; // 400

    const extractedNodes: GridNode[] = rawCoords.map(c => ({
      id: c.id,
      rawX: c.x,
      rawY: c.y,
      x: centerCanvas + (c.x + c.w / 2 - rawCenterX),
      y: centerCanvas + (c.y + c.h / 2 - rawCenterY),
      w: c.w || DOT_RADIUS * 2,
      h: c.h || DOT_RADIUS * 2
    }));

    // Process trial lines and metadata
    const trialsMap = new Map<string | number, Point[]>();
    let lastName = subjectId;
    let firstName = '';
    let age = '---';
    let gender = 'другое';
    let solvedBefore = '';
    let insight = '';
    let totalTaskTime: number | undefined = undefined;
    let group = '';
    const surveyScales: Record<string, number> = {};
    let metadataExtracted = false;

    const dataStartIdx = hasHeader ? 1 : 0;

    for (let i = dataStartIdx; i < rawLines.length; i++) {
      const line = rawLines[i];
      const cols = line.split(delimiter);
      if (cols[isElemIdx] !== '0') continue;

      const trialIdRaw = cols[trialIdx]?.trim();
      const trialIdNum = parseInt(trialIdRaw, 10);
      const lineLengthVal = cols[lineLengthIdx]?.trim().toLowerCase();

      // Skip the screen resolution / setup row where lineLength is "seconds" or trialNumber is non-numeric
      if (isNaN(trialIdNum) || lineLengthVal === 'seconds' || trialIdNum <= 0) continue;

      const x = parseNum(cols[xIdx]);
      const y = parseNum(cols[yIdx]);
      // Timestamp: in uncleaned file time2 is col 6, in cleaned file time2 is col 6.
      const timestamp = time2Idx !== -1 ? parseNum(cols[time2Idx]) : 0;

      if (!isNaN(x) && !isNaN(y)) {
        if (!trialsMap.has(trialIdNum)) trialsMap.set(trialIdNum, []);
        const baseX = centerCanvas + (x - rawCenterX);
        const baseY = centerCanvas + (y - rawCenterY);
        trialsMap.get(trialIdNum)?.push({ x: baseX, y: baseY, t: isNaN(timestamp) ? 0 : timestamp });
      }

      // Extract metadata ONCE from the first non-empty participant row
      if (!metadataExtracted) {
        if (genderIdx !== -1 && cols[genderIdx]) {
          const rawG = cols[genderIdx].trim();
          const lowerG = rawG.toLowerCase();
          if (rawG === '0' || lowerG === 'женский' || lowerG === 'ж' || lowerG === 'female' || lowerG === 'f') {
            gender = 'женский';
          } else if (rawG === '1' || lowerG === 'мужской' || lowerG === 'м' || lowerG === 'male' || lowerG === 'm') {
            gender = 'мужской';
          } else {
            gender = rawG;
          }
        }
        if (ageIdx !== -1 && cols[ageIdx]) {
          const rawAge = cols[ageIdx].trim();
          if (rawAge) age = rawAge;
        }
        if (solvedBeforeIdx !== -1 && cols[solvedBeforeIdx]) {
          solvedBefore = cols[solvedBeforeIdx].trim();
        }
        if (insightIdx !== -1 && cols[insightIdx]) {
          insight = cols[insightIdx].trim();
        }
        if (totalTaskTimeIdx !== -1 && cols[totalTaskTimeIdx]) {
          const ttt = parseNum(cols[totalTaskTimeIdx]);
          if (!isNaN(ttt)) totalTaskTime = ttt;
        }
        if (groupIdx !== -1 && cols[groupIdx]) {
          group = cols[groupIdx].trim();
        }
        if (surnameIdx !== -1 && cols[surnameIdx]) {
          const rawSur = cols[surnameIdx].trim().replace(/^["']|["']$/g, '');
          if (rawSur) lastName = rawSur;
        }
        if (firstnameIdx !== -1 && cols[firstnameIdx]) {
          const rawFirst = cols[firstnameIdx].trim().replace(/^["']|["']$/g, '');
          if (rawFirst) firstName = rawFirst;
        }
        if (nameIdx !== -1 && cols[nameIdx]) {
          const rawName = cols[nameIdx].trim().replace(/^["']|["']$/g, '');
          if (rawName) {
            if (surnameIdx === -1 && firstnameIdx === -1) {
              const parts = rawName.split(/\s+/);
              if (parts.length >= 2) {
                lastName = parts[0];
                firstName = parts.slice(1).join(' ');
              } else {
                lastName = rawName;
              }
            } else if (surnameIdx !== -1 && firstnameIdx === -1) {
              firstName = rawName;
            } else if (firstnameIdx !== -1 && surnameIdx === -1) {
              lastName = rawName;
            }
          }
        }

        scaleCols.forEach(sc => {
          if (cols[sc.idx]) {
            const val = parseNum(cols[sc.idx]);
            if (!isNaN(val)) surveyScales[sc.name] = val;
          }
        });

        if (gender !== 'другое' || age !== '---' || solvedBefore || totalTaskTime !== undefined || lastName !== subjectId || firstName !== '') {
          metadataExtracted = true;
        }
      }
    }

    const rx = dx / 2;
    const ry = dy / 2;
    const trials: ProcessedTrial[] = [];

    trialsMap.forEach((points, trialId) => {
      if (points.length < 2) return;

      const trial_time_ms = points[points.length - 1].t || 0;
      const { lines, breakPoints, smoothed } = performSegmentation(points, angleThreshold, minLineLength);

      const lineSegments: LineSegment[] = lines.map(line => {
        const visited: number[] = [];
        for (let i = 0; i < line.points.length - 1; i++) {
          const p1 = line.points[i];
          const p2 = line.points[i + 1];
          extractedNodes.forEach(node => {
            const d = distToSegment(
              { x: node.x / rx, y: node.y / ry },
              { x: p1.x / rx, y: p1.y / ry },
              { x: p2.x / rx, y: p2.y / ry }
            );
            if (d <= 1.0) {
              if (visited[visited.length - 1] !== node.id) visited.push(node.id);
            }
          });
        }
        return {
          ...line,
          nodesVisited: visited,
          type: classifyLine(visited)
        };
      });

      if (lineSegments.length > 0) {
        trials.push({
          subjectId,
          trialId,
          basePoints: points,
          points,
          smoothedPoints: smoothed,
          startPoint: points[0],
          lines: lineSegments,
          breakPoints: breakPoints,
          trial_time_ms: trial_time_ms
        });
      }
    });

    return { 
        trials, 
        nodes: extractedNodes, 
        cellSize: { w: dx, h: dy },
        metadata: { lastName, firstName, age, gender, solvedBefore, insight, totalTaskTime, surveyScales, group } 
    };
  };

  const filteredTrials = useMemo(() => {
    return processedData.filter(t => {
      if (activeSubjectId && t.subjectId !== activeSubjectId) return false;

      const overrideKey = `${t.subjectId}-${t.trialId}`;
      const isOverridden = manualOverrides.has(overrideKey);
      
      if (filterOverridesOnly && !isOverridden) return false;

      const firstLineNode = t.lines[0]?.nodesVisited[0];
      const lastLine = t.lines[t.lines.length - 1];
      const lastNode = lastLine?.nodesVisited[lastLine.nodesVisited.length - 1];

      if (filterStartNode !== null && firstLineNode !== filterStartNode) return false;
      if (filterFinishNode !== null && lastNode !== filterFinishNode) return false;
      
      if (filterTypes.size > 0) {
        if (isOverridden) {
          if (!filterTypes.has('прочая')) return false;
        } else {
          const hasAnyMatchingLine = t.lines.some(l => filterTypes.has(l.type));
          if (!hasAnyMatchingLine) return false;
        }
      }
      return true;
    });
  }, [processedData, filterTypes, filterStartNode, filterFinishNode, filterOverridesOnly, manualOverrides, activeSubjectId]);

  const selectedTrial = useMemo(() => {
    if (selectedTrialId === null) return null;
    return processedData.find(t => t.trialId === selectedTrialId && t.subjectId === activeSubjectId) || null;
  }, [selectedTrialId, processedData, activeSubjectId]);

  const getNormalizedPoint = useCallback((point: Point, trial: ProcessedTrial, sub: SubjectData) => {
    const centerNode = sub.nodes.find(n => n.id === 5);
    const centerX = centerNode ? centerNode.x : CANVAS_SIZE / 2;
    const centerY = centerNode ? centerNode.y : CANVAS_SIZE / 2;
    
    const rx = point.x - centerX;
    const ry = point.y - centerY;
    
    return { x: rx, y: ry, subjectId: sub.id, trialId: trial.trialId };
  }, []);

  const averageNormalizedNodes = useMemo(() => {
    if (subjects.length === 0) return [];
    
    const nodeSums: Record<number, { x: number, y: number, count: number }> = {};
    
    subjects.forEach(sub => {
      const centerNode = sub.nodes.find(n => n.id === 5);
      const centerX = centerNode ? centerNode.x : CANVAS_SIZE / 2;
      const centerY = centerNode ? centerNode.y : CANVAS_SIZE / 2;
      
      sub.nodes.forEach(node => {
        if (!nodeSums[node.id]) nodeSums[node.id] = { x: 0, y: 0, count: 0 };
        nodeSums[node.id].x += (node.x - centerX);
        nodeSums[node.id].y += (node.y - centerY);
        nodeSums[node.id].count += 1;
      });
    });

    return Object.entries(nodeSums).map(([id, sum]) => ({
      id: parseInt(id),
      x: sum.x / sum.count,
      y: sum.y / sum.count
    })).sort((a, b) => a.id - b.id);
  }, [subjects]);

  const globalHeatmapAll = useMemo(() => {
    const pts: HeatPoint[] = [];
    processedData.forEach(trial => {
      const sub = subjects.find(s => s.id === trial.subjectId);
      if (!sub) return;
      const pt = getNormalizedPoint(trial.startPoint, trial, sub);
      if (pt) pts.push(pt);
    });
    return pts;
  }, [processedData, subjects, getNormalizedPoint]);

  const globalHeatmapFinishAll = useMemo(() => {
    const pts: HeatPoint[] = [];
    processedData.forEach(trial => {
      const sub = subjects.find(s => s.id === trial.subjectId);
      if (!sub) return;
      const lastPoint = trial.points[trial.points.length - 1];
      const pt = getNormalizedPoint(lastPoint, trial, sub);
      if (pt) pts.push(pt);
    });
    return pts;
  }, [processedData, subjects, getNormalizedPoint]);

  const globalHeatmapCorrectLast = useMemo(() => {
    const pts: HeatPoint[] = [];
    subjects.filter(s => s.isSolved).forEach(sub => {
      const subTrials = processedData.filter(t => t.subjectId === sub.id);
      if (subTrials.length === 0) return;
      const lastTrial = subTrials[subTrials.length - 1];
      const pt = getNormalizedPoint(lastTrial.startPoint, lastTrial, sub);
      if (pt) pts.push(pt);
    });
    return pts;
  }, [processedData, subjects, getNormalizedPoint]);

  const globalHeatmapFinishCorrectLast = useMemo(() => {
    const pts: HeatPoint[] = [];
    subjects.filter(s => s.isSolved).forEach(sub => {
      const subTrials = processedData.filter(t => t.subjectId === sub.id);
      if (subTrials.length === 0) return;
      const lastTrial = subTrials[subTrials.length - 1];
      const lastPoint = lastTrial.points[lastTrial.points.length - 1];
      const pt = getNormalizedPoint(lastPoint, lastTrial, sub);
      if (pt) pts.push(pt);
    });
    return pts;
  }, [processedData, subjects, getNormalizedPoint]);

  const experienceGroups = useMemo(() => {
    const groups: Record<string, { start: HeatPoint[], finish: HeatPoint[], solvedFinalStart: HeatPoint[], solvedFinalFinish: HeatPoint[] }> = {};
    const uniqueExps = Array.from(new Set(subjects.map(s => s.experience))) as string[];
    
    uniqueExps.forEach(exp => {
      groups[exp] = { start: [], finish: [], solvedFinalStart: [], solvedFinalFinish: [] };
      const groupSubjectIds = new Set(subjects.filter(s => s.experience === exp).map(s => s.id));
      const solvedGroupSubjectIds = new Set(subjects.filter(s => s.experience === exp && s.isSolved).map(s => s.id));
      
      const groupTrials = processedData.filter(t => groupSubjectIds.has(t.subjectId));
      
      groupTrials.forEach(trial => {
        const sub = subjects.find(s => s.id === trial.subjectId);
        if (!sub) return;
        
        const ptStart = getNormalizedPoint(trial.startPoint, trial, sub);
        if (ptStart) groups[exp].start.push(ptStart);
        
        const lastPoint = trial.points[trial.points.length - 1];
        const ptFinish = getNormalizedPoint(lastPoint, trial, sub);
        if (ptFinish) groups[exp].finish.push(ptFinish);
      });

      solvedGroupSubjectIds.forEach(sId => {
        const sub = subjects.find(s => s.id === sId);
        const subTrials = processedData.filter(t => t.subjectId === sId);
        if (!sub || subTrials.length === 0) return;
        
        const finalTrial = subTrials[subTrials.length - 1];
        
        const ptStartFinal = getNormalizedPoint(finalTrial.startPoint, finalTrial, sub);
        if (ptStartFinal) groups[exp].solvedFinalStart.push(ptStartFinal);

        const finalPoint = finalTrial.points[finalTrial.points.length - 1];
        const ptFinishFinal = getNormalizedPoint(finalPoint, finalTrial, sub);
        if (ptFinishFinal) groups[exp].solvedFinalFinish.push(ptFinishFinal);
      });
    });
    return groups;
  }, [subjects, processedData, getNormalizedPoint]);

  const globalLineMapAll = useMemo(() => {
    const lines: HeatLine[] = [];
    processedData.forEach(trial => {
      const sub = subjects.find(s => s.id === trial.subjectId);
      if (!sub) return;
      const normalizedPoints = trial.points.map(p => getNormalizedPoint(p, trial, sub)).filter(p => p !== null) as {x: number, y: number}[];
      if (normalizedPoints.length > 1) {
        lines.push({ points: normalizedPoints, subjectId: sub.id, trialId: trial.trialId });
      }
    });
    return lines;
  }, [processedData, subjects, getNormalizedPoint]);

  const globalLineMapCorrectLast = useMemo(() => {
    const lines: HeatLine[] = [];
    subjects.filter(s => s.isSolved).forEach(sub => {
      const subTrials = processedData.filter(t => t.subjectId === sub.id);
      if (subTrials.length === 0) return;
      const lastTrial = subTrials[subTrials.length - 1];
      const normalizedPoints = lastTrial.points.map(p => getNormalizedPoint(p, lastTrial, sub)).filter(p => p !== null) as {x: number, y: number}[];
      if (normalizedPoints.length > 1) {
        lines.push({ points: normalizedPoints, subjectId: sub.id, trialId: lastTrial.trialId });
      }
    });
    return lines;
  }, [processedData, subjects, getNormalizedPoint]);

  const experienceLineGroups = useMemo(() => {
    const groups: Record<string, { all: HeatLine[], solvedFinal: HeatLine[] }> = {};
    const uniqueExps = Array.from(new Set(subjects.map(s => s.experience))) as string[];
    
    uniqueExps.forEach(exp => {
      groups[exp] = { all: [], solvedFinal: [] };
      const groupSubjectIds = new Set(subjects.filter(s => s.experience === exp).map(s => s.id));
      const solvedGroupSubjectIds = new Set(subjects.filter(s => s.experience === exp && s.isSolved).map(s => s.id));
      
      const groupTrials = processedData.filter(t => groupSubjectIds.has(t.subjectId));
      
      groupTrials.forEach(trial => {
        const sub = subjects.find(s => s.id === trial.subjectId);
        if (!sub) return;
        const normalizedPoints = trial.points.map(p => getNormalizedPoint(p, trial, sub)).filter(p => p !== null) as {x: number, y: number}[];
        if (normalizedPoints.length > 1) {
          groups[exp].all.push({ points: normalizedPoints, subjectId: sub.id, trialId: trial.trialId });
        }
      });

      solvedGroupSubjectIds.forEach(sId => {
        const sub = subjects.find(s => s.id === sId);
        const subTrials = processedData.filter(t => t.subjectId === sId);
        if (!sub || subTrials.length === 0) return;
        
        const finalTrial = subTrials[subTrials.length - 1];
        const normalizedPoints = finalTrial.points.map(p => getNormalizedPoint(p, finalTrial, sub)).filter(p => p !== null) as {x: number, y: number}[];
        if (normalizedPoints.length > 1) {
          groups[exp].solvedFinal.push({ points: normalizedPoints, subjectId: sub.id, trialId: finalTrial.trialId });
        }
      });
    });
    return groups;
  }, [subjects, processedData, getNormalizedPoint]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || activeNodes.length === 0) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.save();
    ctx.scale(viewScale, viewScale);

    const pulse = isCalibrating ? Math.sin(animationTick / 300) * 0.5 + 0.5 : 0;

    if (showHeatmap && filteredTrials.length > 0) {
      ctx.globalCompositeOperation = 'multiply';
      filteredTrials.forEach(t => {
        const radius = (activeCellSize.w * 0.6) / viewScale;
        const grad = ctx.createRadialGradient(t.startPoint.x, t.startPoint.y, 0, t.startPoint.x, t.startPoint.y, radius);
        grad.addColorStop(0, 'rgba(239, 68, 68, 0.15)');
        grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(t.startPoint.x, t.startPoint.y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
    }

    if (showFinishHeatmap && filteredTrials.length > 0) {
      ctx.globalCompositeOperation = 'multiply';
      filteredTrials.forEach(t => {
        const lastPoint = t.points[t.points.length - 1];
        const radius = (activeCellSize.w * 0.6) / viewScale;
        const grad = ctx.createRadialGradient(lastPoint.x, lastPoint.y, 0, lastPoint.x, lastPoint.y, radius);
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.15)');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
    }

    activeNodes.forEach(node => {
      const hitPadding = activeSubject?.calibration.hitPadding || 0;
      const hitW = node.w + hitPadding * 2;
      const hitH = node.h + hitPadding * 2;

      if (isCalibrating) {
        ctx.beginPath();
        ctx.ellipse(node.x, node.y, hitW / 2, hitH / 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(249, 115, 22, ${0.05 + pulse * 0.1})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(249, 115, 22, ${0.3 + pulse * 0.4})`;
        ctx.lineWidth = 2 / viewScale;
        ctx.setLineDash([5 / viewScale, 3 / viewScale]);
        ctx.stroke();
        ctx.setLineDash([]);
        
        const glowRadius = (Math.max(node.w, node.h) / 2 + 4 + pulse * 4) / viewScale;
        const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
        gradient.addColorStop(0, `rgba(249, 115, 22, ${0.8 * pulse})`);
        gradient.addColorStop(1, 'rgba(249, 115, 22, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      
      const isStartNode = filterStartNode === node.id;
      const isFinishNode = filterFinishNode === node.id;
      
      if (!isCalibrating) {
        ctx.beginPath();
        ctx.ellipse(node.x, node.y, hitW / 2, hitH / 2, 0, 0, Math.PI * 2);
        if (isStartNode) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
          ctx.lineWidth = 2 / viewScale;
        } else if (isFinishNode) {
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
          ctx.lineWidth = 2 / viewScale;
        } else {
          ctx.strokeStyle = 'rgba(203, 213, 225, 0.15)';
          ctx.lineWidth = 1 / viewScale;
        }
        ctx.stroke();
      }
      
      ctx.beginPath();
      const nodeW = (node.w || DOT_RADIUS * 2) / viewScale;
      const nodeH = (node.h || DOT_RADIUS * 2) / viewScale;
      ctx.ellipse(node.x, node.y, nodeW / 2, nodeH / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = isCalibrating ? '#f97316' : '#1e293b';
      ctx.shadowBlur = isCalibrating ? 15 * pulse : 0;
      ctx.shadowColor = '#f97316';
      ctx.fill();
      ctx.shadowBlur = 0;
      
      if (isCalibrating) {
        ctx.fillStyle = 'white';
        ctx.font = `bold ${8 / viewScale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.id.toString(), node.x, node.y);
      }
    });

    const trialsToDraw = selectedTrialId !== null 
      ? (selectedTrial ? [selectedTrial] : [])
      : filteredTrials;

    trialsToDraw.forEach(trial => {
      const isSelected = selectedTrialId === trial.trialId;
      const isHovered = hoveredTrialId === trial.trialId;
      const overrideKey = `${trial.subjectId}-${trial.trialId}`;
      const isOverridden = manualOverrides.has(overrideKey);
      
      trial.lines.forEach((line, lIdx) => {
        const type = isOverridden ? 'прочая' : line.type;
        const isTargetType = filterTypes.size === 0 || filterTypes.has(type);
        
        ctx.beginPath();
        ctx.moveTo(line.points[0].x, line.points[0].y);
        line.points.forEach(p => ctx.lineTo(p.x, p.y));
        
        if (isHovered && !isSelected) {
            ctx.shadowBlur = 10 / viewScale;
            ctx.shadowColor = 'rgba(59, 130, 246, 0.8)';
            ctx.lineWidth = 6 / viewScale;
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        ctx.lineWidth = (isSelected ? 5 : (isTargetType ? 3 : 0.5)) / viewScale;
        ctx.strokeStyle = isSelected 
          ? 'rgba(37, 99, 235, 1)' 
          : (isTargetType ? (isOverridden ? 'rgba(148, 163, 184, 0.6)' : 'rgba(59, 130, 246, 0.6)') : 'rgba(203, 213, 225, 0.2)');
        
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        if (isSelected && line.points.length > 5) {
          const midIdx = Math.floor(line.points.length / 2);
          const p1 = line.points[midIdx - 2];
          const p2 = line.points[midIdx + 2];
          if (p1 && p2) {
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            ctx.beginPath();
            ctx.save();
            ctx.translate(p2.x, p2.y);
            ctx.rotate(angle);
            ctx.moveTo(0, 0);
            ctx.lineTo(-10 / viewScale, -5 / viewScale);
            ctx.lineTo(-10 / viewScale, 5 / viewScale);
            ctx.closePath();
            ctx.fillStyle = 'rgba(37, 99, 235, 1)';
            ctx.fill();
            ctx.restore();
          }
        }
      });

      if (showBreaks || isSelected || isHovered) {
        trial.breakPoints.forEach(bp => {
          ctx.beginPath();
          ctx.arc(bp.x, bp.y, (isSelected || isHovered ? 4 : 3) / viewScale, 0, Math.PI * 2);
          ctx.fillStyle = isOverridden ? 'rgba(148, 163, 184, 0.5)' : '#fbbf24';
          ctx.fill();
        });
      }

      ctx.beginPath();
      ctx.arc(trial.startPoint.x, trial.startPoint.y, (isSelected || isHovered ? 6 : 4) / viewScale, 0, Math.PI * 2);
      ctx.fillStyle = isOverridden ? 'rgba(148, 163, 184, 0.4)' : 'rgba(239, 68, 68, 0.7)';
      ctx.fill();

      if (isSelected) {
        trial.lines.forEach((line, lIdx) => {
          if (line.nodesVisited.length > 0) {
            const lastNodeId = line.nodesVisited[line.nodesVisited.length - 1];
            const lastNode = activeNodes.find(n => n.id === lastNodeId);
            if (lastNode) {
              ctx.shadowBlur = 4 / viewScale;
              ctx.shadowColor = 'white';
              ctx.fillStyle = '#2563eb';
              ctx.font = `bold ${14 / viewScale}px sans-serif`;
              ctx.textAlign = 'center';
              const nodeY = lastNode.y as number;
              ctx.fillText(String(lIdx + 1), lastNode.x, nodeY + (20 / viewScale));
              ctx.shadowBlur = 0;
            }
          }
        });
      }
    });

    ctx.restore();
  }, [activeNodes, activeCellSize, filteredTrials, viewScale, filterStartNode, filterFinishNode, filterTypes, filterOverridesOnly, showBreaks, showHeatmap, showFinishHeatmap, manualOverrides, selectedTrialId, hoveredTrialId, processedData, activeSubjectId, isCalibrating, animationTick, selectedTrial]);

  const toggleLineExclusion = (subjectId: string, trialId: string | number, lineIdx: number) => {
    const key = `${subjectId}-${trialId}-${lineIdx}`;
    setExcludedLines(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const stats = useMemo(() => {
    const currentData = processedData.filter(t => !activeSubjectId || t.subjectId === activeSubjectId);
    
    const calculateForSet = (data: ProcessedTrial[]) => {
      const lineTypeCounts: Record<string, number> = {};
      const startNodeCounts: Record<number, number> = {};
      const finishNodeCounts: Record<number, number> = {};
      let totalOverrides = 0;
      let total_solution_time_ms = 0;
      let linesBothEndsInNodes = 0;
      let linesAnyEndOutside = 0;
      let totalLinesLength = 0;
      let totalLinesCount = 0;
      let totalOutsideLinesLength = 0;
      let totalOutsideLinesCount = 0;

      data.forEach(t => {
        const sub = subjects.find(s => s.id === t.subjectId);
        const subNodes = sub ? sub.nodes.map(n => ({
          ...n,
          x: n.x + sub.calibration.offsetX,
          y: n.y + sub.calibration.offsetY
        })) : [];
        const hitPadding = sub?.calibration.hitPadding ?? 15;

        const isAtNode = (p: Point) => subNodes.some(node => {
          const rx = (node.w / 2) + hitPadding;
          const ry = (node.h / 2) + hitPadding;
          const dx = (p.x - node.x) / rx;
          const dy = (p.y - node.y) / ry;
          return (dx * dx + dy * dy) <= 1.0;
        });

        const overrideKey = `${t.subjectId}-${t.trialId}`;
        const isOverridden = manualOverrides.has(overrideKey);
        if (isOverridden) totalOverrides++;

        total_solution_time_ms += t.trial_time_ms;

        t.lines.forEach((l, idx) => {
          if (excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`)) return;
          const type = isOverridden ? 'прочая' : l.type;
          lineTypeCounts[type] = (lineTypeCounts[type] || 0) + 1;

          let lineLen = 0;
          for (let m = 0; m < l.points.length - 1; m++) {
            lineLen += calculateDistance(l.points[m], l.points[m + 1]);
          }
          totalLinesLength += lineLen;
          totalLinesCount++;

          const startAtNode = isAtNode(l.points[0]);
          const endAtNode = isAtNode(l.points[l.points.length - 1]);
          if (startAtNode && endAtNode) linesBothEndsInNodes++;
          if (!startAtNode || !endAtNode) {
            linesAnyEndOutside++;
            totalOutsideLinesLength += lineLen;
            totalOutsideLinesCount++;
          }
        });
        const firstNode = t.lines[0]?.nodesVisited[0];
        if (typeof firstNode === 'number') {
          startNodeCounts[firstNode] = (startNodeCounts[firstNode] || 0) + 1;
        }
        const lastLine = t.lines[t.lines.length - 1];
        const lastNode = lastLine?.nodesVisited[lastLine.nodesVisited.length - 1];
        if (typeof lastNode === 'number') {
          finishNodeCounts[lastNode] = (finishNodeCounts[lastNode] || 0) + 1;
        }
      });

      const totalLines = Object.values(lineTypeCounts).reduce((a, b) => (a as number) + (b as number), 0);
      const mean_trial_time_ms = data.length > 0 ? total_solution_time_ms / data.length : 0;
      const avgAllLinesLength = totalLinesCount > 0 ? totalLinesLength / totalLinesCount : 0;
      const avgOutsideLinesLength = totalOutsideLinesCount > 0 ? totalOutsideLinesLength / totalOutsideLinesCount : 0;

      return {
        lineTypeCounts, startNodeCounts, finishNodeCounts, totalLines,
        totalTrials: data.length, totalOverrides,
        total_solution_time_ms, mean_trial_time_ms,
        linesBothEndsInNodes, linesAnyEndOutside,
        avgAllLinesLength, avgOutsideLinesLength
      };
    };

    const overall = calculateForSet(currentData);
    
    // First Trial First Line Type
    let firstTrialFirstLineType = 'none';
    const firstTrial = currentData[0];
    if (firstTrial) {
      const isOverridden = manualOverrides.has(`${firstTrial.subjectId}-${firstTrial.trialId}`);
      firstTrialFirstLineType = firstTrial.lines[0] ? (isOverridden ? 'прочая' : firstTrial.lines[0].type) : 'none';
    }

    if (!usePhasedMode || currentData.length < 3) {
      return { ...overall, phases: null, firstTrialFirstLineType };
    }

    const phaseSize = Math.floor(currentData.length / 3);
    const p1 = currentData.slice(0, phaseSize);
    const p2 = currentData.slice(phaseSize, phaseSize * 2);
    const p3 = currentData.slice(phaseSize * 2);

    return {
      ...overall,
      firstTrialFirstLineType,
      phases: {
        beginning: calculateForSet(p1),
        middle: calculateForSet(p2),
        end: calculateForSet(p3)
      }
    };
  }, [processedData, manualOverrides, excludedLines, activeSubjectId, usePhasedMode]);

  const toggleOverride = (trial: ProcessedTrial) => {
    const key = `${trial.subjectId}-${trial.trialId}`;
    setManualOverrides(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleFilterType = (type: string) => {
    setFilterTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const navigateTrial = (direction: 'next' | 'prev') => {
    const currentSubjectTrials = processedData.filter(t => t.subjectId === activeSubjectId);
    if (currentSubjectTrials.length === 0) return;
    
    const ids = currentSubjectTrials.map(t => t.trialId);
    const currIdx = selectedTrialId !== null ? ids.indexOf(selectedTrialId) : -1;
    if (currIdx === -1) return;
    
    let nextIdx: number;
    if (direction === 'next') {
        nextIdx = currIdx + 1;
    } else {
        nextIdx = currIdx - 1;
    }
    
    if (nextIdx < 0) nextIdx = ids.length - 1;
    if (nextIdx >= ids.length) nextIdx = 0;
    
    setSelectedTrialId(ids[nextIdx]);
  };

  const exportCSV = () => {
    const headers = ['LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'totalTaskTime', 'Experience', 'SubjectId', 'Group', 'IsSolved', 'TrialId', 'trial_time_ms', 'LineIdx', 'OriginalType', 'ActualType', 'IsManualOverride', 'Nodes', 'StartX', 'StartY', 'FinishX', 'FinishY', 'StartsAtNode', 'EndsAtNode', 'BothInDots', 'AnyOutDots', 'TrialFinishNode', 'CalibrationOffsetX', 'CalibrationOffsetY', 'CalibrationScale', 'AoI'];
    const rows = filteredTrials.flatMap(t => {
        const overrideKey = `${t.subjectId}-${t.trialId}`;
        const isOverridden = manualOverrides.has(overrideKey);
        const lastLineOfTrial = t.lines[t.lines.length - 1];
        const trialFinishNode = lastLineOfTrial?.nodesVisited[lastLineOfTrial.nodesVisited.length - 1] || 'none';
        const subject = subjects.find(s => s.id === t.subjectId);
        const cal = subject?.calibration || { offsetX: 0, offsetY: 0, scale: 1, hitPadding: 15 };
        const isSolved = subject?.isSolved || false;
        const hitPadding = cal.hitPadding ?? 15;

        const subNodes = subject ? subject.nodes : [];

        const isAtNode = (p: Point) => subNodes.some(node => {
          const rx = (node.w / 2) + hitPadding;
          const ry = (node.h / 2) + hitPadding;
          const dx = (p.x - node.x) / rx;
          const dy = (p.y - node.y) / ry;
          return (dx * dx + dy * dy) <= 1.0;
        });
        
        return t.lines.map((l, idx) => {
            const startAtNode = isAtNode(l.points[0]);
            const endAtNode = isAtNode(l.points[l.points.length - 1]);
            return [
                subject?.lastName || '',
                subject?.firstName || '',
                subject?.age || '',
                subject?.gender || '',
                subject?.solvedBefore || '',
                subject?.insight || '',
                subject?.totalTaskTime !== undefined ? subject.totalTaskTime.toString() : '',
                subject?.experience || '',
                t.subjectId,
                subjectGroups[t.subjectId] || 'None',
                isSolved ? '1' : '0',
                t.trialId,
                t.trial_time_ms.toFixed(0),
                idx + 1, 
                l.type, 
                isOverridden ? 'прочая' : l.type,
                isOverridden ? 'true' : 'false',
                l.nodesVisited.join('-'), 
                l.points[0].x.toFixed(1), 
                l.points[0].y.toFixed(1),
                l.points[l.points.length - 1].x.toFixed(1),
                l.points[l.points.length - 1].y.toFixed(1),
                startAtNode ? '1' : '0',
                endAtNode ? '1' : '0',
                (startAtNode && endAtNode) ? '1' : '0',
                (!startAtNode || !endAtNode) ? '1' : '0',
                trialFinishNode,
                cal.offsetX,
                cal.offsetY,
                cal.scale,
                hitPadding
            ];
        });
    });
    const blob = new Blob([[headers.join(','), ...rows.map(r => r.join(','))].join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `filtered_export_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  const exportAllDataCSV = () => {
    if (processedData.length === 0) return;
    const headers = ['LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'totalTaskTime', 'Experience', 'SubjectId', 'Group', 'IsSolved', 'TrialId', 'trial_time_ms', 'LineIdx', 'OriginalType', 'ActualType', 'IsManualOverride', 'Nodes', 'StartX', 'StartY', 'FinishX', 'FinishY', 'StartsAtNode', 'EndsAtNode', 'BothInDots', 'AnyOutDots', 'TrialFinishNode', 'CalibrationOffsetX', 'CalibrationOffsetY', 'CalibrationScale', 'AoI'];
    
    const rows = subjects.flatMap(subject => {
        const rawSubjectTrials = processedData.filter(t => t.subjectId === subject.id);
        const hitPadding = subject.calibration.hitPadding ?? 15;
        const subNodes = subject.nodes;
        const subjectTrials = processedData.filter(t => t.subjectId === subject.id);
        const isSolved = subject.isSolved || false;
        const cal = subject.calibration;

        const isAtNode = (p: Point) => subNodes.some(node => {
          const rx = (node.w / 2) + hitPadding;
          const ry = (node.h / 2) + hitPadding;
          const dx = (p.x - node.x) / rx;
          const dy = (p.y - node.y) / ry;
          return (dx * dx + dy * dy) <= 1.0;
        });

        return subjectTrials.flatMap(t => {
            const overrideKey = `${t.subjectId}-${t.trialId}`;
            const isOverridden = manualOverrides.has(overrideKey);
            const lastLineOfTrial = t.lines[t.lines.length - 1];
            const trialFinishNode = lastLineOfTrial?.nodesVisited[lastLineOfTrial.nodesVisited.length - 1] || 'none';
            
            return t.lines.map((l, idx) => {
                const startAtNode = isAtNode(l.points[0]);
                const endAtNode = isAtNode(l.points[l.points.length - 1]);
                return [
                    subject.lastName || '',
                    subject.firstName || '',
                    subject.age || '',
                    subject.gender || '',
                    subject.solvedBefore || '',
                    subject.insight || '',
                    subject.totalTaskTime !== undefined ? subject.totalTaskTime.toString() : '',
                    subject.experience || '',
                    t.subjectId,
                    subjectGroups[subject.id] || 'None',
                    isSolved ? '1' : '0',
                    t.trialId,
                    t.trial_time_ms.toFixed(0),
                    idx + 1, 
                    l.type, 
                    isOverridden ? 'прочая' : l.type,
                    isOverridden ? 'true' : 'false',
                    l.nodesVisited.join('-'), 
                    l.points[0].x.toFixed(1), 
                    l.points[0].y.toFixed(1),
                    l.points[l.points.length - 1].x.toFixed(1),
                    l.points[l.points.length - 1].y.toFixed(1),
                    startAtNode ? '1' : '0',
                    endAtNode ? '1' : '0',
                    (startAtNode && endAtNode) ? '1' : '0',
                    (!startAtNode || !endAtNode) ? '1' : '0',
                    trialFinishNode,
                    cal.offsetX,
                    cal.offsetY,
                    cal.scale,
                    hitPadding
                ];
            });
        });
    });
    const blob = new Blob([[headers.join(','), ...rows.map(r => r.join(','))].join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `all_subjects_full_export_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  const exportStatsCSV = () => {
    const lineTypes = ['боковая', 'центральная', 'диагональная', 'хордовая', 'хорды_длинные', 'внешняя', 'касательная', 'прочая'];
    const nodeIds = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    // Build headers for the 4 positions
    const posHeaders = [1, 2, 3, 4].flatMap(pos => 
      lineTypes.map(type => `Pos${pos}_Type_${type}`)
    );

    const phases = ['Beg', 'Mid', 'End'];
    
    const phaseHeaders = phases.flatMap(p => [
      `${p}_TrialsCount`, `${p}_LinesCount`, `${p}_mean_trial_time_ms`, `${p}_total_solution_time_ms`,
      `${p}_TotalTurns`, `${p}_NonDotTurns`, `${p}_NonDotTurnsRatio`,
      `${p}_LinesStartOutsideMatrixAbs`, `${p}_LinesStartOutsideMatrixRel`,
      `${p}_LinesFinishOutsideMatrixAbs`, `${p}_LinesFinishOutsideMatrixRel`,
      `${p}_Lines3PointsAbs`, `${p}_Lines3PointsRel`,
      `${p}_Lines2PointsAbs`, `${p}_Lines2PointsRel`,
      `${p}_Lines1PointAbs`, `${p}_Lines1PointRel`,
      `${p}_LinesBothEndsInNodesAbs`, `${p}_LinesBothEndsInNodesRel`,
      `${p}_LinesAnyEndOutsideAbs`, `${p}_LinesAnyEndOutsideRel`,
      `${p}_AvgAllLinesLength`, `${p}_AvgOutsideLinesLength`,
      ...lineTypes.map(t => `${p}_LineType_${t}`),
      ...nodeIds.map(n => `${p}_StartNode_${n}`),
      ...nodeIds.map(n => `${p}_FinishNode_${n}`)
    ]);

    const allScaleNames = Array.from(
      new Set(subjects.flatMap(s => Object.keys(s.surveyScales || {})))
    );

    const headers = [
      'LastName', 'FirstName', 'Age', 'Gender', 'SolvedBefore', 'Insight', 'totalTaskTime',
      ...allScaleNames.map(sc => `Scale_${sc}`),
      'Experience', 'SubjectId', 'Group', 'IsSolved', 'TrialsCount', 'LinesCount', 'mean_trial_time_ms', 'total_solution_time_ms',
      'SolutionStartNode', 'SolutionFinishNode', 'SolutionStartLine',
      'FirstTrialStartNode', 'FirstTrialFinishNode', 'FirstTrialFirstLineType',
      'TotalTurns', 'NonDotTurns', 'NonDotTurnsRatio',
      'LinesStartOutsideMatrixAbs', 'LinesStartOutsideMatrixRel',
      'LinesFinishOutsideMatrixAbs', 'LinesFinishOutsideMatrixRel',
      'Lines3PointsAbs', 'Lines3PointsRel',
      'Lines2PointsAbs', 'Lines2PointsRel',
      'Lines1PointAbs', 'Lines1PointRel',
      'LinesBothEndsInNodesAbs', 'LinesBothEndsInNodesRel',
      'LinesAnyEndOutsideAbs', 'LinesAnyEndOutsideRel',
      'AvgAllLinesLength', 'AvgOutsideLinesLength',
      ...lineTypes.map(t => `LineType_${t}`),
      ...nodeIds.map(n => `StartNode_${n}`),
      ...nodeIds.map(n => `FinishNode_${n}`),
      ...posHeaders,
      ...phaseHeaders
    ];

    const subjectRows = subjects.map(s => {
        const rawSubjectTrials = processedData.filter(t => t.subjectId === s.id);
        const hitPadding = s.calibration.hitPadding ?? 15;
        
        // Calibrated nodes for this subject
        const subNodes = s.nodes;
        const subjectTrials = processedData.filter(t => t.subjectId === s.id);

        const isPointInAnyNodeLocal = (p: Point) => {
          return subNodes.some(node => {
            const rx = (node.w / 2) + hitPadding;
            const ry = (node.h / 2) + hitPadding;
            const dx = (p.x - node.x) / rx;
            const dy = (p.y - node.y) / ry;
            return (dx * dx + dy * dy) <= 1.0;
          });
        };

        // First Trial Info
        const firstTrial = subjectTrials.length > 0 ? subjectTrials[0] : null;
        let firstTrialStartNode = 'none';
        let firstTrialFinishNode = 'none';
        let firstTrialFirstLineType = 'none';
        if (firstTrial) {
          const allNodes = firstTrial.lines.flatMap(l => l.nodesVisited);
          if (allNodes.length > 0) {
            firstTrialStartNode = allNodes[0].toString();
            firstTrialFinishNode = allNodes[allNodes.length - 1].toString();
          }
          const isOverridden = manualOverrides.has(`${firstTrial.subjectId}-${firstTrial.trialId}`);
          firstTrialFirstLineType = firstTrial.lines[0] ? (isOverridden ? 'прочая' : firstTrial.lines[0].type) : 'none';
        }

        // Turn Stats
        let totalTurns = 0;
        let nonDotTurns = 0;
        subjectTrials.forEach(t => {
          totalTurns += t.breakPoints.length;
          t.breakPoints.forEach(p => {
            if (!isPointInAnyNodeLocal(p)) nonDotTurns++;
          });
        });
        const nonDotTurnsRatio = totalTurns > 0 ? (nonDotTurns / totalTurns).toFixed(4) : '0';

        // Start/Finish Outside Matrix Stats
        let linesStartOutside = 0;
        let linesFinishOutside = 0;
        let totalLinesCountInSubject = 0;
        subjectTrials.forEach(t => {
          t.lines.forEach((l, idx) => {
            if (excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`)) return;
            totalLinesCountInSubject++;
            if (!isPointInAnyNodeLocal(l.points[0])) linesStartOutside++;
            if (!isPointInAnyNodeLocal(l.points[l.points.length - 1])) linesFinishOutside++;
          });
        });
        const linesStartOutsideRel = totalLinesCountInSubject > 0 ? (linesStartOutside / totalLinesCountInSubject).toFixed(4) : '0';
        const linesFinishOutsideRel = totalLinesCountInSubject > 0 ? (linesFinishOutside / totalLinesCountInSubject).toFixed(4) : '0';
        
        // Lines by number of points connected (excluding 'прочая')
        let lines3Points = 0;
        let lines2Points = 0;
        let lines1Point = 0;

        subjectTrials.forEach(t => {
          const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
          t.lines.forEach((l, idx) => {
            if (excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`)) return;
            const actualType = isOverridden ? 'прочая' : l.type;
            if (actualType !== 'прочая') {
              const uniqueNodes = new Set(l.nodesVisited).size;
              if (uniqueNodes === 3) lines3Points++;
              else if (uniqueNodes === 2) lines2Points++;
              else if (uniqueNodes === 1) lines1Point++;
            }
          });
        });

        const lines3PointsRel = totalLinesCountInSubject > 0 ? (lines3Points / totalLinesCountInSubject).toFixed(4) : '0';
        const lines2PointsRel = totalLinesCountInSubject > 0 ? (lines2Points / totalLinesCountInSubject).toFixed(4) : '0';
        const lines1PointRel = totalLinesCountInSubject > 0 ? (lines1Point / totalLinesCountInSubject).toFixed(4) : '0';

        let subjectLinesBothEndsInNodes = 0;
        let subjectLinesAnyEndOutside = 0;
        let subjectTotalLinesLength = 0;
        let subjectTotalOutsideLinesLength = 0;
        let subjectTotalOutsideLinesCount = 0;
        subjectTrials.forEach(t => {
           t.lines.forEach((l, idx) => {
             if (excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`)) return;

             let lineLen = 0;
             for (let m = 0; m < l.points.length - 1; m++) {
               lineLen += calculateDistance(l.points[m], l.points[m + 1]);
             }
             subjectTotalLinesLength += lineLen;

             const startAtNode = isPointInAnyNodeLocal(l.points[0]);
             const endAtNode = isPointInAnyNodeLocal(l.points[l.points.length - 1]);
             if (startAtNode && endAtNode) subjectLinesBothEndsInNodes++;
             if (!startAtNode || !endAtNode) {
               subjectLinesAnyEndOutside++;
               subjectTotalOutsideLinesLength += lineLen;
               subjectTotalOutsideLinesCount++;
             }
           });
        });
        const linesBothEndsInNodesRel = totalLinesCountInSubject > 0 ? (subjectLinesBothEndsInNodes / totalLinesCountInSubject).toFixed(4) : '0';
        const linesAnyEndOutsideRel = totalLinesCountInSubject > 0 ? (subjectLinesAnyEndOutside / totalLinesCountInSubject).toFixed(4) : '0';
        const avgAllLinesLengthInSubject = totalLinesCountInSubject > 0 ? (subjectTotalLinesLength / totalLinesCountInSubject).toFixed(2) : '0';
        const avgOutsideLinesLengthInSubject = subjectTotalOutsideLinesCount > 0 ? (subjectTotalOutsideLinesLength / subjectTotalOutsideLinesCount).toFixed(2) : '0';

        // Solution Trial Info
        const lastTrial = subjectTrials.length > 0 ? subjectTrials[subjectTrials.length - 1] : null;
        let solutionStartNode = 'none';
        let solutionFinishNode = 'none';
        let solutionStartLine = '';

        if (lastTrial && s.isSolved) {
            const allNodes = lastTrial.lines.flatMap(l => l.nodesVisited);
            if (allNodes.length > 0) {
                solutionStartNode = allNodes[0].toString();
                solutionFinishNode = allNodes[allNodes.length - 1].toString();
            }
            
            const isOverridden = manualOverrides.has(`${lastTrial.subjectId}-${lastTrial.trialId}`);
            solutionStartLine = isOverridden ? 'прочая' : (lastTrial.lines[0]?.type || '');
        }

        const subjectLines = subjectTrials.flatMap(t => {
            const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
            return t.lines
              .map((l, idx) => ({l, idx}))
              .filter(({idx}) => !excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`))
              .map(({l}) => isOverridden ? 'прочая' : l.type);
        });

        const subject_total_solution_time_ms = subjectTrials.reduce((sum, t) => sum + (t.trial_time_ms || 0), 0);
        const subject_mean_trial_time_ms = subjectTrials.length > 0 ? subject_total_solution_time_ms / subjectTrials.length : 0;
        
        const lineCounts = lineTypes.map(lt => subjectLines.filter(type => type === lt).length);
        const startCounts = nodeIds.map(nodeId => subjectTrials.filter(t => t.lines[0]?.nodesVisited[0] === nodeId).length);
        const finishCounts = nodeIds.map(nodeId => subjectTrials.filter(t => {
            const lastLine = t.lines[t.lines.length - 1];
            return lastLine?.nodesVisited[lastLine.nodesVisited.length - 1] === nodeId;
        }).length);

        // Aggregate stats for first, second, third, and fourth lines across all trials
        const positionCounts = [1, 2, 3, 4].flatMap(pos => {
          return lineTypes.map(type => {
            return subjectTrials.filter(t => {
              const line = t.lines[pos - 1];
              if (!line) return false;
              const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
              const actualType = isOverridden ? 'прочая' : line.type;
              return actualType === type;
            }).length;
          });
        });

        // Phase Stats logic
        const phaseSize = Math.floor(subjectTrials.length / 3);
        const subjectPhases = [
          subjectTrials.slice(0, phaseSize),
          subjectTrials.slice(phaseSize, phaseSize * 2),
          subjectTrials.slice(phaseSize * 2)
        ];

        const phaseStats = subjectPhases.flatMap(phaseTrials => {
          const pTotal_solution_time_ms = phaseTrials.reduce((sum, t) => sum + (t.trial_time_ms || 0), 0);
          const pMean_trial_time_ms = phaseTrials.length > 0 ? pTotal_solution_time_ms / phaseTrials.length : 0;
          
          let pTotalTurns = 0;
          let pNonDotTurns = 0;
          let pLinesStartOutside = 0;
          let pLinesFinishOutside = 0;
          let pLines3Points = 0;
          let pLines2Points = 0;
          let pLines1Point = 0;
          let pTotalLinesCount = 0;
          let pLinesBothEndsInNodes = 0;
          let pLinesAnyEndOutside = 0;
          let pTotalLinesLength = 0;
          let pTotalOutsideLinesLength = 0;
          let pTotalOutsideLinesCount = 0;

          phaseTrials.forEach(t => {
            pTotalTurns += t.breakPoints.length;
            t.breakPoints.forEach(pt => {
              if (!isPointInAnyNodeLocal(pt)) pNonDotTurns++;
            });

            const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
            t.lines.forEach((l, idx) => {
              if (excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`)) return;
              pTotalLinesCount++;

              let lineLen = 0;
              for (let m = 0; m < l.points.length - 1; m++) {
                lineLen += calculateDistance(l.points[m], l.points[m + 1]);
              }
              pTotalLinesLength += lineLen;

              if (!isPointInAnyNodeLocal(l.points[0])) pLinesStartOutside++;
              if (!isPointInAnyNodeLocal(l.points[l.points.length - 1])) pLinesFinishOutside++;

              const startAtNode = isPointInAnyNodeLocal(l.points[0]);
              const endAtNode = isPointInAnyNodeLocal(l.points[l.points.length - 1]);
              if (startAtNode && endAtNode) pLinesBothEndsInNodes++;
              if (!startAtNode || !endAtNode) {
                pLinesAnyEndOutside++;
                pTotalOutsideLinesLength += lineLen;
                pTotalOutsideLinesCount++;
              }

              const actualType = isOverridden ? 'прочая' : l.type;
              if (actualType !== 'прочая') {
                const uniqueNodes = new Set(l.nodesVisited).size;
                if (uniqueNodes === 3) pLines3Points++;
                else if (uniqueNodes === 2) pLines2Points++;
                else if (uniqueNodes === 1) pLines1Point++;
              }
            });
          });

          const pNonDotTurnsRatio = pTotalTurns > 0 ? (pNonDotTurns / pTotalTurns).toFixed(4) : '0';
          const pLinesStartOutsideRel = pTotalLinesCount > 0 ? (pLinesStartOutside / pTotalLinesCount).toFixed(4) : '0';
          const pLinesFinishOutsideRel = pTotalLinesCount > 0 ? (pLinesFinishOutside / pTotalLinesCount).toFixed(4) : '0';
          const pLines3PointsRel = pTotalLinesCount > 0 ? (pLines3Points / pTotalLinesCount).toFixed(4) : '0';
          const pLines2PointsRel = pTotalLinesCount > 0 ? (pLines2Points / pTotalLinesCount).toFixed(4) : '0';
          const pLines1PointRel = pTotalLinesCount > 0 ? (pLines1Point / pTotalLinesCount).toFixed(4) : '0';
          const pLinesBothEndsInNodesRel = pTotalLinesCount > 0 ? (pLinesBothEndsInNodes / pTotalLinesCount).toFixed(4) : '0';
          const pLinesAnyEndOutsideRel = pTotalLinesCount > 0 ? (pLinesAnyEndOutside / pTotalLinesCount).toFixed(4) : '0';
          const pAvgAllLinesLength = pTotalLinesCount > 0 ? (pTotalLinesLength / pTotalLinesCount).toFixed(2) : '0';
          const pAvgOutsideLinesLength = pTotalOutsideLinesCount > 0 ? (pTotalOutsideLinesLength / pTotalOutsideLinesCount).toFixed(2) : '0';

          const pLineTypesData = phaseTrials.flatMap(t => {
            const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
            return t.lines
              .map((l, idx) => ({l, idx}))
              .filter(({idx}) => !excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`))
              .map(({l}) => isOverridden ? 'прочая' : l.type);
          });
          
          const pLineCounts = lineTypes.map(lt => pLineTypesData.filter(type => type === lt).length);
          const pStartCounts = nodeIds.map(nodeId => phaseTrials.filter(t => t.lines[0]?.nodesVisited[0] === nodeId).length);
          const pFinishCounts = nodeIds.map(nodeId => phaseTrials.filter(t => {
            const lastLine = t.lines[t.lines.length - 1];
            return lastLine?.nodesVisited[lastLine.nodesVisited.length - 1] === nodeId;
          }).length);

          return [
            phaseTrials.length,
            pTotalLinesCount,
            pMean_trial_time_ms.toFixed(2),
            pTotal_solution_time_ms.toFixed(0),
            pTotalTurns,
            pNonDotTurns,
            pNonDotTurnsRatio,
            pLinesStartOutside,
            pLinesStartOutsideRel,
            pLinesFinishOutside,
            pLinesFinishOutsideRel,
            pLines3Points,
            pLines3PointsRel,
            pLines2Points,
            pLines2PointsRel,
            pLines1Point,
            pLines1PointRel,
            pLinesBothEndsInNodes,
            pLinesBothEndsInNodesRel,
            pLinesAnyEndOutside,
            pLinesAnyEndOutsideRel,
            pAvgAllLinesLength,
            pAvgOutsideLinesLength,
            ...pLineCounts,
            ...pStartCounts,
            ...pFinishCounts
          ];
        });

        return [
          s.lastName,
          s.firstName,
          s.age,
          s.gender,
          s.solvedBefore || '',
          s.insight || '',
          s.totalTaskTime !== undefined ? s.totalTaskTime.toString() : '',
          ...allScaleNames.map(name => s.surveyScales?.[name] !== undefined ? s.surveyScales[name].toString() : ''),
          s.experience,
          s.id,
          subjectGroups[s.id] || 'None',
          s.isSolved ? '1' : '0',
          subjectTrials.length,
          subjectLines.length,
          subject_mean_trial_time_ms.toFixed(2),
          subject_total_solution_time_ms.toFixed(0),
          solutionStartNode,
          solutionFinishNode,
          solutionStartLine,
          firstTrialStartNode,
          firstTrialFinishNode,
          firstTrialFirstLineType,
          totalTurns,
          nonDotTurns,
          nonDotTurnsRatio,
          linesStartOutside,
          linesStartOutsideRel,
          linesFinishOutside,
          linesFinishOutsideRel,
          lines3Points,
          lines3PointsRel,
          lines2Points,
          lines2PointsRel,
          lines1Point,
          lines1PointRel,
          subjectLinesBothEndsInNodes,
          linesBothEndsInNodesRel,
          subjectLinesAnyEndOutside,
          linesAnyEndOutsideRel,
          avgAllLinesLengthInSubject,
          avgOutsideLinesLengthInSubject,
          ...lineCounts,
          ...startCounts,
          ...finishCounts,
          ...positionCounts,
          ...phaseStats
        ];
    });

    const csvContent = [headers.join(','), ...subjectRows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `summary_statistics_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const exportSession = () => {
    const sessionData = {
      subjects,
      processedData,
      manualOverrides: Array.from(manualOverrides),
      excludedLines: Array.from(excludedLines),
      subjectGroups,
      angleThreshold,
      minLineLength,
      usePhasedMode
    };
    const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `session_backup_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    link.click();
    addLog("Сессия экспортирована в JSON.");
  };

  const importSession = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      // Try parsing as JSON first (Session Backup)
      if (file.name.toLowerCase().endsWith('.json')) {
        const data = JSON.parse(text);
        if (data.subjects) setSubjects(data.subjects);
        if (data.processedData) setProcessedData(data.processedData);
        if (data.manualOverrides) setManualOverrides(new Set(data.manualOverrides));
        if (data.excludedLines) setExcludedLines(new Set(data.excludedLines));
        if (data.subjectGroups) setSubjectGroups(data.subjectGroups);
        if (data.angleThreshold) setAngleThreshold(data.angleThreshold);
        if (data.minLineLength) setMinLineLength(data.minLineLength);
        if (data.usePhasedMode !== undefined) setUsePhasedMode(data.usePhasedMode);
        addLog("Сессия успешно восстановлена из JSON.");
      } else {
        // Fallback or handle CSV like before if it's the same handler
        // But I will keep separate for clarity if possible.
        // The user button currently calls handleCalibrationFileUpload.
        addLog("Для восстановления сессии используйте .json файл резервной копии.");
      }
    } catch (err) {
      console.error(err);
      setError("Ошибка при импорте сессии.");
      addLog("Ошибка: Не удалось прочитать файл сессии.");
    }
    e.target.value = "";
  };
  const resetFilters = () => {
    setFilterTypes(new Set());
    setFilterStartNode(null);
    setFilterFinishNode(null);
    setFilterOverridesOnly(false);
  };

  const clearAllData = () => {
    setProcessedData([]);
    setSubjects([]);
    setActiveSubjectId(null);
    resetFilters();
    setManualOverrides(new Set());
    setSelectedTrialId(null);
    setHoveredTrialId(null);
    setIsCalibrating(false);
    setShowHeatmap(false);
    setShowFinishHeatmap(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans">
      <header className="max-w-[1550px] mx-auto mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3 tracking-tighter">
            <Activity className="text-blue-600" size={32} />
            SIGMA
          </h1>
          <p className="text-slate-500 font-bold ">Spatial Insight & Gesture Movement Analyzer</p>
        </div>
        {processedData.length > 0 || subjects.length > 0 ? (
          <div className="flex gap-2 flex-wrap justify-center">
            <button 
              onClick={() => setIsCalibrating(!isCalibrating)}
              className={`p-2.5 border rounded-xl transition-all ${isCalibrating ? 'bg-orange-600 border-orange-700 text-white shadow-lg ring-4 ring-orange-100' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              title="Режим калибровки"
            >
              <Settings2 size={20} className={isCalibrating ? "animate-spin-slow" : ""} />
            </button>
            <button 
              onClick={() => setShowHeatmap(!showHeatmap)} 
              className={`p-2.5 border rounded-xl transition-colors ${showHeatmap ? 'bg-red-600 border-red-700 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
              title="Тепловая карта стартовых точек"
            >
              <Flame size={20} className={showHeatmap ? "animate-pulse" : ""} />
            </button>
            <button 
              onClick={() => setShowFinishHeatmap(!showFinishHeatmap)} 
              className={`p-2.5 border rounded-xl transition-colors ${showFinishHeatmap ? 'bg-emerald-600 border-emerald-700 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
              title="Тепловая карта финишных точек"
            >
              <Flag size={20} className={showFinishHeatmap ? "animate-pulse" : ""} />
            </button>
            <button 
              onClick={() => setShowBreaks(!showBreaks)} 
              className={`p-2.5 border rounded-xl transition-colors ${showBreaks ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-white border-slate-200 text-slate-400'}`}
              title="Показать точки поворота"
            >
              <Zap size={20} />
            </button>
            <button onClick={clearAllData} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:bg-slate-50" title="Очистить все данные"><RefreshCcw size={20} /></button>
            <button 
              onClick={() => setUsePhasedMode(!usePhasedMode)} 
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm ${usePhasedMode ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              <Layers size={18} /> {usePhasedMode ? 'Этапы: ВКЛ' : 'Этапы: ВЫКЛ'}
            </button>
          </div>
        ) : null}
      </header>

      <main className="max-w-[1550px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6">
          {isCalibrating && activeSubject && (
            <div className="bg-orange-50 p-8 rounded-[32px] shadow-xl border border-orange-200 animate-in fade-in zoom-in duration-200 relative overflow-hidden">
              <h2 className="text-lg font-bold mb-6 flex items-center gap-2 text-orange-700 relative z-10"><Move size={20} /> Калибровка решения</h2>
              <div className="space-y-6 relative z-10">
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-orange-600 block">Сдвиг X (Пиксели)</label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleCalibrationChange(prev => ({ offsetX: prev.offsetX - 1 }))} className="p-2.5 bg-white rounded-xl text-orange-600 shadow-sm hover:bg-orange-100 transition-colors"><ArrowLeft size={16} /></button>
                      <input 
                        type="number" 
                        value={activeSubject.calibration.offsetX} 
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          handleCalibrationChange({ offsetX: isNaN(val) ? 0 : val });
                        }} 
                        className="flex-1 min-w-0 text-center text-sm font-bold py-2.5 rounded-xl border-none bg-white shadow-inner" 
                      />
                      <button onClick={() => handleCalibrationChange(prev => ({ offsetX: prev.offsetX + 1 }))} className="p-2.5 bg-white rounded-xl text-orange-600 shadow-sm hover:bg-orange-100 transition-colors"><ArrowRight size={16} /></button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-orange-600 block">Сдвиг Y (Пиксели)</label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleCalibrationChange(prev => ({ offsetY: prev.offsetY - 1 }))} className="p-2.5 bg-white rounded-xl text-orange-600 shadow-sm hover:bg-orange-100 transition-colors"><ArrowUp size={16} /></button>
                      <input 
                        type="number" 
                        value={activeSubject.calibration.offsetY} 
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          handleCalibrationChange({ offsetY: isNaN(val) ? 0 : val });
                        }} 
                        className="flex-1 min-w-0 text-center text-sm font-bold py-2.5 rounded-xl border-none bg-white shadow-inner" 
                      />
                      <button onClick={() => handleCalibrationChange(prev => ({ offsetY: prev.offsetY + 1 }))} className="p-2.5 bg-white rounded-xl text-orange-600 shadow-sm hover:bg-orange-100 transition-colors"><ArrowDown size={16} /></button>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-orange-600 block">Масштаб (Множитель)</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleCalibrationChange(prev => ({ scale: Math.max(0.1, prev.scale - 0.05) }))} className="p-2.5 bg-white rounded-xl text-orange-600 shadow-sm hover:bg-orange-100 transition-colors"><Minus size={16} /></button>
                    <input 
                        type="number" 
                        step="0.01" 
                        value={activeSubject.calibration.scale} 
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val)) handleCalibrationChange({ scale: val });
                        }} 
                        className="flex-1 min-w-0 text-center text-sm font-bold py-2.5 rounded-xl border-none bg-white shadow-inner" 
                    />
                    <button onClick={() => handleCalibrationChange(prev => ({ scale: prev.scale + 0.05 }))} className="p-2.5 bg-white rounded-xl text-orange-600 shadow-sm hover:bg-orange-100 transition-colors"><Plus size={16} /></button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-orange-600 block">Зона интереса (Чувствительность, px)</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleCalibrationChange(prev => ({ hitPadding: Math.max(0, prev.hitPadding - 1) }))} className="p-2.5 bg-white rounded-xl text-orange-600 shadow-sm hover:bg-orange-100 transition-colors"><Minus size={16} /></button>
                    <input 
                        type="number" 
                        value={activeSubject.calibration.hitPadding} 
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val)) handleCalibrationChange({ hitPadding: val });
                        }} 
                        className="flex-1 min-w-0 text-center text-sm font-bold py-2.5 rounded-xl border-none bg-white shadow-inner" 
                    />
                    <button onClick={() => handleCalibrationChange(prev => ({ hitPadding: prev.hitPadding + 1 }))} className="p-2.5 bg-white rounded-xl text-orange-600 shadow-sm hover:bg-orange-100 transition-colors"><Plus size={16} /></button>
                  </div>
                </div>
                <div className="pt-2 border-t border-orange-200 flex justify-between gap-2">
                  <button onClick={() => handleCalibrationChange({ offsetX: 0, offsetY: 0, scale: 1.0 })} className="text-[10px] font-bold text-orange-500">Сброс</button>
                  <button onClick={() => setIsCalibrating(false)} className="px-6 py-2 bg-orange-600 text-white rounded-xl text-xs font-bold">Готово</button>
                </div>
                <div className="text-[9px] text-orange-500/80 font-medium italic text-center">Перетаскивайте нарисованное решение прямо на холсте для точной калибровки</div>
              </div>
            </div>
          )}

          {subjects.length > 0 && (
            <div className="bg-white p-8 rounded-[32px] shadow-xl border border-slate-100">
              <h2 className="text-lg font-bold mb-6 flex items-center gap-2"><Users size={20} className="text-indigo-500" /> Испытуемые</h2>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {subjects.map(s => (
                  <div key={s.id} className="flex gap-2 group">
                    <button 
                      onClick={() => { setActiveSubjectId(s.id); setSelectedTrialId(null); }}
                      className={`flex-1 flex justify-between items-center p-3 rounded-xl transition-all ${activeSubjectId === s.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'} ${s.isSolved ? 'ring-1 ring-yellow-400/50 shadow-inner' : ''}`}
                    >
                      <div className="flex flex-col items-start gap-1 overflow-hidden text-left">
                        <span className="text-[11px] font-bold truncate w-full">{s.lastName} {s.firstName}</span>
                        <span className="text-[9px] opacity-40 font-mono italic">ID: {s.id}</span>
                        {s.isSolved && (
                          <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase transition-colors ${activeSubjectId === s.id ? 'bg-white/20 text-white' : 'bg-yellow-400/20 text-yellow-600'}`}>
                            <Trophy size={10} /> Решено
                          </div>
                        )}
                      </div>
                      {activeSubjectId === s.id && <ChevronRight size={14} className="opacity-50" />}
                    </button>
                    <button onClick={() => toggleSubjectSolved(s.id)} className={`p-3 rounded-xl border transition-all ${s.isSolved ? 'bg-yellow-50 border-yellow-200 text-yellow-600 shadow-inner' : 'bg-white border-slate-100 text-slate-300 hover:border-yellow-200 hover:text-yellow-400'}`} title={s.isSolved ? "Пометить как 'Не решил'" : "Пометить как 'Решил'"}>
                      <Trophy size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white p-8 rounded-[32px] shadow-xl border border-slate-100">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2"><Upload size={20} className="text-blue-500" /> Загрузка</h2>
            <div className="space-y-4">
              <label className="block w-full cursor-pointer group">
                <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center group-hover:border-blue-400 group-hover:bg-blue-50 transition-all">
                  <Scissors size={40} className="mx-auto mb-4 text-slate-300 group-hover:text-blue-400" />
                  <span className="text-sm font-bold text-slate-600 block mb-1">Выбрать CSV файлы</span>
                  <input type="file" accept=".csv" multiple onChange={handleFileUpload} className="hidden" />
                </div>
              </label>
              
              <div className="pt-4 border-t border-slate-100 space-y-3">
                 <label className="flex items-center gap-3 w-full cursor-pointer p-3 bg-slate-50 rounded-2xl hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-all text-slate-600 group">
                    <div className="p-2 bg-white rounded-xl text-indigo-500"><FileSpreadsheet size={18} /></div>
                    <div className="flex-1">
                      <span className="text-[11px] font-black uppercase tracking-tight block">Загрузить сессию (JSON)</span>
                    </div>
                    <input type="file" accept=".csv,.json" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file?.name.toLowerCase().endsWith('.json')) {
                        importSession(e);
                      } else {
                        handleCalibrationFileUpload(e);
                      }
                    }} className="hidden" />
                 </label>
                 <label className="flex items-center gap-3 w-full cursor-pointer p-3 bg-slate-50 rounded-2xl hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-all text-slate-600 group">
                    <div className="p-2 bg-white rounded-xl text-emerald-500"><Briefcase size={18} /></div>
                    <div className="flex flex-col">
                      <span className="text-[11px] font-black uppercase tracking-tight">Загрузить опыт (CSV)</span>
                    </div>
                    <input type="file" accept=".csv" onChange={handleExperienceFileUpload} className="hidden" />
                 </label>
              </div>
            </div>
            {log.length > 0 && (
              <div className="mt-6 p-4 bg-slate-900 rounded-xl font-mono text-[10px] text-slate-300 space-y-1 overflow-x-auto max-h-[150px] custom-scrollbar">
                {log.map((l, i) => <div key={i} className="whitespace-nowrap"><span className="text-blue-400">[{i}]</span> {l}</div>)}
              </div>
            )}
          </div>

          {activeSubject && (
             <div className="bg-white p-8 rounded-[32px] shadow-xl border border-slate-100 animate-in fade-in slide-in-from-top-4">
               <h2 className="text-lg font-bold mb-6 flex items-center gap-2 text-slate-700"><Info size={20} className="text-blue-500" /> Информация</h2>
               <div className="space-y-4">
                 <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-2xl">
                   <div className="p-2.5 bg-white rounded-xl text-blue-600 shadow-sm"><User size={20} /></div>
                   <div className="flex-1">
                     <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">ФИО испытуемого</p>
                      <div className="flex items-center gap-2 mt-1">
                        <input 
                          type="text" 
                          value={activeSubject.lastName || ""} 
                          onChange={(e) => {
                            const val = e.target.value;
                            setSubjects(prev => prev.map(s => s.id === activeSubject.id ? { ...s, lastName: val } : s));
                          }}
                          placeholder="Фамилия"
                          title="Фамилия испытуемого"
                          className="w-1/2 bg-white/90 border border-slate-200 rounded-lg px-2.5 py-1 text-sm font-bold text-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-300 shadow-sm"
                        />
                        <input 
                          type="text" 
                          value={activeSubject.firstName || ""} 
                          onChange={(e) => {
                            const val = e.target.value;
                            setSubjects(prev => prev.map(s => s.id === activeSubject.id ? { ...s, firstName: val } : s));
                          }}
                          placeholder="Имя"
                          title="Имя испытуемого"
                          className="w-1/2 bg-white/90 border border-slate-200 rounded-lg px-2.5 py-1 text-sm font-bold text-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-300 shadow-sm"
                        />
                      </div>
                   </div>
                 </div>

                 <div className="flex items-center gap-4 p-3 bg-indigo-50 rounded-2xl border border-indigo-100">
                   <div className="p-2.5 bg-white rounded-xl text-indigo-600 shadow-sm"><Users size={20} /></div>
                   <div className="flex-1">
                     <p className="text-[10px] font-black uppercase text-indigo-400 tracking-wider">ГРУППА</p>
                     <input 
                       type="text" 
                       value={subjectGroups[activeSubject.id] || ""} 
                       onChange={(e) => setSubjectGroups(prev => ({...prev, [activeSubject.id]: e.target.value}))}
                       placeholder="Введите название группы"
                       className="w-full bg-transparent border-none p-0 text-sm font-bold text-indigo-900 focus:ring-0 placeholder:text-indigo-200"
                     />
                   </div>
                 </div>
                 
                 <div className="grid grid-cols-1 gap-3">
                   <div className="flex items-center justify-between p-3 bg-indigo-50 rounded-2xl border border-indigo-100">
                     <div className="flex items-center gap-2">
                        <Clock size={16} className="text-indigo-500" />
                        <p className="text-[10px] font-black uppercase text-indigo-400 tracking-tight">Общее время</p>
                     </div>
                     <p className="text-sm font-black text-indigo-700">{stats.total_solution_time_ms.toFixed(0)} мс</p>
                   </div>
                   <div className="flex items-center justify-between p-3 bg-indigo-50 rounded-2xl border border-indigo-100">
                      <div className="flex items-center gap-2">
                         <Activity size={16} className="text-indigo-500" />
                         <p className="text-[10px] font-black uppercase text-indigo-400 tracking-tight">Среднее время пробы</p>
                      </div>
                      <p className="text-sm font-black text-indigo-700">{stats.mean_trial_time_ms.toFixed(1)} мс</p>
                   </div>
                   <div className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="flex items-center gap-2">
                         <LayoutGrid size={16} className="text-slate-400" />
                         <p className="text-[10px] font-black uppercase text-slate-400 tracking-tight">Число проб</p>
                      </div>
                      <p className="text-sm font-black text-slate-600">{stats.totalTrials}</p>
                   </div>
                   <div className="flex items-center justify-between p-3 bg-amber-50 rounded-2xl border border-amber-100">
                      <div className="flex items-center gap-2">
                         <Zap size={16} className="text-amber-500" />
                         <p className="text-[10px] font-black uppercase text-amber-500 tracking-tight">Тип 1-й линии (1-я проба)</p>
                      </div>
                      <p className="text-sm font-black text-amber-700 uppercase tracking-tighter">{stats.firstTrialFirstLineType}</p>
                   </div>
                   <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-2xl border border-emerald-100">
                      <div className="flex items-center gap-2">
                         <CheckSquare size={16} className="text-emerald-500" />
                         <p className="text-[10px] font-black uppercase text-emerald-500 tracking-tight">Линии точка-точка</p>
                      </div>
                      <p className="text-sm font-black text-emerald-700">{stats.linesBothEndsInNodes}</p>
                   </div>
                   <div className="flex items-center justify-between p-3 bg-rose-50 rounded-2xl border border-rose-100">
                      <div className="flex items-center gap-2">
                         <Ban size={16} className="text-rose-500" />
                         <p className="text-[10px] font-black uppercase text-rose-500 tracking-tight">Линии за пределами</p>
                      </div>
                      <p className="text-sm font-black text-rose-700">{stats.linesAnyEndOutside}</p>
                   </div>
                   <div className="flex items-center justify-between p-3 bg-indigo-50 rounded-2xl border border-indigo-100">
                      <div className="flex items-center gap-2">
                         <Ruler size={16} className="text-indigo-500" />
                         <p className="text-[10px] font-black uppercase text-indigo-500 tracking-tight">Ср. длина (все)</p>
                      </div>
                      <p className="text-sm font-black text-indigo-700">{stats.avgAllLinesLength.toFixed(1)} px</p>
                   </div>
                   <div className="flex items-center justify-between p-3 bg-rose-50 rounded-2xl border border-rose-100">
                      <div className="flex items-center gap-2">
                         <Ruler size={16} className="text-rose-500" />
                         <p className="text-[10px] font-black uppercase text-rose-500 tracking-tight">Ср. длина (за пределами)</p>
                      </div>
                      <p className="text-sm font-black text-rose-700">{stats.avgOutsideLinesLength.toFixed(1)} px</p>
                   </div>
                 </div>

                 <div className="grid grid-cols-2 gap-3">
                   <div className="p-3 bg-slate-50 rounded-2xl">
                     <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Возраст</p>
                     <p className="text-sm font-bold text-slate-700">{activeSubject.age}</p>
                   </div>
                   <div className="p-3 bg-slate-50 rounded-2xl">
                     <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Пол</p>
                     <p className="text-sm font-bold text-slate-700">{activeSubject.gender}</p>
                   </div>
                    {activeSubject.solvedBefore && (
                      <div className="p-3 bg-slate-50 rounded-2xl">
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Решал ранее</p>
                        <p className="text-sm font-bold text-slate-700">{activeSubject.solvedBefore}</p>
                      </div>
                    )}
                    {activeSubject.insight && (
                      <div className="p-3 bg-slate-50 rounded-2xl">
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Инсайт</p>
                        <p className="text-sm font-bold text-slate-700">{activeSubject.insight}</p>
                      </div>
                    )}
                    {activeSubject.totalTaskTime !== undefined && (
                      <div className="p-3 bg-indigo-50/50 rounded-2xl col-span-2 border border-indigo-100/50">
                        <p className="text-[10px] font-black uppercase text-indigo-500 tracking-wider flex items-center gap-1">
                          <Timer size={12} /> Общее время задачи (totalTaskTime)
                        </p>
                        <p className="text-sm font-bold text-indigo-900">{activeSubject.totalTaskTime} с</p>
                      </div>
                    )}
                    {activeSubject.surveyScales && Object.keys(activeSubject.surveyScales).length > 0 && (
                      <div className="p-3 bg-slate-50 rounded-2xl col-span-2 space-y-2">
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Шкалы опросника</p>
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                          {Object.entries(activeSubject.surveyScales).map(([name, val]) => (
                            <div key={name} className="flex justify-between bg-white px-2 py-1 rounded-lg border border-slate-100">
                              <span className="text-slate-600 truncate">{name}:</span>
                              <span className="font-bold text-slate-800 ml-1">{val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                   <div className="p-3 bg-slate-50 rounded-2xl col-span-2">
                     <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Опыт (из CSV)</p>
                     <p className="text-sm font-bold text-slate-700">{activeSubject.experience}</p>
                   </div>
                 </div>
               </div>
             </div>
          )}
        </div>

        <div className="lg:col-span-6 space-y-6">
          <div className="bg-white p-8 rounded-[32px] shadow-xl border border-slate-100 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2 text-slate-700"><Settings size={20} className="text-blue-500" /> Настройки анализа</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-2">
                    <RotateCcw size={12} /> Угол поворота (градусы)
                  </label>
                  <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">{angleThreshold}°</span>
                </div>
                <input 
                  type="range" 
                  min="5" 
                  max="90" 
                  step="1"
                  value={angleThreshold} 
                  onChange={(e) => setAngleThreshold(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-[9px] text-slate-300 font-bold uppercase">
                  <span>Чувствительно</span>
                  <span>Грубо</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-2">
                    <Ruler size={12} /> Мин. длина линии (px)
                  </label>
                  <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">{minLineLength}</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="500" 
                  step="5"
                  value={minLineLength} 
                  onChange={(e) => setMinLineLength(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-[9px] text-slate-300 font-bold uppercase">
                  <span>Короткие</span>
                  <span>Длинные</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[40px] shadow-2xl border border-slate-100 overflow-hidden relative group">
            <canvas 
              ref={canvasRef} 
              width={CANVAS_SIZE} 
              height={CANVAS_SIZE} 
              className={`w-full aspect-square bg-white ${isCalibrating ? (isDraggingGrid ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
              onMouseDown={handleMainCanvasMouseDown}
              onMouseMove={handleMainCanvasMouseMove}
              onMouseUp={handleMainCanvasMouseUp}
              onMouseLeave={handleMainCanvasMouseUp}
            />
            {selectedTrialId !== null && (
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-md p-4 rounded-3xl shadow-2xl border border-slate-100 flex items-center gap-6 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Просмотр пробы</span>
                  <span className="text-lg font-black text-slate-900 leading-tight">#{selectedTrialId}</span>
                  {selectedTrial && (
                    <span className="text-[10px] font-black text-blue-500 uppercase mt-0.5 flex items-center gap-1">
                      <Clock size={10} /> {selectedTrial.trial_time_ms.toFixed(0)} мс
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => navigateTrial('prev')} className="p-2 bg-slate-50 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"><ChevronLeft size={20} /></button>
                  <button onClick={() => navigateTrial('next')} className="p-2 bg-slate-50 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"><ChevronRight size={20} /></button>
                  <button onClick={() => setSelectedTrialId(null)} className="ml-2 p-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors"><X size={20} /></button>
                </div>
              </div>
            )}
          </div>

          {processedData.length > 0 && (
            <>
              {usePhasedMode && stats.phases && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                  {(['beginning', 'middle', 'end'] as const).map(phaseKey => {
                    const phase = stats.phases![phaseKey];
                    const titles = { beginning: 'Начало решения', middle: 'Середина решения', end: 'Конец решения' };
                    const colors = { beginning: 'blue', middle: 'emerald', end: 'amber' };
                    const bgColors = { beginning: 'bg-blue-50', middle: 'bg-emerald-50', end: 'bg-amber-50' };
                    const textColors = { beginning: 'text-blue-600', middle: 'text-emerald-600', end: 'text-amber-600' };
                    const borderColors = { beginning: 'border-blue-100', middle: 'border-emerald-100', end: 'border-amber-100' };

                    return (
                      <div key={phaseKey} className={`p-6 rounded-[32px] border ${borderColors[phaseKey]} ${bgColors[phaseKey]} shadow-sm`}>
                        <h3 className={`text-xs font-black uppercase tracking-widest mb-4 ${textColors[phaseKey]}`}>{titles[phaseKey]}</h3>
                        <div className="space-y-4">
                           <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-slate-500 uppercase">Проб</span>
                              <span className="text-xs font-black text-slate-700">{phase.totalTrials}</span>
                           </div>
                           <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-slate-500 uppercase">Среднее время</span>
                              <span className="text-xs font-black text-slate-700">{phase.mean_trial_time_ms.toFixed(0)} мс</span>
                           </div>
                           <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-slate-500 uppercase">Точка-точка</span>
                              <span className="text-xs font-black text-slate-700">{phase.linesBothEndsInNodes}</span>
                           </div>
                           <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-slate-500 uppercase">Вне точек</span>
                              <span className="text-xs font-black text-slate-700">{phase.linesAnyEndOutside}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-slate-500 uppercase">Ср. длина (все)</span>
                              <span className="text-xs font-black text-slate-700">{phase.avgAllLinesLength.toFixed(1)} px</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-slate-500 uppercase">Ср. длина (вне)</span>
                              <span className="text-xs font-black text-slate-700">{phase.avgOutsideLinesLength.toFixed(1)} px</span>
                           </div>
                           <div className="pt-2 border-t border-slate-200">
                              <span className="text-[9px] font-black uppercase text-slate-400 tracking-tighter block mb-2">Типы линий</span>
                              <div className="space-y-1">
                                 {Object.entries(phase.lineTypeCounts).sort((a: [string, any], b: [string, any]) => (b[1] as number) - (a[1] as number)).slice(0, 4).map(([type, count]) => (
                                   <div key={type} className="flex justify-between items-center bg-white/50 px-2 py-1 rounded-lg">
                                      <span className="text-[9px] font-bold text-slate-600 uppercase">{type}</span>
                                      <span className="text-[9px] font-black text-slate-900">{count}</span>
                                   </div>
                                 ))}
                              </div>
                           </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-8 rounded-[32px] shadow-xl border border-slate-100">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-lg font-bold flex items-center gap-2"><BarChart3 size={20} className="text-blue-500" /> Типы линий</h2>
                  {(filterTypes.size > 0 || filterStartNode !== null || filterFinishNode !== null || filterOverridesOnly) && <button onClick={resetFilters} className="text-[10px] font-bold text-blue-500 hover:underline">Сброс</button>}
                </div>
                <div className="space-y-1.5">
                  {Object.entries(stats.lineTypeCounts).sort((a,b) => (b[1] as number) - (a[1] as number)).map(([type, count]) => {
                    const isSelected = filterTypes.has(type);
                    return (
                      <div 
                        key={type} 
                        onClick={() => toggleFilterType(type)} 
                        className={`group flex justify-between items-center p-2.5 rounded-xl cursor-pointer transition-all border ${isSelected ? 'bg-blue-600 border-blue-700 text-white shadow-lg' : 'bg-slate-50 border-transparent hover:bg-slate-100 text-slate-600'}`}
                      >
                        <div className="flex items-center gap-3">
                          {isSelected ? <CheckSquare size={16} /> : <Square size={16} className="text-slate-300 group-hover:text-slate-400" />}
                          <span className="text-[10px] font-bold uppercase tracking-wide">{type}</span>
                        </div>
                        <span className={`text-xs font-black ${isSelected ? 'text-white' : 'text-slate-400'}`}>{count}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="pt-4 mt-4 border-t border-slate-50">
                  <button onClick={() => setFilterOverridesOnly(!filterOverridesOnly)} className={`w-full flex justify-between items-center p-3 rounded-2xl transition-all ${filterOverridesOnly ? 'bg-red-500 text-white shadow-lg' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                    <span className="text-[10px] font-black uppercase">Исключенные</span>
                    <span className="text-xs font-black">{stats.totalOverrides}</span>
                  </button>
                </div>
              </div>
              
              <div className="bg-white p-8 rounded-[32px] shadow-xl border border-slate-100">
                <h2 className="text-lg font-bold mb-6 flex items-center gap-2"><Target size={20} className="text-red-500" /> Точки старта</h2>
                <div className="grid grid-cols-3 gap-2">
                  {[1,2,3,4,5,6,7,8,9].map(num => (
                    <div key={num} onClick={() => setFilterStartNode(filterStartNode === num ? null : num)} className={`p-3 rounded-xl flex flex-col items-center border cursor-pointer transition-all ${filterStartNode === num ? 'bg-slate-900 text-white shadow-lg' : 'bg-slate-50 border-transparent hover:border-slate-200'}`}>
                      <span className="text-[8px] font-bold opacity-50 mb-1">{num}</span>
                      <span className="text-lg font-black">{stats.startNodeCounts[num] || 0}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white p-8 rounded-[32px] shadow-xl border border-slate-100">
                <h2 className="text-lg font-bold mb-6 flex items-center gap-2 text-emerald-600"><Flag size={20} /> Точки финиша</h2>
                <div className="grid grid-cols-3 gap-2">
                  {[1,2,3,4,5,6,7,8,9].map(num => (
                    <div key={num} onClick={() => setFilterFinishNode(filterFinishNode === num ? null : num)} className={`p-3 rounded-xl flex flex-col items-center border cursor-pointer transition-all ${filterFinishNode === num ? 'bg-emerald-600 text-white shadow-lg' : 'bg-slate-50 border-transparent hover:border-slate-200'}`}>
                      <span className="text-[8px] font-bold opacity-50 mb-1">{num}</span>
                      <span className="text-lg font-black">{stats.finishNodeCounts[num] || 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
          )}

          <div className="bg-white p-8 rounded-[32px] shadow-xl border border-slate-100">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2"><Activity size={14} /> Лог проб {activeSubjectId ? `(${activeSubjectId})` : ''}</h3>
            <div className="max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-white border-b border-slate-100 z-10">
                  <tr className="text-slate-400 uppercase">
                    <th className="py-4 px-2">Проба</th>
                    <th className="py-4 px-2">Тип</th>
                    <th className="py-4 px-2">Время (мс)</th>
                    <th className="py-4 px-2">Путь</th>
                    <th className="py-4 px-2">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {processedData.length > 0 ? processedData
                    .filter(t => t.subjectId === activeSubjectId)
                    .map(t => (
                      <React.Fragment key={`${t.subjectId}-${t.trialId}`}>
                        {t.lines.map((l, idx) => {
                          const isOverridden = manualOverrides.has(`${t.subjectId}-${t.trialId}`);
                          const isSelected = selectedTrialId === t.trialId;
                          const isVisible = filteredTrials.some(ft => ft.trialId === t.trialId);
                          if (!isVisible && !isSelected) return null;
                          return (
                            <tr key={`${t.trialId}-${idx}`} className={`hover:bg-blue-50/30 transition-colors ${isOverridden ? 'bg-slate-50 opacity-60' : ''} ${isSelected ? 'bg-blue-50' : ''} ${excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`) ? 'opacity-40 line-through decoration-orange-500/50' : ''}`}>
                              <td className="py-4 px-2 font-black">#{t.trialId}</td>
                              <td className="py-4 px-2"><span className="px-1.5 py-0.5 rounded font-bold uppercase text-[8px] border bg-slate-100 text-slate-500">{isOverridden ? 'прочая' : l.type}</span></td>
                              <td className="py-4 px-2 font-black text-slate-400">{idx === 0 ? t.trial_time_ms.toFixed(0) : ''}</td>
                              <td className="py-4 px-2 font-bold text-blue-600">{l.nodesVisited.join(' → ') || '---'}</td>
                              <td className="py-4 px-2">
                                <div className="flex items-center gap-1">
                                  {idx === 0 && <button onClick={() => toggleOverride(t)} className="p-1.5 rounded-lg bg-slate-50 text-slate-400 hover:text-red-500" title="Исключить пробу">{isOverridden ? <RotateCcw size={14} /> : <Trash2 size={14} />}</button>}
                                  {idx === 0 && <button onClick={() => setSelectedTrialId(isSelected ? null : t.trialId)} className="p-1.5 rounded-lg bg-slate-50 text-slate-400 hover:text-blue-500" title="Просмотр"><Eye size={14} /></button>}
                                  <button 
                                    onClick={() => toggleLineExclusion(t.subjectId, t.trialId, idx)} 
                                    className={`p-1.5 rounded-lg bg-slate-50 transition-colors ${excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`) ? 'text-orange-500 bg-orange-50' : 'text-slate-400 hover:text-orange-500'}`} 
                                    title="Исключить линию из статистики"
                                  >
                                    {excludedLines.has(`${t.subjectId}-${t.trialId}-${idx}`) ? <RotateCcw size={14} /> : <Ban size={14} />}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    )) : (<tr><td colSpan={5} className="py-12 text-center text-slate-300">{subjects.length > 0 ? "У выбранного участника нет валидных проб" : "Загрузите данные"}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="sticky top-8 space-y-4">
            <div className="bg-white p-6 rounded-[32px] shadow-xl border border-slate-100 animate-in fade-in slide-in-from-right-4">
              <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2">
                <Download size={14} className="text-blue-500" /> Активность
              </h2>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={exportCSV} 
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 text-slate-900 rounded-2xl font-bold hover:bg-slate-200 transition-all group"
                  title="Экспорт текущего представления"
                >
                  <span className="flex items-center gap-2 text-sm"><FileDown size={18} className="text-slate-400 group-hover:text-blue-600" /> Экспорт</span>
                  <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                
                <button 
                  onClick={exportAllDataCSV} 
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-900 text-white rounded-2xl font-bold hover:bg-black shadow-lg shadow-slate-200 transition-all group"
                  title="Экспорт всех данных всех испытуемых"
                >
                  <span className="flex items-center gap-2 text-sm"><FileDown size={18} className="text-slate-400 group-hover:text-white" /> Экспорт (Все)</span>
                  <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                
                <button 
                  onClick={exportStatsCSV} 
                  className="w-full flex items-center justify-between px-4 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all group"
                  title="Сводная статистика"
                >
                  <span className="flex items-center gap-2 text-sm"><BarChart3 size={18} className="text-indigo-200 group-hover:text-white" /> Статистика</span>
                  <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                
                <div className="pt-4 mt-2 border-t border-slate-50">
                  <button 
                    onClick={exportSession} 
                    className="w-full flex items-center justify-between px-4 py-3 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-100 transition-all group"
                    title="Сохранить всю сессию в JSON"
                  >
                    <span className="flex items-center gap-2 text-sm"><Download size={18} className="text-emerald-200 group-hover:text-white" /> Сохранить сессию</span>
                  </button>
                  <p className="mt-3 text-[9px] text-slate-400 text-center font-medium leading-relaxed uppercase tracking-tighter">
                    Используйте JSON для восстановления <br /> всех параметров и группировок
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 p-6 rounded-[32px] shadow-xl text-white relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform"><Activity size={80} /></div>
               <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">Статус анализа</p>
               <h3 className="text-2xl font-black">{subjects.length} <span className="text-xs opacity-60 uppercase">Субъектов</span></h3>
               <div className="mt-4 flex gap-2">
                 <div className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
                   <div className="h-full bg-white transition-all duration-1000" style={{ width: subjects.length > 0 ? '100%' : '0%' }}></div>
                 </div>
               </div>
            </div>
          </div>
        </div>

        {processedData.length > 0 && (
          <div className="lg:col-span-12 space-y-12 mt-12 animate-in slide-in-from-bottom-8 duration-700">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <GlobalHeatMap 
                title="Стартовые точки: все пробы" 
                icon={<LayoutGrid size={20} />} 
                points={globalHeatmapAll} 
                normalizedNodes={averageNormalizedNodes} 
              />
              <GlobalHeatMap 
                title="Финишные точки: все пробы" 
                icon={<Flag size={20} />} 
                points={globalHeatmapFinishAll} 
                normalizedNodes={averageNormalizedNodes} 
              />
              <GlobalHeatMap 
                title="Стартовые точки: финалы решений" 
                icon={<Trophy size={20} />} 
                points={globalHeatmapCorrectLast} 
                normalizedNodes={averageNormalizedNodes} 
              />
              <GlobalHeatMap 
                title="Финишные точки: финалы решений" 
                icon={<Trophy size={20} className="text-emerald-500" />} 
                points={globalHeatmapFinishCorrectLast} 
                normalizedNodes={averageNormalizedNodes} 
              />
            </div>

            <div className="pt-12 border-t border-slate-200 mt-12">
               <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-8">Глобальные карты линий</h2>
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                 <GlobalLineMap 
                   title="Все линии: все пробы" 
                   icon={<Activity size={20} />} 
                   lines={globalLineMapAll} 
                   normalizedNodes={averageNormalizedNodes} 
                 />
                 <GlobalLineMap 
                   title="Все линии: финалы решений" 
                   icon={<Trophy size={20} className="text-emerald-500" />} 
                   lines={globalLineMapCorrectLast} 
                   normalizedNodes={averageNormalizedNodes} 
                 />
               </div>
            </div>

            <div className="pt-12 border-t border-slate-200 mt-12">
               <div className="flex items-center gap-4 mb-8">
                 <div className="p-3 bg-indigo-100 text-indigo-600 rounded-2xl"><Layers size={24} /></div>
                 <div>
                   <h2 className="text-2xl font-black text-slate-900 tracking-tight">Сравнение по опыту решения</h2>
                   <p className="text-slate-500 font-medium">Анализ стратегий на основе предварительного опыта испытуемых (из experience.csv).</p>
                 </div>
               </div>
               
               <div className="space-y-24">
                 {Object.entries(experienceGroups).map(([experience, data]: [string, any]) => (
                   <div key={experience} className="space-y-8">
                     <div className="flex items-center gap-3">
                        <div className="h-px flex-1 bg-slate-200"></div>
                        <div className="flex items-center gap-2 px-6 py-2 bg-white border border-slate-200 rounded-full shadow-sm">
                           <GraduationCap size={18} className="text-indigo-500" />
                           <span className="text-sm font-black uppercase tracking-widest text-slate-600">{experience}</span>
                        </div>
                        <div className="h-px flex-1 bg-slate-200"></div>
                     </div>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <GlobalHeatMap 
                          title="Точки старта (все пробы)" 
                          icon={<Target size={20} className="text-red-500" />} 
                          points={data.start} 
                          normalizedNodes={averageNormalizedNodes}
                          badge={experience}
                        />
                        <GlobalHeatMap 
                          title="Точки финиша (все пробы)" 
                          icon={<Flag size={20} className="text-emerald-500" />} 
                          points={data.finish} 
                          normalizedNodes={averageNormalizedNodes}
                          badge={experience}
                        />
                        <GlobalHeatMap 
                          title="Успешные финалы: точки старта" 
                          icon={<Trophy size={20} className="text-amber-500" />} 
                          points={data.solvedFinalStart} 
                          normalizedNodes={averageNormalizedNodes}
                          badge={`${experience} • УСПЕХ`}
                          color="amber"
                        />
                        <GlobalHeatMap 
                          title="Успешные финалы: точки финиша" 
                          icon={<Star size={20} className="text-amber-500" />} 
                          points={data.solvedFinalFinish} 
                          normalizedNodes={averageNormalizedNodes}
                          badge={`${experience} • УСПЕХ`}
                          color="amber"
                        />
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-6">
                        <GlobalLineMap 
                          title="Все линии (все пробы)" 
                          icon={<Activity size={20} className="text-blue-500" />} 
                          lines={experienceLineGroups[experience]?.all || []} 
                          normalizedNodes={averageNormalizedNodes}
                          badge={experience}
                        />
                        <GlobalLineMap 
                          title="Успешные финалы: все линии" 
                          icon={<Trophy size={20} className="text-amber-500" />} 
                          lines={experienceLineGroups[experience]?.solvedFinal || []} 
                          normalizedNodes={averageNormalizedNodes}
                          badge={`${experience} • УСПЕХ`}
                          color="amber"
                        />
                     </div>
                   </div>
                 ))}
               </div>
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-[1550px] mx-auto mt-20 pt-8 border-t border-slate-200 text-slate-400 text-[10px] uppercase font-black tracking-[0.2em] flex flex-col md:flex-row justify-between gap-4">
        <p>&copy; 2025 Cognition Research Hub</p>
        <p>Refined Analysis Multi-Subject v12.11</p>
      </footer>

      <style>{`
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin-slow { animation: spin-slow 8s linear infinite; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  // @ts-ignore
  const root = (window as any)._reactRoot || createRoot(container);
  // @ts-ignore
  (window as any)._reactRoot = root;
  root.render(<App />);
}
