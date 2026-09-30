"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function HeroCarousel({
  slides,
  autoPlayInterval = 4000,
  className = "",
  showControls = true,
  showIndicators = true,
}: {
  slides: { key: string; content: ReactNode }[];
  autoPlayInterval?: number;
  className?: string;
  showControls?: boolean;
  showIndicators?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const pausedRef = useRef(false);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const didSwipeRef = useRef(false);
  const count = slides.length;

  function go(next: number) {
    setIndex(((next % count) + count) % count);
  }

  useEffect(() => {
    if (count <= 1) return;
    const id = setInterval(() => {
      if (!pausedRef.current) setIndex((i) => (i + 1) % count);
    }, autoPlayInterval);
    return () => clearInterval(id);
  }, [count, autoPlayInterval]);

  if (count === 0) return null;

  return (
    <div
      className={`relative rounded-2xl overflow-hidden h-40 touch-pan-y select-none md:h-60 lg:h-80 ${className}`}
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        touchStartXRef.current = touch.clientX;
        touchStartYRef.current = touch.clientY;
        didSwipeRef.current = false;
        pausedRef.current = true;
        setIsDragging(true);
        setDragOffset(0);
      }}
      onTouchMove={(event) => {
        const startX = touchStartXRef.current;
        const startY = touchStartYRef.current;
        if (startX === null || startY === null) return;

        const touch = event.touches[0];
        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;

        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          const resistance =
            (index === 0 && deltaX > 0) || (index === count - 1 && deltaX < 0) ? 0.28 : 1;
          setDragOffset(deltaX * resistance);
        }
      }}
      onTouchEnd={(event) => {
        const startX = touchStartXRef.current;
        const startY = touchStartYRef.current;
        const touch = event.changedTouches[0];

        if (startX !== null && startY !== null) {
          const deltaX = touch.clientX - startX;
          const deltaY = touch.clientY - startY;

          if (Math.abs(deltaX) >= 45 && Math.abs(deltaX) > Math.abs(deltaY)) {
            didSwipeRef.current = true;
            go(deltaX < 0 ? index + 1 : index - 1);
          }
        }

        touchStartXRef.current = null;
        touchStartYRef.current = null;
        pausedRef.current = false;
        setIsDragging(false);
        setDragOffset(0);
      }}
      onTouchCancel={() => {
        touchStartXRef.current = null;
        touchStartYRef.current = null;
        pausedRef.current = false;
        setIsDragging(false);
        setDragOffset(0);
      }}
      onClickCapture={(event) => {
        if (didSwipeRef.current) {
          event.preventDefault();
          event.stopPropagation();
          didSwipeRef.current = false;
        }
      }}
    >
      <div
        className={`hero-carousel-motion flex h-full will-change-transform ${
          isDragging
            ? ""
            : "transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
        }`}
        style={{ transform: `translateX(calc(-${index * 100}% + ${dragOffset}px))` }}
      >
        {slides.map((s, slideIndex) => (
          <div
            key={s.key}
            className={`hero-carousel-motion h-full w-full shrink-0 transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              slideIndex === index ? "scale-100 opacity-100" : "scale-[0.985] opacity-80"
            }`}
          >
            {s.content}
          </div>
        ))}
      </div>

      {count > 1 && showControls && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous slide"
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-white/80 hover:text-white active:scale-90 transition-all"
          >
            <ChevronLeft size={22} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next slide"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-white/80 hover:text-white active:scale-90 transition-all"
          >
            <ChevronRight size={22} strokeWidth={2.5} />
          </button>

        </>
      )}

      {count > 1 && showIndicators && (
        <div className="absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/15 px-2 py-1 backdrop-blur-sm">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => go(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-1.5 overflow-hidden rounded-full shadow-sm transition-all duration-500 ${
                i === index ? "w-9 bg-white/35" : "w-1.5 bg-white/55 hover:bg-white/80"
              }`}
            >
              {i === index && (
                <span
                  key={`${s.key}-${index}`}
                  className="hero-carousel-progress block h-full w-full origin-left animate-[carousel-progress_linear_forwards] rounded-full bg-white"
                  style={{ animationDuration: `${autoPlayInterval}ms` }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
