// 사업자등록번호 (Korean business registration number) normalisation + validation.
//
// Pure, framework-free helpers so this can be imported both from zod schemas
// on the server (buyer.ts, seller.ts) and from account-recovery code that
// needs to compare a submitted number against a stored one (passwordReset.ts,
// findId.ts) without re-deriving the same rules in three places.

/** Strip everything but digits so "123-45-67890" and "1234567890" normalise
 * to the same stored value — this MUST run before both validation and any
 * comparison/storage, or the same real business could be registered twice
 * under differently-formatted numbers. */
export function normalizeBusinessRegNumber(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

// Official checksum algorithm for 사업자등록번호. The number is 10 digits:
// [기관코드 3][일련번호 5][검증코드 1][체크섬 1] in loose terms, verified by a
// weighted sum over the first 9 digits plus a half-carry from the 9th digit.
// Weights per digit position (1-indexed): 1,3,7,1,3,7,1,3,5. This exact
// weight sequence and the "+ floor(d9*5/10)" step are what the Korean NTS
// (국세청) validators use; there is no shorter/cleaner equivalent to derive
// it from, so it's hard-coded here rather than "explained" further.
const CHECKSUM_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const;

/** True only for a syntactically well-formed (10 digit) AND checksum-valid
 * 사업자등록번호. Callers should normalize() first — this does not strip
 * separators itself, so it can also be used to re-validate an already-stored
 * value. */
export function isValidBusinessRegNumber(normalized: string): boolean {
  if (!/^\d{10}$/.test(normalized)) return false;

  const digits = normalized.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < CHECKSUM_WEIGHTS.length; i++) {
    sum += digits[i] * CHECKSUM_WEIGHTS[i];
  }
  // The 9th digit (index 8) contributes twice: once at its normal weight (5)
  // above, and again halved (integer division by 10) as a carry into the
  // check digit — this is the part of the algorithm that isn't a plain
  // weighted-sum-mod-10 checksum.
  sum += Math.floor((digits[8] * 5) / 10);

  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === digits[9];
}
