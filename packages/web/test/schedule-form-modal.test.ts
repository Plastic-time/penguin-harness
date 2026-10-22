// @vitest-environment jsdom
/**
 * The scheduled task form (features/schedules/schedule-form-modal.tsx) as one record form under
 * the settings commit model.
 *
 * - Create waits for a name, a prompt and a start time; an untouched required field shows only
 *   its asterisk.
 * - Esc, Cancel, a press outside and the × each ask while anything is typed; "keep editing"
 *   leaves the dialog and the typing.
 * - An untouched dialog closes at once.
 * - A created task closes the dialog without asking; its Enabled box is a field of the form,
 *   sent with Create.
 * - A refused create keeps the dialog open with the reason under the form, still unsaved.
 * - The three values the store cannot take — a name it cannot file, a malformed period, an end
 *   at or before the start — are said under their own field while they are typed, Create held,
 *   and a server that refuses with the codes answers in the same sentences, in either language.
 * - Editing: Save is held while nothing differs from the task; flipping Enabled is a change that
 *   waits for Save (nothing is written on the click), and a prompt cleared is named as required.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h, useState } from "react";
import type { ScheduleItem } from "@prismshadow/penguin-server/api";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ScheduleFormModal } from "../src/features/schedules/schedule-form-modal";
import {
  AGENT_ID,
  agentServer,
  buttonIn,
  fieldIn,
  mountAgentApp,
  topDialog,
} from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  hasButton,
  pressEscape,
  pressScrim,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const DAILY: ScheduleItem = {
  name: "daily",
  prompt: "Write the report.",
  enabled: true,
  startAt: "2026-10-11T01:00:00.000Z",
  period: "1d",
  status: "active",
  queued: false,
};

function Harness({ editing, onSaved }: { editing: ScheduleItem | null; onSaved: () => void }) {
  const [open, setOpen] = useState(true);
  return h(ScheduleFormModal, {
    open,
    agentId: AGENT_ID,
    editing,
    onClose: () => setOpen(false),
    onSaved,
  });
}

async function openForm(editing: ScheduleItem | null = null) {
  const server = agentServer();
  const onSaved = vi.fn();
  await mountAgentApp(h(Harness, { editing, onSaved }), { at: `/agents/${AGENT_ID}` });
  await waitFor(() => dialogs().length === 1);
  return { server, onSaved };
}

const inForm = (title: string) => fieldIn(topDialog(), title);
const verb = (name: string) => buttonIn(topDialog(), name);
const enabledBox = () => topDialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const promptOpen = () => hasButton(en.common.discard);

async function fillRequired() {
  await type(inForm(en.common.name), "daily_report");
  await type(inForm(en.schedule.prompt), "Write the report.");
  await type(inForm(en.schedule.startAt), "2026-10-11T09:00");
}

describe("the scheduled task form", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for a name, a prompt and a start time, without naming untouched fields", async () => {
    await openForm();
    expect(verb(en.common.create).disabled).toBe(true);
    await type(inForm(en.common.name), "daily_report");
    await type(inForm(en.schedule.prompt), "Write the report.");
    expect(verb(en.common.create).disabled).toBe(true);
    expect(topDialog().textContent).not.toContain(en.common.requiredField);
    await type(inForm(en.schedule.startAt), "2026-10-11T09:00");
    expect(verb(en.common.create).disabled).toBe(false);
  });

  it.each([
    ["Escape", pressEscape],
    ["Cancel", () => click(verb(en.common.cancel))],
    ["a press outside", pressScrim],
    ["the ×", () => click(verb("Close"))],
  ])("asks on %s with anything typed, and keep editing keeps the typing", async (_, leave) => {
    await openForm();
    await type(inForm(en.common.name), "daily_report");
    await leave();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(dialogs()).toHaveLength(1);
    expect(inForm(en.common.name).value).toBe("daily_report");
  });

  it("closes an untouched dialog at once", async () => {
    await openForm();
    await click(verb(en.common.cancel));
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toEqual([]);
  });

  it("creates without asking on the way out, sending the Enabled box with the form", async () => {
    const { server, onSaved } = await openForm();
    await fillRequired();
    await click(enabledBox());
    await click(verb(en.common.create));
    await waitFor(() => dialogs().length === 0);
    expect(promptOpen()).toBe(false);
    expect(hasUnsaved()).toBe(false);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(server.writes("/schedules")).toHaveLength(1);
    expect(server.writes("/schedules")[0]!.body).toMatchObject({
      name: "daily_report",
      prompt: "Write the report.",
      enabled: false,
    });
  });

  it("keeps a refused create open with the reason under the form, still unsaved", async () => {
    const { server, onSaved } = await openForm();
    server.refuseNext(400, "invalid_schedule", "the period is not valid");
    await fillRequired();
    await click(verb(en.common.create));
    await waitFor(() => topDialog().textContent?.includes("the period is not valid") === true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(hasUnsaved()).toBe(true);
  });

  it("holds Save on an untouched edit; Enabled waits for Save; a cleared prompt is named", async () => {
    const { server } = await openForm(DAILY);
    expect(verb(en.common.save).disabled).toBe(true);
    await click(enabledBox());
    expect(verb(en.common.save).disabled).toBe(false);
    expect(server.writes()).toEqual([]);
    await click(enabledBox());
    expect(verb(en.common.save).disabled).toBe(true);

    await type(inForm(en.schedule.prompt), "");
    expect(verb(en.common.save).disabled).toBe(true);
    expect(topDialog().textContent).toContain(en.common.requiredField);
  });

  it("says a name the store cannot file under the name field, and holds Create", async () => {
    const { server, onSaved } = await openForm();
    await type(inForm(en.common.name), "qa_bad/name");
    expect(topDialog().textContent).toContain(en.schedule.nameInvalid);
    await type(inForm(en.schedule.prompt), "Write the report.");
    await type(inForm(en.schedule.startAt), "2026-10-11T09:00");
    expect(verb(en.common.create).disabled).toBe(true);
    expect(server.writes()).toEqual([]);
    await type(inForm(en.common.name), "daily_report");
    expect(topDialog().textContent).not.toContain(en.schedule.nameInvalid);
    expect(verb(en.common.create).disabled).toBe(false);
    await click(verb(en.common.create));
    await waitFor(() => dialogs().length === 0);
    expect(server.writes("/schedules")).toHaveLength(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("says a malformed period under the period field, naming the shapes it takes", async () => {
    const { server } = await openForm();
    await fillRequired();
    await type(inForm(en.schedule.period), "nonsense-period");
    expect(topDialog().textContent).toContain(en.schedule.periodInvalid);
    expect(topDialog().textContent).toMatch(/30m \/ 12h \/ 7d/);
    expect(verb(en.common.create).disabled).toBe(true);
    expect(server.writes()).toEqual([]);
    await type(inForm(en.schedule.period), "30m");
    expect(topDialog().textContent).not.toContain(en.schedule.periodInvalid);
    await click(verb(en.common.create));
    await waitFor(() => dialogs().length === 0);
    expect(server.writes("/schedules")).toHaveLength(1);
  });

  it("says an end at or before the start under the end field, and a later one goes", async () => {
    const { server } = await openForm();
    await fillRequired();
    await type(inForm(en.schedule.endAt), "2026-10-11T08:00");
    expect(topDialog().textContent).toContain(en.schedule.windowInvalid);
    expect(verb(en.common.create).disabled).toBe(true);
    expect(server.writes()).toEqual([]);
    await type(inForm(en.schedule.endAt), "2026-10-11T10:00");
    expect(topDialog().textContent).not.toContain(en.schedule.windowInvalid);
    await click(verb(en.common.create));
    await waitFor(() => dialogs().length === 0);
    expect(server.writes("/schedules")).toHaveLength(1);
  });

  it("answers a server that still refuses in the form's own words, not its English", async () => {
    const { server, onSaved } = await openForm();
    // A rule this form does not mirror — the server's 5-minute floor, say — still comes back
    // localized: the code carries the sentence, the message is only the fallback.
    server.refuseNext(
      400,
      "schedule_invalid_period",
      "Invalid schedule configuration: period must look like 30m / 12h / 7d",
    );
    await fillRequired();
    await click(verb(en.common.create));
    await waitFor(() => topDialog().textContent?.includes(en.schedule.periodInvalid) === true);
    expect(topDialog().textContent).not.toContain("Invalid schedule configuration");
    expect(onSaved).not.toHaveBeenCalled();
    expect(hasUnsaved()).toBe(true);
  });

  it("says the same three sentences in the Chinese UI the defect was filed against", async () => {
    // The mounted app carries its own LocaleProvider, which re-applies the language on every
    // mount from the stored preference — that store is the lever, not a bare setActiveStrings.
    localStorage.setItem("penguin.lang", "zh");
    try {
      const { server } = await openForm();
      await type(inForm(zh.common.name), "qa_c7_bad/name");
      await type(inForm(zh.schedule.prompt), "写日报。");
      await type(inForm(zh.schedule.startAt), "2026-10-11T09:00");
      await type(inForm(zh.schedule.period), "nonsense-period");
      await type(inForm(zh.schedule.endAt), "2026-10-11T08:00");
      expect(topDialog().textContent).toContain(zh.schedule.nameInvalid);
      expect(topDialog().textContent).toContain(zh.schedule.periodInvalid);
      expect(topDialog().textContent).toContain(zh.schedule.windowInvalid);
      // The defect's English never reaches the Chinese dialog.
      expect(topDialog().textContent).not.toContain("Invalid schedule");
      expect(verb(zh.common.create).disabled).toBe(true);
      expect(server.writes()).toEqual([]);
    } finally {
      localStorage.setItem("penguin.lang", "en");
      setActiveStrings(en);
    }
  });
});
