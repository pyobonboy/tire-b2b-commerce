"use client";

import { useEffect, useState, type FormEvent } from "react";
import { MapPin, Pencil, Star, Trash2 } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import LoadingState from "@/components/LoadingState";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { ShippingAddressView } from "@/lib/shippingAddress-types";

interface AddressForm {
  label: string;
  recipientName: string;
  recipientPhone: string;
  postalCode: string;
  address: string;
  addressDetail: string;
  isDefault: boolean;
}

const emptyForm: AddressForm = {
  label: "",
  recipientName: "",
  recipientPhone: "",
  postalCode: "",
  address: "",
  addressDetail: "",
  isDefault: false,
};

function formFromAddress(address: ShippingAddressView): AddressForm {
  return {
    label: address.label,
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    postalCode: address.postalCode,
    address: address.address,
    addressDetail: address.addressDetail ?? "",
    isDefault: address.isDefault,
  };
}

const inputClass =
  "h-11 px-3 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-foreground/70">
        {label}
      </label>
      {children}
    </div>
  );
}

async function readAddressError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error === "VALIDATION_ERROR") return "입력한 정보를 확인해 주세요.";
    if (body.error === "ADDRESS_NOT_FOUND") return "이미 삭제된 배송지입니다.";
    if (body.error === "FORBIDDEN") return "구매회원만 이용할 수 있는 기능입니다.";
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

