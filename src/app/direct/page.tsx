"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MapPin, Search, Truck } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import Select from "@/components/ui/Select";
import { DIRECT_NOTICE, MANUFACTURERS, REGIONS, TIRES } from "@/lib/mockData";

const DIRECT_TIRE_IDS = ["t1", "t5", "t6", "t7", "t10", "t12"];

function DirectContent() {
  const provinces = Object.keys(REGIONS);
  const [province, setProvince] = useState(provinces[0]);
  const [city, setCity] = useState(Object.keys(REGIONS[provinces[0]])[0]);
  const cities = Object.keys(REGIONS[province] ?? {});
  const towns = REGIONS[province]?.[city] ?? [];
  const [town, setTown] = useState(towns[0] ?? "");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");

  function handleProvinceChange(next: string) {
    setProvince(next);
    const nextCity = Object.keys(REGIONS[next])[0];
    setCity(nextCity);
    setTown(REGIONS[next][nextCity][0]);
  }

  function handleCityChange(next: string) {
    setCity(next);
    setTown(REGIONS[province][next][0]);
  }

  const directTires = useMemo(
    () =>
      TIRES.filter((t) => DIRECT_TIRE_IDS.includes(t.id))
        .filter((t) => !manufacturer || t.manufacturer === manufacturer)
        .filter((t) => !model || t.model.toLowerCase().includes(model.toLowerCase())),
    [manufacturer, model]
  );

  return (
    <div className="px-4 py-5">
      <div className="card p-5 mb-6 text-center bg-surface-2 border-dashed">
        <p className="text-sm text-muted mb-1">{DIRECT_NOTICE}</p>
        <h1 className="text-lg font-extrabold">
          타이어 <span className="text-brand">당일 직배송</span> 주문으로~!
        </h1>
      </div>

      <div className="card p-4 mb-6 flex flex-col sm:flex-row gap-2 items-stretch">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted px-1 sm:hidden">
          <MapPin size={14} /> 직배송 지역 설정
        </div>
        <Select
          value={province}
          onValueChange={handleProvinceChange}
          items={provinces.map((p) => ({ value: p, label: p }))}
          className="h-11 px-3 rounded-lg border border-border sm:w-40 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          ariaLabel="도/광역시"
        />
        <Select
          value={city}
          onValueChange={handleCityChange}
          items={cities.map((c) => ({ value: c, label: c }))}
          className="h-11 px-3 rounded-lg border border-border sm:w-40 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          ariaLabel="시/군/구"
        />
        <Select
          value={town}
          onValueChange={setTown}
          items={towns.map((t) => ({ value: t, label: t }))}
          className="h-11 px-3 rounded-lg border border-border sm:w-40 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          ariaLabel="읍/면/동"
        />
        <button className="btn-primary h-11 px-5 gap-1.5 sm:ml-auto">
          <Search size={15} /> 직배송 상품보기
        </button>
      </div>

      <div className="card p-4 mb-6 flex flex-col sm:flex-row gap-2">
        <Select
          value={manufacturer}
          onValueChange={setManufacturer}
          items={[
            { value: "", label: "제조사" },
            ...MANUFACTURERS.map((m) => ({ value: m, label: m })),
          ]}
          className="h-10 px-3 rounded-lg border border-border text-sm sm:w-40 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          ariaLabel="제조사"
        />
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="제품명 검색"
          className="h-10 px-3 rounded-lg border border-border text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
        />
      </div>

      <div className="flex items-center gap-1.5 mb-3">
        <Truck size={16} className="text-brand" />
        <h2 className="font-bold">
          {province} {city} {town} 당일직배송 상품
        </h2>
      </div>
      <p className="text-sm text-muted mb-3">총 {directTires.length}개 상품</p>

      <div className="hidden lg:block overflow-x-auto card">
        <table className="min-w-[880px] w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="py-3 px-4 font-medium">제조사</th>
              <th className="py-3 px-4 font-medium">제품정보</th>
              <th className="py-3 px-4 font-medium">사이즈</th>
              <th className="py-3 px-4 font-medium">생산년도</th>
              <th className="py-3 px-4 font-medium">공장도가</th>
              <th className="py-3 px-4 font-medium">당일배송가</th>
              <th className="py-3 px-4 font-medium">재고수량</th>
            </tr>
          </thead>
          <tbody>
            {directTires.map((t) => {
              const factoryPrice = Math.round((t.price / (1 - t.discountRate / 100)) / 10) * 10;
              const directPrice = Math.round((t.price * 1.08) / 10) * 10;
              return (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="py-3 px-4">{t.manufacturer}</td>
                  <td className="py-3 px-4">
                    <Link href={`/products/${t.id}`} className="font-medium text-brand hover:underline">
                      {t.model}
                    </Link>
                  </td>
                  <td className="py-3 px-4">
                    {t.width}/{t.ratio}R{t.rim}
                  </td>
                  <td className="py-3 px-4 text-muted">{t.dot}</td>
                  <td className="py-3 px-4 tabular-nums text-muted">
                    {factoryPrice.toLocaleString()}원
                  </td>
                  <td className="py-3 px-4 tabular-nums font-bold text-brand">
                    {directPrice.toLocaleString()}원
                  </td>
                  <td className="py-3 px-4 tabular-nums">{t.stock}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="lg:hidden flex flex-col gap-3">
        {directTires.map((t) => {
          const directPrice = Math.round((t.price * 1.08) / 10) * 10;
          return (
            <Link key={t.id} href={`/products/${t.id}`} className="card p-4 block">
              <p className="text-xs text-muted mb-0.5">{t.manufacturer}</p>
              <p className="font-semibold">{t.model}</p>
              <p className="text-xs text-muted mt-1">
                {t.width} / {t.ratio} R {t.rim} · DOT {t.dot}
              </p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-muted">재고 {t.stock}</span>
                <span className="font-extrabold text-brand tabular-nums">
                  {directPrice.toLocaleString()}원
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function DirectPage() {
  return (
    <RequireAuth>
      <DirectContent />
    </RequireAuth>
  );
}
