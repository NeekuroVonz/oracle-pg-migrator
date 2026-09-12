import type { ObjectDagDto, OracleObjectType } from "@migrator/shared";
import type { ObjectDag } from "./dag";

export function toObjectDagDto(dag: ObjectDag): ObjectDagDto {
  return {
    nodeCount: dag.nodes.length,
    edgeCount: dag.edges.length,
    layerCount: dag.layers.length,
    cycleCount: dag.cycleCount,
    waitingCount: dag.waitingCount,
    layers: dag.layers,
    cycles: dag.cycles,
    nodes: dag.nodes.map((node) => ({
      id: node.id,
      owner: node.owner,
      name: node.name,
      objectType: node.objectType as OracleObjectType,
      layer: node.layer,
      waiting: node.waiting,
      inCycle: node.inCycle,
      blockedBy: node.blockedBy.map((blocked) => ({
        id: blocked.id,
        owner: blocked.owner,
        name: blocked.name,
        objectType: blocked.objectType as OracleObjectType,
        reason: blocked.reason,
      })),
    })),
    edges: dag.edges.map((edge) => ({
      fromObjectId: edge.fromId,
      toObjectId: edge.toId,
      dependencyType: edge.dependencyType,
    })),
  };
}
