import { AesGcmSecretCipher, type AppEnv, loadEnv, type SecretCipher } from "@migrator/config";
import {
  AiProvidersRepository,
  AuditRepository,
  ConnectionsRepository,
  ConversionAttemptsRepository,
  createDatabase,
  createPool,
  DataCopyRunsRepository,
  DataCopyTablesRepository,
  DeployObjectsRepository,
  DeployRunsRepository,
  DiscoveredObjectsRepository,
  DiscoveryRunsRepository,
  type MetadataDatabase,
  MigrationReportsRepository,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  MigrationScopesRepository,
  ObjectDependenciesRepository,
  ProjectsRepository,
  TestAttemptsRepository,
  ValidationAttemptsRepository,
} from "@migrator/db";
import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { Pool } from "pg";
import { AiProvidersController } from "./ai-providers/ai-providers.controller";
import { AiProvidersService } from "./ai-providers/ai-providers.service";
import { AuditController } from "./audit/audit.controller";
import { AuditService } from "./audit/audit.service";
import { AppExceptionFilter } from "./common/app-exception.filter";
import { ConnectionsController } from "./connections/connections.controller";
import { ConnectionsService } from "./connections/connections.service";
import { ConversionController } from "./conversion/conversion.controller";
import { ConversionService } from "./conversion/conversion.service";
import { DagController } from "./dag/dag.controller";
import { DagService } from "./dag/dag.service";
import { DataCopyService } from "./data-copy/data-copy.service";
import { DeployService } from "./deploy/deploy.service";
import { DiscoveryController } from "./discovery/discovery.controller";
import { DiscoveryService } from "./discovery/discovery.service";
import { HealthController } from "./health/health.controller";
import { HealthService } from "./health/health.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsService } from "./projects/projects.service";
import { ReportService } from "./report/report.service";
import { ScopeController } from "./scope/scope.controller";
import { ScopeService } from "./scope/scope.service";
import { ValidatorPoolController } from "./validator-pool/validator-pool.controller";
import { ValidatorPoolService } from "./validator-pool/validator-pool.service";

export const ENV = "APP_ENV";
export const DB_POOL = "DB_POOL";
export const DATABASE = "DATABASE";
export const SECRET_CIPHER = "SECRET_CIPHER";

