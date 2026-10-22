/**
 * The schedule form's field-level rules (features/schedules/schedule-form-validation.ts) — the
 * mirror of what the server refuses, said under the field before anything is sent.
 *
 * - A name the store cannot file — the id alphabet, so no path character and no `.toml` — is
 *   named while it is typed; an edit dialog never blames the locked name it opened with.
 * - A period is digits then one of m/h/d, exactly the shape the server parses, and zero is no
 *   period there either; an empty period is a one-shot task, not an error.
 * - An end at or before the start is refused; an empty end is open-ended, and the window is not
 *   judged before there is a start to compare with.
 */
import { describe, expect, it } from "vitest";
import { invalidScheduleFields } from "../src/features/schedules/schedule-form-validation";
import type { ScheduleFormValues } from "../src/features/schedules/schedule-form-validation";

const form = (v: Partial<ScheduleFormValues> = {}): ScheduleFormValues => ({
  editing: null,
  name: "daily_report",
  period: "",
  startAt: "2026-10-11T09:00",
  endAt: "",
  ...v,
});

describe("invalidScheduleFields", () => {
  it("takes the store's name alphabet, measured trimmed as it is sent", () => {
    expect(invalidScheduleFields(form())).toEqual(new Set());
    // The defect's own shape: a path separator the file name cannot carry.
    expect(invalidScheduleFields(form({ name: "qa_bad/name" }))).toEqual(new Set(["name"]));
    expect(invalidScheduleFields(form({ name: "bad name" }))).toEqual(new Set(["name"]));
    expect(invalidScheduleFields(form({ name: "daily.toml" }))).toEqual(new Set(["name"]));
    expect(invalidScheduleFields(form({ name: "  bad name  " }))).toEqual(new Set(["name"]));
    // Empty is the required-field rule's to say, not this one's.
    expect(invalidScheduleFields(form({ name: "  " }))).toEqual(new Set());
    expect(invalidScheduleFields(form({ name: "A-1_2" }))).toEqual(new Set());
  });

  it("never blames the locked name of a task being edited", () => {
    expect(invalidScheduleFields(form({ editing: "daily", name: "qa_bad/name" }))).toEqual(
      new Set(),
    );
  });

  it("takes the period shape the server parses, zero included in what it refuses", () => {
    expect(invalidScheduleFields(form({ period: "30m" }))).toEqual(new Set());
    expect(invalidScheduleFields(form({ period: "12h" }))).toEqual(new Set());
    expect(invalidScheduleFields(form({ period: "7d" }))).toEqual(new Set());
    expect(invalidScheduleFields(form({ period: "nonsense-period" }))).toEqual(new Set(["period"]));
    expect(invalidScheduleFields(form({ period: "10s" }))).toEqual(new Set(["period"]));
    expect(invalidScheduleFields(form({ period: "0m" }))).toEqual(new Set(["period"]));
    // Trimmed the way the submit body sends it.
    expect(invalidScheduleFields(form({ period: " 30m " }))).toEqual(new Set());
  });

  it("refuses an end at or before the start, and leaves an open-ended task alone", () => {
    expect(invalidScheduleFields(form({ endAt: "2026-10-11T08:00" }))).toEqual(new Set(["endAt"]));
    expect(invalidScheduleFields(form({ endAt: "2026-10-11T09:00" }))).toEqual(new Set(["endAt"]));
    expect(invalidScheduleFields(form({ endAt: "2026-10-11T09:01" }))).toEqual(new Set());
    // No start yet: the window waits for the required start's own rule.
    expect(invalidScheduleFields(form({ startAt: "", endAt: "2026-10-11T08:00" }))).toEqual(
      new Set(),
    );
  });
});
