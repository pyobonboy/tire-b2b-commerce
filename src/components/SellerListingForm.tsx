"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, X } from "lucide-react";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/ui/Select";
import { MANUFACTURERS } from "@/lib/mockData";
import type { SellerListingView } from "@/lib/seller-types";
import { formatZodIssues } from "@/lib/validation-messages";

// Matches listingSchema / listingPatchSchema (src/lib/server/seller.ts —
// the PATCH schema is `listingSchema.partial()`, same field names)
// field-for-field.
const LABELS: Record<string, string> = {
  manufacturer: "제조사",
  model: "모델명",
  width: "단면폭",
  ratio: "편평비",
  rim: "림경",
  dot: "DOT",
  loadIndex: "하중지수",
  speedIndex: "속도지수",
  ply: "타이어겹수",
  oe: "OE",
  season: "계절",
  productCode: "상품번호",
  discountRate: "할인율",
  price: "판매가",
  factoryPrice: "공장도가",
  stock: "재고",
  minOrder: "최소 주문수량",
  tag: "태그",
  shippingNote: "배송 안내 문구",
  courier: "택배사",
  shippingFee: "배송비",
  freeShippingThreshold: "무료배송 기준금액",
  imageUrls: "상품 이미지",
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_COUNT = 10;
const IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface ImageDraft {
  id?: string;
  url: string;
  file?: File;
}

interface FormState {
  manufacturer: string;
  model: string;
  width: string;
  ratio: string;
  rim: string;
  dot: string;
  loadIndex: string;
  speedIndex: string;
  ply: string;
  oe: string;
  season: string;
  productCode: string;
  discountRate: string;
  price: string;
  factoryPrice: string;
  stock: string;
  minOrder: string;
  tag: string;
  courier: string;
  shippingNote: string;
  shippingFee: string;
  freeShippingThreshold: string;
}

const emptyForm: FormState = {
  manufacturer: MANUFACTURERS[0] ?? "",
  model: "",
  width: "",
  ratio: "",
  rim: "",
  dot: "",
  loadIndex: "",
  speedIndex: "",
  ply: "",
  oe: "",
  season: "사계절",
  productCode: "",
  discountRate: "0",
  price: "0",
  factoryPrice: "0",
  stock: "0",
  minOrder: "1",
  tag: "",
  courier: "",
  shippingNote: "",
  shippingFee: "0",
  freeShippingThreshold: "",
};

function formFromListing(listing: SellerListingView): FormState {
  return {
    manufacturer: listing.manufacturer,
    model: listing.model,
    width: String(listing.width),
    ratio: String(listing.ratio),
    rim: String(listing.rim),
    dot: listing.dot,
    loadIndex: listing.loadIndex,
    speedIndex: listing.speedIndex,
    ply: listing.ply,
    oe: listing.oe ?? "",
    season: listing.season,
    productCode: listing.productCode,
    discountRate: String(listing.discountRate),
    price: String(listing.price),
    factoryPrice: String(listing.factoryPrice),
    stock: String(listing.stock),
    minOrder: String(listing.minOrder),
    tag: listing.tag ?? "",
    courier: listing.seller.courier,
    shippingNote: listing.seller.shippingNote ?? "",
    shippingFee: String(listing.seller.shippingFee),
    freeShippingThreshold:
      listing.seller.freeShippingThreshold === null ? "" : String(listing.seller.freeShippingThreshold),
  };
}

export default function SellerListingForm({ listingId }: { listingId?: string }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [listing, setListing] = useState<SellerListingView | null>(null);
  const [images, setImages] = useState<ImageDraft[]>([]);
  const [imagesChanged, setImagesChanged] = useState(false);
  const [loading, setLoading] = useState(Boolean(listingId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;

    fetch(`/api/seller/listings/${listingId}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("상품 정보를 불러오지 못했습니다.");
        return response.json() as Promise<{ listing: SellerListingView }>;
      })
      .then((data) => {
        if (!cancelled) {
          setListing(data.listing);
          setForm(formFromListing(data.listing));
          setImages(data.listing.images.map((image) => ({ id: image.id, url: image.url })));
          setImagesChanged(false);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [listingId]);

  function setField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    if (images.length + files.length > MAX_IMAGE_COUNT) {
      setError(`이미지는 최대 ${MAX_IMAGE_COUNT}장까지 등록할 수 있습니다.`);
      return;
    }

    const invalidFile = files.find(
      (file) => !IMAGE_CONTENT_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES,
    );
    if (invalidFile) {
      setError("JPG, PNG, WebP 이미지만 등록할 수 있으며 파일당 최대 10MB입니다.");
      return;
    }

    setError(null);
    setImages((current) => [
      ...current,
      ...files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
    setImagesChanged(true);
  }

  function removeImage(index: number) {
    setImages((current) => {
      const removed = current[index];
      if (removed?.file) URL.revokeObjectURL(removed.url);
      return current.filter((_, imageIndex) => imageIndex !== index);
    });
    setImagesChanged(true);
  }

  async function uploadImage(file: File) {
    const presignResponse = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }),
    });
    const presign = (await presignResponse.json().catch(() => null)) as
      | { uploadUrl?: string; url?: string; error?: string }
      | null;
    if (!presignResponse.ok || !presign?.uploadUrl || !presign.url) {
      throw new Error(
        presign?.error === "STORAGE_NOT_CONFIGURED"
          ? "이미지 저장소가 아직 설정되지 않았습니다. 관리자에게 문의해 주세요."
          : "이미지 업로드용 URL을 발급하지 못했습니다.",
      );
    }

    // Presigned PUT — R2 does not support presigned POST at all (see
    // createImagePresign in src/lib/server/storage.ts for the doc reference).
    // The URL's signature binds Content-Length to the `size` sent above, so
    // this PUT must carry the exact same body length. "Content-Length" is a
    // forbidden fetch header that can't be set manually, but that's fine:
    // the browser always computes it from the actual `file` body being sent,
    // which is what makes the bound size enforceable server-side.
    const uploadResponse = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!uploadResponse.ok) throw new Error("이미지 파일을 저장하지 못했습니다.");
    return presign.url;
  }

  async function resolveImageUrls() {
    return Promise.all(images.map((image) => (image.file ? uploadImage(image.file) : image.url)));
  }

  async function persist(requestApproval: boolean) {
    setBusy(true);
    setError(null);

    try {
      const url = listingId ? `/api/seller/listings/${listingId}` : "/api/seller/listings";
      const response = await fetch(url, {
        method: listingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string; details?: unknown } | null;
        if (body?.error === "VALIDATION_ERROR") {
          const lines = formatZodIssues(body.details, LABELS);
          setError(lines.length > 0 ? lines.join("\n") : "입력값을 확인해 주세요.");
          return;
        }
        // 입력값 문제가 아닌 실패(로그인 만료, 판매자 승인 대기/정지 등)를
        // 전부 "상품을 저장하지 못했습니다" 한 줄로 뭉개면 판매자가 원인을
        // 알 수 없다 — 가드가 내려주는 에러 코드별로 실제 이유를 보여준다.
        if (body?.error === "UNAUTHENTICATED") {
          setError("로그인이 만료되었습니다. 다시 로그인한 뒤 시도해 주세요.");
          return;
        }
        if (body?.error === "SELLER_INACTIVE" || body?.error === "SELLER_PROFILE_REQUIRED" || body?.error === "FORBIDDEN") {
          setError(
            "판매자 계정이 아직 활성 상태가 아닙니다. 가입 승인이 완료되지 않았거나 계정이 정지된 경우 상품을 등록할 수 없습니다. 관리자에게 문의해 주세요.",
          );
          return;
        }
        setError(
          body?.error
            ? `상품을 저장하지 못했습니다. (오류 코드: ${body.error})`
            : "상품을 저장하지 못했습니다.",
        );
        return;
      }

      const data = (await response.json()) as { listing: SellerListingView };
      const savedId = data.listing.id;

      if (imagesChanged) {
        const imageUrls = await resolveImageUrls();
        const imageResponse = await fetch(`/api/seller/listings/${savedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrls }),
        });
        if (!imageResponse.ok) throw new Error("상품은 저장되었지만 이미지 정보를 저장하지 못했습니다.");

        images.forEach((image) => {
          if (image.file) URL.revokeObjectURL(image.url);
        });
        setImages(imageUrls.map((imageUrl) => ({ url: imageUrl })));
        setImagesChanged(false);
      }

      if (requestApproval) {
        const submitResponse = await fetch(`/api/seller/listings/${savedId}/submit`, { method: "POST" });
        if (!submitResponse.ok) throw new Error("상품은 저장되었지만 승인 요청에 실패했습니다.");
      }

      router.push("/seller/listings");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "상품을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void persist(false);
  }

  if (loading) return <LoadingState />;

  if (error && listingId && !listing) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-accent mb-4">{error}</p>
        <Link href="/seller/listings" className="text-brand font-semibold">
          상품 목록으로
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 max-w-7xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <Link href="/seller/listings" className="text-sm text-muted hover:text-brand">
            ← 상품 목록
          </Link>
          <h1 className="text-xl font-extrabold mt-2">{listingId ? "상품 수정" : "상품 등록"}</h1>
          <p className="text-sm text-muted mt-1">
            {listingId ? "변경 내용을 저장하고 승인 상태를 확인하세요." : "상품 정보를 임시 저장한 뒤 본사에 승인 요청을 보내세요."}
          </p>
        </div>
        {listing && <StatusBadge status={listing.status} />}
      </div>

      {listing?.rejectedReason && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 text-sm text-accent p-3 mb-4">
          반려 사유: {listing.rejectedReason}
        </div>
      )}
      {error && <p className="text-sm text-accent mb-3 whitespace-pre-line">{error}</p>}

      <form onSubmit={handleSubmit} className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="flex flex-col gap-5">
          <section className="card p-5">
            <h2 className="font-bold mb-4">상품 기본 정보</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="제조사" required>
                <Select
                  value={form.manufacturer}
                  onValueChange={(value) => setField("manufacturer", value)}
                  items={MANUFACTURERS.map((manufacturer) => ({ value: manufacturer, label: manufacturer }))}
                  ariaLabel="제조사"
                />
              </Field>
              <Field label="모델명" required>
                <input value={form.model} onChange={(event) => setField("model", event.target.value)} className="seller-input" required />
              </Field>
              <Field label="단면폭" required>
                <input type="number" min="1" value={form.width} onChange={(event) => setField("width", event.target.value)} className="seller-input" required />
              </Field>
              <Field label="편평비" required>
                <input type="number" min="1" value={form.ratio} onChange={(event) => setField("ratio", event.target.value)} className="seller-input" required />
              </Field>
              <Field label="림경" required>
                <input type="number" min="1" value={form.rim} onChange={(event) => setField("rim", event.target.value)} className="seller-input" required />
              </Field>
              <Field label="생산년도(DOT)" required>
                <input value={form.dot} onChange={(event) => setField("dot", event.target.value)} className="seller-input" placeholder="2026" required />
              </Field>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-bold mb-4">상품 스펙</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <TextField label="하중지수" field="loadIndex" form={form} setField={setField} required />
              <TextField label="속도지수" field="speedIndex" form={form} setField={setField} required />
              <TextField label="타이어겹수" field="ply" form={form} setField={setField} required />
              <TextField label="OE" field="oe" form={form} setField={setField} />
              <TextField label="계절" field="season" form={form} setField={setField} required />
              <TextField label="상품번호" field="productCode" form={form} setField={setField} required />
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-bold mb-4">판매 조건</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <NumberField label="공장도가" field="factoryPrice" form={form} setField={setField} required />
              <NumberField label="판매가" field="price" form={form} setField={setField} required />
              <NumberField label="할인율(%)" field="discountRate" form={form} setField={setField} required />
              <NumberField label="재고" field="stock" form={form} setField={setField} required />
              <NumberField label="최소 주문수량" field="minOrder" form={form} setField={setField} required />
              <Field label="태그">
                <Select
                  value={form.tag}
                  onValueChange={(value) => setField("tag", value)}
                  items={[
                    { value: "", label: "없음" },
                    { value: "EVENT", label: "EVENT" },
                    { value: "BEST", label: "BEST" },
                  ]}
                  ariaLabel="태그"
                />
              </Field>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-bold mb-4">배송 안내</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <TextField label="택배사" field="courier" form={form} setField={setField} required />
              <TextField label="배송 안내 문구" field="shippingNote" form={form} setField={setField} />
              <NumberField label="배송비" field="shippingFee" form={form} setField={setField} required />
              <Field label="무료배송 기준금액">
                <input
                  type="number"
                  min="0"
                  value={form.freeShippingThreshold}
                  onChange={(event) => setField("freeShippingThreshold", event.target.value)}
                  placeholder="미입력 시 무료배송 없음"
                  className="seller-input"
                />
              </Field>
            </div>
            {/* 배송비/무료배송 기준은 상품이 아니라 판매자 단위 설정이다 — 택배사/
                배송 안내 문구와 마찬가지로 이 상품 폼을 저장할 때 함께 반영되며,
                이 판매자의 다른 모든 상품에도 동일하게 적용된다. */}
            <p className="text-xs text-muted mt-3">
              배송비는 이 판매점의 모든 상품에 공통 적용됩니다. 무료배송 기준금액을 채우면 한 번의 주문에서
              이 판매점 상품 합계가 그 금액 이상일 때 배송비가 무료로 적용됩니다.
            </p>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="font-bold">상품 이미지</h2>
              <span className="text-xs text-muted">{images.length}/{MAX_IMAGE_COUNT}</span>
            </div>
            <p className="text-xs text-muted mb-4">
              JPG, PNG, WebP 이미지를 파일당 최대 10MB까지 등록할 수 있습니다.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {images.map((image, index) => (
                <div key={`${image.id ?? "new"}-${image.url}`} className="relative aspect-square overflow-hidden rounded-xl border border-border bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- uploaded object-storage URLs are user-configured and not known at build time */}
                  <img src={image.url} alt={`상품 이미지 ${index + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    disabled={busy}
                    aria-label={`상품 이미지 ${index + 1} 삭제`}
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/80 disabled:opacity-50"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGE_COUNT && (
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-muted transition-colors hover:border-brand hover:bg-brand/5">
                  <ImagePlus size={22} strokeWidth={1.6} />
                  <span className="text-xs font-semibold">이미지 추가</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="sr-only"
                    onChange={handleImageChange}
                    disabled={busy}
                  />
                </label>
              )}
            </div>
          </section>

          <div className="flex justify-end gap-2">
            <Link href="/seller/listings" className="btn-outline h-11 px-5">
              취소
            </Link>
            <button type="submit" className="btn-outline h-11 px-5" disabled={busy}>
              {busy ? "저장 중..." : "임시 저장"}
            </button>
            <button type="button" className="btn-primary h-11 px-5" disabled={busy} onClick={() => void persist(true)}>
              승인 요청
            </button>
          </div>
        </div>

        <aside className="card p-5 h-fit xl:sticky xl:top-4">
          <h2 className="font-bold mb-4">상세페이지 미리보기</h2>
          <div className="rounded-xl border border-border bg-surface-2 p-4">
            <p className="text-xs text-muted">{form.manufacturer}</p>
            <p className="font-bold mt-1">{form.model || "모델명을 입력하세요"}</p>
            <p className="text-sm text-muted mt-2">
              {form.width || "-"} / {form.ratio || "-"} R {form.rim || "-"} · DOT {form.dot || "-"}
            </p>
            <div className="border-t border-border mt-4 pt-3 flex flex-col gap-2 text-sm">
              <PreviewRow label="상품번호" value={form.productCode || "-"} />
              <PreviewRow label="스펙" value={`${form.loadIndex || "-"} ${form.speedIndex || "-"} ${form.ply || "-"}`} />
              <PreviewRow label="판매가" value={`${Number(form.price || 0).toLocaleString()}원`} />
              <PreviewRow label="재고" value={`${Number(form.stock || 0).toLocaleString()}개`} />
            </div>
          </div>
          <p className="text-xs text-muted leading-relaxed mt-3">
            공장도가는 1차 정책에 따라 판매자가 입력합니다. 가격과 재고 변경은 이력으로 기록됩니다.
          </p>
        </aside>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-medium text-foreground/70">{label}{required && <span className="text-accent"> *</span>}</span>
      {children}
    </label>
  );
}

function TextField({ label, field, form, setField, required }: { label: string; field: keyof FormState; form: FormState; setField: (field: keyof FormState, value: string) => void; required?: boolean }) {
  return (
    <Field label={label} required={required}>
      <input value={form[field]} onChange={(event) => setField(field, event.target.value)} className="seller-input" required={required} />
    </Field>
  );
}

function NumberField({ label, field, form, setField, required }: { label: string; field: keyof FormState; form: FormState; setField: (field: keyof FormState, value: string) => void; required?: boolean }) {
  return (
    <Field label={label} required={required}>
      <input type="number" min="0" value={form[field]} onChange={(event) => setField(field, event.target.value)} className="seller-input" required={required} />
    </Field>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><span className="text-muted">{label}</span><span className="font-medium text-right">{value}</span></div>;
}

function StatusBadge({ status }: { status: SellerListingView["status"] }) {
  const labels: Record<SellerListingView["status"], string> = {
    DRAFT: "작성중",
    PENDING: "승인 대기",
    ACTIVE: "판매중",
    REJECTED: "반려",
    SOLDOUT: "품절",
    HIDDEN: "비노출",
  };
  return <span className="text-sm font-semibold text-brand">{labels[status]}</span>;
}
