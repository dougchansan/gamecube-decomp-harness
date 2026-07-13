import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { classifyCanonicalFunctionSource, classifySourceText } from "./source-progress.js";

describe("source progress multiline definitions", () => {
  test("classifies an active multiline canonical body while ignoring its inactive asm fallback", () => {
    const classes = classifySourceText(
      [
        "#if 0",
        "asm void hwSetVolume(void) {",
        "#include \"hwSetVolume.inc\"",
        "}",
        "#else",
        "void hwSetVolume(u32 voice, u32 table, f32 volume, u32 pan,",
        "                 u32 span, f32 auxA, f32 auxB)",
        "{",
        "    u32 changed = voice + table + pan + span;",
        "    (void)changed;",
        "}",
        "#endif",
      ].join("\n"),
    );

    expect(classes.get("hwSetVolume")).toBe("REAL_C");
  });

  test("does not classify asm, included assembly, or forwarding wrappers as real C", () => {
    const classes = classifySourceText(
      [
        "asm void asmBody(void) {",
        "    nofralloc",
        "    blr",
        "}",
        "void includedBody(void) {",
        "#include \"includedBody.inc\"",
        "}",
        "void forwardingWrapper(u32 voice) {",
        "    fn_80162A58(voice);",
        "}",
      ].join("\n"),
    );

    expect(classes.get("asmBody")).toBe("ASM");
    expect(classes.get("includedBody")).toBe("ASM");
    expect(classes.get("forwardingWrapper")).toBe("STUB");
  });
});

describe("canonical address trace identity", () => {
  test("links only the exact canonical address alias in the same source file", () => {
    const root = mkdtempSync(resolve(tmpdir(), "source-identity-"));
    try {
      mkdirSync(resolve(root, "config/GC6E01"), { recursive: true });
      mkdirSync(resolve(root, "src/musyx"), { recursive: true });
      writeFileSync(
        resolve(root, "config/GC6E01/symbols.txt"),
        "hwSetVolume = .text:0x80162A58; // type:function size:0x2C0\n",
      );
      const sourcePath = resolve(root, "src/musyx/range.c");
      writeFileSync(
        sourcePath,
        [
          "void fn_80162A58(u32 voice) {",
          "    u32 changed = voice + 1;",
          "    (void)changed;",
          "}",
          "void fn_80163000(void) {",
          "    int unrelated = 1;",
          "    (void)unrelated;",
          "}",
        ].join("\n"),
      );

      expect(classifyCanonicalFunctionSource(root, sourcePath, "hwSetVolume")).toEqual({
        canonicalSymbol: "hwSetVolume",
        canonicalAddress: "0x80162A58",
        traceAlias: "fn_80162A58",
        canonicalClass: null,
        traceAliasClass: "REAL_C",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not infer an alias without a canonical function entry", () => {
    const root = mkdtempSync(resolve(tmpdir(), "source-identity-missing-"));
    try {
      mkdirSync(resolve(root, "config/GC6E01"), { recursive: true });
      writeFileSync(resolve(root, "config/GC6E01/symbols.txt"), "hwSetVolume = .text:0x80162A58; // type:object size:4\n");
      const sourcePath = resolve(root, "range.c");
      writeFileSync(sourcePath, "void fn_80162A58(void) { int value = 1; (void)value; }\n");

      expect(classifyCanonicalFunctionSource(root, sourcePath, "hwSetVolume")).toEqual({
        canonicalSymbol: "hwSetVolume",
        canonicalAddress: null,
        traceAlias: null,
        canonicalClass: null,
        traceAliasClass: null,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
