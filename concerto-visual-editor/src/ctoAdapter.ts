
// ctoAdapter.ts
// Parses a .cto string using @accordproject/concerto-cto and maps the AST
// into React Flow nodes + edges, laid out with dagre.

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore – access Parser directly from the CJS barrel export
import ConcertoCto from '@accordproject/concerto-cto';
// The barrel exports { Parser, Printer, ... } where Parser = { parse, parseModels }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (ConcertoCto as any).Parser.parse.bind((ConcertoCto as any).Parser) as (cto: string) => unknown;
import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

// ─── Type colour palette ───────────────────────────────────────────────────
export const TYPE_COLORS: Record<string, { bg: string; border: string; badge: string }> = {
  ConceptDeclaration:      { bg: '#1e2a3a', border: '#3b82f6', badge: '#3b82f6' },
  AssetDeclaration:        { bg: '#1a2e24', border: '#22c55e', badge: '#22c55e' },
  ParticipantDeclaration:  { bg: '#2a1e3a', border: '#a855f7', badge: '#a855f7' },
  TransactionDeclaration:  { bg: '#2e1e1a', border: '#f97316', badge: '#f97316' },
  EventDeclaration:        { bg: '#2a2a1a', border: '#eab308', badge: '#eab308' },
  EnumDeclaration:         { bg: '#1a2a2a', border: '#06b6d4', badge: '#06b6d4' },
  // Scalars (StringScalar, IntegerScalar, etc.)
  StringScalar:            { bg: '#2a1a2a', border: '#ec4899', badge: '#ec4899' },
  IntegerScalar:           { bg: '#2a1a2a', border: '#ec4899', badge: '#ec4899' },
  LongScalar:              { bg: '#2a1a2a', border: '#ec4899', badge: '#ec4899' },
  DoubleScalar:            { bg: '#2a1a2a', border: '#ec4899', badge: '#ec4899' },
  BooleanScalar:           { bg: '#2a1a2a', border: '#ec4899', badge: '#ec4899' },
  DateTimeScalar:          { bg: '#2a1a2a', border: '#ec4899', badge: '#ec4899' },
  MapDeclaration:          { bg: '#2a2218', border: '#f59e0b', badge: '#f59e0b' },
};

export const TYPE_LABELS: Record<string, string> = {
  ConceptDeclaration:      'Concept',
  AssetDeclaration:        'Asset',
  ParticipantDeclaration:  'Participant',
  TransactionDeclaration:  'Transaction',
  EventDeclaration:        'Event',
  EnumDeclaration:         'Enum',
  StringScalar:            'Scalar',
  IntegerScalar:           'Scalar',
  LongScalar:              'Scalar',
  DoubleScalar:            'Scalar',
  BooleanScalar:           'Scalar',
  DateTimeScalar:          'Scalar',
  MapDeclaration:          'Map',
};

// ─── AST node typing (matches concerto-metamodel@1.0.0) ───────────────────
interface ASTLocation {
  start: { line: number; column: number; offset: number };
  end:   { line: number; column: number; offset: number };
}

interface TypeIdentifier {
  name: string;
  namespace?: string;
}

interface ASTProperty {
  $class?: string;
  name?: string;
  type?: TypeIdentifier;
  isArray?: boolean;
  isOptional?: boolean;
  location?: ASTLocation;
}

interface ASTDeclaration {
  $class?: string;
  name?: string;
  superType?: TypeIdentifier;
  properties?: ASTProperty[];
  isAbstract?: boolean;
  location?: ASTLocation;
}

