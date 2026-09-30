"use client";

import RequireAuth from "@/components/RequireAuth";
import { useOrders } from "@/lib/orders";
import { getStatusStyle } from "@/lib/status";

function StatCard({ label, value, delay }: { label: string; value: number; delay: number }) {
  const valueStyle = value > 0 ? getStatusStyle(label).split(" ")[1] : "text-muted";
  return (
    <div
      className="card p-4 text-center animate-[fade-slide-up_400ms_ease-out_both]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className="text-xs text-muted mb-1">{label}</p>
      <p className={`text-lg font-extrabold tabular-nums ${valueStyle}`}>{value}건</p>
    </div>
  );
}

function StatusContent() {
  const { orderStatusCounts, cancelStatusCounts } = useOrders();
  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-extrabold mb-5">주문 / 배송 현황</h1>

      <h2 className="font-bold mb-3">타이어 주문 현황</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
        {Object.entries(orderStatusCounts).map(([label, value], i) => (
          <StatCard key={label} label={label} value={value} delay={i * 30} />
        ))}
      </div>

      <h2 className="font-bold mb-3">타이어 취소/교환/반품 현황</h2>
      <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-6">
        {Object.entries(cancelStatusCounts).map(([label, value], i) => (
          <StatCard key={label} label={label} value={value} delay={i * 30} />
        ))}
      </div>
    </div>
  );
}

export default function OrderStatusPage() {
  return (
    <RequireAuth>
      <StatusContent />
    </RequireAuth>
  );
}
