import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { buildLegacyColosseumKgGraphRecords, importLegacyColosseumKg } from "./legacy-colosseum-kg.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("legacy Colosseum KG import", () => {
  test("keeps outcome evidence and substantive hints while rejecting stale bulk progress", () => {
    const root = mkdtempSync(join(tmpdir(), "legacy-colosseum-kg-"));
    tempRoots.push(root);
    const inputPath = join(root, "kg.db");
    const outputPath = join(root, "legacy.jsonl");
    const recoveryPath = join(root, "recovery.json");
    const db = new Database(inputPath);
    db.exec(`
      CREATE TABLE levers (slug TEXT, title TEXT, description TEXT, opt_gated INTEGER, source TEXT);
      CREATE TABLE walls (class TEXT, title TEXT, c_controllable INTEGER, description TEXT);
      CREATE TABLE functions (
        addr TEXT, name TEXT, tu TEXT, byte_pct REAL, compiler TEXT, status TEXT,
        is_equivalent INTEGER, wall_class TEXT, scratch_url TEXT, notes TEXT, updated_at REAL
      );
      CREATE TABLE cracked_by (id INTEGER, addr TEXT, lever_slug TEXT, commit_sha TEXT, delta TEXT, ts REAL);
      INSERT INTO levers VALUES ('known-shape', 'Known shape', 'Verified historical tactic', 0, 'fixture');
      INSERT INTO levers VALUES ('blank-title', '', 'Still a defined lever', 0, 'fixture');
      INSERT INTO walls VALUES ('W1', 'Coloring wall', 1, 'Historical wall class');
      INSERT INTO functions VALUES ('fn_80000000', 'fn_80000000', 'src/game/a.c', 92.0, 'GC/1.3', 'WALL', 0, 'W1', NULL, 'Useful note', 100);
      INSERT INTO functions VALUES ('fn_80000004', 'fn_80000004', 'src/game/a.c', 87.0, 'GC/1.3', 'WIP', 0, NULL, NULL, NULL, 100);
      INSERT INTO cracked_by VALUES (1, 'fn_80000000', 'known-shape', 'abcdef1', '92 -> 100 exact', 100);
      INSERT INTO cracked_by VALUES (2, 'fn_80000008', 'ad-hoc observation', 'pending', 'verified match', 100);
      INSERT INTO cracked_by VALUES (3, 'fn_8000000C', 'broken-row', NULL, NULL, 100);
      INSERT INTO cracked_by VALUES (4, 'fn_80000000', 'known-shape', NULL, 'second exact observation', 101);
      INSERT INTO cracked_by VALUES (5, 'fn_80000010', 'known-shape', NULL, 'mismatch remains', 101);
      INSERT INTO cracked_by VALUES (6, 'fn_80000014', 'blank-title', NULL, 'ported exact', 101);
    `);
    db.close();
    writeFileSync(
      recoveryPath,
      JSON.stringify({
        candidates: [
          {
            address: "0x80000008",
            current_symbol: "fn_80000008",
            status: "open",
            local_score: 40,
            next_action: "Revalidate the archived body.",
          },
        ],
      }),
    );

    const result = importLegacyColosseumKg({ inputPath, outputPath });
    expect(result).toMatchObject({
      records_written: 9,
      levers: 2,
      synthetic_levers: 1,
      cracks: 4,
      wall_classes: 1,
      function_hints: 1,
    });

    const rows = readFileSync(outputPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows.some((row) => row.kind === "legacy_function_hint" && row.addr === "fn_80000004")).toBe(false);
    expect(rows.find((row) => row.id === "legacy_crack:2")).toMatchObject({
      legacy_commit_ref: "pending",
      lever_synthetic: true,
      requires_current_revalidation: true,
      status: "stale",
    });
    expect(rows.find((row) => row.id === "legacy_crack:2")).not.toHaveProperty("commit_sha");
    expect(rows.find((row) => row.id === "legacy_crack:1")).toMatchObject({ historical_conflict: true });
    expect(rows.some((row) => row.id === "legacy_crack:5")).toBe(false);

    const graph = buildLegacyColosseumKgGraphRecords(root, outputPath, recoveryPath);
    expect(graph).not.toBeNull();
    if (!graph) throw new Error("Expected legacy graph records");
    const synthetic = graph?.entities.find((entity) => entity.entityType === "legacy_synthetic_lever");
    expect(synthetic).toBeDefined();
    expect(graph?.edges.some((edge) => edge.edgeType === "LEGACY_CRACKED_BY_LEVER" && edge.toEntityId === synthetic?.id)).toBe(true);
    expect(graph?.chunks.find((chunk) => chunk.title.includes("fn_80000000"))?.text).toContain("HISTORICAL CONFLICT");
    expect(graph?.entities.filter((entity) => entity.entityType === "legacy_crack")).toHaveLength(4);
    expect(new Set(graph.entities.map((entity) => entity.id)).size).toBe(graph.entities.length);
    expect(new Set(graph.facts.map((fact) => fact.id)).size).toBe(graph.facts.length);
    expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(graph.edges.length);
    expect(new Set(graph.chunks.map((chunk) => chunk.id)).size).toBe(graph.chunks.length);
    expect(graph?.edges.filter((edge) => edge.edgeType === "HAS_LEGACY_LEVER_LESSON").every((edge) => edge.status === "stale")).toBe(true);
    expect(graph?.chunks.find((chunk) => chunk.title.includes("0x80000008 (open)"))?.text).toContain("Revalidate the archived body.");
  }, 30_000);
});
