// 예금주 실명조회 (bank account holder real-name verification) provider
// abstraction.
//
// There is no real-name-verification vendor under contract for this
// deployment — no API credentials, no integration. `saveBankAccount` (in
// account.ts) still has to behave honestly about that: it saves whatever the
// user submitted, and reports — explicitly, in a machine-readable way — that
// nothing was actually verified, rather than silently writing
// `bankAccountVerifiedAt: null` with no caller-visible signal that
// verification was skipped entirely (which is what the route named `verify`
// used to do). This module exists so that wiring in a real provider later is
// a single implementation swap behind the interface below — nothing in
// account.ts, its API route, or the settings UI needs to change shape.
//
// Expected contract for a real provider implementation:
//   - Take the submitted (bankName, bankAccountNumber, bankAccountHolder).
//   - Call out to the bank/PG 실명조회 API for an account-holder-name match.
//   - Resolve with { verified: true, verifiedAt, reason: null } on a
//     confirmed match, or { verified: false, verifiedAt: null, reason }
//     on a mismatch or provider-side error — do NOT throw for an ordinary
//     "name does not match" result, since that is an expected outcome
//     saveBankAccount must be able to persist, not a failure of the save
//     itself. Only throw for something saveBackAccount genuinely cannot
//     proceed on (e.g. network/config errors so severe the caller should
//     see a 500), and even then prefer surfacing it as
//     { verified: false, reason: "PROVIDER_ERROR" } so a flaky vendor can't
//     turn "save my bank account" into a hard failure.

export interface BankAccountDetails {
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
}

export interface BankVerificationResult {
  verified: boolean;
  verifiedAt: Date | null;
  // Machine-readable reason the API response / admin tooling can key off —
  // e.g. distinguishing "no provider configured at all" from a real
  // provider's "name didn't match" or "vendor call failed".
  reason: "NOT_CONFIGURED" | "NAME_MISMATCH" | "PROVIDER_ERROR" | null;
}

export interface BankVerificationProvider {
  verify(details: BankAccountDetails): Promise<BankVerificationResult>;
}

/**
 * The only provider wired in today. It makes no external call and always
 * reports "unverified" — the honest behavior when no 실명조회 channel exists.
 * Spelling this out as its own class (rather than an early-return short
 * circuit inside saveBankAccount) keeps the "unconfigured" state a visible,
 * swappable implementation rather than an implicit assumption buried in
 * account.ts.
 *
 * Replace this the moment a real provider is under contract: implement
 * BankVerificationProvider against the vendor's API and swap the
 * `bankVerificationProvider` export below — saveBankAccount and the
 * /api/account/bank-account/verify route already treat the result generically
 * and need no further changes.
 */
class NotConfiguredBankVerificationProvider implements BankVerificationProvider {
  async verify(): Promise<BankVerificationResult> {
    return { verified: false, verifiedAt: null, reason: "NOT_CONFIGURED" };
  }
}

export const bankVerificationProvider: BankVerificationProvider = new NotConfiguredBankVerificationProvider();
