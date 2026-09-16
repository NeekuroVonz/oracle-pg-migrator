import { describe, expect, test } from "bun:test";
import {
  isConversionStopped,
  isPlsqlObjectType,
  parseRunTracks,
  runCancelRequested,
  typesForTracks,
} from "./enums";

describe("conversion tracks", () => {
  test("schema track is tables indexes sequences only", () => {
    expect([...typesForTracks(["SCHEMA"])].sort()).toEqual(
      ["CONSTRAINT", "INDEX", "SEQUENCE", "TABLE"].sort(),
    );
    expect(isPlsqlObjectType("PROCEDURE")).toBe(true);
    expect(isPlsqlObjectType("TABLE")).toBe(false);
  });

  test("legacy runs without tracks keep schema plus views", () => {
    expect(parseRunTracks({})).toEqual(["SCHEMA", "VIEWS"]);
    expect(parseRunTracks({ tracks: ["PLSQL"] })).toEqual(["PLSQL"]);
    expect(runCancelRequested({ cancelRequested: true })).toBe(true);
    expect(isConversionStopped({ status: "RUNNING", stats: { cancelRequested: true } })).toBe(true);
    expect(isConversionStopped({ status: "CANCELLED", stats: {} })).toBe(true);
    expect(isConversionStopped({ status: "RUNNING", stats: {} })).toBe(false);
  });
});
