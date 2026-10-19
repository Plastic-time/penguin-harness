/**
 * The rung the settings card names for the DSH adaptor, the limits each rung discloses,
 * and the pure half of the Landlock extension: the dimensions a rung declares, the grants
 * it splices in, and the corner the allow-list cannot express.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  assertLandlockCanExpress,
  declaredDimensions,
  grantableWritableRoots,
  rungLimits,
  rungName,
  spliceLandlockGrants,
} from "../src/index.js";
import type { GrantArgs } from "../src/index.js";

describe("the DSH rung", () => {
  it.each([
    ["linux", "bwrap", "bubblewrap"],
    ["linux", "/opt/penguin/node_modules/.bin/landlock-run", "Landlock"],
    ["darwin", "sandbox-exec", "Seatbelt"],
    ["win32", "C:\\node.exe", "the Windows ACL runner"],
  ] as const)("on %s, %s is %s", (platform, program, name) => {
    expect(rungName(platform, program)).toBe(name);
  });

  it("names the scratchpad on the non-Landlock rungs, Landlock's shared /tmp, and a partial Landlock's ABI gaps", () => {
    expect(rungLimits("bubblewrap", "full").map((l) => l.text)).toEqual([
      expect.stringContaining("Session scratchpad is not writable"),
    ]);
    // Landlock splices the writable roots in, so its scratchpad limitation is gone; what
    // stays is the shared /tmp — still the first line — and the partial-ABI disclosure.
    const [tmp, ...rest] = rungLimits("Landlock", "full");
    const partial = rungLimits("Landlock", "partial")[1];
    expect(rest).toEqual([]);
    expect(tmp!.text).toContain("the host's shared /tmp");
    expect(tmp!.textZh).toContain("宿主共享的 /tmp");
    expect(partial!.text).toMatch(/older than 5 .*ioctl.*below ABI 3 .*truncating/);
  });
});

describe("the dimensions a rung declares", () => {
  it.each([
    ["Landlock", ["fs-write", "readonly-roots"]],
    ["bubblewrap", ["fs-write"]],
    ["Seatbelt", ["fs-write"]],
    ["the Windows ACL runner", ["fs-write"]],
  ] as const)("the %s rung declares %j", (rung, dimensions) => {
    // readonly-roots rides only on the Landlock rung: the service routes by this.
    expect(declaredDimensions(rung)).toEqual(dimensions);
  });
});

describe("the writable roots the Landlock rung splices in", () => {
  // Resolved in the expectations as in the implementation, so the literals hold on every
  // platform the package tests on (win32 path resolution prefixes a drive).
  /** Rows share the Workspace root and always say the temp flag: a row is the rest. */
  const policy = (
    mode: "workspace-write" | "read-only",
    writableRoots: readonly string[],
    writableTemp: boolean,
  ) => ({ mode, workspaceRoot: "/work/project", writableRoots, writableTemp });

  it.each([
    [
      "the policy's further roots plus the real temp, minus what the chain grants",
      policy("workspace-write", ["/data/agent/scratchpad/s", "/data/agent/scratchpad/s"], true),
      "/tmp",
      ["/data/agent/scratchpad/s"],
    ],
    [
      "a TMPDIR elsewhere must not lose its temp; the literal /tmp the chain already grants",
      policy("workspace-write", [], true),
      "/home/deploy/tmp-verify",
      ["/home/deploy/tmp-verify"],
    ],
    [
      "temp turned off adds nothing; the workspace itself is already granted",
      policy("workspace-write", ["/work/project", "/work/project/deeper"], false),
      "/tmp",
      ["/work/project/deeper"],
    ],
    [
      "read-only keeps the chain's own profile: nothing to splice",
      policy("read-only", ["/data/s"], true),
      "/tmp",
      [],
    ],
  ] as const)("%s", (_, shaped, tmp, expected) => {
    expect(grantableWritableRoots(shaped, tmp)).toEqual(expected.map((p) => path.resolve(p)));
  });
});

