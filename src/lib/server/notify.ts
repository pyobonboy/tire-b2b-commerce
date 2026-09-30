// Notification dispatch for every "the system should tell someone something
// happened" moment in the app: buyer/seller approval, suspension, listing
// review, new orders, shipping progress, and auto-cancellation.
//
// LIMITATION (see README's 운영 가이드): no email/SMS provider or credentials
// are available in this deployment. There is no SMTP/Resend/Twilio dependency
// wired in, and none should be invented here — that would just be config
// that cannot work. `NotConfiguredNotificationChannel` below is the active
// implementation, and it never actually delivers anything: outside
// production it logs what *would* have been sent (so the wiring at every
// call site is verifiable without a real provider); in production it is
// silently a no-op, since printing "would have sent" to stdout on every
// order isn't something an operator would want to grep through, and there is
// no notification queue/table in the schema to persist it into instead.
//
// SWAPPING IN A REAL PROVIDER: implement `NotificationChannel` (one method,
// `send`) against whatever provider is chosen (email API, SMS gateway, etc.)
// and replace the `activeChannel` assignment near the bottom of this file
// with an instance of that class. Every call site in the codebase already
// goes through `notifyUser`, so nothing else needs to change. The contract a
// real implementation must satisfy:
//   - `send` must resolve, never reject/throw. Swallow and log the
//     provider's own errors internally (network failure, invalid recipient,
//     provider outage, etc.) — see the "never break the business operation"
//     rule below for why.
//   - `send` may be called for a recipient with a null `email` and/or empty
//     `mobilePhone`; decide per-channel what to do (skip, fall back, etc.)
//     rather than assuming both are always usable.
//   - `send` should be reasonably fast or fire against a queue itself; every
//     call site here awaits it once (after its own DB work has already
//     committed), so a slow provider call directly slows down the HTTP
//     response, but a provider *outage* must never turn into a 500 for the
//     underlying business operation (see notifyUser below).
//
// HARD REQUIREMENT — notification failure must never break or roll back the
// business operation it's attached to. Several call sites
// (approveAdminSeller, cancelOrder's sibling flows, etc.) run inside
// prisma.$transaction; sending a notification from *inside* one of those
// would be an external side effect Postgres cannot roll back if a later
// statement in the same transaction then fails — exactly the mistake
// cancelOrder's comment (src/lib/server/orders.ts) documents at length for
// the Toss refund call, and exactly why settleOrderRefundViaToss there runs
// only after that transaction has committed. Every call to `notifyUser` in
// this codebase must likewise happen only after the relevant
// prisma.$transaction has already resolved, never from within the callback
// passed to it. `notifyUser` itself additionally catches and logs any error
// (its own lookup query failing, or the channel throwing despite the
// contract above) rather than letting it propagate, so even a caller that
// forgets to await it, or awaits it before returning, can never have a
// notification failure surface as a failed request.
import { prisma } from "./prisma";

export type NotificationEvent =
  | "BUYER_APPROVED"
  | "BUYER_REJECTED"
  | "BUYER_SUSPENDED"
  | "SELLER_APPROVED"
  | "SELLER_SUSPENDED"
  | "SELLER_REINSTATED"
  | "LISTING_APPROVED"
  | "LISTING_REJECTED"
  | "SELLER_ORDER_RECEIVED"
  | "BUYER_ORDER_SHIPPED"
  | "BUYER_ORDER_AUTO_CANCELLED"
  | "INQUIRY_ANSWERED"
  | "SELLER_RETURN_REQUEST_RECEIVED"
  | "BUYER_RETURN_REQUEST_APPROVED"
  | "BUYER_RETURN_REQUEST_REJECTED"
  | "BUYER_RETURN_REQUEST_COMPLETED"
  | "BUYER_TAX_INVOICE_ISSUED"
  | "BUYER_TAX_INVOICE_REJECTED";

export interface NotificationMessage {
  /** Short line suitable for a push/SMS title or an email subject. */
  subject: string;
  /** Full Korean copy describing what happened. */
  body: string;
}

export interface NotificationRecipient {
  userId: string;
  email: string | null;
  mobilePhone: string;
}

/**
 * A channel is anything capable of actually delivering a notification (email,
 * SMS, push, ...). See the file header for the contract an implementation
 * must satisfy — most importantly, `send` must never throw/reject.
 */
export interface NotificationChannel {
  send(
    recipient: NotificationRecipient,
    event: NotificationEvent,
    message: NotificationMessage,
  ): Promise<void>;
}

// The only implementation available today. No provider or credentials exist
// for this deployment, so this deliberately does not deliver anything real —
// see the file header for why, and for what to do when a real provider shows
// up.
class NotConfiguredNotificationChannel implements NotificationChannel {
  async send(
    recipient: NotificationRecipient,
    event: NotificationEvent,
    message: NotificationMessage,
  ): Promise<void> {
    // Outside production, log what *would* have gone out so every call site
    // wired up in this task is verifiable end-to-end without a real
    // provider. In production, stay silent — there is no notification log
    // table in the schema to write this into instead, and spraying it into
    // stdout on every order would just be noise an operator has no use for.
    if (process.env.NODE_ENV !== "production") {
      console.log("[NOTIFY:NOT_CONFIGURED] would send", {
        userId: recipient.userId,
        email: recipient.email,
        mobilePhone: recipient.mobilePhone,
        event,
        subject: message.subject,
        body: message.body,
      });
    }
  }
}

const activeChannel: NotificationChannel = new NotConfiguredNotificationChannel();

/**
 * Look up `userId`'s current contact info + opt-in choice and, if they're
 * opted in, hand `message` to the active channel.
 *
 * Gating: this app's schema has exactly one opt-in flag (`User.notifyOptIn`),
 * not a separate marketing-vs-transactional pair. Given only one flag, this
 * gates *every* notification on it — including the "transactional"-feeling
 * ones like shipping updates — rather than special-casing some events to
 * ignore an explicit opt-out. Rationale: `notifyOptIn` defaults to `true`, so
 * the common case (never touched the setting) still gets shipping/order
 * updates; a user who deliberately opted out asked not to be contacted, and
 * silently emailing/texting them anyway because *we* decided their case was
 * "transactional enough" would violate that choice. If the business later
 * wants shipping/order updates to be non-optional regardless of
 * `notifyOptIn`, that needs its own column (this task may not add one) —
 * bolting a per-event override onto this single flag would just be guessing
 * at a distinction the schema doesn't actually encode.
 *
 * Never throws: a failure here (bad userId, DB hiccup, or the channel
 * misbehaving despite its contract) is caught and logged, never surfaced to
 * the caller, per the "must never break the business operation" rule in the
 * file header. Call this only after any surrounding prisma.$transaction has
 * already committed.
 */
export async function notifyUser(
  userId: string,
  event: NotificationEvent,
  message: NotificationMessage,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, mobilePhone: true, notifyOptIn: true },
    });
    if (!user) return;
    if (!user.notifyOptIn) return;

    await activeChannel.send(
      { userId, email: user.email, mobilePhone: user.mobilePhone },
      event,
      message,
    );
  } catch (error) {
    console.error("NOTIFY_USER_FAILED", { userId, event, error });
  }
}
