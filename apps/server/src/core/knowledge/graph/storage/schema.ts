import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
  GraphEdgeType,
  GraphEntityType,
  GraphFactType,
  GraphStatus,
  JsonObject,
  KnowledgeGraphPayload,
} from "../payloads.js";
import type { SourceDescriptor, SourceKind, TrustTier, ToolDescriptor } from "../types.js";

export const knowledgeSources = sqliteTable("knowledge_sources", {
  id: text("id").primaryKey(),
  kind: text("kind").$type<SourceKind>().notNull(),
  title: text("title").notNull(),
  trustTier: text("trust_tier").$type<TrustTier>().notNull(),
  freshness: text("freshness").$type<SourceDescriptor["freshness"]>().notNull(),
  descriptorJson: text("descriptor_json", { mode: "json" }).$type<SourceDescriptor>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const knowledgeTools = sqliteTable("knowledge_tools", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  trustTier: text("trust_tier").$type<TrustTier>().notNull(),
  descriptorJson: text("descriptor_json", { mode: "json" }).$type<ToolDescriptor>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const resourceVersions = sqliteTable("resource_versions", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  contentHash: text("content_hash").notNull(),
  indexedAt: text("indexed_at").notNull(),
  sourcePathsJson: text("source_paths_json", { mode: "json" }).$type<string[]>().notNull(),
});

export const graphEntities = sqliteTable(
  "graph_entities",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").$type<GraphEntityType>().notNull(),
    stableKey: text("stable_key").notNull(),
    payloadJson: text("payload_json", { mode: "json" }).$type<KnowledgeGraphPayload>().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("graph_entities_type_idx").on(table.entityType)],
);

export const graphFacts = sqliteTable(
  "graph_facts",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").notNull(),
    factType: text("fact_type").$type<GraphFactType>().notNull(),
    payloadJson: text("payload_json", { mode: "json" }).$type<KnowledgeGraphPayload>().notNull(),
    confidence: real("confidence").notNull(),
    trustTier: text("trust_tier").$type<TrustTier>().notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    resourceVersionId: text("resource_version_id").notNull(),
    status: text("status").$type<GraphStatus>().notNull(),
  },
  (table) => [
    index("graph_facts_entity_idx").on(table.entityId, table.factType),
    index("graph_facts_entity_status_type_idx").on(table.entityId, table.status, table.factType),
  ],
);

export const graphEdges = sqliteTable(
  "graph_edges",
  {
    id: text("id").primaryKey(),
    fromEntityId: text("from_entity_id").notNull(),
    edgeType: text("edge_type").$type<GraphEdgeType>().notNull(),
    toEntityId: text("to_entity_id").notNull(),
    weight: real("weight").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    resourceVersionId: text("resource_version_id").notNull(),
    status: text("status").$type<GraphStatus>().notNull(),
  },
  (table) => [
    index("graph_edges_from_idx").on(table.fromEntityId, table.edgeType),
    index("graph_edges_to_idx").on(table.toEntityId, table.edgeType),
    index("graph_edges_from_status_type_idx").on(table.fromEntityId, table.status, table.edgeType),
    index("graph_edges_to_status_type_idx").on(table.toEntityId, table.status, table.edgeType),
  ],
);

export const searchChunks = sqliteTable(
  "search_chunks",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    sourceVersionId: text("source_version_id").notNull(),
    entityId: text("entity_id"),
    title: text("title").notNull(),
    text: text("text").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    payloadJson: text("payload_json", { mode: "json" }).$type<KnowledgeGraphPayload>().notNull(),
  },
  (table) => [
    index("search_chunks_source_idx").on(table.sourceId),
    index("search_chunks_entity_source_idx").on(table.entityId, table.sourceId),
  ],
);

export const workerGraphUpdates = sqliteTable("worker_graph_updates", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  claimId: text("claim_id").notNull(),
  sourcePath: text("source_path").notNull(),
  symbol: text("symbol"),
  updateType: text("update_type").notNull(),
  payloadJson: text("payload_json", { mode: "json" }).$type<JsonObject>().notNull(),
  evidenceRef: text("evidence_ref").notNull(),
  validationRef: text("validation_ref"),
  status: text("status").$type<GraphStatus>().notNull(),
  createdAt: text("created_at").notNull(),
});

export const mergedPrUpdates = sqliteTable("merged_pr_updates", {
  id: text("id").primaryKey(),
  pr: integer("pr").notNull(),
  mergedAt: text("merged_at"),
  resourceVersionId: text("resource_version_id").notNull(),
  touchedFilesJson: text("touched_files_json", { mode: "json" }).$type<string[]>().notNull(),
  graphDeltaJson: text("graph_delta_json", { mode: "json" }).$type<JsonObject>().notNull(),
  indexedAt: text("indexed_at").notNull(),
});

export const knowledgeGraphSchema = {
  graphEdges,
  graphEntities,
  graphFacts,
  knowledgeSources,
  knowledgeTools,
  mergedPrUpdates,
  resourceVersions,
  searchChunks,
  workerGraphUpdates,
};

export type KnowledgeSourceRow = typeof knowledgeSources.$inferSelect;
export type KnowledgeToolRow = typeof knowledgeTools.$inferSelect;
export type ResourceVersionRow = typeof resourceVersions.$inferSelect;
export type GraphEntityRow = typeof graphEntities.$inferSelect;
export type GraphFactRow = typeof graphFacts.$inferSelect;
export type GraphEdgeRow = typeof graphEdges.$inferSelect;
export type SearchChunkRow = typeof searchChunks.$inferSelect;
export type WorkerGraphUpdateRow = typeof workerGraphUpdates.$inferSelect;
export type MergedPrUpdateRow = typeof mergedPrUpdates.$inferSelect;
