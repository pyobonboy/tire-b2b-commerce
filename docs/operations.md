# 운영 가이드
소스 주석의 "README의 운영 가이드" 참조는 이 문서를 가리킨다.

실제 서비스를 운영하는 담당자를 위한 안내입니다. 소스 코드 주석에만 남아 있던 위험한 동작들을 정리했으니, 배포/장애 대응 전에 반드시 읽어 주세요.

## 1. 부분 취소 환불도 이제 자동입니다 (단, 실패 시 수동 처리로 폴백)

- 주문을 취소하면(`cancelOrder`, `src/lib/server/orders.ts`) 재고 복구와 주문 상태 변경은 즉시 일어나고, **이미 결제된 주문의 환불도 취소되는 주문마다 즉시 Toss에 자동 제출됩니다.** 세 개 주문이 걸린 결제에서 한 건만 취소해도, 그 즉시 그 주문 금액만큼 Toss 결제취소 API가 호출됩니다 — 다른 주문이 아직 남아 있어 이 결제가 "완전히 취소"된 것은 아니어도 마찬가지입니다.
  - 각 취소는 `cancelledOrderAmount`(`unitPrice * quantity + extraShipping`)를 그 주문의 `cancelAmount`로, `taxFreeAmount: 0`을 명시적으로 실어 Toss에 보냅니다(`settleOrderRefundViaToss`, `src/lib/server/orders.ts`). 판매 상품이 전부 과세 대상 타이어이므로 `taxFreeAmount: 0`이 맞다는 전제이며, 향후 비과세 상품을 취급하게 되면 이 전제와 부분취소 자체가 깨질 수 있다는 점이 코드 주석에 명시되어 있습니다.
  - 결제에 남은 마지막 주문을 취소할 때는 `cancelAmount`를 생략해 토스의 남은 잔액 전체를 취소한다. 그래야 콘솔에서 결제가 PARTIAL_CANCELED가 아닌 CANCELED가 되고, 앞선 부분취소 중 실패한 금액도 함께 회수된다. 토스는 보유 잔액 이상을 돌려주지 않으므로 과다환불은 없다(`../src/lib/server/orders.ts` 616~647행, 702행).
  - Toss 호출은 항상 DB 트랜잭션이 커밋된 **뒤에** 실행됩니다(`cancelOrder`의 트랜잭션 안에서 외부 HTTP 호출을 하지 않는 이유는 해당 함수 주석 참고). 재시도가 이중 환불로 이어지지 않도록 주문 ID 기반의 안정적인 `Idempotency-Key`(`order-cancel-refund:<orderId>`)를 사용합니다(Toss 문서 기준 최초 사용 후 15일간 유효).
  - **과다환불 가드**: 이 결제에 이미 기록된 `refundAmount`를 기준으로 로컬에서 남은 잔액을 계산해 `cancelAmount`가 그 이상으로 나가지 않게 클램프합니다. 다만 매 취소마다 Toss의 실시간 `balanceAmount`를 GET으로 미리 조회하지는 않습니다 — 매 취소 요청마다 왕복이 늘어나는 비용 대비, Toss `/cancel` API 자체가 실제 잔액을 넘는 `cancelAmount`는 거부해 주기 때문입니다(운영자가 콘솔에서 직접 취소해 로컬 기록과 실제 잔액이 어긋난 경우가 바로 이 케이스이며, 이는 아래 웹훅이 비동기로 따라잡습니다).
