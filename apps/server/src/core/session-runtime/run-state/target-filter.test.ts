import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  parseTargetKeysManifest,
  targetClaimFilterCommandArgs,
  targetClaimFilterFromArgs,
  targetClaimFilterSql,
} from "./target-filter.js";

describe("target key manifests", () => {
  test("parses newline manifests, comments, BOMs, and duplicate keys", () => {
    expect(parseTargetKeysManifest("\uFEFF# lane\nunit/a::fn_a\n\nunit/b::fn_b\nunit/a::fn_a\n", "targets.txt")).toEqual([
      "unit/a::fn_a",
      "unit/b::fn_b",
    ]);
  });

  test("selects target_key from a TSV header in any column", () => {
    expect(
      parseTargetKeysManifest(
        ["symbol\ttarget_key\tsource", "fn_a\tunit/a::fn_a\tsrc/a.c", "fn_b\tunit/b::fn_b\tsrc/b.c"].join("\n"),
        "targets.tsv",
      ),
    ).toEqual(["unit/a::fn_a", "unit/b::fn_b"]);
  });

  test("rejects empty, malformed, and headerless TSV manifests", () => {
    expect(() => parseTargetKeysManifest("\n# none\n", "empty.txt")).toThrow("manifest is empty");
    expect(() => parseTargetKeysManifest("not-a-target-key\n", "bad.txt")).toThrow("Invalid target_key");
    expect(() => parseTargetKeysManifest("unit/a::fn_a\tsrc/a.c\n", "bad.tsv")).toThrow("must have a target_key header");
  });

  test("loads an absolute manifest path and preserves it for child commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "target-keys-filter-"));
    try {
      const path = resolve(dir, "targets.tsv");
      writeFileSync(path, "target_key\tsymbol\nunit/a::fn_a\tfn_a\nunit/b::fn_b\tfn_b\n");
      const filter = targetClaimFilterFromArgs(new Map([["--target-keys-file", path]]));
      expect(filter).toMatchObject({ targetKeys: ["unit/a::fn_a", "unit/b::fn_b"], targetKeysFile: path });
      expect(targetClaimFilterCommandArgs(filter)).toEqual(["--target-keys-file", path]);
      expect(targetClaimFilterSql(filter)).toEqual({
        sql: " AND epoch_targets.target_key IN (?, ?)",
        params: ["unit/a::fn_a", "unit/b::fn_b"],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not silently drop programmatic target keys from child commands", () => {
    expect(() => targetClaimFilterCommandArgs({ targetKeys: ["unit/a::fn_a"] })).toThrow("require targetKeysFile");
  });
});