interface ParsedModel {
  $class?: string;
  namespace: string;
  declarations?: ASTDeclaration[];
  imports?: unknown[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Per-property data stored in node for click-to-navigate */
export interface PropertyLine {
  label: string;
  line: number | null;   // 1-indexed source line, null if unknown
}

function formatProperty(prop: ASTProperty): PropertyLine {
  const cls = prop.$class ?? '';
  let label: string;
  if (cls.includes('EnumProperty')) {
    label = `  ◆ ${prop.name}`;
  } else {
    const optional = prop.isOptional ? '?' : '';
    const arr = prop.isArray ? '[]' : '';
    const typeName = prop.type?.name ?? '?';
    const marker = cls.includes('RelationshipProperty') ? '→ ' : (optional ? '○ ' : '● ');
    label = `  ${marker}${prop.name}: ${typeName}${arr}${optional ? ' (opt)' : ''}`;
  }
  return { label, line: prop.location?.start.line ?? null };
}

/** Strip the metamodel namespace prefix from a $class string */
function shortClass(fullClass?: string): string {
  if (!fullClass) return 'ConceptDeclaration';
  return fullClass.split('.').pop() ?? fullClass;
}

// ─── Main export ──────────────────────────────────────────────────────────
export interface ParseResult {
  nodes: Node[];
  edges: Edge[];
  namespace: string;
  declarationCount: number;
}

export interface ParseError {
  message: string;
  line?: number;
}

const NODE_WIDTH = 240;
const NODE_HEIGHT_BASE = 72;
const PROPERTY_HEIGHT = 22;

export function parseCtoToGraph(ctoSource: string): ParseResult | ParseError {
  let model: ParsedModel;
  try {
    // concerto-cto exports { parse, parseModels }
    // parse() returns a metamodel Model object
    model = parse(ctoSource) as ParsedModel;
  } catch (err: unknown) {
    const e = err as Error & { location?: { start: { line: number } } };
    return {
      message: e.message ?? String(err),
      line: e.location?.start?.line,
    };
  }

  const declarations = model.declarations ?? [];
  const namespace = model.namespace ?? 'unknown';

  // ── Build nodes ──────────────────────────────────────────────────────────
  const nodes: Node[] = declarations.map((decl) => {
    const kind = shortClass(decl.$class);
    const props = decl.properties ?? [];
    const height = NODE_HEIGHT_BASE + props.length * PROPERTY_HEIGHT;
    const colors = TYPE_COLORS[kind] ?? TYPE_COLORS.ConceptDeclaration;
    const abstract = decl.isAbstract ? '«abstract» ' : '';

    return {
      id: decl.name ?? 'unknown',
      type: 'concertoNode',
      position: { x: 0, y: 0 },         // dagre will override
      data: {
        label: decl.name ?? 'Unknown',
        kind,
        typeLabel: TYPE_LABELS[kind] ?? kind,
        abstract,
        colors,
        propertyLines: props.map(formatProperty),   // { label, line }[]
        superType: decl.superType?.name,
        declLine: decl.location?.start.line ?? null, // for click-to-navigate
      },
      style: { width: NODE_WIDTH, height },
    };
  });

  // ── Build edges ──────────────────────────────────────────────────────────
  const edges: Edge[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  declarations.forEach((decl) => {
    // Inheritance edges
    const superName = decl.superType?.name;
    if (superName && nodeIds.has(superName)) {
      edges.push({
        id: `extends-${decl.name}-${superName}`,
        source: decl.name ?? '',
        target: superName,
        label: 'extends',
        type: 'smoothstep',
        style: { stroke: '#6366f1', strokeWidth: 2, strokeDasharray: '6 3' },
        labelStyle: { fill: '#a5b4fc', fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: '#12122a', fillOpacity: 0.9 },
      });
    }

    // Relationship edges (-->) — RelationshipProperty in the metamodel
    (decl.properties ?? []).forEach((prop) => {
      const cls = prop.$class ?? '';
      if (cls.includes('RelationshipProperty')) {
        const typeName = prop.type?.name ?? '';
        if (typeName && nodeIds.has(typeName)) {
          edges.push({
            id: `rel-${decl.name}-${prop.name}-${typeName}`,
            source: decl.name ?? '',
            target: typeName,
            label: `→ ${prop.name ?? ''}`,
            type: 'smoothstep',
            style: { stroke: '#22c55e', strokeWidth: 1.5 },
            labelStyle: { fill: '#86efac', fontSize: 10 },
            labelBgStyle: { fill: '#12122a', fillOpacity: 0.9 },
          });
        }
      }
    });
  });

  // ── Dagre layout ─────────────────────────────────────────────────────────
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 70, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((n) => {
    const h = (n.style as { height?: number } | undefined)?.height ?? NODE_HEIGHT_BASE;
    g.setNode(n.id, { width: NODE_WIDTH + 20, height: h });
  });
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  nodes.forEach((n) => {
    const pos = g.node(n.id);
    const h = (n.style as { height?: number } | undefined)?.height ?? NODE_HEIGHT_BASE;
    n.position = { x: pos.x - NODE_WIDTH / 2, y: pos.y - h / 2 };
  });

  return { nodes, edges, namespace, declarationCount: declarations.length };
}

// ─── Mutation: add a --> relationship from one declaration to another ────────
/**
 * Inserts a RelationshipProperty line into the source declaration's block.
 *
 * @param ctoSource  - The current raw .cto string
 * @param fromName   - The source declaration name (e.g. "Shipment")
 * @param toName     - The target declaration name (e.g. "Supplier")
 * @returns Updated .cto string, or null if the block was not found / invalid
 */
export function addRelationship(
  ctoSource: string,
  fromName: string,
  toName: string,
): string | null {
  // Enums and Scalars cannot have relationship properties
  const enumScalarRe = new RegExp(
    `(?:enum|scalar)\\s+${fromName}\\b`,
  );
  if (enumScalarRe.test(ctoSource)) return null;

  // Locate the declaration header for fromName
  // Matches: [abstract] (concept|asset|participant|transaction|event) <name>
  const headerRe = new RegExp(
    `(?:abstract\\s+)?(?:concept|asset|participant|transaction|event)\\s+${fromName}\\b`,
  );
  const headerMatch = headerRe.exec(ctoSource);
  if (!headerMatch) return null;

  // Walk forward from the match to find the matching closing }
  let braceDepth = 0;
  let insertPos = -1;
  for (let i = headerMatch.index; i < ctoSource.length; i++) {
    if (ctoSource[i] === '{') {
      braceDepth++;
    } else if (ctoSource[i] === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        insertPos = i;
        break;
      }
    }
  }
  if (insertPos === -1) return null;

  // Generate a unique camelCase field name, e.g. Supplier → supplier, SupplierFoo → supplierFoo
  // If a field with this name already exists, append a number
  const baseName = toName.charAt(0).toLowerCase() + toName.slice(1);
  const existingBlock = ctoSource.slice(headerMatch.index, insertPos);
  const existing = new RegExp(`-->\\s+${toName}\\s+(\\w+)`).exec(existingBlock);
  const fieldName = existing
    ? baseName + '2'          // simple dedup: just append 2
    : baseName;

  const newLine = `  --> ${toName} ${fieldName}\n`;
  return ctoSource.slice(0, insertPos) + newLine + ctoSource.slice(insertPos);
}

