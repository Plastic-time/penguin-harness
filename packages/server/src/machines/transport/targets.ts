/**
 * Turning `~/.ssh/config` into the list of aliases the menu can show, and appending a host
 * block to it. The parsing and the rendering are in ssh-config.ts; this file owns the I/O —
 * reading files, expanding `Include` globs, and the one append.
 *
 * WHICH `~` THE CONFIG IS IN. OpenSSH reads its user config from the account's home as the
 * passwd database gives it and ignores the environment: a process whose HOME points
 * elsewhere (an isolated test root, a service with HOME set) still has ssh reading the
 * passwd home's config. So this file reads and writes THAT one — or the menu would offer
 * hosts ssh cannot resolve, and a host block the page writes would land in a file ssh never
 * reads. `Include` is ssh's own exception and is kept as ssh keeps it: an `Include`
 * argument — `~/…` or bare — is globbed with its leading `~` taken from $HOME (readconf.c
 * anchors a bare argument at `~/.ssh` and globs it GLOB_TILDE), so the include reader stays
 * on the environment even though the config itself came from the passwd home.
 *
 * Nothing here resolves an alias: what it means is ssh's business, applied by ssh itself
 * every time it is handed one. An unreadable or missing config degrades to "no targets"
 * rather than to an error: this list is a convenience, and a user with no ssh setup should
 * simply not see the feature offer them anything.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseHostAliases, parseHostEntries } from "../ssh-config.js";
import type { SshHostLines } from "../ssh-config.js";

/**
 * Which home `~/.ssh/config` is read from, given the two candidates it can be in. OpenSSH
 * takes the passwd entry and ignores the environment, so on POSIX the passwd home wins
 * wherever the two differ — a host the menu offers and a host ssh can resolve must come
 * from one config. Windows keeps the environment: its ssh follows the profile environment,
 * which `os.homedir()` already reads. When the account has no passwd entry (a container
 * with a bare numeric uid), $HOME stands in — the same order `os.homedir()` itself falls
 * back in.
 */
export function sshConfigHomeFor(
  platform: NodeJS.Platform,
  envHome: string,
  passwdHome: string | null,
): string {
  if (platform === "win32") return envHome;
  return passwdHome !== null && passwdHome !== "" ? passwdHome : envHome;
}

/** The account's home as its passwd entry gives it, or null when it has no entry. */
function accountHome(): string | null {
  try {
    return os.userInfo().homedir;
  } catch {
    return null;
  }
}

/** The home whose `~/.ssh/config` OpenSSH itself reads (sshConfigHomeFor, applied). */
function sshConfigHome(): string {
  return sshConfigHomeFor(process.platform, os.homedir(), accountHome());
}

/**
 * The startup self-check: one plain sentence when the home ssh reads its config from is not
 * $HOME — a deployment that set HOME deliberately needs to hear which file the machines page
 * is listing and writing. Null when there is nothing to say.
 */
export function sshHomeDivergenceNote(
  platform: NodeJS.Platform,
  envHome: string,
  passwdHome: string | null,
): string | null {
  const home = sshConfigHomeFor(platform, envHome, passwdHome);
  if (home === envHome) return null;
  return `ssh reads its config from ${home}/.ssh/config, not from $HOME (${envHome}); the machines page lists that config, and the hosts it writes go there.`;
}

/** sshHomeDivergenceNote applied to this process: what the server says at startup. */
export function sshConfigHomeCheck(): string | null {
  return sshHomeDivergenceNote(process.platform, os.homedir(), accountHome());
}

/** The directory of THE config: the one OpenSSH reads, in the home sshConfigHome gives. */
const SSH_DIR = () => path.join(sshConfigHome(), ".ssh");

/**
 * The directory an `Include` argument is anchored at when it does not name one: `~/.ssh`
 * with the `~` from the environment — where ssh itself anchors it (GLOB_TILDE), which is
 * not necessarily the directory the config being read came from.
 */
const INCLUDE_DIR = () => path.join(os.homedir(), ".ssh");

/**
 * Resolves one `Include` argument to the text of the files it matches. Both spellings take
 * their `~` from the environment, as they do for ssh; patterns are relative to `~/.ssh`
 * unless absolute, and only the last path segment may glob — which is what OpenSSH's own
 * configs use (`Include config.d/*`), and all this list needs.
 */
function readIncluded(pattern: string): string[] {
  const expanded = pattern.startsWith("~/")
    ? path.join(os.homedir(), pattern.slice(2))
    : path.isAbsolute(pattern)
      ? pattern
      : path.join(INCLUDE_DIR(), pattern);
  const dir = path.dirname(expanded);
  const base = path.basename(expanded);
  try {
    if (!base.includes("*") && !base.includes("?")) return [fs.readFileSync(expanded, "utf8")];
    const matcher = new RegExp(
      `^${base.replaceAll(".", "\\.").replaceAll("*", ".*").replaceAll("?", ".")}$`,
    );
    return fs
      .readdirSync(dir)
      .filter((entry) => matcher.test(entry))
      .sort()
      .map((entry) => {
        try {
          return fs.readFileSync(path.join(dir, entry), "utf8");
        } catch {
          return "";
        }
      });
  } catch {
    return []; // Missing or unreadable include: OpenSSH ignores it, so do we.
  }
}

/** Host aliases declared in this machine's ssh config; empty when there is no usable config. */
export function listHostAliases(): string[] {
  try {
    return parseHostAliases(fs.readFileSync(path.join(SSH_DIR(), "config"), "utf8"), readIncluded);
  } catch {
    return [];
  }
}

/** Every host the config declares, with what its own block says; empty when there is no usable config. */
export function listHostEntries(): SshHostLines[] {
  try {
    return parseHostEntries(fs.readFileSync(path.join(SSH_DIR(), "config"), "utf8"), readIncluded);
  } catch {
    return [];
  }
}

/**
 * Appends a rendered host block to `~/.ssh/config`, creating the directory and the file with
 * the modes ssh insists on when they do not exist yet (0700 and 0600; ssh refuses a config
 * others can write). A blank line separates the block from whatever came before, and a file
 * that did not end in a newline gets one first, so the block never joins a foreign line.
 */
export function appendHostBlock(block: string): void {
  const dir = SSH_DIR();
  const file = path.join(dir, "config");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch {
    fs.writeFileSync(file, "", { mode: 0o600 });
  }
  const lead = existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  fs.appendFileSync(file, lead + block);
}

/** The config's text, or null when there is none to read. */
export function readSshConfig(): string | null {
  try {
    return fs.readFileSync(path.join(SSH_DIR(), "config"), "utf8");
  } catch {
    return null;
  }
}

/** Writes the config back whole — after a block this app wrote was rewritten in place. */
export function writeSshConfig(text: string): void {
  fs.writeFileSync(path.join(SSH_DIR(), "config"), text, { mode: 0o600 });
}
