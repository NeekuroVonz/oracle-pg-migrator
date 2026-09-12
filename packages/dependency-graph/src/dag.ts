import type { DagBlockedReason } from "@migrator/shared";
import { compareConversionOrder, type RankedObject } from "./order";

export interface DagObjectInput extends RankedObject {}

export interface DagEdgeInput {
  fromId: string;
  toId: string;
  dependencyType: string;
}

export interface BuildObjectDagInput {
  nodes: DagObjectInput[];
  edges: DagEdgeInput[];
  selectedIds?: Iterable<string>;
  unavailableIds?: Iterable<string>;
}

export interface DagBlockedBy {
  id: string;
  owner: string;
  name: string;
  objectType: string;
  reason: DagBlockedReason;
}

export interface ObjectDagNode extends DagObjectInput {
  layer: number;
  waiting: boolean;
  inCycle: boolean;
  blockedBy: DagBlockedBy[];
}

export interface ObjectDagEdge {
  fromId: string;
  toId: string;
  dependencyType: string;
}

export interface ObjectDag {
  order: string[];
  layers: string[][];
  cycles: string[][];
  nodes: ObjectDagNode[];
  edges: ObjectDagEdge[];
  waitingCount: number;
  cycleCount: number;
}

function neighbors(adj: Map<string, string[]>, id: string): string[] {
  const existing = adj.get(id);
  if (existing) {
    return existing;
  }
  const created: string[] = [];
  adj.set(id, created);
  return created;
}

function tarjan(ids: string[], adj: Map<string, string[]>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const sccs: string[][] = [];

  const strongconnect = (vertex: string): void => {
    indices.set(vertex, index);
    low.set(vertex, index);
    index += 1;
    stack.push(vertex);
    onStack.add(vertex);
    for (const next of neighbors(adj, vertex)) {
      if (!indices.has(next)) {
        strongconnect(next);
        low.set(vertex, Math.min(low.get(vertex) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(vertex, Math.min(low.get(vertex) ?? 0, indices.get(next) ?? 0));
      }
    }
    if (low.get(vertex) === indices.get(vertex)) {
      const scc: string[] = [];
      while (stack.length > 0) {
        const item = stack.pop();
        if (!item) {
          break;
        }
        onStack.delete(item);
        scc.push(item);
        if (item === vertex) {
          break;
        }
      }
      sccs.push(scc);
    }
  };

  for (const id of ids) {
    if (!indices.has(id)) {
      strongconnect(id);
    }
  }
  return sccs;
}

export function buildObjectDag(input: BuildObjectDagInput): ObjectDag {
  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  const selectedIds = new Set(input.selectedIds ?? byId.keys());
  const unavailable = new Set(input.unavailableIds ?? []);
  const blockedBy = new Map<string, DagBlockedBy[]>();
  const graphEdges: ObjectDagEdge[] = [];
  const adj = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const id of selectedIds) {
    indegree.set(id, 0);
    neighbors(adj, id);
    blockedBy.set(id, []);
  }

  for (const edge of input.edges) {
    if (!selectedIds.has(edge.fromId) || edge.fromId === edge.toId) {
      continue;
    }
    const from = byId.get(edge.fromId);
    const to = byId.get(edge.toId);
    if (!from) {
      continue;
    }
    if (!selectedIds.has(edge.toId)) {
      blockedBy.get(edge.fromId)?.push({
        id: edge.toId,
        owner: to?.owner ?? "",
        name: to?.name ?? edge.toId,
        objectType: to?.objectType ?? "TABLE",
        reason: "OUT_OF_SCOPE",
      });
      continue;
    }
    if (unavailable.has(edge.toId)) {
      blockedBy.get(edge.fromId)?.push({
        id: edge.toId,
        owner: to?.owner ?? "",
        name: to?.name ?? edge.toId,
        objectType: to?.objectType ?? "TABLE",
        reason: "DEFERRED",
      });
      continue;
    }
    graphEdges.push({
      fromId: edge.fromId,
      toId: edge.toId,
      dependencyType: edge.dependencyType,
    });
    neighbors(adj, edge.toId).push(edge.fromId);
    indegree.set(edge.fromId, (indegree.get(edge.fromId) ?? 0) + 1);
  }

  const ranked = (id: string): RankedObject => {
    const node = byId.get(id);
    return node ?? { id, owner: "", name: id, objectType: "TABLE" };
  };

  const layers: string[][] = [];
  const remaining = new Set(selectedIds);
  let ready = [...selectedIds]
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort((left, right) => compareConversionOrder(ranked(left), ranked(right)));

  while (ready.length > 0) {
    layers.push(ready);
    const next: string[] = [];
    for (const id of ready) {
      remaining.delete(id);
      for (const dependent of neighbors(adj, id)) {
        const degree = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, degree);
        if (degree === 0 && remaining.has(dependent)) {
          next.push(dependent);
        }
      }
    }
    ready = [...new Set(next)].sort((left, right) =>
      compareConversionOrder(ranked(left), ranked(right)),
    );
  }

  const leftover = [...remaining].sort((left, right) =>
    compareConversionOrder(ranked(left), ranked(right)),
  );
  if (leftover.length > 0) {
    layers.push(leftover);
  }

  const cyclicIds = new Set<string>();
  const cycles = tarjan([...selectedIds], adj)
    .filter((scc) => scc.length > 1)
    .map((scc) => scc.sort((left, right) => compareConversionOrder(ranked(left), ranked(right))));
  for (const scc of cycles) {
    for (const id of scc) {
      cyclicIds.add(id);
    }
  }

  const order = layers.flat();
  const layerOf = new Map<string, number>();
  layers.forEach((layer, index) => {
    for (const id of layer) {
      layerOf.set(id, index);
    }
  });

  const nodes: ObjectDagNode[] = order.map((id) => {
    const node = ranked(id);
    const blocked = blockedBy.get(id) ?? [];
    return {
      id,
      owner: node.owner,
      name: node.name,
      objectType: node.objectType,
      layer: layerOf.get(id) ?? 0,
      waiting: blocked.length > 0,
      inCycle: cyclicIds.has(id),
      blockedBy: blocked,
    };
  });

  return {
    order,
    layers,
    cycles,
    nodes,
    edges: graphEdges,
    waitingCount: nodes.filter((node) => node.waiting).length,
    cycleCount: cycles.length,
  };
}
