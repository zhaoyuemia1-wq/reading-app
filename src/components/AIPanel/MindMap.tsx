import { useRef, useEffect, useState, useCallback } from 'react';
import type { MindMapNode } from '../../services/ai';

interface LayoutNode {
  node: MindMapNode;
  x: number;
  y: number;
  depth: number;
  id: string;
}

interface LayoutEdge {
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Color palettes per depth
const DEPTH_COLORS = [
  { bg: '#6366f1', text: '#fff', border: '#818cf8' },   // root - indigo
  { bg: '#1e293b', text: '#a5b4fc', border: '#4f46e5' }, // depth 1
  { bg: '#1e293b', text: '#67e8f9', border: '#0891b2' }, // depth 2
  { bg: '#1e293b', text: '#86efac', border: '#16a34a' }, // depth 3
];

const NODE_WIDTH = 120;
const NODE_HEIGHT = 36;
const H_GAP = 60;  // horizontal gap between levels
const V_GAP = 14;  // vertical gap between siblings

let idCounter = 0;

function layoutTree(
  node: MindMapNode,
  depth: number,
  x: number,
  nextY: { val: number }
): { nodes: LayoutNode[]; edges: LayoutEdge[]; minY: number; maxY: number; id: string } {
  const id = `node-${idCounter++}`;
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  if (!node.children || node.children.length === 0) {
    const y = nextY.val;
    nextY.val += NODE_HEIGHT + V_GAP;
    nodes.push({ node, x, y, depth, id });
    return { nodes, edges, minY: y, maxY: y + NODE_HEIGHT, id };
  }

  const childResults = node.children.map(child => {
    const cx = x + NODE_WIDTH + H_GAP;
    const res = layoutTree(child, depth + 1, cx, nextY);
    return res;
  });

  const firstChildMinY = childResults[0].minY;
  const lastChildMaxY = childResults[childResults.length - 1].maxY;
  const centerY = (firstChildMinY + lastChildMaxY) / 2 - NODE_HEIGHT / 2;

  nodes.push({ node, x, y: centerY, depth, id });

  for (const cr of childResults) {
    nodes.push(...cr.nodes);
    edges.push(...cr.edges);
    edges.push({
      fromId: id,
      toId: cr.id,
      x1: x + NODE_WIDTH,
      y1: centerY + NODE_HEIGHT / 2,
      x2: cr.nodes.find(n => n.id === cr.id)!.x,
      y2: cr.nodes.find(n => n.id === cr.id)!.y + NODE_HEIGHT / 2,
    });
  }

  return { nodes, edges, minY: centerY, maxY: lastChildMaxY, id };
}

interface Props {
  data: MindMapNode;
}

export default function MindMap({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  idCounter = 0;
  const nextY = { val: 20 };
  const { nodes, edges } = layoutTree(data, 0, 20, nextY);

  const maxX = Math.max(...nodes.map(n => n.x + NODE_WIDTH)) + 20;
  const maxY = Math.max(...nodes.map(n => n.y + NODE_HEIGHT)) + 20;

  // Center on mount
  useEffect(() => {
    if (containerRef.current) {
      const containerW = containerRef.current.clientWidth;
      const containerH = containerRef.current.clientHeight;
      const initialScale = Math.min(containerW / maxX, containerH / maxY, 1) * 0.9;
      setScale(initialScale);
      setPan({
        x: (containerW - maxX * initialScale) / 2,
        y: (containerH - maxY * initialScale) / 2,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale(prev => Math.min(Math.max(prev - e.deltaY * 0.001, 0.3), 2));
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsPanning(true);
    setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({ x: e.clientX - startPan.x, y: e.clientY - startPan.y });
  };

  const handleMouseUp = () => setIsPanning(false);

  const resetView = () => {
    if (containerRef.current) {
      const containerW = containerRef.current.clientWidth;
      const containerH = containerRef.current.clientHeight;
      const s = Math.min(containerW / maxX, containerH / maxY, 1) * 0.9;
      setScale(s);
      setPan({ x: (containerW - maxX * s) / 2, y: (containerH - maxY * s) / 2 });
    }
  };

  return (
    <div className="relative w-full h-full bg-slate-950/60 overflow-hidden select-none" ref={containerRef}>
      {/* Controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <button
          onClick={() => setScale(s => Math.min(s + 0.15, 2))}
          className="w-7 h-7 flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white rounded-lg text-sm transition-colors"
        >+</button>
        <button
          onClick={() => setScale(s => Math.max(s - 0.15, 0.3))}
          className="w-7 h-7 flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white rounded-lg text-sm transition-colors"
        >-</button>
        <button
          onClick={resetView}
          className="w-7 h-7 flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors"
          title="重置视图"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>

      {/* Hint */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 text-xs text-slate-600 pointer-events-none">
        拖动平移 · 滚轮缩放
      </div>

      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          width: maxX,
          height: maxY,
          cursor: isPanning ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <svg
          width={maxX}
          height={maxY}
          className="absolute inset-0 pointer-events-none overflow-visible"
        >
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <circle cx="3" cy="3" r="1.5" fill="#334155" />
            </marker>
          </defs>
          {edges.map((edge, i) => {
            const cx1 = edge.x1;
            const cy1 = edge.y1;
            const cx2 = edge.x2;
            const cy2 = edge.y2;
            const midX = (cx1 + cx2) / 2;
            const isHighlighted = hoveredId === edge.fromId || hoveredId === edge.toId;

            return (
              <path
                key={i}
                d={`M ${cx1} ${cy1} C ${midX} ${cy1}, ${midX} ${cy2}, ${cx2} ${cy2}`}
                fill="none"
                stroke={isHighlighted ? '#6366f1' : '#334155'}
                strokeWidth={isHighlighted ? 1.5 : 1}
                opacity={isHighlighted ? 1 : 0.7}
                style={{ transition: 'stroke 0.15s, stroke-width 0.15s' }}
              />
            );
          })}
        </svg>

        {nodes.map(({ node, x, y, depth, id }) => {
          const colors = DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];
          const isHovered = hoveredId === id;
          const isRoot = depth === 0;

          return (
            <div
              key={id}
              onMouseEnter={() => setHoveredId(id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
                background: isRoot ? colors.bg : isHovered ? '#263349' : '#1a2336',
                border: `1.5px solid ${isHovered || isRoot ? colors.border : '#2d3f57'}`,
                borderRadius: isRoot ? 10 : 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px 8px',
                boxShadow: isRoot
                  ? `0 0 20px ${colors.bg}40`
                  : isHovered
                  ? `0 0 12px ${colors.border}30`
                  : 'none',
                transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
                cursor: 'default',
              }}
            >
              <span
                style={{
                  color: colors.text,
                  fontSize: isRoot ? 11 : 10,
                  fontWeight: isRoot ? 700 : depth === 1 ? 600 : 400,
                  textAlign: 'center',
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {node.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
