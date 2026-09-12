import { describe, expect, test } from "bun:test";
import {
  chunkObjectDependencyEdges,
  OBJECT_DEPENDENCY_INSERT_BATCH_SIZE,
  uniqueObjectDependencyEdges,
} from "./object-dependencies-repository";

describe("uniqueObjectDependencyEdges", () => {
  test("keeps the first of duplicate from/to/type triples", () => {
    expect(
      uniqueObjectDependencyEdges([
        { fromObjectId: "a", toObjectId: "b", dependencyType: "HARD" },
        { fromObjectId: "a", toObjectId: "b", dependencyType: "HARD" },
        { fromObjectId: "a", toObjectId: "c", dependencyType: "HARD" },
        { fromObjectId: "a", toObjectId: "b", dependencyType: "REF" },
      ]),
    ).toEqual([
      { fromObjectId: "a", toObjectId: "b", dependencyType: "HARD" },
      { fromObjectId: "a", toObjectId: "c", dependencyType: "HARD" },
      { fromObjectId: "a", toObjectId: "b", dependencyType: "REF" },
    ]);
  });
});

describe("chunkObjectDependencyEdges", () => {
  test("splits oversized inserts under the postgres bind budget", () => {
    const edges = Array.from({ length: OBJECT_DEPENDENCY_INSERT_BATCH_SIZE + 3 }, (_, index) => ({
      fromObjectId: "from",
      toObjectId: `to-${index}`,
      dependencyType: "HARD",
    }));
    const chunks = chunkObjectDependencyEdges(edges, OBJECT_DEPENDENCY_INSERT_BATCH_SIZE);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(OBJECT_DEPENDENCY_INSERT_BATCH_SIZE);
    expect(chunks[1]).toHaveLength(3);
  });
});
