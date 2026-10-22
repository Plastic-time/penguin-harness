/**
 * API error → display text: the server's `{error:{code,message}}` message is
 * **English-only**, but the UI language may be Chinese — so for any error the
 * user might actually hit, we derive localized text from the **code** (the
 * context-dependent and form-shared cases below, then the S.errors.byCode
 * table); the raw server message is only a fallback for codes we haven't
 * mapped yet.
 */
import { ApiError } from "../api/client";
import { S } from "./strings";

/**
 * ctx supplies context needed for localized text (e.g. the model id for a
 * missing key — the error body only has the code; the model id is filled in
 * by the caller: the model used by the current session/draft when sending).
 */
export function apiErrorText(err: unknown, ctx?: { modelId?: string }): string {
  if (!(err instanceof ApiError)) return S.common.unknownError;
  // These need context the error body doesn't carry (the model id) / their own phrasing.
  if (err.code === "model_credential_missing") {
    return ctx?.modelId ? S.errors.modelCredentialMissing(ctx.modelId) : err.message;
  }
  if (err.code === "no_default_model") return S.errors.noDefaultModel;
  // The schedule form's three rejections: the form says them under the field while the value
  // is typed (features/schedules/schedule-form-validation.ts); a server that is left to do the
  // refusing — another client's write, a rule this form does not mirror — answers in the same
  // words, read from the same keys.
  if (err.code === "schedule_invalid_name") return S.schedule.nameInvalid;
  if (err.code === "schedule_invalid_period") return S.schedule.periodInvalid;
  if (err.code === "schedule_invalid_window") return S.schedule.windowInvalid;
  // Code → localized text; the map is a plain object, indexed by the runtime code string.
  const byCode = S.errors.byCode as Record<string, string | undefined>;
  return byCode[err.code] ?? err.message;
}
