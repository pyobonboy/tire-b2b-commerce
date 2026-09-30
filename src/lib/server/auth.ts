import { compare } from "bcryptjs";
import { getServerSession } from "next-auth";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { loginIdLimiter, loginIpLimiter } from "./rateLimit";
import { getClientIp } from "./requestIp";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        loginId: { label: "아이디", type: "text" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(credentials, req) {
        const loginId = typeof credentials?.loginId === "string" ? credentials.loginId.trim() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";

        if (!loginId || !password) return null;

        const ip = getClientIp(req.headers);
        const loginIdKey = `login:${loginId}`;
        // getClientIp returns null when it can't determine a trustworthy IP
        // (see requestIp.ts) — in production, behind Render's proxy,
        // x-forwarded-for is always present, so this is effectively a local-
        // dev-only case. When it happens, skip the IP axis entirely rather
        // than interpolate null into a string key (`login-ip:null` would
        // recreate a single shared bucket for every such request — the exact
        // bug this change fixes). The loginId axis still applies regardless.
        const loginIpKey = ip !== null ? `login-ip:${ip}` : null;

        // Check both axes — and skip the DB lookup and bcrypt compare below —
        // before doing any real work, so a lockout also caps the CPU/DB cost an
        // attacker can force per request.
        if (loginIdLimiter.isBlocked(loginIdKey) || (loginIpKey !== null && loginIpLimiter.isBlocked(loginIpKey))) {
          return null;
        }

        const fail = () => {
          loginIdLimiter.record(loginIdKey);
          if (loginIpKey !== null) loginIpLimiter.record(loginIpKey);
          return null;
        };

        const user = await prisma.user.findUnique({
          where: { loginId },
          include: { seller: true, buyer: true },
        });

        if (!user || user.withdrawnAt) return fail();
        if (!(await compare(password, user.passwordHash))) return fail();

        if (user.role === "SELLER" && user.seller?.status !== "ACTIVE") {
          return fail();
        }

        if (user.role === "BUYER" && user.buyer?.status !== "ACTIVE") {
          return fail();
        }

        loginIdLimiter.reset(loginIdKey);
        if (loginIpKey !== null) loginIpLimiter.reset(loginIpKey);

        return {
          id: user.id,
          name: user.businessName,
          email: user.email ?? undefined,
          role: user.role,
          sellerId: user.seller?.id ?? null,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  // Without an explicit maxAge, NextAuth v4 falls back to a 30-day session
  // (see SessionOptions.maxAge in node_modules/next-auth/core/types.d.ts).
  // That is too long for a B2B service where a logged-in session can place
  // orders and sellers can see buyer PII, and where accounts are commonly
  // used on shared shop-floor PCs that nobody explicitly signs out of.
  //
  // 8 hours covers a full working day without interrupting it, and
  // `updateAge: 0` re-issues the session cookie on every request while the
  // user is active (default is once per day — too coarse for an 8h window,
  // since a session started at 9am would otherwise still expire at 9am
  // sharp even if the user was actively using it at 8:55am). Together this
  // means: active use never gets logged out mid-day, but a machine left
  // unattended overnight is signed out by morning.
  //
  // `jwt.maxAge` must be set separately — it is NOT derived from
  // `session.maxAge`. NextAuth's core init (node_modules/next-auth/core/init.js)
  // hardcodes a 30-day default for `jwt.maxAge` independently of whatever
  // `session.maxAge` is, and the encrypted JWT's own `exp` claim is stamped
  // from `jwt.maxAge` (see the `encode()` call in
  // node_modules/next-auth/jwt/index.js). Leaving it unset here would mean
  // the signed cookie payload keeps validating for 30 days even though the
  // session option says 8h — i.e. the token would outlive the session it
  // claims to represent.
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
    updateAge: 0,
  },
  jwt: {
    maxAge: 8 * 60 * 60,
  },
  secret: process.env.NEXTAUTH_SECRET,
  useSecureCookies: process.env.NEXTAUTH_URL
    ? process.env.NEXTAUTH_URL.startsWith("https://")
    : process.env.NODE_ENV === "production",
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.sellerId = user.sellerId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id && token.role) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.sellerId = token.sellerId ?? null;
        // `iat` is stamped by next-auth when it signs the token. Carrying it
        // onto the session is what lets getSession() below tell a token
        // minted before a password change from one minted after it.
        session.user.tokenIssuedAt = typeof token.iat === "number" ? token.iat : undefined;
      }
      return session;
    },
  },
};

export async function getSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return session;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      withdrawnAt: true,
      role: true,
      passwordChangedAt: true,
      seller: { select: { status: true } },
      buyer: { select: { status: true } },
    },
  });
  if (!user || user.withdrawnAt) return null;

  // Sessions are JWTs, so changing the password does nothing to tokens that
  // are already out there — without this check, someone who suspects their
  // account is compromised could reset their password and the intruder would
  // stay signed in for the rest of the 8-hour session. That matters more here
  // than in most apps: account recovery is operator-mediated (see
  // passwordReset.ts), so a password reset is effectively the only self-serve
  // remedy a user has.
  //
  // Both sides are truncated to whole seconds before comparing. A JWT's `iat`
  // is already floor()ed to seconds, while passwordChangedAt keeps
  // milliseconds — comparing them raw would reject a token minted a few
  // hundred milliseconds *after* the change, i.e. the fresh login the user
  // performs immediately after resetting. Truncating both leaves a
  // sub-second window in which a token survives, which is the standard
  // trade-off and far safer than logging out the person who just recovered
  // their account.
  if (user.passwordChangedAt) {
    const changedAtSeconds = Math.floor(user.passwordChangedAt.getTime() / 1000);
    const issuedAtSeconds = session.user.tokenIssuedAt;
    if (issuedAtSeconds === undefined || issuedAtSeconds < changedAtSeconds) return null;
  }
  if (user.role === "SELLER" && user.seller?.status !== "ACTIVE") return null;
  if (user.role === "BUYER" && user.buyer?.status !== "ACTIVE") return null;

  return session;
}
