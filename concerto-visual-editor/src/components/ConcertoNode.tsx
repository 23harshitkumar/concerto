
// ConcertoNode.tsx — Custom React Flow node rendered as a UML class card
// Supports click-to-navigate: clicking the title or a property fires onNavigate(line)
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { TYPE_COLORS, type PropertyLine } from '../ctoAdapter';

export interface ConcertoNodeData {
  label: string;
  kind: string;
  typeLabel: string;
  abstract?: string;
  colors: (typeof TYPE_COLORS)[string];
  propertyLines: PropertyLine[];   // { label, line }[]
  superType?: string;
  declLine: number | null;
  onNavigate?: (line: number) => void;
  [key: string]: unknown;
}

export function ConcertoNode({ data, selected }: NodeProps) {
  const d = data as ConcertoNodeData;
  const { label, typeLabel, abstract: abs, colors, propertyLines, superType, declLine, onNavigate } = d;

  const navigate = (line: number | null) => {
    if (line != null && onNavigate) onNavigate(line);
  };

  return (
    <div
      className="concerto-node"
      style={{
        background: colors.bg,
        border: `2px solid ${selected ? '#fff' : colors.border}`,
        boxShadow: selected
          ? `0 0 0 3px ${colors.border}55, 0 8px 32px #00000080`
          : `0 4px 20px #00000060`,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: colors.border, width: 10, height: 10 }} />

      {/* ── Header (click → jump to declaration line) ── */}
      <div
        className={`node-header ${declLine != null ? 'node-header--clickable' : ''}`}
        style={{ background: `${colors.border}22`, borderBottom: `1px solid ${colors.border}44` }}
        onClick={() => navigate(declLine)}
        title={declLine != null ? `Click to jump to line ${declLine}` : undefined}
      >
        <span className="node-badge" style={{ background: colors.badge, color: '#000' }}>
          {typeLabel}
        </span>
        <span className="node-title">
          {abs && <span className="node-abstract">{abs}</span>}{label}
          {declLine != null && (
            <span className="node-line-hint">:{declLine}</span>
          )}
        </span>
        {superType && (
          <span className="node-super" style={{ color: colors.border }}>
            ↑ {superType}
          </span>
        )}
      </div>

      {/* ── Properties (click each → jump to that property's line) ── */}
      {propertyLines.length > 0 ? (
        <div className="node-props">
          {propertyLines.map((p, i) => (
            <div
              key={i}
              className={`node-prop ${p.line != null ? 'node-prop--clickable' : ''}`}
              onClick={() => navigate(p.line)}
              title={p.line != null ? `Click to jump to line ${p.line}` : undefined}
            >
              {p.label}
              {p.line != null && (
                <span className="node-prop-line"> :{p.line}</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="node-empty">no properties</div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: colors.border, width: 10, height: 10 }} />
    </div>
  );
}
