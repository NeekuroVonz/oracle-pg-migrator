import { describe, expect, test } from "bun:test";
import { convertOracleDdl, mapTypesInSql, toPgIdent } from "./convert";
import { mapOracleDataType } from "./types";

describe("mapOracleDataType", () => {
  test("follows Ora2Pg integer and numeric defaults", () => {
    expect(mapOracleDataType("NUMBER")).toBe("bigint");
    expect(mapOracleDataType("NUMBER(4)")).toBe("smallint");
    expect(mapOracleDataType("NUMBER(9,0)")).toBe("integer");
    expect(mapOracleDataType("NUMBER(18)")).toBe("bigint");
    expect(mapOracleDataType("NUMBER(10,2)")).toBe("numeric(10,2)");
    expect(mapOracleDataType("VARCHAR2(100)")).toBe("varchar(100)");
    expect(mapOracleDataType("CLOB")).toBe("text");
    expect(mapOracleDataType("DATE")).toBe("timestamp");
    expect(mapOracleDataType("TIMESTAMP(6) WITH TIME ZONE")).toBe("timestamp(6) with time zone");
  });
});

describe("toPgIdent", () => {
  test("lowercases Oracle-quoted uppercase names", () => {
    expect(toPgIdent("EMPLOYEES")).toBe("employees");
    expect(toPgIdent('"HR"')).toBe("hr");
  });
});

