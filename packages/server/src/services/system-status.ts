/**
 * System load for the harness status bar: whole-machine CPU utilization and memory, read
 * on demand and cached — never a background timer.
 *
 * Sampling is request-driven because the status bar is the only reader and it polls at a
 * human cadence (seconds): an interval running between polls would be the denser of the
 * two. CPU utilization is a ratio of two points in time, so the sampler keeps the previous
 * `os.cpus()` reading and answers the delta since it — the first read after a boot answers
 * `cpuPercent: null` (the bar shows its placeholder for one poll), every later read answers
 * utilization over the window since the previous read. A read closer together than
 * MIN_SAMPLE_SPACING_MS serves the cached answer, so however many surfaces read at once,
 * the counters are read at most once per spacing window.
 *
 * Memory is the same pair the built-in browser's load warning reads (os.freemem /
 * os.totalmem): portable to every platform the harness runs on. `used` is total − free,
 * which counts reclaimable cache as used — a conservative overestimate, never an
 * underestimate, and deliberately not smarter than the OS's own free counter.
 */
import os from "node:os";
import { Component, Interface } from "@prismshadow/penguin-core/kernel";

/** One `os.cpus()` core reduced to the counters a utilization delta needs (ms). */
export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

/** What the status bar's left side shows; `cpuPercent` is null while the first window is open. */
export interface SystemStatusSnapshot {
  /** Whole-machine CPU utilization over the last sample window, 0–100 (one decimal); null while measuring. */
  cpuPercent: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
}

/** Two reads closer together than this serve the cached answer. */
export const MIN_SAMPLE_SPACING_MS = 2000;

/** Pure: one `os.cpus()` reading as the per-core counters a delta needs. */
export function readCpuTimes(): CpuTimes[] {
  return os.cpus().map((cpu) => ({
    user: cpu.times.user,
    nice: cpu.times.nice,
    sys: cpu.times.sys,
    idle: cpu.times.idle,
    irq: cpu.times.irq,
  }));
}

/**
 * Pure: whole-machine utilization between two readings, 0–100 with one decimal; null when
 * either reading has no cores, when any core's counters went backwards (a counter can only
 * grow, so that means the readings were not of this machine's lifetime), or when nothing
 * at all passed in the window (an idle core's zero window is fine; only the machine-wide
 * zero leaves utilization undefined).
 */
export function computeCpuPercent(
  prev: readonly CpuTimes[],
  next: readonly CpuTimes[],
): number | null {
  if (prev.length === 0 || prev.length !== next.length) return null;
  let idle = 0;
  let total = 0;
  for (let i = 0; i < prev.length; i++) {
    const before = prev[i];
    const after = next[i];
    if (before === undefined || after === undefined) return null;
    const dIdle = after.idle - before.idle;
    const dTotal =
      after.user -
      before.user +
      (after.nice - before.nice) +
      (after.sys - before.sys) +
      dIdle +
      (after.irq - before.irq);
    if (dIdle < 0 || dTotal < 0) return null;
    idle += dIdle;
    total += dTotal;
  }
  if (total <= 0) return null;
  return Math.round(((total - idle) / total) * 1000) / 10;
}

/** Pure: the memory pair as the bar shows it (`used` = total − free; see the file header). */
export function readMemory(): { memoryUsedBytes: number; memoryTotalBytes: number } {
  const memoryTotalBytes = os.totalmem();
  return { memoryUsedBytes: memoryTotalBytes - os.freemem(), memoryTotalBytes };
}

/** The mechanism the harness-status route (and only it, so far) requires. */
@Interface()
export abstract class SystemStatus {
  abstract read(): SystemStatusSnapshot;
}

@Component()
export class SystemStatusService implements SystemStatus {
  /** The previous reading's counters; null until the first read of this process. */
  private lastTimes: CpuTimes[] | null = null;
  /** When the counters were last actually read (not when the cache was last served). */
  private lastReadAt = 0;
  private cached: SystemStatusSnapshot | null = null;

  read(): SystemStatusSnapshot {
    const now = Date.now();
    if (this.cached !== null && now - this.lastReadAt < MIN_SAMPLE_SPACING_MS) {
      return this.cached;
    }
    const times = readCpuTimes();
    const cpuPercent = this.lastTimes !== null ? computeCpuPercent(this.lastTimes, times) : null;
    this.lastTimes = times;
    this.lastReadAt = now;
    this.cached = { cpuPercent, ...readMemory() };
    return this.cached;
  }
}