function AddressesContent() {
  const { confirm: confirmDialog } = useDialogs();
  const [addresses, setAddresses] = useState<ShippingAddressView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadAddresses() {
    const response = await fetch("/api/mypage/addresses", { cache: "no-store" });
    if (!response.ok) throw new Error(await readAddressError(response, "배송지 목록을 불러오지 못했습니다."));
    const body = (await response.json()) as { addresses: ShippingAddressView[] };
    setAddresses(body.addresses);
  }

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial API hydration is intentionally applied after mount
    loadAddresses()
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function updateField<K extends keyof AddressForm>(key: K, value: AddressForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openNewForm() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
    setError("");
  }

  function openEditForm(address: ShippingAddressView) {
    setEditingId(address.id);
    setForm(formFromAddress(address));
    setFormOpen(true);
    setError("");
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const url = editingId ? `/api/mypage/addresses/${editingId}` : "/api/mypage/addresses";
      const payload = editingId
        ? {
            label: form.label,
            recipientName: form.recipientName,
            recipientPhone: form.recipientPhone,
            postalCode: form.postalCode,
            address: form.address,
            addressDetail: form.addressDetail,
          }
        : { ...form };
      const response = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readAddressError(response, "배송지를 저장하지 못했습니다."));
      await loadAddresses();
      closeForm();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "배송지를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(id: string) {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/mypage/addresses/${id}/default`, { method: "POST" });
      if (!response.ok) throw new Error(await readAddressError(response, "기본 배송지로 설정하지 못했습니다."));
      await loadAddresses();
    } catch (setDefaultError) {
      setError(setDefaultError instanceof Error ? setDefaultError.message : "기본 배송지로 설정하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirmDialog({ title: "이 배송지를 삭제하시겠습니까?", destructive: true }))) return;
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/mypage/addresses/${id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        throw new Error(await readAddressError(response, "배송지를 삭제하지 못했습니다."));
      }
      if (editingId === id) closeForm();
      await loadAddresses();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "배송지를 삭제하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="px-4 py-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-xl font-extrabold">배송지 관리</h1>
        {!formOpen && (
          <button type="button" onClick={openNewForm} className="btn-primary h-10 px-4 text-sm">
            새 배송지 추가
          </button>
        )}
      </div>
      <p className="text-sm text-muted mb-5">
        지점이 여럿인 경우 배송지를 미리 등록해 두면 주문서 작성 시 바로 선택할 수 있습니다.
      </p>

      {error && <p className="mb-4 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      {formOpen && (
        <form onSubmit={handleSubmit} className="card p-5 mb-5 flex flex-col gap-4">
          <h2 className="font-bold">{editingId ? "배송지 수정" : "새 배송지"}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="배송지 이름" htmlFor="a-label">
              <input
                id="a-label"
                value={form.label}
                onChange={(event) => updateField("label", event.target.value)}
                placeholder="예: 본사, 2호점 창고"
                className={inputClass}
                required
                maxLength={40}
              />
            </Field>
            <Field label="받는사람" htmlFor="a-recipient">
              <input
                id="a-recipient"
                value={form.recipientName}
                onChange={(event) => updateField("recipientName", event.target.value)}
                className={inputClass}
                required
                maxLength={60}
              />
            </Field>
            <Field label="연락처" htmlFor="a-phone">
              <input
                id="a-phone"
                value={form.recipientPhone}
                onChange={(event) => updateField("recipientPhone", event.target.value)}
                className={inputClass}
                required
                maxLength={30}
              />
            </Field>
            <Field label="우편번호" htmlFor="a-postal">
              <input
                id="a-postal"
                value={form.postalCode}
                onChange={(event) => updateField("postalCode", event.target.value)}
                className={inputClass}
                required
                maxLength={20}
              />
            </Field>
            <Field label="주소" htmlFor="a-address">
              <input
                id="a-address"
                value={form.address}
                onChange={(event) => updateField("address", event.target.value)}
                className={inputClass}
                required
                maxLength={300}
              />
            </Field>
            <Field label="상세주소" htmlFor="a-address-detail">
              <input
                id="a-address-detail"
                value={form.addressDetail}
                onChange={(event) => updateField("addressDetail", event.target.value)}
                placeholder="선택 입력"
                className={inputClass}
                maxLength={200}
              />
            </Field>
          </div>
          {!editingId && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(event) => updateField("isDefault", event.target.checked)}
                className="h-4 w-4"
              />
              기본 배송지로 저장
            </label>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary h-11 px-6">
              {saving ? "저장 중..." : "저장"}
            </button>
            <button type="button" onClick={closeForm} className="btn-outline h-11 px-6">
              취소
            </button>
          </div>
        </form>
      )}

      {addresses.length === 0 ? (
        <div className="card text-center py-16 text-muted">
          <MapPin size={32} className="mx-auto mb-3 text-border" strokeWidth={1.5} />
          등록된 배송지가 없습니다.
        </div>
      ) : (
        <>
          <div className="hidden lg:block overflow-x-auto card">
            <table className="min-w-[880px] w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-3 px-4 font-medium">배송지 이름</th>
                  <th className="py-3 px-4 font-medium">받는사람 / 연락처</th>
                  <th className="py-3 px-4 font-medium">주소</th>
                  <th className="py-3 px-4 font-medium">기본 배송지</th>
                  <th className="py-3 px-4 font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {addresses.map((address) => (
                  <tr key={address.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="py-3 px-4 font-medium">{address.label}</td>
                    <td className="py-3 px-4">
                      {address.recipientName} · {address.recipientPhone}
                    </td>
                    <td className="py-3 px-4">
                      [{address.postalCode}] {address.address} {address.addressDetail ?? ""}
                    </td>
                    <td className="py-3 px-4">
                      {address.isDefault ? (
                        <span className="inline-flex items-center gap-1 text-brand font-semibold text-xs">
                          <Star size={13} fill="currentColor" /> 기본
                        </span>
                      ) : (
                        <button
                          onClick={() => void handleSetDefault(address.id)}
                          disabled={busyId === address.id}
                          className="text-xs text-muted underline underline-offset-2 hover:text-brand disabled:opacity-50"
                        >
                          기본으로 설정
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => openEditForm(address)}
                          className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand"
                        >
                          <Pencil size={13} /> 수정
                        </button>
                        <button
                          onClick={() => void handleDelete(address.id)}
                          disabled={busyId === address.id}
                          className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent disabled:opacity-50"
                        >
                          <Trash2 size={13} /> 삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lg:hidden flex flex-col gap-3">
            {addresses.map((address) => (
              <div key={address.id} className="card p-4">
                <div className="flex items-start justify-between mb-1.5">
                  <div>
                    <p className="font-semibold flex items-center gap-1.5">
                      {address.label}
                      {address.isDefault && <Star size={13} className="text-brand" fill="currentColor" />}
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      {address.recipientName} · {address.recipientPhone}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-muted">
                  [{address.postalCode}] {address.address} {address.addressDetail ?? ""}
                </p>
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border">
                  {!address.isDefault && (
                    <button
                      onClick={() => void handleSetDefault(address.id)}
                      disabled={busyId === address.id}
                      className="text-xs text-muted underline underline-offset-2 hover:text-brand disabled:opacity-50"
                    >
                      기본으로 설정
                    </button>
                  )}
                  <button
                    onClick={() => openEditForm(address)}
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand"
                  >
                    <Pencil size={13} /> 수정
                  </button>
                  <button
                    onClick={() => void handleDelete(address.id)}
                    disabled={busyId === address.id}
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent disabled:opacity-50"
                  >
                    <Trash2 size={13} /> 삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function AddressesPage() {
  return (
    <RequireAuth>
      <AddressesContent />
    </RequireAuth>
  );
}
