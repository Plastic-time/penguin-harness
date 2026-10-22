/**
 * Which home the machines feature reads `~/.ssh/config` from: OpenSSH's own basis — the
 * account's passwd entry on POSIX, which a differently-set HOME does not move — so that a
 * host the page lists is a host ssh can resolve. These pin the rule and the startup sentence
 * that names the config when the two homes differ; the rule is pure — the platform and the
 * two homes in, the answer and the sentence out — so nothing here touches a filesystem.
 */
import { describe, expect, it } from "vitest";
import { sshConfigHomeFor, sshHomeDivergenceNote } from "../src/machines/transport/targets.js";

describe("sshConfigHomeFor", () => {
  it("reads the config from the passwd home, which a differently-set HOME does not move", () => {
    expect(sshConfigHomeFor("linux", "/srv/penguin/home", "/home/operator")).toBe("/home/operator");
    expect(sshConfigHomeFor("darwin", "/srv/penguin/home", "/Users/operator")).toBe(
      "/Users/operator",
    );
  });

  it("is the same home on a machine where HOME and the passwd entry agree", () => {
    expect(sshConfigHomeFor("linux", "/home/operator", "/home/operator")).toBe("/home/operator");
  });

  it("falls back to HOME when the account has no passwd entry", () => {
    expect(sshConfigHomeFor("linux", "/srv/penguin/home", null)).toBe("/srv/penguin/home");
    expect(sshConfigHomeFor("linux", "/srv/penguin/home", "")).toBe("/srv/penguin/home");
  });

  it("keeps HOME as the basis on Windows, whose ssh follows the profile environment", () => {
    expect(sshConfigHomeFor("win32", "C:\\srv\\home", "C:\\Users\\operator")).toBe("C:\\srv\\home");
  });
});

describe("sshHomeDivergenceNote", () => {
  it("says which file ssh reads when HOME is another home", () => {
    const note = sshHomeDivergenceNote("linux", "/srv/penguin/home", "/home/operator");
    expect(note).toContain("/home/operator/.ssh/config");
    expect(note).toContain("/srv/penguin/home");
  });

  it("says nothing when the homes agree, when there is no passwd entry, or on Windows", () => {
    expect(sshHomeDivergenceNote("linux", "/home/operator", "/home/operator")).toBeNull();
    expect(sshHomeDivergenceNote("linux", "/srv/penguin/home", null)).toBeNull();
    expect(sshHomeDivergenceNote("win32", "C:\\srv\\home", "C:\\Users\\operator")).toBeNull();
  });
});
