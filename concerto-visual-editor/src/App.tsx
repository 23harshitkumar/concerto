
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  addEdge,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { parseCtoToGraph, addRelationship, TYPE_COLORS } from './ctoAdapter';
import { ConcertoNode } from './components/ConcertoNode';
import './App.css';

// ─── Hardcoded default .cto ───────────────────────────────────────────────
const DEFAULT_CTO = `namespace org.example.supplychain@1.0.0

enum ShipmentStatus {
  o CREATED
  o IN_TRANSIT
  o ARRIVED
  o DAMAGED
}

scalar ContractId extends String

concept Address {
  o String street
  o String city
  o String country
  o String postCode optional
}

abstract asset BaseAsset identified by assetId {
  o String assetId
}

asset Shipment extends BaseAsset {
  o ShipmentStatus status
  o Double weight
  o Address origin
  o Address destination
  --> Supplier supplier
  --> Retailer retailer
}

abstract participant BaseParticipant identified by participantId {
  o String participantId
  o String name
  o Address address
}

participant Supplier extends BaseParticipant {
  o String[] productCategories
}

participant Retailer extends BaseParticipant {
  o Double creditLimit
}

transaction ShipmentReceived {
  --> Shipment shipment
  o String receivedBy
}

event ShipmentStatusChanged {
  --> Shipment shipment
  o ShipmentStatus newStatus
}
`;

const nodeTypes = { concertoNode: ConcertoNode };
const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 520;
const DEFAULT_PANEL_WIDTH = 280;

