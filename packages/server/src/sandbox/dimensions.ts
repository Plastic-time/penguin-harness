/**
 * Runtime helpers over the sandbox vocabulary.
 *
 * The vocabulary itself is `@prismshadow/penguin-core/plugin` — a backend compiles
 * against those names, so they belong with the rest of the plugin contract rather than
 * inside the harness that routes them. What stays here is the code that READS those
 * shapes: which dimensions a provider covers and which a settings object requires, the two
 * questions service.ts routes on. That is the embedder's business, and keeping it out of
 * the contract is what stops it becoming a runtime dependency of every plugin package.
 */
import type {
  SandboxDimension,
  SandboxProvider,
  SandboxSettings,
} from "@prismshadow/penguin-core/plugin";

/** Every dimension, in the order error messages list them. */
export const SANDBOX_DIMENSIONS: readonly SandboxDimension[] = [
  "fs-write",
  "network",
  "network-local",
  "mask-paths",
  "closed-temp",
  "readonly-roots",
];

/** The dimensions a provider implements (absent declaration = filesystem only). */
export function providerDimensions(provider: SandboxProvider): readonly SandboxDimension[] {
  return provider.dimensions ?? ["fs-write"];
}

/** The dimensions a settings object actually requires. */
export function requestedDimensions(settings: SandboxSettings): SandboxDimension[] {
  const dims: SandboxDimension[] = ["fs-write"];
  if (settings.network === "none") dims.push("network");
  if (settings.network === "local") dims.push("network-local");
  if (settings.maskPaths !== undefined && settings.maskPaths.length > 0) dims.push("mask-paths");
  // Temp closed matters only while confining: full access writes everywhere anyway.
  if (settings.writableTemp === false && settings.mode !== "danger-full-access") {
    dims.push("closed-temp");
  }
  // A read-only state root is orthogonal to the mode: it holds under full access too, so the
  // short-circuit for "full access with nothing else asked" must not swallow it. Only a
  // backend that declares the dimension may receive such a policy — ignoring the root would
  // WIDEN confinement, the one direction the interface forbids.
  if (settings.stateReadonly === true) dims.push("readonly-roots");
  return dims;
}
