import { describe, expect, test } from "bun:test";
import { buildObjectDag } from "./dag";
import { conversionObjectOrder, orderByDag } from "./order";

function node(
  id: string,
  objectType: string,
  name = id,
): { id: string; owner: string; name: string; objectType: string } {
  return { id, owner: "HR", name, objectType };
}

describe("conversionObjectOrder", () => {
  test("sequences and tables compile before views", () => {
    expect(conversionObjectOrder("SEQUENCE")).toBeLessThan(conversionObjectOrder("TABLE"));
    expect(conversionObjectOrder("TABLE")).toBeLessThan(conversionObjectOrder("INDEX"));
    expect(conversionObjectOrder("INDEX")).toBeLessThan(conversionObjectOrder("CONSTRAINT"));
    expect(conversionObjectOrder("CONSTRAINT")).toBeLessThan(conversionObjectOrder("VIEW"));
  });
});

describe("buildObjectDag", () => {
  test("orders a view after the table it depends on", () => {
    const dag = buildObjectDag({
      nodes: [node("view", "VIEW", "EMP_V"), node("table", "TABLE", "EMP")],
      edges: [{ fromId: "view", toId: "table", dependencyType: "HARD" }],
    });
    expect(dag.order).toEqual(["table", "view"]);
    expect(dag.layers).toEqual([["table"], ["view"]]);
    expect(dag.waitingCount).toBe(0);
    expect(dag.cycleCount).toBe(0);
  });

  test("uses type rank when objects have no edges", () => {
    const dag = buildObjectDag({
      nodes: [node("view", "VIEW"), node("seq", "SEQUENCE"), node("table", "TABLE")],
      edges: [],
    });
    expect(dag.order).toEqual(["seq", "table", "view"]);
  });

  test("marks out-of-scope prerequisites as waiting", () => {
    const dag = buildObjectDag({
      nodes: [
        node("view", "VIEW", "EMP_V"),
        node("table", "TABLE", "EMP"),
        node("missing", "TABLE", "DEPT"),
      ],
      selectedIds: ["view", "table"],
      edges: [
        { fromId: "view", toId: "table", dependencyType: "HARD" },
        { fromId: "view", toId: "missing", dependencyType: "HARD" },
      ],
    });
    const view = dag.nodes.find((item) => item.id === "view");
    expect(view?.waiting).toBe(true);
    expect(view?.blockedBy).toEqual([
      {
        id: "missing",
        owner: "HR",
        name: "DEPT",
        objectType: "TABLE",
        reason: "OUT_OF_SCOPE",
      },
    ]);
    expect(dag.waitingCount).toBe(1);
  });

  test("marks deferred in-scope prerequisites as waiting", () => {
    const dag = buildObjectDag({
      nodes: [node("view", "VIEW"), node("fn", "FUNCTION")],
      edges: [{ fromId: "view", toId: "fn", dependencyType: "HARD" }],
      unavailableIds: ["fn"],
    });
    expect(dag.nodes.find((item) => item.id === "view")?.waiting).toBe(true);
    expect(dag.nodes.find((item) => item.id === "view")?.blockedBy[0]?.reason).toBe("DEFERRED");
  });

  test("detects a two-node cycle", () => {
    const dag = buildObjectDag({
      nodes: [node("a", "VIEW", "A"), node("b", "VIEW", "B")],
      edges: [
        { fromId: "a", toId: "b", dependencyType: "HARD" },
        { fromId: "b", toId: "a", dependencyType: "HARD" },
      ],
    });
    expect(dag.cycleCount).toBe(1);
    expect(dag.cycles[0]?.sort()).toEqual(["a", "b"]);
    expect(dag.nodes.every((item) => item.inCycle)).toBe(true);
  });

  test("orderByDag follows the computed order", () => {
    const ordered = orderByDag([{ id: "view" }, { id: "table" }], ["table", "view"]);
    expect(ordered.map((item) => item.id)).toEqual(["table", "view"]);
  });
});