// ─── Inner canvas ─────────────────────────────────────────────────────────
function EditorCanvas({
  nodes,
  edges,
  miniMapColor,
  onConnect,
}: {
  nodes: Node[];
  edges: Edge[];
  miniMapColor: (n: Node) => string;
  onConnect: (connection: Connection) => void;
}) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (nodes.length > 0) {
      requestAnimationFrame(() => fitView({ padding: 0.18, duration: 400 }));
    }
  }, [nodes, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      minZoom={0.1}
      maxZoom={3}
      zoomOnScroll
      zoomOnPinch
      panOnScroll={false}
      onConnect={onConnect}
      proOptions={{ hideAttribution: true }}
      onInit={() => {
        if (nodes.length > 0) fitView({ padding: 0.18, duration: 400 });
      }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} color="#ffffff0f" />
      {/* ── Smaller minimap ── */}
      <MiniMap
        nodeColor={miniMapColor}
        maskColor="#00000060"
        style={{
          background: '#0d0d1a',
          border: '1px solid #333',
          width: 120,
          height: 80,
        }}
      />
    </ReactFlow>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────
function AppInner() {
  const [ctoSource, setCtoSource] = useState(DEFAULT_CTO);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [status, setStatus] = useState<{ msg: string; type: 'idle' | 'ok' | 'error' }>({
    msg: 'Edit the .cto model and click "Parse & Render" →',
    type: 'idle',
  });
  const [stats, setStats] = useState<{ ns: string; count: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Resizable panel state ────────────────────────────────────────────────
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_PANEL_WIDTH);

  // ── Click-to-navigate: scroll textarea to a 1-indexed line ───────────────
  const navigateToLine = useCallback((line: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const lines = ta.value.split('\n');
    let start = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length - 1); i++) {
      start += lines[i].length + 1;
    }
    const end = start + (lines[line - 1]?.length ?? 0);
    ta.focus();
    ta.setSelectionRange(start, end);
    // Scroll the textarea so the selected line is visible
    // Approximate: use scrollTop based on line height
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const scrollTarget = (line - 3) * lineHeight;
    ta.scrollTop = Math.max(0, scrollTarget);
    // Flash the editor panel border to give visual feedback
    ta.classList.add('navigate-flash');
    setTimeout(() => ta.classList.remove('navigate-flash'), 600);
  }, []);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const next = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, dragStartWidth.current + delta));
      setPanelWidth(next);
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // ── Parse handler ────────────────────────────────────────────────────────
  const handleParse = useCallback((src: string, silent = false) => {
    const result = parseCtoToGraph(src);
    if ('message' in result) {
      if (!silent) setStatus({
        msg: `Parse error${result.line ? ` (line ${result.line})` : ''}: ${result.message}`,
        type: 'error',
      });
      setNodes([]);
      setEdges([]);
      setStats(null);
    } else {
      setNodes(result.nodes);
      setEdges(result.edges);
      setStats({ ns: result.namespace, count: result.declarationCount });
      if (!silent) setStatus({
        msg: `✓ ${result.declarationCount} declarations rendered — click any node or property to navigate`,
        type: 'ok',
      });
    }
  }, []);

  const miniMapColor = useCallback((node: Node) => {
    const kind = (node.data as { kind?: string }).kind ?? '';
    return TYPE_COLORS[kind]?.border ?? '#888';
  }, []);

  // ── History stack for undo (stores previous .cto source strings) ──────────
  const history = useRef<string[]>([]);

  const pushHistory = useCallback((src: string) => {
    history.current = [...history.current.slice(-49), src]; // keep last 50
  }, []);

  // Ctrl+Z: pop history and restore
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (history.current.length === 0) return;
        e.preventDefault();
        const prev = history.current[history.current.length - 1];
        history.current = history.current.slice(0, -1);
        setCtoSource(prev);
        handleParse(prev, true);
        setStatus({ msg: `↩ Undo — restored previous model`, type: 'idle' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleParse]);

  // ── onConnect: draw edge → mutate .cto → re-parse ──────────────────────
  const handleConnect = useCallback((connection: Connection) => {
    const { source, target } = connection;
    if (!source || !target || source === target) return;

    const updated = addRelationship(ctoSource, source, target);
    if (updated === null) {
      setStatus({
        msg: `⚠ Cannot add relationship: "${source}" may be an Enum or Scalar`,
        type: 'error',
      });
      return;
    }

    // push current source to history BEFORE mutating
    pushHistory(ctoSource);
    setCtoSource(updated);
    handleParse(updated, true);
    setEdges((eds) => addEdge({
      ...connection,
      label: `→ ${target.charAt(0).toLowerCase() + target.slice(1)}`,
      type: 'smoothstep',
      style: { stroke: '#22c55e', strokeWidth: 1.5 },
      labelStyle: { fill: '#86efac', fontSize: 10 },
      labelBgStyle: { fill: '#12122a', fillOpacity: 0.9 },
    }, eds));
    setStatus({
      msg: `✓ Added --> ${target} to ${source} — Ctrl+Z to undo`,
      type: 'ok',
    });
  }, [ctoSource, pushHistory, handleParse]);

  const legendItems = useMemo(
    () =>
      Object.entries(TYPE_COLORS).map(([kind, c]) => ({
        kind,
        label: kind.replace('Declaration', '').replace('Scalar', ' Scalar'),
        color: c.border,
      })),
    [],
  );

  // Inject onNavigate callback into every node's data
  const nodesWithNav = useMemo(
    () => nodes.map((n) => ({
      ...n,
      data: { ...n.data, onNavigate: navigateToLine },
    })),
    [nodes, navigateToLine],
  );

  return (
    <div className="app-shell">
      {/* ─── Header ──────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-icon">◈</span>
          <span className="brand-name">Concerto Visual Editor</span>
          <span className="brand-tag">GSoC '26 Prototype · Accord Project</span>
        </div>
        <div className="header-meta">
          <a href="https://github.com/23harshitkumar" target="_blank" rel="noreferrer" className="header-link">
            23harshitkumar
          </a>
        </div>
      </header>

      {/* ─── Main split ──────────────────────────────────────────────── */}
      <main className="app-main">
        {/* Left: Resizable Editor panel */}
        <aside className="editor-panel" style={{ width: panelWidth, minWidth: panelWidth, maxWidth: panelWidth }}>
          <div className="panel-titlebar">
            <span className="panel-icon">{ }</span>
            <span>.cto Model Editor</span>
          </div>
          <textarea
            ref={textareaRef}
            className="cto-editor"
            value={ctoSource}
            onChange={(e) => {
              setCtoSource(e.target.value);
              setStatus({ msg: 'Model changed — click "Parse & Render" to update.', type: 'idle' });
            }}
            spellCheck={false}
            aria-label="CTO source editor"
          />
          <button className="parse-btn" onClick={() => handleParse(ctoSource)} id="parse-render-btn">
            <span className="parse-btn-icon">▶</span> Parse &amp; Render
          </button>
          <div className="legend">
            {legendItems.map(({ kind, label, color }) => (
              <div key={kind} className="legend-item">
                <span className="legend-dot" style={{ background: color }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* Drag divider */}
        <div className="resize-divider" onMouseDown={onDividerMouseDown} title="Drag to resize" />

        {/* Right: Graph canvas */}
        <section className="canvas-panel">
          <div className={`status-bar ${status.type}`} role="status" aria-live="polite">
            {status.msg}
            {stats && (
              <span className="status-stats">
                &nbsp;|&nbsp; ns: <strong>{stats.ns}</strong>
                &nbsp;|&nbsp; <strong>{stats.count}</strong> declarations
              </span>
            )}
          </div>

          {nodes.length === 0 && (
            <div className="canvas-placeholder">
              <div className="placeholder-icon">◈</div>
              <p>Edit the .cto model on the left and click<br /><strong>Parse &amp; Render</strong> to visualise the graph.</p>
            </div>
          )}

          <EditorCanvas
            nodes={nodesWithNav}
            edges={edges}
            miniMapColor={miniMapColor}
            onConnect={handleConnect}
          />
        </section>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  );
}