@Module({
  controllers: [
    HealthController,
    ProjectsController,
    ConnectionsController,
    AuditController,
    DiscoveryController,
    ScopeController,
    ConversionController,
    DagController,
    ValidatorPoolController,
    AiProvidersController,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AppExceptionFilter,
    },
    {
      provide: ENV,
      useFactory: (): AppEnv => loadEnv(),
    },
    {
      provide: DB_POOL,
      inject: [ENV],
      useFactory: (env: AppEnv): Pool => createPool(env.DATABASE_URL),
    },
    {
      provide: DATABASE,
      inject: [DB_POOL],
      useFactory: (pool: Pool): MetadataDatabase => createDatabase(pool),
    },
    {
      provide: SECRET_CIPHER,
      inject: [ENV],
      useFactory: (env: AppEnv): SecretCipher => new AesGcmSecretCipher(env.SECRETS_MASTER_KEY),
    },
    {
      provide: ProjectsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new ProjectsRepository(db),
    },
    {
      provide: ConnectionsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new ConnectionsRepository(db),
    },
    {
      provide: AuditRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new AuditRepository(db),
    },
    {
      provide: DiscoveryRunsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new DiscoveryRunsRepository(db),
    },
    {
      provide: DiscoveredObjectsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new DiscoveredObjectsRepository(db),
    },
    {
      provide: ObjectDependenciesRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new ObjectDependenciesRepository(db),
    },
    {
      provide: MigrationScopesRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new MigrationScopesRepository(db),
    },
    {
      provide: MigrationRunsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new MigrationRunsRepository(db),
    },
    {
      provide: MigrationRunObjectsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new MigrationRunObjectsRepository(db),
    },
    {
      provide: ConversionAttemptsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new ConversionAttemptsRepository(db),
    },
    {
      provide: ValidationAttemptsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new ValidationAttemptsRepository(db),
    },
    {
      provide: TestAttemptsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new TestAttemptsRepository(db),
    },
    {
      provide: MigrationReportsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new MigrationReportsRepository(db),
    },
    {
      provide: DataCopyRunsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new DataCopyRunsRepository(db),
    },
    {
      provide: DataCopyTablesRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new DataCopyTablesRepository(db),
    },
    {
      provide: DeployRunsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new DeployRunsRepository(db),
    },
    {
      provide: DeployObjectsRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new DeployObjectsRepository(db),
    },
    {
      provide: AiProvidersRepository,
      inject: [DATABASE],
      useFactory: (db: MetadataDatabase) => new AiProvidersRepository(db),
    },
    {
      provide: HealthService,
      inject: [DB_POOL, ENV],
      useFactory: (pool: Pool, env: AppEnv) => new HealthService(pool, env),
    },
    ProjectsService,
    {
      provide: ConnectionsService,
      inject: [ProjectsRepository, ConnectionsRepository, AuditRepository, SECRET_CIPHER],
      useFactory: (
        projects: ProjectsRepository,
        connections: ConnectionsRepository,
        audit: AuditRepository,
        cipher: SecretCipher,
      ) => new ConnectionsService(projects, connections, audit, cipher),
    },
    AuditService,
    {
      provide: DiscoveryService,
      inject: [
        ENV,
        SECRET_CIPHER,
        ProjectsRepository,
        ConnectionsRepository,
        DiscoveryRunsRepository,
        DiscoveredObjectsRepository,
        ObjectDependenciesRepository,
        AuditRepository,
      ],
      useFactory: (
        env: AppEnv,
        cipher: SecretCipher,
        projects: ProjectsRepository,
        connections: ConnectionsRepository,
        runs: DiscoveryRunsRepository,
        objects: DiscoveredObjectsRepository,
        dependencies: ObjectDependenciesRepository,
        audit: AuditRepository,
      ) =>
        new DiscoveryService(
          env,
          cipher,
          projects,
          connections,
          runs,
          objects,
          dependencies,
          audit,
        ),
    },
    {
      provide: ScopeService,
      inject: [
        ProjectsRepository,
        ConnectionsRepository,
        DiscoveredObjectsRepository,
        MigrationScopesRepository,
        AuditRepository,
      ],
      useFactory: (
        projects: ProjectsRepository,
        connections: ConnectionsRepository,
        objects: DiscoveredObjectsRepository,
        scopes: MigrationScopesRepository,
        audit: AuditRepository,
      ) => new ScopeService(projects, connections, objects, scopes, audit),
    },
    {
      provide: ConversionService,
      inject: [
        ENV,
        ProjectsRepository,
        MigrationScopesRepository,
        DiscoveredObjectsRepository,
        MigrationRunsRepository,
        MigrationRunObjectsRepository,
        ConversionAttemptsRepository,
        ValidationAttemptsRepository,
        TestAttemptsRepository,
        AuditRepository,
        ConnectionsRepository,
      ],
      useFactory: (
        env: AppEnv,
        projects: ProjectsRepository,
        scopes: MigrationScopesRepository,
        objects: DiscoveredObjectsRepository,
        runs: MigrationRunsRepository,
        runObjects: MigrationRunObjectsRepository,
        attempts: ConversionAttemptsRepository,
        validations: ValidationAttemptsRepository,
        tests: TestAttemptsRepository,
        audit: AuditRepository,
        connections: ConnectionsRepository,
      ) =>
        new ConversionService(
          env,
          projects,
          scopes,
          objects,
          runs,
          runObjects,
          attempts,
          validations,
          tests,
          audit,
          connections,
        ),
    },
    ReportService,
    {
      provide: DataCopyService,
      inject: [
        ENV,
        ProjectsRepository,
        ConnectionsRepository,
        MigrationScopesRepository,
        MigrationRunsRepository,
        MigrationRunObjectsRepository,
        DataCopyRunsRepository,
        DataCopyTablesRepository,
        AuditRepository,
      ],
      useFactory: (
        env: AppEnv,
        projects: ProjectsRepository,
        connections: ConnectionsRepository,
        scopes: MigrationScopesRepository,
        runs: MigrationRunsRepository,
        runObjects: MigrationRunObjectsRepository,
        copyRuns: DataCopyRunsRepository,
        copyTables: DataCopyTablesRepository,
        audit: AuditRepository,
      ) =>
        new DataCopyService(
          env,
          projects,
          connections,
          scopes,
          runs,
          runObjects,
          copyRuns,
          copyTables,
          audit,
        ),
    },
    {
      provide: DeployService,
      inject: [
        ENV,
        ProjectsRepository,
        ConnectionsRepository,
        MigrationRunsRepository,
        MigrationRunObjectsRepository,
        ObjectDependenciesRepository,
        MigrationReportsRepository,
        DeployRunsRepository,
        DeployObjectsRepository,
        DiscoveredObjectsRepository,
        AuditRepository,
      ],
      useFactory: (
        env: AppEnv,
        projects: ProjectsRepository,
        connections: ConnectionsRepository,
        runs: MigrationRunsRepository,
        runObjects: MigrationRunObjectsRepository,
        dependencies: ObjectDependenciesRepository,
        reports: MigrationReportsRepository,
        deployRuns: DeployRunsRepository,
        deployObjects: DeployObjectsRepository,
        discovered: DiscoveredObjectsRepository,
        audit: AuditRepository,
      ) =>
        new DeployService(
          env,
          projects,
          connections,
          runs,
          runObjects,
          dependencies,
          reports,
          deployRuns,
          deployObjects,
          discovered,
          audit,
        ),
    },
    {
      provide: DagService,
      inject: [
        ProjectsRepository,
        DiscoveredObjectsRepository,
        MigrationScopesRepository,
        ObjectDependenciesRepository,
        MigrationRunsRepository,
        MigrationRunObjectsRepository,
      ],
      useFactory: (
        projects: ProjectsRepository,
        objects: DiscoveredObjectsRepository,
        scopes: MigrationScopesRepository,
        dependencies: ObjectDependenciesRepository,
        runs: MigrationRunsRepository,
        runObjects: MigrationRunObjectsRepository,
      ) => new DagService(projects, objects, scopes, dependencies, runs, runObjects),
    },
    {
      provide: ValidatorPoolService,
      inject: [ENV],
      useFactory: (env: AppEnv) => new ValidatorPoolService(env),
    },
    {
      provide: AiProvidersService,
      inject: [ENV, AiProvidersRepository, AuditRepository, SECRET_CIPHER],
      useFactory: (
        env: AppEnv,
        providers: AiProvidersRepository,
        audit: AuditRepository,
        cipher: SecretCipher,
      ) => new AiProvidersService(env, providers, audit, cipher),
    },
  ],
})
export class AppModule {}