describe("splicing further grants into a Landlock wrapper", () => {
  /** A fake with the real one's shape: read-only first, then read-write, flag before path. */
  const fakeGrantArgs: GrantArgs = (grants) => [
    ...(grants.readOnly ?? []).map((root) => ["--ro", root]).flat(),
    ...(grants.readWrite ?? []).map((root) => ["--rw", root]).flat(),
  ];
  const callerArgv = ["bash", "-lc", "echo hi"];
  const wrapped = [
    "/bin/landlock-run",
    ...fakeGrantArgs({ readOnly: ["/"], readWrite: ["/dev/null", "/tmp", "/work/project"] }),
    "--",
    ...callerArgv,
  ];

  it("adds the extra roots in front of the separator, command untouched behind it", () => {
    const spliced = spliceLandlockGrants(
      wrapped,
      callerArgv,
      ["/data/agent/scratchpad/s"],
      fakeGrantArgs,
    );
    const at = spliced.lastIndexOf("--");
    // The grants go in front of the separator; the head they follow is the wrapper's own.
    expect(spliced.slice(at)).toEqual(["--", ...callerArgv]);
    expect(spliced.slice(at - 2, at)).toEqual(["--rw", "/data/agent/scratchpad/s"]);
    expect(spliced.slice(0, at - 2)).toEqual(wrapped.slice(0, wrapped.indexOf("--")));
  });

  it("only ever asks for read-write grants: read-only comes from the chain's own profile", () => {
    const seen: unknown[] = [];
    spliceLandlockGrants(wrapped, callerArgv, ["/data/s"], (grants) => {
      seen.push(grants);
      return ["--rw", "/data/s"];
    });
    expect(seen).toEqual([{ readWrite: ["/data/s"] }]);
  });

  it("nothing to add leaves the wrapper byte-identical (a copy, not the same array)", () => {
    const same = spliceLandlockGrants(wrapped, callerArgv, [], fakeGrantArgs);
    expect(same).toEqual(wrapped);
    expect(same).not.toBe(wrapped);
  });

  it("matches the tail even when the caller's own arguments contain a -- separator", () => {
    const tricky = ["/bin/landlock-run", "--ro", "/", "--", "bash", "-c", "echo -- x"];
    const spliced = spliceLandlockGrants(
      tricky,
      ["bash", "-c", "echo -- x"],
      ["/data/s"],
      fakeGrantArgs,
    );
    const at = spliced.lastIndexOf("--");
    expect(spliced.slice(at)).toEqual(["--", "bash", "-c", "echo -- x"]);
    expect(spliced.slice(at - 2, at)).toEqual(["--rw", "/data/s"]);
    expect(spliced.slice(0, at - 2)).toEqual(["/bin/landlock-run", "--ro", "/"]);
  });

  it.each([
    ["a wrapper with no separator at all", ["/bin/landlock-run", "--ro", "/"], []],
    [
      "a wrapper ending with a different command",
      ["/bin/landlock-run", "--ro", "/", "--", "bash", "-c", "other"],
      ["bash", "-c", "echo hi"],
    ],
  ] as const)("refuses %s", (_, bad, caller) => {
    expect(() => spliceLandlockGrants(bad, caller, [], fakeGrantArgs)).toThrow(
      /no longer ends with/,
    );
  });
});

describe("the corner Landlock cannot express", () => {
  it.each([
    [
      "refuses a read-only root inside a writable grant",
      ["/tmp/state-root"],
      ["/dev/null", "/tmp", "/work/project"],
      /cannot hold .* read-only under Landlock/,
    ],
    [
      "refuses a read-only root inside the workspace grant",
      ["/work/project/state"],
      ["/work/project"],
      /writable grant/,
    ],
    [
      "refuses a read-only root equal to a grant",
      ["/work/project"],
      ["/work/project"],
      /writable grant/,
    ],
    ["refuses a read-only root under a writable /", ["/data/agents/a"], ["/"], /writable grant/],
    [
      "allows the carve-out: a writable root deeper inside the read-only one is how the scratchpad works",
      ["/data/agents/a"],
      ["/data/agents/a/scratchpad"],
      undefined,
    ],
    [
      "allows a read-only root beside the grants",
      ["/data/agents/a"],
      ["/dev/null", "/tmp", "/work/project"],
      undefined,
    ],
  ] as const)("%s", (_, roots, grants, message) => {
    const tryIt = () => assertLandlockCanExpress(roots, grants);
    if (message === undefined) expect(tryIt).not.toThrow();
    else expect(tryIt).toThrow(message);
  });
});
