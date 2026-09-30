# 검증 기록

이 저장소에는 자동화 테스트가 없다. 돈이 오가는 경로는 실제 토스 테스트 결제와 PGlite 하네스로 검증했고, 그 결과와 재현 방법을 남긴다.

## 실물로 검증한 것 / 못 한 것

**실제 Toss 테스트 결제로 확인 완료**

- 6,000원 결제(3건 묶음) → 주문 3건 입금완료
- 1건만 취소 → `cancelAmount=1000`, `taxFreeAmount=0` 전송, 응답 `balanceAmount=5000`,
  화면 "부분환불 완료", 합계 5,000원
- 순차 취소 → 총 6,000원, 과다환불 0, 잔액 누락 0, 멱등키 주문별 분리
- **Toss는 잔액이 0이어도 `PARTIAL_CANCELED` 를 반환한다.** 응답 status를 그대로 쓰면
  전액 환불 후에도 "부분환불 완료"로 남는다 — 자체 판단(남은 활성 주문 0건)으로
  `CANCELED` 를 정하는 현재 설계가 맞다.
- **CSP**: 문서에 없는 도메인 3개가 실제 결제에서 나왔다 —
  `log.tosspayments.com`, `apigw-sandbox.tosspayments.com`,
  **`payment-gateway-sandbox.tosspayments.com`(결제창 iframe)**.
  enumerate 방식은 결제창을 막으므로 `*.tosspayments.com` / `*.toss.im` 와일드카드로 전환.
  재결제로 위반 0건 확인.
- 배포 DB(Render Postgres, 실제 고객 데이터 없이 데모 계정만 존재)에서 미결제 주문 2건이 로그인 시점에 자동 만료·재고 복원되는 것 확인.

**아직 실물 검증 못 한 것**

| | 왜 남았나 |
|---|---|
| **할부 결제 + 할부 부분취소** | 카드사 보안 프로그램이 자동화 브라우저 환경에서 안 잡힘. 평소 쓰는 Chrome에서 해야 함. 카드사가 할부 부분취소를 거부할 가능성이 있어 실물 확인 필요 |
| **Toss 웹훅 실제 페이로드** | 로컬이라 터널 필요(`npx ngrok http 3000`). **공식 문서에 페이로드 형식이 없어 방어적으로 파싱했고, 형식이 다르면 오류 없이 조용히 무시한다** — 실물로만 확인 가능 |
| 상품 이미지 업로드 | S3 미설정 |
| 라이브 키 환경의 CSP 도메인 | 계약 후 |

## 검증 하네스 재현법

로컬에 Postgres도 Docker도 없다(WSL 배포판 미설치). WASM Postgres로 우회했다.

```bash
npm install --no-save @electric-sql/pglite @electric-sql/pglite-socket
```

- `package.json` / `package-lock.json` 은 오염되지 않는다. `npm ci` 하면 사라진다.
- **임베디드 모드**: 마이그레이션 SQL을 직접 적용해 데이터 시나리오를 검증할 때.
  `prisma.$queryRaw` 만 쓰는 코드는 이 방식으로 실제 실행까지 가능하다.
- **소켓 모드**(`PGLiteSocketServer`, 임의 포트): Prisma가 TCP로 붙어
  `prisma migrate deploy` 와 앱 코드를 그대로 돌릴 수 있다.
  단 **동시 연결 1개만 허용**하므로 `?connection_limit=1` 필수이고,
  실행마다 서버를 새로 띄워야 한다(재사용 시 `prepared statement "s0" already exists`).
- 검증 스크립트는 `prisma/` 아래에 두면 앱 TS 프로젝트에서 제외되어 `tsc` 를 오염시키지 않는다.
- Toss 호출은 `globalThis.fetch` 를 감싸 가로채면 요청 본문·멱등키·응답을 그대로 관찰할 수 있다.

이 방식으로 잡은 것: 마이그레이션 백필 누락, 배송완료 주문이 취소 가능해지던 회귀,
팬텀 결제 표시, 부분환불 성공인데 "처리중"으로 뜨던 문제, 비밀번호 변경 후 세션 유지.
