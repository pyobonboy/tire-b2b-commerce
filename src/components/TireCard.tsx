import Link from "next/link";
import type { Tire } from "@/lib/types";
import ImagePlaceholder from "./ImagePlaceholder";

export default function TireCard({
  tire,
  fixedWidth = true,
}: {
  tire: Tire;
  fixedWidth?: boolean;
}) {
  return (
    <Link
      href={`/products/${tire.id}`}
      className={`group card card-hover ${fixedWidth ? "min-w-[160px] w-40 shrink-0" : "w-full"} p-3 lg:p-3.5 flex flex-col gap-1`}
    >
      <ImagePlaceholder
        className="w-full aspect-[4/3] mb-2 transition-transform duration-300 group-hover:scale-[1.04]"
        manufacturer={tire.manufacturer}
      />
      <span className="text-xs text-muted">{tire.manufacturer}</span>
      <p className="text-sm font-semibold leading-snug line-clamp-2 min-h-[2.5em] break-words">{tire.model}</p>
      <p className="text-xs text-muted">
        {tire.width} / {tire.ratio} R {tire.rim} · DOT {tire.dot}
      </p>
      <div className="mt-auto pt-1.5 flex items-center gap-1.5 flex-wrap tabular-nums">
        <span className="font-extrabold text-base text-brand shrink-0">{tire.discountRate}%</span>
        {tire.tag && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border border-brand text-brand shrink-0">
            {tire.tag}
          </span>
        )}
        <span className="font-extrabold text-base">{tire.price.toLocaleString()}원</span>
      </div>
    </Link>
  );
}
