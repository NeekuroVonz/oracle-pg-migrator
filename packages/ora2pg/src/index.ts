export { convertWithOra2pgCli } from "./cli";
export type { ConversionResult } from "./convert";
export {
  convertOracleDdl,
  detectRiskFlags,
  mapTypesInSql,
  rewriteIdentifiers,
  toPgIdent,
} from "./convert";
export {
  mapOracleDataType,
  ORACLE_TYPE_PATTERN,
  type ParsedOracleType,
  parseOracleDataType,
} from "./types";
