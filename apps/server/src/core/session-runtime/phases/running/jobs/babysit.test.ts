import { describe, expect, test } from "bun:test";
import { babysitSystemArgs } from "./babysit.js";

describe("babysitSystemArgs", () => {
  test("forwards and absolutizes target key manifests for the run-loop child", () => {
    const args = new Map<string, string | true>([
      ["--target-keys-file", "manifests/small.tsv"],
      ["--exclude-sources", "src/game/fight_range_80211A00.c"],
      ["--force-recover-claims", true],
    ]);

    expect(babysitSystemArgs(args, "/operator")).toEqual([
      "--target-keys-file",
      "/operator/manifests/small.tsv",
      "--exclude-sources",
      "src/game/fight_range_80211A00.c",
    ]);
  });
});
