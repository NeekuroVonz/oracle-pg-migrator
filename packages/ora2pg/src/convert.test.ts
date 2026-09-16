import { describe, expect, test } from "bun:test";
import {
  aliasViewSelectToColumnList,
  convertOracleDdl,
  ensureTargetSchemaSql,
  mapTypesInSql,
  mergeConstraintAlters,
  rewriteCatalogColumnTypes,
  toPgIdent,
} from "./convert";
import { mapOracleDataType } from "./types";

describe("mapOracleDataType", () => {
  test("maps Oracle NUMBER to PostgreSQL numeric (avoids bigint for fractional data)", () => {
    expect(mapOracleDataType("NUMBER")).toBe("numeric");
    expect(mapOracleDataType("NUMBER(4)")).toBe("numeric(4)");
    expect(mapOracleDataType("NUMBER(9,0)")).toBe("numeric(9)");
    expect(mapOracleDataType("NUMBER(18)")).toBe("numeric(18)");
    expect(mapOracleDataType("NUMBER(10,2)")).toBe("numeric(10,2)");
    expect(mapOracleDataType("NUMERIC")).toBe("numeric");
    expect(mapOracleDataType("DECIMAL")).toBe("numeric");
    expect(mapOracleDataType("VARCHAR2(100)")).toBe("varchar(100)");
    expect(mapOracleDataType("CLOB")).toBe("text");
    expect(mapOracleDataType("DATE")).toBe("timestamp");
    expect(mapOracleDataType("TIMESTAMP(6) WITH TIME ZONE")).toBe("timestamp(6) with time zone");
  });
  test("rewrites Ora2Pg bigint columns to catalog numeric types", () => {
    const rewritten = rewriteCatalogColumnTypes(
      `CREATE TABLE wms1.tac_crca (
  pk bigint NOT NULL,
  amount bigint,
  note varchar(40)
);`,
      [
        {
          name: "PK",
          dataType: "NUMBER",
          dataLength: 22,
          dataPrecision: 19,
          dataScale: 0,
        },
        {
          name: "AMOUNT",
          dataType: "NUMBER",
          dataLength: 22,
          dataPrecision: 18,
          dataScale: 0,
        },
        {
          name: "NOTE",
          dataType: "VARCHAR2",
          dataLength: 40,
          dataPrecision: null,
          dataScale: null,
        },
      ],
    );
    expect(rewritten.sql).toContain("pk numeric(19)");
    expect(rewritten.sql).toContain("amount numeric(18)");
    expect(rewritten.sql).toContain("note varchar(40)");
    expect(rewritten.rewritten.some((item) => item.includes("amount"))).toBe(true);
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
    expect(result.sql).toContain("CREATE TABLE hr.employees");
    expect(result.sql).toContain("employee_id numeric(6)");
    expect(result.sql).toContain("first_name varchar(20)");
    expect(result.sql).toContain("CURRENT_TIMESTAMP");
    expect(result.sql).not.toContain("TABLESPACE");
    expect(result.sql).not.toContain("PCTFREE");
    expect(result.sql).toMatch(/CONSTRAINT emp_pk PRIMARY KEY/i);
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

  test("does not rewrite column name DEC (December) as a type", () => {
    expect(mapTypesInSql("nov NUMBER, dec NUMBER, ale_in_year NUMBER")).toBe(
      "nov numeric, dec numeric, ale_in_year numeric",
    );
  });

  test("maps types inside SQL fragments", () => {
    expect(mapTypesInSql("id NUMBER(9,0), name VARCHAR2(40)")).toBe("id numeric(9), name varchar(40)");
    expect(mapOracleDataType("VARCHAR2(1 CHAR)")).toBe("varchar(1)");
    expect(mapOracleDataType("VARCHAR2(1000 BYTE)")).toBe("varchar(1000)");
    expect(mapTypesInSql("code VARCHAR2(1 CHAR)")).toBe("code varchar(1)");
    expect(mapTypesInSql("number_employee NUMBER(10,0)")).toBe("number_employee numeric(10)");
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

  test("maps GLOBAL TEMPORARY TABLE to UNLOGGED TABLE in the owner schema", () => {
    const result = convertOracleDdl({
      objectType: "TABLE",
      owner: "WMS1",
      name: "TLG_DAILY_TMP_12",
      sourceText: `CREATE GLOBAL TEMPORARY TABLE "WMS1"."TLG_DAILY_TMP_12" (
        "PK" NUMBER(19,0) NOT NULL ENABLE
      ) ON COMMIT DELETE ROWS`,
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.sql).toContain("CREATE UNLOGGED TABLE wms1.tlg_daily_tmp_12");
    expect(result.sql).toContain("CREATE SCHEMA IF NOT EXISTS wms1");
    expect(result.sql).not.toContain("TEMPORARY");
    expect(result.sql).not.toContain("ON COMMIT");
    expect(result.warnings.some((warning) => warning.includes("UNLOGGED TABLE"))).toBe(true);
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
    expect(result.sql).toMatch(/ADD CONSTRAINT tco_buspartner_pk PRIMARY KEY/i);
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

  test("keeps ALTER TABLE on the real table when converting a named constraint", () => {
    const result = convertOracleDdl({
      objectType: "CONSTRAINT",
      owner: "WMS1",
      name: "TAC_ABBUDGET_PK",
      sourceText: `ALTER TABLE "WMS1"."TAC_ABBUDGET" ADD CONSTRAINT "TAC_ABBUDGET_PK" PRIMARY KEY ("PK")`,
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.sql).toContain("ALTER TABLE wms1.tac_abbudget ADD CONSTRAINT tac_abbudget_pk");
    expect(result.sql).not.toMatch(/ALTER TABLE wms1\.tac_abbudget_pk\b/i);
  });

  test("pins a constraint onto the Oracle table name even if the object is named like a PK", () => {
    const result = convertOracleDdl({
      objectType: "CONSTRAINT",
      owner: "WMS1",
      name: "TAC_ABBUDGET_PK",
      tableName: "TAC_ABBUDGET",
      sourceText: `ALTER TABLE "WMS1"."TAC_ABBUDGET" ADD CONSTRAINT "TAC_ABBUDGET_PK" PRIMARY KEY ("PK")`,
    });
    expect(result.sql).toContain("ALTER TABLE wms1.tac_abbudget ADD CONSTRAINT tac_abbudget_pk");
  });

  test("adds SET NOT NULL when Oracle catalog says the column is mandatory", () => {
    const result = convertOracleDdl({
      objectType: "TABLE",
      owner: "WMS1",
      name: "TAC_ABBUDGET",
      sourceText: `CREATE TABLE "WMS1"."TAC_ABBUDGET" ("PK" NUMBER(19,0), "NOTE" VARCHAR2(50))`,
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
          name: "NOTE",
          dataType: "VARCHAR2",
          nullable: true,
          dataLength: 50,
          dataPrecision: null,
          dataScale: null,
          columnId: 2,
        },
      ],
    });
    expect(result.sql).toMatch(/ALTER TABLE wms1\.tac_abbudget ALTER COLUMN pk SET NOT NULL/i);
    expect(result.sql).not.toMatch(/ALTER COLUMN note SET NOT NULL/i);
  });

  test("rewrites sequence.nextval into nextval()", () => {
    const result = convertOracleDdl({
      objectType: "TABLE",
      owner: "WMS1",
      name: "SYS_USER_FAVORITE_MENU",
      sourceText: `CREATE TABLE "WMS1"."SYS_USER_FAVORITE_MENU" (
        "PK" NUMBER DEFAULT "WMS1"."SYS_USER_FAVORITE_MENU_SEQ".NEXTVAL
      )`,
    });
    expect(result.sql).toContain("nextval('wms1.sys_user_favorite_menu_seq')");
    expect(result.sql).not.toMatch(/\.nextval/i);
  });

  test("strips Oracle PARTITION BY RANGE lists from CREATE TABLE", () => {
    const result = convertOracleDdl({
      objectType: "TABLE",
      owner: "WMS1",
      name: "TLG_BPG_PLAN_D",
      sourceText: `CREATE TABLE "WMS1"."TLG_BPG_PLAN_D" (
        "PK" NUMBER(19,0),
        "YYYYMM" VARCHAR2(6)
      ) PARTITION BY RANGE ("YYYYMM") (
        PARTITION YYYY_2020_1 VALUES LESS THAN ('202003'),
        PARTITION YYYYMM_ALL VALUES LESS THAN (MAXVALUE)
      )`,
    });
    expect(result.sql).toContain("CREATE TABLE wms1.tlg_bpg_plan_d");
    expect(result.sql).not.toMatch(/PARTITION BY/i);
    expect(result.sql).not.toMatch(/VALUES LESS THAN/i);
    expect(result.warnings.some((warning) => warning.includes("PARTITION BY"))).toBe(true);
  });

  test("strips LOCAL from partitioned indexes", () => {
    const result = convertOracleDdl({
      objectType: "INDEX",
      owner: "WMS1",
      name: "TLG_STOCK_DAILY_IDX02",
      sourceText: `CREATE INDEX "WMS1"."TLG_STOCK_DAILY_IDX02" ON "WMS1"."TLG_STOCK_DAILY" ("STOCK_DT") LOCAL`,
    });
    expect(result.sql).toContain("CREATE INDEX tlg_stock_daily_idx02 ON wms1.tlg_stock_daily");
    expect(result.sql).not.toMatch(/\bLOCAL\b/i);
  });

  test("does not let -- comments swallow the rest of a view after whitespace collapse", () => {
    const result = convertOracleDdl({
      objectType: "VIEW",
      owner: "WMS1",
      name: "VLG_IN_CURRENTSTOCK",
      sourceText: `CREATE OR REPLACE VIEW "WMS1"."VLG_IN_CURRENTSTOCK" AS
        SELECT A1.PK
        -- comment before FROM
        FROM "WMS1"."TLG_SA_STOCK_CLOSING_D" A1`,
    });
    expect(result.sql).toMatch(/\bFROM\b/i);
    expect(result.sql).not.toContain("--");
  });

  test("rewrites DECODE to CASE", () => {
    const result = convertOracleDdl({
      objectType: "VIEW",
      owner: "WMS1",
      name: "VLG_SO_STOCKTRDAILY",
      sourceText: `CREATE OR REPLACE VIEW "WMS1"."V" AS
        SELECT DECODE(NVL(a.out_wh_pk, 0), 0, b.out_wh_pk, a.out_wh_pk) wh
        FROM tlg_gd_outgo_d a, tlg_gd_outgo_m b`,
    });
    expect(result.sql).toMatch(/CASE/i);
    expect(result.sql).not.toMatch(/\bDECODE\s*\(/i);
  });

  test("strips Oracle (+) outer-join markers", () => {
    const result = convertOracleDdl({
      objectType: "VIEW",
      owner: "WMS1",
      name: "V_ABPLCENTER",
      sourceText: `CREATE OR REPLACE VIEW "WMS1"."V_ABPLCENTER" AS
        SELECT a.pk FROM tac_abpl a, tac_abplcenter b
        WHERE a.pk = b.tac_abpl_pk(+) AND b.del_if(+) = 0`,
    });
    expect(result.sql).not.toMatch(/\(\s*\+\s*\)/);
    expect(result.warnings.some((w) => w.includes("(+)") )).toBe(true);
  });

  test("renames PRIMARY KEY when constraint name equals table name", () => {
    const result = convertOracleDdl({
      objectType: "CONSTRAINT",
      owner: "WMS1",
      name: "THR_CLOSE",
      tableName: "THR_CLOSE",
      sourceText: `ALTER TABLE "WMS1"."THR_CLOSE" ADD CONSTRAINT "THR_CLOSE" PRIMARY KEY ("PK")`,
    });
    expect(result.sql).toMatch(/ADD CONSTRAINT thr_close_pkey PRIMARY KEY/i);
    expect(result.sql).not.toMatch(/ADD CONSTRAINT thr_close PRIMARY KEY/i);
  });

  test("renames PRIMARY KEY when Oracle name matches a sibling table", () => {
    const result = convertOracleDdl({
      objectType: "CONSTRAINT",
      owner: "WMS1",
      name: "TCO_ABCODE",
      tableName: "TCO_ABCODE_NO_USE",
      sourceText: `ALTER TABLE "WMS1"."TCO_ABCODE_NO_USE" ADD CONSTRAINT "TCO_ABCODE" PRIMARY KEY ("PK")`,
    });
    expect(result.sql).toMatch(
      /ALTER TABLE wms1\.tco_abcode_no_use ADD CONSTRAINT tco_abcode_no_use_pkey/i,
    );
    expect(result.sql).not.toMatch(/ADD CONSTRAINT tco_abcode PRIMARY KEY/i);
  });

  test("casts bare NULL in UNION branches to NULL::bigint", () => {
    const result = convertOracleDdl({
      objectType: "VIEW",
      owner: "WMS1",
      name: "VLG_PO_PUR_ORDER",
      sourceText: `CREATE OR REPLACE VIEW "WMS1"."VLG_PO_PUR_ORDER" AS
        SELECT d.pk, d.in_qty submit_qty, NULL return_qty FROM tlg_st_income_d d
        UNION ALL
        SELECT d.pk, NULL submit_qty, d.return_qty FROM tlg_st_outgo_return_d d`,
    });
    expect(result.sql).toMatch(/NULL::bigint\s+return_qty/i);
    expect(result.sql).toMatch(/NULL::bigint\s+submit_qty/i);
    expect(result.sql).not.toMatch(/NULLIF::bigint/i);
  });
  test("aliases VIEW SELECT items to the Oracle column list", () => {
    const sql = aliasViewSelectToColumnList(
      `CREATE OR REPLACE VIEW wms1.ves_userobjpriv (user_pk, menu_pk, role_nm) AS SELECT DISTINCT u.pk, o.pk, r.role_nm FROM tes_user u, tes_obj o, tes_role r;`,
    );
    expect(sql).toMatch(/u\.pk AS user_pk/i);
    expect(sql).toMatch(/o\.pk AS menu_pk/i);
    expect(sql).toMatch(/r\.role_nm AS role_nm/i);
    expect(sql).not.toMatch(/\(user_pk,/i);
  });

  test("aliases COALESCE expressions that would otherwise all be named coalesce", () => {
    const sql = aliasViewSelectToColumnList(
      `CREATE OR REPLACE VIEW wms1.vhr_sal_custom (thr_emp_pk, s1, s12) AS SELECT S.THR_EMP_PK, COALESCE(NET_AMT, 0), COALESCE(SOCIAL_AMT, 0) FROM thr_month_salary S;`,
    );
    expect(sql).toMatch(/COALESCE\(NET_AMT, 0\) AS s1/i);
    expect(sql).toMatch(/COALESCE\(SOCIAL_AMT, 0\) AS s12/i);
  });
});

describe("ensureTargetSchemaSql", () => {
  test("puts unqualified Ora2Pg output into the Oracle owner schema", () => {
    const sql = ensureTargetSchemaSql(
      `SET search_path = public, pg_catalog;
CREATE TABLE tco_buspartner (
  pk bigint NOT NULL
);`,
      "WMS1",
      "TCO_BUSPARTNER",
      "TABLE",
    );
    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS wms1");
    expect(sql).toContain("CREATE TABLE wms1.tco_buspartner");
    expect(sql).not.toContain("search_path");
    expect(sql).not.toContain("CREATE TABLE tco_buspartner");
  });

  test("does not rewrite constraint ALTER TABLE onto the constraint name", () => {
    const sql = ensureTargetSchemaSql(
      `ALTER TABLE wms1.tac_abbudget ADD CONSTRAINT tac_abbudget_pk PRIMARY KEY (pk);`,
      "WMS1",
      "TAC_ABBUDGET_PK",
      "CONSTRAINT",
    );
    expect(sql).toContain("ALTER TABLE wms1.tac_abbudget ADD CONSTRAINT tac_abbudget_pk");
    expect(sql).not.toMatch(/ALTER TABLE wms1\.tac_abbudget_pk\b/i);
  });
});

describe("mergeConstraintAlters", () => {
  test("copies named PK alters onto ora2pg table SQL that dropped them", () => {
    const merged = mergeConstraintAlters(
      `CREATE TABLE wms1.tco_buspartner (pk bigint);`,
      `CREATE TABLE wms1.tco_buspartner (pk bigint);\nALTER TABLE wms1.tco_buspartner ADD CONSTRAINT tco_buspartner_pk PRIMARY KEY (pk);`,
    );
    expect(merged).toMatch(/ADD CONSTRAINT tco_buspartner_pk PRIMARY KEY/i);
  });
});