describe("convertOracleDdl", () => {
  test("converts a table without calling AI", () => {
    const result = convertOracleDdl({
      objectType: "TABLE",
      owner: "HR",
      name: "EMPLOYEES",
      sourceText: `CREATE TABLE "HR"."EMPLOYEES" (
        "EMPLOYEE_ID" NUMBER(6,0) NOT NULL ENABLE,
        "FIRST_NAME" VARCHAR2(20),
        "HIRE_DATE" DATE DEFAULT SYSDATE,
        CONSTRAINT "EMP_PK" PRIMARY KEY ("EMPLOYEE_ID") ENABLE
      ) PCTFREE 10 TABLESPACE "USERS"`,
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.sql).toContain("CREATE SCHEMA IF NOT EXISTS hr");
    expect(result.sql).toContain("employee_id integer");
    expect(result.sql).toContain("first_name varchar(20)");
    expect(result.sql).toContain("CURRENT_TIMESTAMP");
    expect(result.sql).not.toContain("TABLESPACE");
    expect(result.sql).not.toContain("PCTFREE");
  });

  test("virtual columns and bitmap indexes stay succeeded with warnings, not review", () => {
    const table = convertOracleDdl({
      objectType: "TABLE",
      owner: "WMS1",
      name: "ITEMS",
      sourceText: `CREATE TABLE "WMS1"."ITEMS" (
        "PK" NUMBER(19,0) NOT NULL ENABLE,
        "LABEL" VARCHAR2(20) GENERATED ALWAYS AS (UPPER("NAME")) VIRTUAL
      )`,
    });
    expect(table.status).toBe("SUCCEEDED");
    expect(table.warnings.some((warning) => warning.includes("Virtual"))).toBe(true);

    const index = convertOracleDdl({
      objectType: "INDEX",
      owner: "WMS1",
      name: "IX_ITEMS_BITMAP",
      sourceText: `CREATE BITMAP INDEX "WMS1"."IX_ITEMS_BITMAP" ON "WMS1"."ITEMS" ("PK")`,
    });
    expect(index.status).toBe("SUCCEEDED");
    expect(index.warnings.some((warning) => warning.includes("BITMAP"))).toBe(true);
  });

  test("converts a sequence and strips Oracle-only clauses", () => {
    const result = convertOracleDdl({
      objectType: "SEQUENCE",
      owner: "HR",
      name: "EMP_SEQ",
      sourceText:
        'CREATE SEQUENCE  "HR"."EMP_SEQ"  MINVALUE 1 MAXVALUE 9999999999999999999999999999 INCREMENT BY 1 START WITH 41 CACHE 20 NOORDER  NOCYCLE',
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.sql).toContain("CREATE SEQUENCE hr.emp_seq");
    expect(result.sql).toContain("CACHE 20");
    expect(result.sql).toContain("NO CYCLE");
    expect(result.sql).not.toContain("NOORDER");
  });

  test("flags CONNECT BY as review-required instead of guessing", () => {
    const result = convertOracleDdl({
      objectType: "VIEW",
      owner: "HR",
      name: "ORG",
      sourceText: `CREATE OR REPLACE VIEW "HR"."ORG" AS SELECT "EMPLOYEE_ID" FROM "HR"."EMPLOYEES" START WITH "MANAGER_ID" IS NULL CONNECT BY PRIOR "EMPLOYEE_ID" = "MANAGER_ID"`,
    });
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.riskFlags).toContain("CONNECT BY");
    expect(result.sql).toContain("CREATE SCHEMA IF NOT EXISTS hr");
  });

  test("does not convert packages", () => {
    const result = convertOracleDdl({
      objectType: "PACKAGE",
      owner: "HR",
      name: "EMP_PKG",
      sourceText: "CREATE PACKAGE EMP_PKG AS END;",
    });
    expect(result.sql).toBeNull();
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  test("maps types inside SQL fragments", () => {
    expect(mapTypesInSql("id NUMBER(9,0), name VARCHAR2(40)")).toBe("id integer, name varchar(40)");
    expect(mapOracleDataType("VARCHAR2(1 CHAR)")).toBe("varchar(1)");
    expect(mapOracleDataType("VARCHAR2(1000 BYTE)")).toBe("varchar(1000)");
    expect(mapTypesInSql("code VARCHAR2(1 CHAR)")).toBe("code varchar(1)");
    expect(mapTypesInSql("number_employee NUMBER(10,0)")).toBe("number_employee bigint");
    expect(mapTypesInSql("interface_dt DATE")).toBe("interface_dt timestamp");
  });

  test("unqualifies schema-prefixed index names", () => {
    const result = convertOracleDdl({
      objectType: "INDEX",
      owner: "WMS1",
      name: "SYS_MAIL_TEMPLATE_PK",
      sourceText: `CREATE UNIQUE INDEX "WMS1"."SYS_MAIL_TEMPLATE_PK" ON "WMS1"."SYS_MAIL_TEMPLATE" ("PK") PCTFREE 10 INITRANS 2 TABLESPACE "WMS1"`,
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.sql).toContain(
      "CREATE UNIQUE INDEX sys_mail_template_pk ON wms1.sys_mail_template (pk)",
    );
    expect(result.sql).not.toMatch(/index wms1\./i);
    expect(result.sql).not.toContain("PCTFREE");
  });

  test("strips GoldenGate supplemental logging and USING INDEX storage", () => {
    const result = convertOracleDdl({
      objectType: "TABLE",
      owner: "WMS1",
      name: "SYS_MAIL_TEMPLATE",
      sourceText: `CREATE TABLE "WMS1"."SYS_MAIL_TEMPLATE" (
        "PK" NUMBER(19,0) NOT NULL ENABLE,
        "BODY" CLOB,
        CONSTRAINT "SYS_MAIL_TEMPLATE_PK" PRIMARY KEY ("PK")
          USING INDEX PCTFREE 10 INITRANS 2 MAXTRANS 255 COMPUTE STATISTICS
          STORAGE(INITIAL 65536) TABLESPACE "WMS1" ENABLE,
        SUPPLEMENTAL LOG DATA (PRIMARY KEY) COLUMNS,
        SUPPLEMENTAL LOG GROUP "GGS_SYS_MAIL" ("PK") ALWAYS
      ) PCTFREE 10 LOB ("BODY") STORE AS SECUREFILE (STORAGE IN ROW CHUNK 8192 CACHE)
      CREATE UNIQUE INDEX "WMS1"."SYS_MAIL_TEMPLATE_PK" ON "WMS1"."SYS_MAIL_TEMPLATE" ("PK")`,
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.sql).toContain("PRIMARY KEY (pk)");
    expect(result.sql).not.toContain("SUPPLEMENTAL");
    expect(result.sql).not.toContain("USING INDEX");
    expect(result.sql).not.toContain("STATISTICS");
    expect(result.sql).not.toContain("LOB");
    expect(result.sql).not.toContain("CREATE UNIQUE INDEX");
    expect(result.sql).toMatch(/body text/i);
  });

  test("converts GLOBAL TEMPORARY TABLE without a schema qualifier", () => {
    const result = convertOracleDdl({
      objectType: "TABLE",
      owner: "WMS1",
      name: "TLG_DAILY_TMP_12",
      sourceText: `CREATE GLOBAL TEMPORARY TABLE "WMS1"."TLG_DAILY_TMP_12" (
        "PK" NUMBER(19,0) NOT NULL ENABLE
      ) ON COMMIT DELETE ROWS`,
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.sql).toContain("CREATE TEMPORARY TABLE tlg_daily_tmp_12");
    expect(result.sql).toContain("ON COMMIT DELETE ROWS");
    expect(result.sql).not.toMatch(/TEMPORARY TABLE wms1\./i);
    expect(result.sql).not.toContain("GLOBAL");
    expect(result.warnings.some((warning) => warning.includes("GLOBAL TEMPORARY"))).toBe(true);
  });

  test("maps sequence NOCACHE to CACHE 1", () => {
    const result = convertOracleDdl({
      objectType: "SEQUENCE",
      owner: "WMS1",
      name: "MAIL_SEQ",
      sourceText: `CREATE SEQUENCE "WMS1"."MAIL_SEQ" MINVALUE 1 MAXVALUE 9999999999999999999999999999 INCREMENT BY 1 START WITH 1 NOCACHE NOORDER NOCYCLE`,
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.sql).toContain("CACHE 1");
    expect(result.sql).not.toContain("NOCACHE");
  });

  test("strips FORCE EDITIONABLE from views", () => {
    const result = convertOracleDdl({
      objectType: "VIEW",
      owner: "WMS1",
      name: "V_MAIL",
      sourceText: `CREATE OR REPLACE FORCE EDITIONABLE VIEW "WMS1"."V_MAIL" ("PK") AS SELECT "PK" FROM "WMS1"."SYS_MAIL_TEMPLATE"`,
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.sql).toContain("CREATE OR REPLACE VIEW");
    expect(result.sql).not.toContain("FORCE");
    expect(result.sql).not.toContain("EDITIONABLE");
  });

  test("rewrites function-based index expressions", () => {
    const result = convertOracleDdl({
      objectType: "INDEX",
      owner: "WMS1",
      name: "IX_MAIL_UPPER",
      sourceText: `CREATE INDEX "WMS1"."IX_MAIL_UPPER" ON "WMS1"."SYS_MAIL_TEMPLATE" (UPPER("BODY"), NVL("PK", 0))`,
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.sql).toContain("CREATE INDEX ix_mail_upper ON wms1.sys_mail_template");
    expect(result.sql).toContain("COALESCE(");
    expect(result.sql).not.toMatch(/index wms1\./i);
  });

  test("keeps ALTER TABLE ADD columns that GET_DDL appends after CREATE TABLE", () => {
    const result = convertOracleDdl({
      objectType: "TABLE",
      owner: "WMS1",
      name: "TCO_BUSPARTNER",
      sourceText: `CREATE TABLE "WMS1"."TCO_BUSPARTNER" (
        "PK" NUMBER(19,0) NOT NULL ENABLE
      ) PCTFREE 10
      ALTER TABLE "WMS1"."TCO_BUSPARTNER" ADD (
        "NUMBER_EMPLOYEE" NUMBER(10,0),
        "NUMBER_BANK" NUMBER(10,0),
        "INTERFACE_DT" DATE,
        "INTERFACE_BY" VARCHAR2(50)
      )
      ALTER TABLE "WMS1"."TCO_BUSPARTNER" ADD CONSTRAINT "TCO_BUSPARTNER_PK" PRIMARY KEY ("PK")
      CREATE UNIQUE INDEX "WMS1"."TCO_BUSPARTNER_PK" ON "WMS1"."TCO_BUSPARTNER" ("PK")`,
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.sql).toMatch(/number_employee/i);
    expect(result.sql).toMatch(/number_bank/i);
    expect(result.sql).toMatch(/interface_dt/i);
    expect(result.sql).toMatch(/interface_by/i);
    expect(result.sql).not.toContain("ADD CONSTRAINT");
    expect(result.sql).not.toContain("CREATE UNIQUE INDEX");
  });

  test("adds Oracle catalog columns missing from extracted DDL", () => {
    const result = convertOracleDdl({
      objectType: "TABLE",
      owner: "WMS1",
      name: "TCO_BUSPARTNER",
      sourceText: `CREATE TABLE "WMS1"."TCO_BUSPARTNER" ("PK" NUMBER(19,0) NOT NULL ENABLE)`,
      columns: [
        {
          name: "PK",
          dataType: "NUMBER",
          nullable: false,
          dataLength: 22,
          dataPrecision: 19,
          dataScale: 0,
          columnId: 1,
        },
        {
          name: "NUMBER_EMPLOYEE",
          dataType: "NUMBER",
          nullable: true,
          dataLength: 22,
          dataPrecision: 10,
          dataScale: 0,
          columnId: 2,
        },
        {
          name: "INTERFACE_DT",
          dataType: "DATE",
          nullable: true,
          dataLength: 7,
          dataPrecision: null,
          dataScale: null,
          columnId: 3,
        },
      ],
    });
    expect(result.sql).toContain("ADD COLUMN number_employee");
    expect(result.sql).toContain("ADD COLUMN interface_dt");
    expect(result.warnings.some((warning) => warning.includes("number_employee"))).toBe(true);
  });
});
