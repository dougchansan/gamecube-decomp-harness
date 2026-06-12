import { describe, expect, test } from "bun:test";
import {
  PRESHIP_REVIEW_SCHEMA_VERSION,
  loadPreshipExhibits,
  preshipExhibitsPromptXml,
  validatePreshipReview,
} from "./preship.js";
import { prPreshipReviewPrompt } from "./prompt.js";

function validReview(): Record<string, unknown> {
  return {
    schema_version: PRESHIP_REVIEW_SCHEMA_VERSION,
    slice_id: "gm",
    slice_verdict: "reject",
    findings: [
      {
        file: "src/melee/gm/gm_1832.c",
        line: 1919,
        standard_id: "global_standard:literals-and-data-ownership",
        verdict: "reject",
        rationale: "extern const f32 lbl_804DA60C anchors data ordering instead of defining the data.",
        suggested_fix: "Remove the extern and define the constant in binary order; accept the lower match.",
      },
      {
        file: "src/melee/gm/gm_1832.c",
        line: null,
        standard_id: null,
        verdict: "warn",
        rationale: "Suspicious but not provable from the diff alone.",
        suggested_fix: null,
      },
    ],
    summary: "One data-ordering dodge; slice must not ship with it.",
    confidence: 0.9,
  };
}

describe("validatePreshipReview", () => {
  test("accepts a valid review object", () => {
    const { review, errors } = validatePreshipReview(validReview());
    expect(errors).toEqual([]);
    expect(review).not.toBeNull();
    expect(review?.slice_verdict).toBe("reject");
    expect(review?.findings).toHaveLength(2);
    expect(review?.findings[1]?.line).toBeNull();
  });

  test("accepts an approve verdict with no findings", () => {
    const { review, errors } = validatePreshipReview({
      ...validReview(),
      slice_verdict: "approve",
      findings: [],
    });
    expect(errors).toEqual([]);
    expect(review?.slice_verdict).toBe("approve");
  });

  test("rejects non-objects", () => {
    expect(validatePreshipReview(null).review).toBeNull();
    expect(validatePreshipReview([]).review).toBeNull();
    expect(validatePreshipReview("approve").review).toBeNull();
  });

  test("rejects a wrong schema_version", () => {
    const { review, errors } = validatePreshipReview({ ...validReview(), schema_version: "melee_pr_postmortem_v1" });
    expect(review).toBeNull();
    expect(errors.join(" ")).toContain("schema_version");
  });

  test.each(["schema_version", "slice_id", "slice_verdict", "findings", "summary", "confidence"])(
    "rejects when top-level key %s is missing",
    (key) => {
      const broken = validReview();
      delete broken[key];
      const { review, errors } = validatePreshipReview(broken);
      expect(review).toBeNull();
      expect(errors.length).toBeGreaterThan(0);
    },
  );

  test("rejects a bad slice_verdict enum", () => {
    const { review, errors } = validatePreshipReview({ ...validReview(), slice_verdict: "ship-it" });
    expect(review).toBeNull();
    expect(errors.join(" ")).toContain("slice_verdict");
  });

  test("rejects a bad finding verdict enum", () => {
    const broken = validReview();
    (broken.findings as Array<Record<string, unknown>>)[0].verdict = "approve";
    const { review, errors } = validatePreshipReview(broken);
    expect(review).toBeNull();
    expect(errors.join(" ")).toContain("findings[0].verdict");
  });

  test("rejects findings missing required keys", () => {
    const broken = validReview();
    (broken.findings as Array<Record<string, unknown>>)[0] = { verdict: "reject" };
    const { review, errors } = validatePreshipReview(broken);
    expect(review).toBeNull();
    expect(errors.join(" ")).toContain("findings[0].file");
    expect(errors.join(" ")).toContain("findings[0].rationale");
  });

  test("rejects a non-numeric confidence", () => {
    const { review } = validatePreshipReview({ ...validReview(), confidence: "high" });
    expect(review).toBeNull();
  });
});

describe("preship exhibits", () => {
  test("static curated file loads the nine seeded rejections", () => {
    const exhibits = loadPreshipExhibits();
    expect(exhibits).toHaveLength(9);
    expect(exhibits.filter((exhibit) => exhibit.kind === "counter_exhibit")).toHaveLength(1);
    const particle = exhibits.find((exhibit) => exhibit.file === "src/sysdolphin/baselib/particle.c");
    expect(particle?.pr).toBe(2659);
    expect(particle?.comment).toContain("You submitted this change before");
  });

  test("exhibits XML marks the counter-exhibit and carries comments verbatim", () => {
    const xml = preshipExhibitsPromptXml();
    expect(xml).toContain('<maintainer_rejection_exhibits count="9">');
    expect(xml).toContain('kind="counter_exhibit"');
    expect(xml).toContain("Matching because of externs is not correct.");
    expect(xml).toContain("ACCEPTED counter-exhibit");
  });
});

describe("prPreshipReviewPrompt", () => {
  test("renders the diff, lint findings, exhibits, and schema into the bundle", () => {
    const bundle = prPreshipReviewPrompt({
      sliceId: "gm",
      sliceDiff: "+extern const f32 lbl_804DA60C;",
      lintFindings: { findings: [{ rule_id: "extern_literal_anchor" }] },
    });
    expect(bundle.systemPrompt).toContain("melee_pr_preship_review_v1");
    expect(bundle.systemPrompt).toContain("find every reason the maintainer");
    expect(bundle.userPrompt).toContain("slice `gm`");
    expect(bundle.userPrompt).toContain("+extern const f32 lbl_804DA60C;");
    expect(bundle.userPrompt).toContain("extern_literal_anchor");
    expect(bundle.userPrompt).toContain('"lint_available": true');
    expect(bundle.userPrompt).toContain("<maintainer_rejection_exhibits");
    expect(bundle.userPrompt).toContain("<decomp_standards>");
  });

  test("notes lint unavailability instead of failing", () => {
    const bundle = prPreshipReviewPrompt({
      sliceId: "gm",
      sliceDiff: "+int x;",
      lintUnavailableNote: "scan_diff.py not found",
    });
    expect(bundle.userPrompt).toContain('"lint_available": false');
    expect(bundle.userPrompt).toContain("scan_diff.py not found");
  });

  test("truncates oversized diffs with an inline note", () => {
    const bundle = prPreshipReviewPrompt({
      sliceId: "gm",
      sliceDiff: "x".repeat(500),
      diffCharLimit: 100,
    });
    expect(bundle.userPrompt).toContain("[diff truncated after 100 characters; 400 characters omitted");
    expect(bundle.userPrompt).not.toContain("x".repeat(101));
  });
});