- **자동 환불이 실패하면 예전과 동일하게 수동 폴백으로 남습니다.** Toss 호출이 실패(네트워크 오류, 응답 실패 등)하면 `Payment.refundReason`이 `AUTO_REFUND_FAILED_NEEDS_MANUAL_TOSS_CANCEL`로 남고 `refundRequiredAt`은 절대 지워지지 않습니다. **이 결제에 한 번이라도 자동 환불 실패가 기록되면, 이후 그 결제에서 일어나는 다른 주문 취소가 성공하더라도 `refundRequiredAt`을 자동으로 지우지 않고 계속 수동 처리 대상으로 남겨둡니다** — 이 코드베이스는 어느 부분(원)이 실제로 환불됐는지 주문 단위로 추적하는 별도 원장이 없기 때문에, 한 번 실패가 생긴 결제는 안전하게 사람이 최종 확인할 때까지 계속 배너를 띄우는 쪽을 택했습니다.
- **관리자가 대기 중인 환불을 찾는 방법**: `/admin/orders` 페이지에서 `payment.refundRequiredAt`이 설정된 주문 카드 상단에 "환불 필요 · N원 (사유)" 배너가 표시됩니다. 이 배너가 보이는 주문은 자동 환불이 실패했거나(`refundReason: AUTO_REFUND_FAILED_NEEDS_MANUAL_TOSS_CANCEL`) 아직 Toss에서 실제로 환불되지 않은 상태입니다.
- **배너의 금액을 환불할 금액으로 그대로 쓰지 마십시오.** 배너는 `Payment.refundAmount`, 즉 **이 결제에서 취소된 주문 금액의 누계**를 보여줍니다. 그 중 일부는 이미 자동 환불에 성공했을 수 있으므로, 배너 금액과 "아직 환불되지 않은 금액"은 다릅니다.

  예: 100,000 / 50,000 / 30,000원짜리 주문 3건이 걸린 결제에서 첫 건의 자동 환불만 실패하고 나머지 두 건은 성공한 경우 — 배너는 `180,000원`을 표시하지만 실제로 덜 나간 돈은 `100,000원`뿐입니다. 이 코드베이스에는 주문별 환불 성공 여부를 기록하는 원장이 없어서 배너가 그 차이를 구분하지 못합니다.

