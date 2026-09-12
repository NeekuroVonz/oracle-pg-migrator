export {
  type CompileDiagnostic,
  type CompileResult,
  type CompileSqlOptions,
  compileSql,
  isDuplicateObjectError,
  type SqlExecutor,
  splitSqlStatements,
} from "./compile";
export {
  type CatalogExecutor,
  catalogName,
  quoteIdent,
  runStructuralTests,
  type StructuralCheck,
  type StructuralTestInput,
  type StructuralTestResult,
} from "./structural";
