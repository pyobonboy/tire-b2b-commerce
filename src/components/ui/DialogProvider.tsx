"use client";

// 브라우저 기본 대화상자(window.confirm/prompt/alert)를 대체하는 Radix 기반
// 공용 대화상자. 기본 대화상자를 걷어내는 이유는 스타일 통일만이 아니다:
//   - sandboxed iframe·일부 엔터프라이즈 정책·자동화 환경에서 window.prompt 는
//     null 을 돌려주는 대신 예외를 던진다(실제로 이 앱의 관리자 반려 버튼이
//     그렇게 hard-fail 했고, 호출부마다 try/catch 를 덧대야 했다).
//   - 기본 대화상자는 페이지 스크립트를 통째로 멈추고, 키보드/스크린리더
//     제어나 문구 다듬기가 불가능하다.
// 여기서는 Promise 를 돌려주는 명령형 API 로 감싸, 호출부가 기존 코드 모양을
// 거의 그대로 유지한 채 `await confirm(...)` 로만 바꾸면 되게 한다.

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  /** 확인 버튼 문구. 기본 "확인" */
  confirmLabel?: string;
  /** 취소 버튼 문구. 기본 "취소" */
  cancelLabel?: string;
  /** 되돌리기 어려운 동작(취소·삭제·환불)이면 true — 확인 버튼이 경고색이 된다. */
  destructive?: boolean;
}

export interface PromptOptions {
  title: string;
  description?: ReactNode;
  placeholder?: string;
  /** 입력 초기값 */
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true 면 공백만 입력했을 때 확인 버튼이 비활성화된다. 기본 true. */
  required?: boolean;
  /** 여러 줄 입력(사유 등)이면 true */
  multiline?: boolean;
  destructive?: boolean;
}

export interface AlertOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
}

interface DialogsApi {
  /** window.confirm 대체. 확인 true / 취소·닫기 false */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** window.prompt 대체. 입력값 / 취소·닫기 null */
  prompt: (options: PromptOptions) => Promise<string | null>;
  /** window.alert 대체. 닫히면 resolve */
  alert: (options: AlertOptions) => Promise<void>;
}

const DialogsContext = createContext<DialogsApi | null>(null);

/**
 * 대화상자 API. DialogProvider(= Providers.tsx) 아래에서만 쓸 수 있다.
 * 사용 예:
 *   const { confirm, prompt } = useDialogs();
 *   if (!(await confirm({ title: "주문을 취소할까요?", destructive: true }))) return;
 *   const reason = await prompt({ title: "취소 사유" });
 *   if (reason === null) return;  // 사용자가 닫음
 */
export function useDialogs(): DialogsApi {
  const context = useContext(DialogsContext);
  if (!context) {
    throw new Error("useDialogs must be used within <DialogProvider>");
  }
  return context;
}

type PendingState =
  | { kind: "confirm"; options: ConfirmOptions }
  | { kind: "prompt"; options: PromptOptions }
  | { kind: "alert"; options: AlertOptions };

const OVERLAY_CLASS =
  "fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-[overlay-show_200ms_ease-out] data-[state=closed]:animate-[overlay-hide_180ms_ease-in]";
const CONTENT_CLASS =
  "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-sm card rounded-2xl p-6 z-50 shadow-[var(--shadow-lg)] data-[state=open]:animate-[fade-slide-up_220ms_ease-out_both]";

