import { fileEntityId } from "./code-graph.js";
import type { KnowledgeGraphStore } from "./db.js";
import { rankFeatureForSourcePath } from "./rank.js";
import type { FileGraphCard } from "./types.js";
import { arrayValue, objectValue, stringValue } from "./util.js";

export function fileGraphCard(store: KnowledgeGraphStore, sourcePath: string): FileGraphCard {
  const entityId = fileEntityId(sourcePath);
  const matchStatus = factPayload(store, entityId, "file_match_status");
  const editabilityPayload = factPayload(store, entityId, "editability");
  const editability = {
    mode: editabilityMode(editabilityPayload.mode),
    reason: stringValue(editabilityPayload.reason, "No editability fact is available for this file."),
  };
  const touchingPrs = store.db
    .query(
      `
        SELECT graph_entities.payload_json
        FROM graph_edges
        JOIN graph_entities ON graph_entities.id = graph_edges.to_entity_id
        WHERE graph_edges.from_entity_id = ? AND graph_edges.edge_type = 'TOUCHED_BY_PR'
        ORDER BY graph_entities.stable_key DESC
        LIMIT 24
      `,
    )
    .all(entityId) as Array<Record<string, unknown>>;
  const rollup = factPayload(store, entityId, "past_pr_file_rollup");
  const resourceHits = store.db
    .query(
      `
        SELECT source_id, title, evidence_ref
        FROM search_chunks
        WHERE entity_id = ?
          AND source_id != 'mismatch_patterns'
        ORDER BY source_id, title
        LIMIT 16
      `,
    )
    .all(entityId) as Array<Record<string, unknown>>;
  return {
    entity_id: entityId,
    source_path: sourcePath,
    editability,
    match_status: matchStatus,
    units: arrayValue(matchStatus.units).map((unit) => ({ unit: String(unit) })),
    functions: arrayValue(matchStatus.functions).map(objectValue),
    pr_history: {
      touching_prs: touchingPrs.map((row) => objectValue(JSON.parse(stringValue(row.payload_json, "{}")))),
      review_risks: arrayValue(rollup.review_risks).map((value) => ({ value })),
      tactics: arrayValue(rollup.tactics).map((value) => ({ value })),
    },
    resource_hits: resourceHits.map((row) => ({
      source_id: stringValue(row.source_id),
      title: stringValue(row.title),
      evidence_ref: stringValue(row.evidence_ref),
    })),
    mismatch_patterns: mismatchPatternsForFile(store, entityId),
    tool_hits: [],
    scheduling_signals: rankFeatureForSourcePath(store, sourcePath),
  };
}

function mismatchPatternsForFile(store: KnowledgeGraphStore, entityId: string): Array<Record<string, unknown>> {
  const patternRows = store.db
    .query(
      `
        SELECT
          graph_entities.id AS pattern_entity_id,
          graph_entities.payload_json AS pattern_payload_json,
          graph_edges.evidence_ref,
          graph_edges.weight
        FROM graph_edges
        JOIN graph_entities ON graph_entities.id = graph_edges.to_entity_id
        WHERE graph_edges.from_entity_id = ?
          AND graph_edges.edge_type = 'HAS_MISMATCH_PATTERN'
          AND graph_edges.status = 'accepted'
          AND graph_entities.entity_type = 'mismatch_pattern'
        ORDER BY graph_edges.weight DESC, graph_entities.stable_key
        LIMIT 48
      `,
    )
    .all(entityId) as Array<Record<string, unknown>>;
  const evidenceRows = store.db
    .query(
      `
        SELECT
          graph_entities.payload_json AS evidence_payload_json,
          graph_edges.evidence_ref,
          graph_edges.weight
        FROM graph_edges
        JOIN graph_entities ON graph_entities.id = graph_edges.to_entity_id
        WHERE graph_edges.from_entity_id = ?
          AND graph_edges.edge_type = 'HAS_MISMATCH_PATTERN_EVIDENCE'
          AND graph_edges.status = 'accepted'
          AND graph_entities.entity_type = 'mismatch_pattern_evidence'
        ORDER BY graph_edges.weight DESC, graph_edges.evidence_ref
        LIMIT 48
      `,
    )
    .all(entityId) as Array<Record<string, unknown>>;

  const evidenceByPattern = new Map<string, Array<Record<string, unknown>>>();
  for (const row of evidenceRows) {
    const payload = objectValue(JSON.parse(stringValue(row.evidence_payload_json, "{}")));
    const patternId = stringValue(payload.pattern_id);
    if (!patternId) continue;
    const records = evidenceByPattern.get(patternId) ?? [];
    records.push({
      title: stringValue(payload.title),
      kind: stringValue(payload.kind),
      evidence_ref: stringValue(payload.evidence_ref, stringValue(row.evidence_ref)),
      source_paths: arrayValue(payload.source_paths).map(String),
      unit: stringValue(payload.unit) || null,
      symbol: stringValue(payload.symbol) || null,
      pr: payload.pr ?? null,
    });
    evidenceByPattern.set(patternId, records);
  }

  const byPattern = new Map<string, Record<string, unknown>>();
  for (const row of patternRows) {
    const payload = objectValue(JSON.parse(stringValue(row.pattern_payload_json, "{}")));
    const patternId = stringValue(payload.id, stringValue(row.pattern_entity_id));
    const existing = byPattern.get(patternId);
    const evidenceRefs = new Set(arrayValue(existing?.linked_evidence_refs).map(String));
    evidenceRefs.add(stringValue(row.evidence_ref));
    byPattern.set(patternId, {
      pattern_id: patternId,
      title: stringValue(payload.title),
      category: stringValue(payload.category),
      symptoms: arrayValue(payload.symptoms).map(String),
      tactics: arrayValue(payload.tactics).map(String),
      evidence_count: payload.evidence_count ?? 0,
      linked_evidence_refs: [...evidenceRefs].filter(Boolean),
      linked_evidence: evidenceByPattern.get(patternId) ?? [],
    });
  }
  return [...byPattern.values()].slice(0, 16);
}

function factPayload(store: KnowledgeGraphStore, entityId: string, factType: string): Record<string, unknown> {
  const row = store.db
    .query("SELECT payload_json FROM graph_facts WHERE entity_id = ? AND fact_type = ? AND status = 'accepted' LIMIT 1")
    .get(entityId, factType) as Record<string, unknown> | null;
  if (!row) return {};
  return objectValue(JSON.parse(stringValue(row.payload_json, "{}")));
}

function editabilityMode(value: unknown): FileGraphCard["editability"]["mode"] {
  const mode = stringValue(value, "unknown");
  if (mode === "editable" || mode === "read_only_complete" || mode === "locked" || mode === "blocked") return mode;
  return "unknown";
}
