// Client-side formatter for the `details` array the server sends back on a
// 400 with `{ error: "VALIDATION_ERROR", details: error.issues }` — every
// `validationResponse()` in src/lib/server/*.ts returns exactly that shape
// (it is `ZodError.issues` from zod 4, unmodified). zod 4's built-in issue
// messages are English ("Too small: expected string to have >=3
// characters"), so the server does NOT attempt to localize them — it just
// forwards `issues` as-is and leaves message assembly to whoever renders the
// error. This file is the ONLY place that turns an issue's `code` (+ its
// parameters, e.g. `minimum`/`maximum`/`format`) into a Korean sentence.
// Do not "fix" this by adding a zod error map or `message` option to a
// server schema instead — that would duplicate this logic server-side and
// still leave every other screen's messages unlocalized.
//
// Usage for a new screen: call
//   formatZodIssues(body.details, LABELS, OVERRIDES)
// where LABELS maps every field name of that screen's zod schema (see the
// matching src/lib/server/*.ts module) to a short Korean label, and
// OVERRIDES (optional) maps a field name to a fixed message to use whenever
// that field fails a string-format check (email/url/regex/etc.) — e.g. a
// regex-constrained login id, where "형식이 올바르지 않습니다" alone doesn't
// tell the user what characters are actually allowed.

const MAX_LINES = 5;

interface RawIssueLike {
  path?: unknown;
  code?: unknown;
  origin?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  format?: unknown;
  message?: unknown;
}

function isIssueLike(value: unknown): value is RawIssueLike {
  return typeof value === "object" && value !== null;
}

// zod 4's too_small/too_big issues carry `origin` ("string" | "number" |
// "int" | "array" | ...) rather than the zod 3 `type` field. Only "string"
// gets the "자" (character-count) phrasing; every other origin we might see
// from these schemas (number/int, or an array like listingSchema's
// imageUrls) reads fine with the plain numeric-comparison phrasing.
function isStringOrigin(origin: unknown): boolean {
  return origin === "string";
}

function formatIssue(
  issue: RawIssueLike,
  field: string,
  formatOverrides: Record<string, string> | undefined,
): string {
  const code = typeof issue.code === "string" ? issue.code : "";

  switch (code) {
    // Missing field (undefined/null) and any other expected-vs-actual type
    // mismatch both surface as "invalid_type" in zod 4 — there is no
    // separate "required" code to distinguish them, and the user-facing
    // message is the same either way.
    case "invalid_type":
      return "필수 입력 항목입니다";

    case "too_small": {
      const minimum = issue.minimum;
      return isStringOrigin(issue.origin)
        ? `${String(minimum)}자 이상 입력해 주세요`
        : `${String(minimum)} 이상이어야 합니다`;
    }

    case "too_big": {
      const maximum = issue.maximum;
      return isStringOrigin(issue.origin)
        ? `${String(maximum)}자 이하로 입력해 주세요`
        : `${String(maximum)} 이하여야 합니다`;
    }

    // String-format checks (.email()/.url()/.regex()/etc.) all share this one
    // code in zod 4, distinguished by `format`.
    case "invalid_format": {
      const override = formatOverrides?.[field];
      if (override) return override;
      if (issue.format === "email") return "이메일 형식이 올바르지 않습니다";
      if (issue.format === "url") return "URL 형식이 올바르지 않습니다";
      return "형식이 올바르지 않습니다";
    }

    // .refine()/.superRefine() — the server's own refine messages are
    // already Korean (e.g. businessRegNumberField's "사업자등록번호 형식이
    // 올바르지 않습니다."), so pass them through as-is.
    case "custom":
      return typeof issue.message === "string" && issue.message.length > 0
        ? issue.message
        : "입력값이 올바르지 않습니다";

    // Anything else (not_multiple_of, invalid_value, unrecognized_keys,
    // invalid_union, ...) — none of these six schemas produce them today,
    // but never fall back to the raw (English) issue.message here.
    default:
      return "입력값이 올바르지 않습니다";
  }
}

/**
 * Turns a (network-supplied, therefore untrusted) zod 4 `issues` array into
 * up to 5 Korean "라벨: 문장" lines, one per distinct field (first issue per
 * field wins). If there are more than 5 distinct fields with an issue, the
 * remainder is summarized as one "외 N건의 입력 오류가 있습니다" line.
 *
 * Returns `[]` if `details` isn't shaped like an issues array at all, so
 * callers can fall back to a generic message instead of showing nothing.
 */
export function formatZodIssues(
  details: unknown,
  labels: Record<string, string>,
  formatOverrides?: Record<string, string>,
): string[] {
  if (!Array.isArray(details)) return [];

  const seenFields = new Set<string>();
  const lines: string[] = [];
  let extraCount = 0;

  for (const raw of details) {
    if (!isIssueLike(raw)) continue;

    const path = Array.isArray(raw.path) ? raw.path : [];
    const field = String(path[0] ?? "");
    if (seenFields.has(field)) continue;
    seenFields.add(field);

    if (lines.length < MAX_LINES) {
      const label = labels[field] ?? field;
      lines.push(`${label}: ${formatIssue(raw, field, formatOverrides)}`);
    } else {
      extraCount += 1;
    }
  }

  if (extraCount > 0) {
    lines.push(`외 ${extraCount}건의 입력 오류가 있습니다`);
  }

  return lines;
}
