"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PackageSearch } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import LoadingState from "@/components/LoadingState";
import { useDialogs } from "@/components/ui/DialogProvider";
import { useCart } from "@/lib/cart";
import { OrderRequestError, useOrders } from "@/lib/orders";
import type { ShippingAddressView } from "@/lib/shippingAddress-types";
import type { CartItem } from "@/lib/types";

interface ShippingGroupSummary {
  sellerCode: string;
  subtotal: number;
  shippingFee: number;
}

const inputClass =
  "h-11 px-3 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand";

function groupBySeller(items: CartItem[]) {
  const map = new Map<string, CartItem[]>();
  for (const item of items) {
    const list = map.get(item.sellerCode) ?? [];
    list.push(item);
    map.set(item.sellerCode, list);
  }
  return Array.from(map.entries()).map(([sellerCode, groupItems]) => ({ sellerCode, items: groupItems }));
}

function CheckoutContent() {
  const { items, loading: cartLoading, clear } = useCart();
  const { addOrders } = useOrders();
  const router = useRouter();
  const { alert: alertDialog } = useDialogs();

  const [addresses, setAddresses] = useState<ShippingAddressView[]>([]);
  const [feesBySellerCode, setFeesBySellerCode] = useState<Map<string, ShippingGroupSummary>>(new Map());
  const [loadingSupport, setLoadingSupport] = useState(true);

  const [selectedAddressId, setSelectedAddressId] = useState<string | "new">("new");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [saveNewAddress, setSaveNewAddress] = useState(false);
  const [newAddressLabel, setNewAddressLabel] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadSupportData() {
      const [addressesResponse, summaryResponse] = await Promise.all([
        fetch("/api/mypage/addresses", { cache: "no-store" }),
        fetch("/api/checkout/summary", { cache: "no-store" }),
      ]);
      if (!active) return;

      if (addressesResponse.ok) {
        const body = (await addressesResponse.json()) as { addresses: ShippingAddressView[] };
        setAddresses(body.addresses);
        const defaultAddress = body.addresses.find((a) => a.isDefault) ?? body.addresses[0];
        if (defaultAddress) {
          setSelectedAddressId(defaultAddress.id);
          setRecipientName(defaultAddress.recipientName);
          setRecipientPhone(defaultAddress.recipientPhone);
          setPostalCode(defaultAddress.postalCode);
          setAddress(defaultAddress.address);
          setAddressDetail(defaultAddress.addressDetail ?? "");
        }
      }

      if (summaryResponse.ok) {
        const body = (await summaryResponse.json()) as { groups: ShippingGroupSummary[] };
        setFeesBySellerCode(new Map(body.groups.map((group) => [group.sellerCode, group])));
      }
    }

    loadSupportData()
      .catch(() => {
        if (active) setError("배송지/배송비 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.");
      })
      .finally(() => {
        if (active) setLoadingSupport(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const groups = useMemo(() => groupBySeller(items), [items]);
  const goodsTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity + item.extraShipping, 0),
    [items],
  );
  const shippingTotal = useMemo(
    () => groups.reduce((sum, group) => sum + (feesBySellerCode.get(group.sellerCode)?.shippingFee ?? 0), 0),
    [groups, feesBySellerCode],
  );
  const grandTotal = goodsTotal + shippingTotal;

  function selectSavedAddress(savedAddress: ShippingAddressView) {
    setSelectedAddressId(savedAddress.id);
    setRecipientName(savedAddress.recipientName);
    setRecipientPhone(savedAddress.recipientPhone);
    setPostalCode(savedAddress.postalCode);
    setAddress(savedAddress.address);
    setAddressDetail(savedAddress.addressDetail ?? "");
  }

  function selectNewAddress() {
    setSelectedAddressId("new");
    setRecipientName("");
    setRecipientPhone("");
    setPostalCode("");
    setAddress("");
    setAddressDetail("");
    setSaveNewAddress(false);
    setNewAddressLabel("");
  }

  async function handleSubmit() {
    setError("");

    if (!recipientName.trim() || !recipientPhone.trim() || !postalCode.trim() || !address.trim()) {
      setError("받는사람, 연락처, 우편번호, 주소를 모두 입력해 주세요.");
      return;
    }
    if (selectedAddressId === "new" && saveNewAddress && !newAddressLabel.trim()) {
      setError("배송지를 저장하려면 배송지 이름을 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    try {
      await addOrders(items, {
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        postalCode: postalCode.trim(),
        address: address.trim(),
        addressDetail: addressDetail.trim() || null,
        deliveryNote: deliveryNote.trim() || null,
      });

      try {
        await clear();
      } catch {
        await alertDialog({
          title: "주문은 완료되었지만 장바구니를 비우지 못했습니다. 주문내역을 확인해 주세요.",
        });
      }

      if (selectedAddressId === "new" && saveNewAddress) {
        try {
          await fetch("/api/mypage/addresses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              label: newAddressLabel.trim(),
              recipientName: recipientName.trim(),
              recipientPhone: recipientPhone.trim(),
              postalCode: postalCode.trim(),
              address: address.trim(),
              addressDetail: addressDetail.trim() || null,
            }),
          });
        } catch {
          await alertDialog({ title: "주문은 완료되었지만 배송지를 저장하지 못했습니다." });
        }
      }

      router.push("/mypage/orders?justOrdered=1");
    } catch (submitError) {
      const code = submitError instanceof OrderRequestError ? submitError.code : "ORDER_REQUEST_FAILED";
      setError(
        code === "ORDER_STOCK_INSUFFICIENT"
          ? "재고가 부족한 상품이 있어 주문할 수 없습니다."
          : code === "ORDER_ITEM_NOT_FOUND"
            ? "판매가 종료되었거나 찾을 수 없는 상품이 포함되어 있습니다."
            : code === "ORDER_QUANTITY_TOO_SMALL"
              ? "최소 주문수량보다 적게 담긴 상품이 있습니다."
              : "주문 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (cartLoading || loadingSupport) return <LoadingState />;

  // Guard (Task 3): an empty cart has nothing to check out.
  if (items.length === 0) {
    return (
      <div className="px-4 py-5">
        <h1 className="text-xl font-extrabold mb-5">주문서 작성</h1>
        <div className="card text-center py-16">
          <PackageSearch size={32} className="mx-auto mb-3 text-border" strokeWidth={1.5} />
          <p className="text-muted mb-4">장바구니에 담은 상품이 없습니다.</p>
          <Link href="/products" className="text-brand font-semibold">
            타이어 검색하러 가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 max-w-4xl">
      <h1 className="text-xl font-extrabold mb-1">주문서 작성</h1>
      <p className="text-sm text-muted mb-5">주문 상품과 배송지를 확인한 뒤 결제를 진행해 주세요.</p>

      {error && <p className="mb-4 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      <section className="card p-5 mb-5">
        <h2 className="font-bold mb-4">주문 상품</h2>
        <div className="flex flex-col gap-5">
          {groups.map((group) => {
            const subtotal = group.items.reduce((sum, item) => sum + item.price * item.quantity + item.extraShipping, 0);
            const fee = feesBySellerCode.get(group.sellerCode)?.shippingFee ?? 0;
            return (
              <div key={group.sellerCode} className="border border-border rounded-xl p-4">
                <p className="text-sm font-semibold text-brand mb-3">판매점 {group.sellerCode}</p>
                <div className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {item.manufacturer} {item.model}
                        </p>
                        <p className="text-xs text-muted">
                          {item.width}/{item.ratio}R{item.rim} · DOT {item.dot} · {item.quantity}개
                        </p>
                      </div>
                      <span className="tabular-nums shrink-0">
                        {(item.price * item.quantity).toLocaleString()}원
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-xs text-muted mt-3 pt-3 border-t border-border">
                  <span>상품금액 {subtotal.toLocaleString()}원</span>
                  <span>배송비 {fee.toLocaleString()}원</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card p-5 mb-5">
        <h2 className="font-bold mb-4">배송지</h2>

        {addresses.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {addresses.map((savedAddress) => (
              <label
                key={savedAddress.id}
                className={`flex items-start gap-3 rounded-lg border p-3 text-sm cursor-pointer ${
                  selectedAddressId === savedAddress.id ? "border-brand bg-brand/5" : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name="shipping-address"
                  className="mt-1"
                  checked={selectedAddressId === savedAddress.id}
                  onChange={() => selectSavedAddress(savedAddress)}
                />
                <span>
                  <span className="font-semibold">{savedAddress.label}</span>
                  {savedAddress.isDefault && <span className="ml-1.5 text-xs text-brand">(기본)</span>}
                  <br />
                  <span className="text-muted">
                    {savedAddress.recipientName} · {savedAddress.recipientPhone}
                  </span>
                  <br />
                  <span className="text-muted">
                    [{savedAddress.postalCode}] {savedAddress.address} {savedAddress.addressDetail ?? ""}
                  </span>
                </span>
              </label>
            ))}
            <label
              className={`flex items-center gap-3 rounded-lg border p-3 text-sm cursor-pointer ${
                selectedAddressId === "new" ? "border-brand bg-brand/5" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="shipping-address"
                checked={selectedAddressId === "new"}
                onChange={selectNewAddress}
              />
              <span className="font-semibold">새 배송지 입력</span>
            </label>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-foreground/70">받는사람</span>
            <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className={inputClass} required />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-foreground/70">연락처</span>
            <input value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} className={inputClass} required />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-foreground/70">우편번호</span>
            <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className={inputClass} required />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-foreground/70">주소</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} required />
          </label>
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="text-xs font-medium text-foreground/70">상세주소</span>
            <input value={addressDetail} onChange={(e) => setAddressDetail(e.target.value)} placeholder="선택 입력" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="text-xs font-medium text-foreground/70">배송 요청사항</span>
            <input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} placeholder="선택 입력" className={inputClass} />
          </label>
        </div>

        {selectedAddressId === "new" && (
          <div className="mt-4 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={saveNewAddress}
                onChange={(e) => setSaveNewAddress(e.target.checked)}
                className="h-4 w-4"
              />
              이 배송지를 배송지 목록에 저장
            </label>
            {saveNewAddress && (
              <input
                value={newAddressLabel}
                onChange={(e) => setNewAddressLabel(e.target.value)}
                placeholder="배송지 이름 (예: 본사, 2호점 창고)"
                className={`${inputClass} max-w-xs`}
              />
            )}
          </div>
        )}
      </section>

      <section className="card p-5 mb-5">
        <h2 className="font-bold mb-4">결제 금액</h2>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">상품금액</span>
            <span className="tabular-nums">{goodsTotal.toLocaleString()}원</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">배송비</span>
            <span className="tabular-nums">{shippingTotal.toLocaleString()}원</span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
            <span className="font-semibold">합계</span>
            <span className="text-lg font-extrabold text-brand tabular-nums">{grandTotal.toLocaleString()}원</span>
          </div>
        </div>
      </section>

      <div className="flex justify-end pb-8">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="btn-primary h-12 px-8"
        >
          {submitting ? "주문 처리 중..." : "주문하기"}
        </button>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <RequireAuth>
      <CheckoutContent />
    </RequireAuth>
  );
}