- **관리자가 해야 할 일**: 배너가 보이면 [Toss Payments 관리자 콘솔](https://admin.tosspayments.com)에서 해당 결제 건을 열고, **콘솔에 표시된 잔액(`balanceAmount`)을 실제 환불 가능 금액의 기준으로 삼아** 수동 취소를 실행하십시오. 잔액을 넘는 금액은 Toss가 거부하므로 과다환불로 이어지지는 않지만, 배너 금액을 그대로 입력하면 요청이 거부되거나 실제 필요한 금액과 어긋납니다. 콘솔에서 환불을 완료해도 DB의 `refundRequiredAt` / `refundReason` / `refundAmount`는 자동으로 갱신되지 않으므로, 처리 완료 사실을 별도로 기록(예: 사내 스프레드시트, 티켓)해 두십시오.
- **결제 승인 왕복 중 취소된 주문(`ORDER_CANCELED_BEFORE_PAYMENT_CONFIRMED`)은 여전히 수동 처리입니다.** `toss/confirm`과 웹훅이 기록하는 이 사유는 이번 자동화 대상에 포함되지 않았습니다 — 해당 기록이 Payment를 DONE으로 확정하는 트랜잭션 "안"에서 발생해, Toss 호출을 트랜잭션 밖으로 옮기려면 그 라우트의 정교한 실패 복구 로직을 함께 재구성해야 하기 때문입니다. 이 사유가 보이는 결제도 위와 동일하게 관리자가 콘솔에서 수동으로 처리해야 합니다.

## 2. 결제 확인 실패 시 상태들

`POST /api/payments/toss/confirm`(`src/app/api/payments/toss/confirm/route.ts`)은 Toss에 결제 승인을 요청한 뒤 DB에 결과를 반영합니다. Toss 승인 자체는 성공했는데 그 뒤 DB 반영 과정에서 문제가 생기는 경우를 대비한 복구 로직이 있으며, 아래 상태들로 나타납니다.

- **HTTP 202 `PAYMENT_CONFIRM_PENDING_RECONCILIATION`**: Toss 결제는 정상적으로 승인(카드 청구 완료)되었지만, 그 결과를 DB에 반영하는 트랜잭션이 실패했고 자동 취소도 실패했거나 시도할 수 없었던 상태입니다. **돈은 실제로 빠져나갔는데 시스템에는 아직 완전히 반영되지 않았을 수 있는 상태**이므로, 구매자에게는 "잠시 후 확인해달라"는 안내만 나가고 재결제를 유도하지 않습니다. 운영자는 해당 `paymentId`/`tossOrderId`를 Toss 콘솔의 결제 내역과 대조하여 실제 승인 여부와 금액을 확인하고, 필요하면 주문 상태를 수동으로 맞춰야 합니다.
- **`failReason: ORDER_STATUS_SYNC_FAILED: ...`**: Toss 승인 결과(`paymentKey`, 승인 시각 등)는 DB에 성공적으로 기록됐지만, 그 뒤 주문들을 `입금완료`로 바꾸는 단계에서 오류가 났다는 뜻입니다. 즉 **결제 자체는 정상 기록되었고 결제 정보(Payment)는 신뢰할 수 있지만, 연결된 개별 주문(Order)의 상태가 아직 못 따라간 상태**입니다. 운영자는 해당 결제에 연결된 주문들을 확인해 `입금대기`로 남아있는 것이 있으면 수동으로 `입금완료`로 전환해야 합니다.
- **`failReason: DB_SAVE_FAILED_AUTO_CANCELED`**: DB에 승인 결과를 기록하는 것 자체가 실패해서(즉 이 결제를 "정상 승인"으로 신뢰할 근거가 DB에 없어서) 시스템이 안전 장치로 Toss에 **자동 취소(환불)를 요청해 성공**한 경우입니다. 구매자 입장에서는 결제가 실패로 보이고 카드 청구도 취소되므로, 별도 조치 없이 재시도를 안내하면 됩니다. 다만 실제로 취소가 잘 됐는지 Toss 콘솔에서 한 번 확인하는 것을 권장합니다.
- **`failReason: SUPERSEDED_BY_NEW_PAYMENT_PREPARE`**: (`toss/prepare` 경로에서 발생) 같은 주문들에 대해 새로운 결제 준비가 이루어지면서 이전 `Payment`가 대체되어 취소된 경우입니다. 구버전 결제창을 붙잡고 있던 브라우저 탭이 뒤늦게 승인 요청을 보내면 나타날 수 있는 정상적인 상태이며, 별도 조치가 필요 없습니다.
- **로그 `TOSS_PAYMENT_CONFIRM_UNRECOVERABLE`**: 가장 심각한 상태입니다. Toss 승인은 성공했고(카드 청구 완료) DB에는 그 사실을 전혀 기록하지 못했으며, 안전장치로 시도한 Toss 자동 취소마저 실패한 경우에만 남습니다. **돈은 실제로 빠져나갔는데 시스템 어디에도 그 결제 기록이 없는 상태**이므로, 이 로그 라인이 보이면 반드시 사람이 개입해야 합니다. 로그에 남은 `paymentId`, `tossOrderId`, `paymentKey`, `amount`를 근거로 Toss 콘솔에서 실제 승인 내역을 확인하고, DB에 `Payment`/`Order` 레코드를 수동으로 복구하거나(정상 결제로 인정하는 경우) Toss 콘솔에서 수동으로 취소·환불(결제를 무효화하는 경우) 처리해야 합니다.

## 3. Toss 웹훅 (`POST /api/payments/toss/webhook`)

`POST /api/payments/toss/confirm`이 실행되지 않고 끝나는 경우(구매자가 결제 직후 브라우저를 닫거나, 이탈하거나, 네트워크가 끊긴 경우)와 Toss 콘솔에서 직접 수행한 취소/환불이 이 DB에 반영되지 않는 문제를 보완하기 위해 웹훅 엔드포인트를 두었습니다. 다만 아래 특성을 반드시 이해하고 있어야 합니다.

- **Toss는 웹훅 요청에 서명을 하지 않습니다.** [공식 문서](https://docs.tosspayments.com/guides/webhook)에 서명 헤더나 HMAC 방식이 전혀 명시되어 있지 않으며, HTTPS 사용 권장 외의 보안 장치가 없습니다. 따라서 이 엔드포인트의 인증은 **등록된 URL에 심어둔 공유 비밀값(`TOSS_WEBHOOK_SECRET`, [deployment.md](deployment.md)의 "Toss 웹훅 설정" 참고)** 에만 의존합니다. `TOSS_WEBHOOK_SECRET`이 설정되어 있지 않으면 항상 503을 반환하고 아무 것도 처리하지 않습니다.
- **이 엔드포인트의 실제 안전장치는 URL 비밀값이 아니라, 요청 바디를 절대 신뢰하지 않는다는 점입니다.** 웹훅 바디는 오직 "어떤 결제를 다시 확인해야 하는지" 판단하는 용도로만 쓰이고, 실제 상태(결제 승인 여부, 금액, 취소 여부)는 항상 `TOSS_SECRET_KEY`로 인증한 서버-to-서버 호출로 Toss API에서 다시 조회합니다(`GET https://api.tosspayments.com/v1/payments/{paymentKey}` 또는 `GET https://api.tosspayments.com/v1/payments/orders/{orderId}` — 둘 다 Toss API 레퍼런스로 확인됨). 즉 URL 비밀값이 유출되어 위조 요청이 들어오더라도, 그 요청이 실제로 존재하지 않거나 이 앱이 모르는 결제를 가리키면 아무 일도 일어나지 않습니다.
- **Toss가 공개한 발신 IP 목록**(https://docs.tosspayments.com/reference/using-api/security): `13.124.18.147, 13.124.108.35, 3.36.173.151, 3.38.81.32, 115.92.221.121, 115.92.221.122, 115.92.221.123, 115.92.221.125, 115.92.221.126, 115.92.221.127`. 이 목록은 Toss 쪽에서 계속 바뀔 수 있다고 문서에 명시되어 있고, 이 앱이 Render 프록시 뒤에 있어 관측되는 IP가 실제로 이 목록과 일치하는지 이 저장소 안에서 검증할 방법이 없으므로, **차단 조건이 아니라 모니터링 용도로만** 사용합니다. `TOSS_WEBHOOK_ALLOWED_IPS` 환경 변수(콤마 구분)에 위 목록을 넣어두면, 목록에 없는 IP로 들어온 요청은 거부하지 않고 경고 로그(`TOSS_WEBHOOK_IP_NOT_IN_ALLOWLIST`)만 남깁니다.
- **재시도 정책**(Toss 문서 기준): Toss는 10초 이내 200 응답을 기대하며, 그렇지 않으면 최대 7회, 1·4·16·64·256·1024·4096분 간격(총 약 3일 19시간)으로 재시도한 뒤 포기하고 이메일로 실패를 통지합니다. 이 앱은 정상 처리했거나 의도적으로 무시한 경우 200을, 재시도가 실제로 도움이 될 수 있는 경우(Toss 조회 API 실패, DB 오류 등)에만 5xx를 반환합니다.
- **Toss의 결제 상태(`READY`/`IN_PROGRESS`/`WAITING_FOR_DEPOSIT`/`DONE`/`CANCELED`/`PARTIAL_CANCELED`/`ABORTED`/`EXPIRED`)는 이 앱의 `PaymentStatus`(`READY`/`DONE`/`FAILED`/`CANCELED`)보다 더 세분화되어 있습니다.** 특히 `PARTIAL_CANCELED`(부분 취소)는 로컬 `status`를 절대 `CANCELED`로 바꾸지 않습니다 — `status === "CANCELED" && refundRequiredAt === null`을 "환불완료"로 표시하는 입출금 화면(`settlement.ts`)에서, 부분 취소된 결제가 전액 환불된 것처럼 보이는 것을 막기 위함입니다. 대신 `refundRequiredAt`/`refundReason`(`PARTIAL_CANCEL_DETECTED_VIA_TOSS_WEBHOOK_NEEDS_MANUAL_ORDER_MATCH`)/`refundAmount`만 기록해, 어느 주문이 취소된 것인지 관리자가 맞춰 처리하도록 남겨둡니다. 앱 안에서 주문을 취소할 때의 부분 환불은 1번 항목대로 자동 제출됩니다.
- 이 웹훅이 있어도 **위 2번 항목의 수동 개입 상태들은 그대로 유지됩니다.** 결제 관련 이상(구매자 문의 등)이 있으면 이 앱의 상태만 믿지 말고 항상 Toss 콘솔의 실제 결제 내역을 함께 확인해야 합니다.

## 4. 레이트리밋이 인메모리라는 점

`src/lib/server/rateLimit.ts`의 로그인/회원가입 요청 제한(`InMemorySlidingWindowLimiter`)은 프로세스 메모리에만 상태를 저장합니다.

- **재배포/재시작마다 초기화**됩니다. 즉 배포 직후에는 그 이전까지 쌓인 실패 횟수가 전부 사라집니다.
- **인스턴스별로 독립적**입니다. 앱이 여러 인스턴스로 뜨는 환경(예: Render 오토스케일)에서는 공격자가 인스턴스 수만큼의 배수로 시도 횟수를 확보하게 됩니다. 현재는 외부 의존성(Redis 등)을 추가하지 않기 위한 의도적인 트레이드오프이며, 인스턴스를 여러 개로 늘릴 계획이 있다면 공유 저장소 기반으로 교체해야 합니다.

## 5. 배포 주의사항

- `render.yaml`의 `buildCommand`는 `npx prisma migrate deploy`를 빌드 과정 중에 실행합니다. **즉 마이그레이션이 먼저 적용되고, 그 다음에 애플리케이션이 빌드됩니다.** 만약 마이그레이션 적용 이후 빌드(`npm run build`)가 실패하면, **DB 스키마는 이미 새 버전으로 넘어갔는데 실제 배포된 애플리케이션 코드는 이전 버전인 상태**가 됩니다. 빌드 실패 시 이 사실을 인지하고, 스키마와 코드 버전이 어긋난 채로 서비스가 유지되고 있지 않은지(이전 배포가 여전히 서빙 중이라면 이전 코드가 새 스키마에 대해 정상 동작하는지) 반드시 확인해야 합니다.
- 현재 `render.yaml`의 DB(`tire-b2b-db`)와 웹 서비스(`tire-b2b-app`) 모두 Render의 **`free` 플랜**으로 설정되어 있습니다.
  - 무료 PostgreSQL은 일정 기간 후 만료(삭제)됩니다.
  - 무료 웹 서비스는 트래픽이 없으면 슬립 상태가 되어 첫 요청에 콜드스타트 지연이 발생합니다.
  - 실제 트래픽을 받기 전에 반드시 유료 플랜으로 업그레이드해야 합니다. **이 문서는 안내만 할 뿐, `render.yaml`의 플랜/커넥션 문자열 변경은 이 저장소를 소유한 담당자가 직접 결정하고 수정해야 하는 사안입니다** (외부 커넥션 문자열을 쓰는 현재 설정도 이전 커밋에서 의도적으로 선택된 것입니다).

## 6. Prisma 커넥션 풀 설정이 없다는 점

`render.yaml`의 `DATABASE_URL`은 Render DB의 `externalConnectionString`을 그대로 사용하며, 여기에 `?connection_limit=N` 같은 Prisma 커넥션 풀 파라미터가 붙어 있지 않습니다.

- **기본 동작**: Prisma는 `connection_limit`을 명시하지 않으면 `num_physical_cpus * 2 + 1`을 기본값으로 사용합니다([Prisma 공식 문서](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections#connection-pool-size)). 이 값은 이 앱을 서빙하는 Render 웹 서비스 인스턴스의 CPU 코어 수를 기준으로 계산되는 것이지, Postgres 쪽이 실제로 감당할 수 있는 동시 연결 수와는 무관합니다.
- **왜 문제가 되는가**: Render의 저가/무료 Postgres 플랜은 `max_connections`가 작습니다. 인스턴스를 여러 개로 늘리거나(오토스케일), CPU 코어가 많은 인스턴스 타입으로 올리면 Prisma 기본값이 그만큼 커져서, 애플리케이션 쪽 커넥션 풀 총합이 DB의 `max_connections`를 넘어설 수 있습니다. 이 경우 DB가 새 연결을 거부하기 시작하고, 결제·주문처럼 실시간으로 DB를 쓰는 요청이 무작위로 실패합니다.
- **지금 값을 정하지 않은 이유**: 적절한 `connection_limit`은 (a) 최종적으로 선택할 Postgres 플랜의 `max_connections`, (b) 웹 서비스 인스턴스 개수, (c) 그 외 이 DB에 붙는 다른 클라이언트(예: Prisma Studio, 배치 스크립트) 수에 따라 달라집니다. 이 저장소는 아직 유료 플랜 확정 전이므로(위 5번 항목 참고), 근거 없이 숫자를 하나 박아두는 대신 이 문서에만 절차를 남겨 둡니다.
- **플랜이 정해지면 할 일**: `render.yaml`의 `DATABASE_URL` 값(현재 `fromDatabase.property: externalConnectionString`으로 주입됨)에 커넥션 풀 파라미터를 추가합니다. Prisma는 연결 문자열의 쿼리 파라미터로 이를 읽으므로, 예를 들어 DB의 `max_connections`가 20이고 웹 서비스가 항상 인스턴스 1개로만 뜬다면 다른 클라이언트 여유분을 남기고 `connection_limit=10~15` 사이로 시작해 실제 부하를 보며 조정하는 식입니다. Render 대시보드에서 해당 Postgres 인스턴스의 `max_connections`를 먼저 확인한 뒤 결정하십시오.

## 7. 비밀번호 재설정/알림 기능이 아직 없다는 점

로그인 화면의 "아이디 찾기"/"비밀번호 재설정" 버튼은 현재 아무 동작도 하지 않습니다(placeholder). 즉:

- 사용자가 비밀번호를 잊어버리면 이메일/SMS를 통한 자동 재설정 절차가 없습니다.
- 계정 복구는 현재 **운영자가 DB를 직접 조작하는 수동 작업**으로만 가능합니다(예: Render Shell에서 스크립트를 실행하거나 Prisma Studio로 비밀번호 해시를 직접 갱신). 이 작업을 수행할 담당자와 절차를 미리 정해 두는 것을 권장합니다.
- 사용자에게 이 기능이 아직 없다는 점을 고객센터/안내 문구 등으로 명확히 알려서, 문의가 들어왔을 때 수동으로 대응할 수 있도록 준비해야 합니다.
