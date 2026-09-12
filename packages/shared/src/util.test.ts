import { describe, expect, test } from "bun:test";
import { suggestedDiscoverySchemas } from "./util";

describe("suggestedDiscoverySchemas", () => {
  test("uses configured schemas instead of every user on the instance", () => {
    expect(suggestedDiscoverySchemas(["wms1"], "MIGRATOR_RO")).toEqual(["WMS1"]);
  });

  test("falls back to the Oracle session user when none are configured", () => {
    expect(suggestedDiscoverySchemas([], "wms1")).toEqual(["WMS1"]);
    expect(suggestedDiscoverySchemas(["  "], "WMS1")).toEqual(["WMS1"]);
  });
});
