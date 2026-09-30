"use client";

// 네이티브 <select> 를 대체하는 Radix Select 래퍼. 화면마다 제각각이던
// 드롭다운 모양(브라우저·OS 기본 위젯)을 앱 디자인으로 통일하고, 키보드·
// 스크린리더 동작을 Radix 에 맡긴다.
//
// 호출부가 기존 <select>/<option> 구조를 거의 그대로 옮길 수 있도록 items
// 배열을 받는다. 한 가지 Radix 제약을 여기서 흡수한다: Radix 는 빈 문자열
// 값을 "선택 없음"으로 예약해 두어 <option value=""> 같은 항목을 그대로 쓸
// 수 없다. 이 앱은 "전체"/"선택 안 함" 항목에 빈 문자열을 널리 쓰므로,
// 내부에서만 sentinel 로 바꿔 저장하고 onValueChange 로 돌려줄 때 다시 빈
// 문자열로 되돌린다 — 호출부는 계속 "" 를 쓰면 된다.

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

const EMPTY_SENTINEL = "__empty__";

export interface SelectItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  items: SelectItem[];
  /** 값이 비어 있을 때 표시할 문구 (빈 문자열 항목이 없을 때만 의미가 있다) */
  placeholder?: string;
  /** 트리거에 적용할 클래스. 기본은 폼 입력과 같은 seller-input. */
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  name?: string;
  /**
   * 트리거 버튼의 id. 네이티브 <select id="x"> 를 <label htmlFor="x"> 가
   * 가리키던 자리를 그대로 이어받기 위한 것 — 이게 없으면 라벨 클릭이
   * 드롭다운을 열지 못하고 스크린리더의 라벨 연결도 끊긴다.
   */
  id?: string;
}

export default function Select({
  value,
  onValueChange,
  items,
  placeholder,
  className = "seller-input",
  ariaLabel,
  disabled,
  name,
  id,
}: SelectProps) {
  return (
    <RadixSelect.Root
      value={value === "" ? EMPTY_SENTINEL : value}
      onValueChange={(next) => onValueChange(next === EMPTY_SENTINEL ? "" : next)}
      disabled={disabled}
      name={name}
    >
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={`${className} inline-flex items-center justify-between gap-2 text-left data-[placeholder]:text-muted`}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="shrink-0 text-muted">
          <ChevronDown size={16} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-lg)] data-[state=open]:animate-[fade-slide-up_160ms_ease-out_both]"
        >
          <RadixSelect.Viewport className="p-1">
            {items.map((item) => (
              <RadixSelect.Item
                key={item.value === "" ? EMPTY_SENTINEL : item.value}
                value={item.value === "" ? EMPTY_SENTINEL : item.value}
                disabled={item.disabled}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-surface-2 data-[state=checked]:font-semibold data-[state=checked]:text-brand data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
              >
                <RadixSelect.ItemIndicator className="absolute left-2 inline-flex items-center">
                  <Check size={14} />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{item.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