export default function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);
  const [inputValue, setInputValue] = useState("");
  // 열려 있는 대화상자의 Promise resolver. 어떤 경로로 닫히든(버튼·Esc·오버레이)
  // 반드시 한 번 호출돼야 호출부의 await 가 영원히 멈추지 않는다.
  const resolverRef = useRef<((value: never) => void) | null>(null);

  const settle = useCallback((value: boolean | string | null | void) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    setInputValue("");
    // resolve 는 kind 별로 타입이 다르지만 저장 시점에 좁혀 두었다.
    (resolve as ((v: unknown) => void) | null)?.(value);
  }, []);

  const api = useMemo<DialogsApi>(
    () => ({
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          resolverRef.current = resolve as unknown as (value: never) => void;
          setPending({ kind: "confirm", options });
        }),
      prompt: (options) =>
        new Promise<string | null>((resolve) => {
          resolverRef.current = resolve as unknown as (value: never) => void;
          setInputValue(options.defaultValue ?? "");
          setPending({ kind: "prompt", options });
        }),
      alert: (options) =>
        new Promise<void>((resolve) => {
          resolverRef.current = resolve as unknown as (value: never) => void;
          setPending({ kind: "alert", options });
        }),
    }),
    [],
  );

  const isConfirm = pending?.kind === "confirm";
  const isAlert = pending?.kind === "alert";
  const isPrompt = pending?.kind === "prompt";
  const promptOptions = isPrompt ? pending.options : null;
  const promptRequired = promptOptions?.required ?? true;
  const promptSubmitDisabled = promptRequired && inputValue.trim().length === 0;

  return (
    <DialogsContext.Provider value={api}>
      {children}

      {/* confirm / alert — AlertDialog 는 오버레이 클릭으로 닫히지 않아
          "확인이 필요한 동작"에 맞다. alert 는 취소 버튼만 없는 같은 모양. */}
      <AlertDialog.Root
        open={isConfirm || isAlert}
        onOpenChange={(open) => {
          if (!open) settle(isAlert ? undefined : false);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={OVERLAY_CLASS} />
          <AlertDialog.Content className={CONTENT_CLASS}>
            <AlertDialog.Title className="font-bold text-lg">
              {pending && pending.kind !== "prompt" ? pending.options.title : ""}
            </AlertDialog.Title>
            {pending && pending.kind !== "prompt" && pending.options.description ? (
              <AlertDialog.Description className="mt-2 text-sm text-muted leading-relaxed">
                {pending.options.description}
              </AlertDialog.Description>
            ) : (
              // Radix 는 Description 이 없으면 경고를 낸다 — 설명이 없는 경우를
              // 위해 접근성 트리에서만 제외되는 빈 설명을 둔다.
              <AlertDialog.Description className="sr-only">
                {pending && pending.kind !== "prompt" ? pending.options.title : ""}
              </AlertDialog.Description>
            )}
            <div className="mt-6 flex justify-end gap-2">
              {isConfirm && (
                <AlertDialog.Cancel asChild>
                  <button className="btn-outline h-10 px-4 text-sm">
                    {pending.options.cancelLabel ?? "취소"}
                  </button>
                </AlertDialog.Cancel>
              )}
              <AlertDialog.Action asChild>
                <button
                  onClick={() => settle(isAlert ? undefined : true)}
                  className={
                    isConfirm && pending.options.destructive
                      ? "btn-outline text-accent border-accent h-10 px-4 text-sm"
                      : "btn-primary h-10 px-4 text-sm"
                  }
                >
                  {pending && pending.kind !== "prompt"
                    ? (pending.options.confirmLabel ?? "확인")
                    : "확인"}
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {/* prompt — 입력이 필요하므로 일반 Dialog + form */}
      <Dialog.Root
        open={isPrompt}
        onOpenChange={(open) => {
          if (!open) settle(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={OVERLAY_CLASS} />
          <Dialog.Content className={CONTENT_CLASS} aria-describedby={undefined}>
            <Dialog.Title className="font-bold text-lg">{promptOptions?.title ?? ""}</Dialog.Title>
            {promptOptions?.description && (
              <p className="mt-2 text-sm text-muted leading-relaxed">{promptOptions.description}</p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (promptSubmitDisabled) return;
                settle(inputValue);
              }}
              className="mt-4"
            >
              {promptOptions?.multiline ? (
                <textarea
                  autoFocus
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder={promptOptions.placeholder}
                  rows={3}
                  className="seller-input h-auto py-2 resize-y"
                />
              ) : (
                <input
                  autoFocus
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder={promptOptions?.placeholder}
                  className="seller-input"
                />
              )}
              <div className="mt-6 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <button type="button" className="btn-outline h-10 px-4 text-sm">
                    {promptOptions?.cancelLabel ?? "취소"}
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={promptSubmitDisabled}
                  className={
                    promptOptions?.destructive
                      ? "btn-outline text-accent border-accent h-10 px-4 text-sm"
                      : "btn-primary h-10 px-4 text-sm"
                  }
                >
                  {promptOptions?.confirmLabel ?? "확인"}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </DialogsContext.Provider>
  );
}
