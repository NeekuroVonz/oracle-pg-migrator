import type { ObjectDagDto, ObjectDagNodeDto } from "@migrator/shared";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";

function nodeLabel(node: ObjectDagNodeDto): string {
  return `${node.owner}.${node.name}`;
}

export function DagView({
  dag,
  objectHref,
}: {
  dag: ObjectDagDto;
  objectHref?: (objectId: string) => string;
}) {
  const byId = new Map(dag.nodes.map((node) => [node.id, node]));
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        {dag.nodeCount} objects · {dag.edgeCount} edges · {dag.layerCount} layers · {dag.cycleCount}{" "}
        cycles · {dag.waitingCount} waiting
      </p>
      {dag.cycles.length > 0 ? (
        <Card>
          <CardTitle>Cycles</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {dag.cycles.map((cycle) => (
              <li key={cycle.join("-")}>
                {cycle
                  .map((id) => {
                    const node = byId.get(id);
                    return node ? nodeLabel(node) : id;
                  })
                  .join(" → ")}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {dag.nodes
        .filter((node) => node.waiting)
        .map((node) => (
          <Card key={`wait-${node.id}`}>
            <CardTitle>{nodeLabel(node)} waits</CardTitle>
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {node.blockedBy.map((blocked) => (
                <li key={`${node.id}-${blocked.id}`}>
                  {blocked.owner ? `${blocked.owner}.` : ""}
                  {blocked.name} ({blocked.reason})
                </li>
              ))}
            </ul>
          </Card>
        ))}
      {dag.layers.map((layer, layerNumber) => (
        <Card key={layer.join("|") || `layer-${layerNumber + 1}`}>
          <CardTitle>Layer {layerNumber + 1}</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {layer.map((id) => {
              const node = byId.get(id);
              if (!node) {
                return null;
              }
              const content = (
                <>
                  <span className="font-medium">{nodeLabel(node)}</span>
                  <span className="text-muted"> {node.objectType}</span>
                  {node.waiting ? <Badge className="ml-2">WAITING</Badge> : null}
                  {node.inCycle ? <Badge className="ml-2">CYCLE</Badge> : null}
                </>
              );
              return (
                <li key={id}>
                  {objectHref ? (
                    <Link href={objectHref(id)} className="hover:underline">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
