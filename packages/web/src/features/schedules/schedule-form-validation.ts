/**
 * The schedule form's field-level validation: the three rejections a person can see coming
 * while the dialog is still open — a name the store cannot take, a malformed period, an end
 * at or before the start — each said under its own field (schedule-form-modal.tsx) instead of
 * after a round trip, in the UI's language (S.schedule).
 *
 * The rules mirror the server's own, so the two never disagree about the same value:
 *   - the name rule is core's `isValidId` (packages/core/src/state/agent-state.ts): the name
 *     is the file name the task is stored under, so it takes the id alphabet;
 *   - the period rule is the server's `parsePeriod` (runtime/schedule-file.ts): digits then
 *     one of m/h/d, and like the server, zero is no period at all.
 * The 5-minute floor (MIN_PERIOD_MS) is deliberately left to the server: it is a different
 * refusal with its own sentence, and this form does not pre-empt it — nor any of the rules
 * that need the server's clock or config. What slips past stays caught there, and the codes
 * the server sends back (schedule_invalid_*) map to the same S.schedule sentences
 * (lib/api-error.ts).
 */

/** The id alphabet the store's file names are drawn from (mirrors core's isValidId). */
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** The period shape the server parses (mirrors runtime/schedule-file.ts parsePeriod). */
const PERIOD_PATTERN = /^(\d+)([mhd])$/;

/** The fields whose current value the server would refuse. */
export type InvalidScheduleField = "name" | "period" | "endAt";

/**
 * The shape of the form these rules read — the modal's FormState satisfies it structurally,
 * and nothing else imports this module, so the two cannot drift apart silently.
 */
export interface ScheduleFormValues {
  /** The task being edited (its name is locked, and it arrived valid), or null to create. */
  editing: string | null;
  name: string;
  period: string;
  /** datetime-local input values: local time, minute precision, "" when empty. */
  startAt: string;
  endAt: string;
}

/**
 * The fields whose current value the server would refuse, as one set the submit guard and the
 * field errors share. Values are measured trimmed, the way the submit body sends them.
 */
export function invalidScheduleFields(v: ScheduleFormValues): Set<InvalidScheduleField> {
  const invalid = new Set<InvalidScheduleField>();
  // Create mode only: an existing task's name is disabled, and it was validated when written.
  const name = v.name.trim();
  if (v.editing === null && name !== "" && !NAME_PATTERN.test(name)) invalid.add("name");
  const period = v.period.trim();
  const m = PERIOD_PATTERN.exec(period);
  if (period !== "" && (m === null || Number(m[1]) <= 0)) invalid.add("period");
  if (v.startAt !== "" && v.endAt !== "") {
    const start = Date.parse(v.startAt);
    const end = Date.parse(v.endAt);
    // The server refuses end_at <= start_at (runtime/schedule-file.ts); datetime-local inputs
    // produce parseable values or empty ones, so an unparseable one is left to the server.
    if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) invalid.add("endAt");
  }
  return invalid;
}
