# 배포와 설정

## Toss Payments test setup

Online payment uses the account-specific Toss Payments API individual integration keys. Add the following values to `.env.local` for local testing; never commit the real secret key.

```env
TOSS_CLIENT_KEY=test_ck_your_account_client_key
TOSS_SECRET_KEY=test_sk_your_account_secret_key
```

`TOSS_CLIENT_KEY` is read on the server by the payment preparation API and returned to the browser for SDK initialization, so it does not need a `NEXT_PUBLIC_` prefix. `TOSS_SECRET_KEY` is used only by the server-side payment confirmation API.

The current Toss Payments SDK v2 distinguishes API individual integration keys (`test_ck_`/`test_sk_`) from payment-widget integration keys (`test_gck_`/`test_gsk_`). This implementation uses the v2 `payment().requestPayment()` flow because the account keys provided for this project are API individual integration keys; it does not use the public documentation test keys.

To test locally, start the app with `npm run dev`, sign in as a buyer, create an order, and select `결제하기` from the order list. Use the test keys from your own Toss Payments account. The payment success redirect confirms the payment on the server and changes linked orders to `입금완료`; the failure redirect returns to the order list so the payment can be retried.

### Toss 웹훅 설정

`POST /api/payments/toss/webhook`은 Toss가 결제 상태 변경(`PAYMENT_STATUS_CHANGED`, `CANCEL_STATUS_CHANGED`)을 알려오는 엔드포인트입니다. Toss는 웹훅 요청에 서명을 하지 않으므로([공식 문서](https://docs.tosspayments.com/guides/webhook) 확인), 인증은 등록된 URL에 심어둔 공유 비밀값(`TOSS_WEBHOOK_SECRET`)에만 의존합니다.

```env
TOSS_WEBHOOK_SECRET=<임의의 긴 무작위 문자열>
```

1. 위 값을 `.env.local`(로컬) 또는 Render 환경 변수(운영)에 설정합니다.
2. [Toss Payments 개발자센터](https://developers.tosspayments.com)의 웹훅 등록 화면에서, 이 앱의 엔드포인트 URL을 **쿼리 파라미터에 그 값을 포함한 형태**로 등록합니다. 예: `https://<앱 도메인>/api/payments/toss/webhook?secret=<위에서 설정한 값>`.
3. `TOSS_WEBHOOK_SECRET`이 설정되어 있지 않으면 이 엔드포인트는 항상 503을 반환하고 아무 것도 처리하지 않습니다(안전한 기본값).
4. 비밀값을 교체하려면 환경 변수를 바꾸는 것만으로는 부족합니다 — 개발자센터에 등록된 URL 자체를 새 값으로 다시 등록해야 합니다.

자세한 보안 모델(서명이 없는 이유, 그래서 요청 바디를 신뢰하지 않고 항상 Toss API로 재조회하는 이유)은 [운영 가이드](operations.md) 3번 항목을 참고하세요.

## Database seeding

Database seeding is not run automatically during Render builds. To run it manually, open the **Shell** tab in the Render dashboard (or run locally) with:

```bash
npm run db:seed
```

The seed script has two independent parts:

- **Demo accounts** (`admin`/`buyer`/`seller` login IDs, matching this README) — only created when `SEED_DEMO_USERS=true` is set, and refused outright whenever `NODE_ENV=production`, regardless of that flag. This is intentional: those login IDs are public, so this must never run unattended against a real database. Set `SEED_ADMIN_PASSWORD`, `SEED_DEMO_BUYER_PASSWORD`, and `SEED_DEMO_SELLER_PASSWORD` to choose their passwords; outside production, any left unset fall back to a hardcoded local-dev default.
- **Tire catalog** (products + listings from `src/lib/mockData.ts`) — runs every time, and always attaches to the canonical `seller` account. If that account doesn't exist yet (e.g. a catalog-only run against a fresh database), the script fails with an explicit error instead of guessing — run once with `SEED_DEMO_USERS=true` first (outside production) to create it, or point at a database that already has it.

`SEED_RESET_NON_CANONICAL=true` additionally deletes every non-demo user (and their orders/cart/wishlist); also refused when `NODE_ENV=production`.

## 상품 이미지 업로드 설정

상품 이미지는 S3 호환 오브젝트 스토리지에 presigned URL로 업로드합니다. Render와 로컬 환경에 다음 변수를 설정해야 합니다.

```env
S3_BUCKET=<bucket-name>
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<access-key>
S3_SECRET_ACCESS_KEY=<secret-key>
S3_PUBLIC_BASE_URL=https://cdn.example.com
S3_FORCE_PATH_STYLE=false
```

`S3_PUBLIC_BASE_URL`은 업로드된 파일을 브라우저가 읽을 수 있는 공개 도메인(Cloudflare R2 커스텀 도메인 또는 S3/CloudFront 주소)이어야 합니다. 업로드는 presigned **PUT**으로 이루어지며(R2는 presigned POST를 지원하지 않습니다 — [Cloudflare 문서](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)에 "POST ... is not currently supported"로 명시), 서명에 Content-Length가 묶여 있어 선언한 파일 크기와 실제 업로드 크기가 정확히 일치해야 합니다. 버킷 CORS에는 앱 도메인의 `PUT` 요청과 `Content-Type` 헤더를 허용해야 합니다. 배포 후 실제 판매자/관리자 계정으로 이미지 1건을 업로드해 정상 저장·표시되는지 확인하세요.

## Vercel + Supabase 배포

이 앱은 Vercel(서버리스) + Supabase Postgres 배포를 지원합니다. Render 배포는 당분간 병행되며, 이 섹션의 변경은 두 플랫폼 모두에서 동작합니다.

Supabase 프로젝트는 리전을 반드시 **Seoul (ap-northeast-2)** 로 생성하세요.

### 환경 변수 (Vercel 대시보드)

| 변수 | 값 |
| --- | --- |
| `DATABASE_URL` | Supabase 대시보드 Connect 화면의 **Transaction pooler** 주소(포트 6543)에 `?pgbouncer=true&connection_limit=1` 쿼리를 붙인 것. 서버리스는 요청마다 인스턴스가 새로 커넥션을 여므로 풀러 없이는 커넥션이 금방 고갈되고, `pgbouncer=true`는 Prisma가 트랜잭션 모드 풀러와 호환되도록 prepared statement를 끄는 스위치입니다. |
| `DIRECT_URL` | 같은 화면의 **Direct connection** 주소(포트 5432). 마이그레이션 전용입니다. |
| `NEXTAUTH_SECRET` | 기존 값을 재사용하거나 신규 발급 |
| `NEXTAUTH_URL` | `<배포 도메인>` (Vercel이 부여한 도메인 또는 커스텀 도메인) |
| `TOSS_CLIENT_KEY` / `TOSS_SECRET_KEY` / `TOSS_WEBHOOK_SECRET` | 기존과 동일 |
| `S3_BUCKET` / `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_PUBLIC_BASE_URL` | 기존과 동일 |
| `S3_REGION` | `auto` |
| `S3_FORCE_PATH_STYLE` | `false` |
| `TRUSTED_PROXY_HOPS` | `1` (Vercel 프록시도 1단이므로 Render와 동일) |

### `vercel-build` 스크립트

`package.json`의 `vercel-build`(`prisma generate && prisma migrate deploy && next build`)는 Vercel이 `build` 대신 자동으로 실행합니다. `prisma migrate deploy`는 `schema.prisma`의 `directUrl` 설정 덕분에 빌드 중 `DIRECT_URL`(직결 주소)로 적용되고, 런타임 쿼리는 계속 `DATABASE_URL`(풀러 주소)로 나갑니다.

### 도메인이 바뀌면 해야 하는 것

1. [Toss Payments 개발자센터](https://developers.tosspayments.com)에서 웹훅 URL을 새 도메인으로 재등록: `https://<새 도메인>/api/payments/toss/webhook?secret=<TOSS_WEBHOOK_SECRET>`
2. R2 버킷 CORS의 `AllowedOrigins`에 새 도메인 추가
3. `NEXTAUTH_URL` 갱신

### 알려진 한계

- `src/lib/server/rateLimit.ts`의 인메모리 레이트리미터는 서버리스에서 인스턴스별로 따로 적용되어 효과가 약해집니다(해당 파일의 기존 LIMITATION 주석 참고). 정식 오픈 전에는 공유 저장소(예: Upstash Redis) 기반으로 교체하는 것을 권장합니다.
- Vercel Hobby 플랜은 비상업용 약관이므로, 상용 오픈 시 Pro 플랜으로 전환해야 합니다.
