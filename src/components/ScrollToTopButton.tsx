"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 480);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="맨 위로"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed right-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 w-11 h-11 rounded-full bg-gradient-to-br from-brand-light to-brand-dark text-white shadow-[var(--shadow-brand)] flex items-center justify-center hover:brightness-110 active:scale-90 transition-all lg:right-6 lg:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] ${
        visible
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-2 pointer-events-none"
      }`}
    >
      <ArrowUp size={20} />
    </button>
  );
}
