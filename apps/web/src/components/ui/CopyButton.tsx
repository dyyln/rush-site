"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { copyText } from "@/components/match/copy";
import { Button, type ButtonProps } from "./Button";
import styles from "./Button.module.css";

export const COPIED_MS = 1500;

export function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type CopyState = "idle" | "copied" | "failed";

// Tracks the short Copied state for any copy control. flash runs the copy and shows the result
export function useCopyFeedback() {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const show = useCallback((next: CopyState) => {
    if (timer.current) clearTimeout(timer.current);
    setState(next);
    timer.current = setTimeout(() => setState("idle"), next === "failed" ? 3000 : COPIED_MS);
  }, []);
  const copy = useCallback(
    async (text: string | (() => Promise<string | null>)) => {
      const value = typeof text === "string" ? text : await text();
      const ok = value ? await copyText(value) : false;
      show(ok ? "copied" : "failed");
      return ok;
    },
    [show],
  );
  return { state, copied: state === "copied", failed: state === "failed", copy, show };
}

type CopyButtonProps = Omit<ButtonProps, "onClick" | "children"> & {
  // Text to copy, or a function that makes it
  text: string | (() => Promise<string | null>);
  children?: ReactNode;
  copiedLabel?: string;
  failedLabel?: string;
};

// Copies text and confirms on the button itself for 1.5 seconds
export function CopyButton({ text, children = "Copy", copiedLabel = "Copied", failedLabel = "Copy failed", icon, className, ...rest }: CopyButtonProps) {
  const { state, copy } = useCopyFeedback();
  const label = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : children;
  return (
    <Button
      variant="secondary"
      {...rest}
      className={[className, state === "copied" ? styles.copied : undefined].filter(Boolean).join(" ") || undefined}
      icon={state === "copied" ? <CheckIcon /> : (icon ?? <CopyIcon />)}
      onClick={() => copy(text)}
    >
      <span aria-live="polite">{label}</span>
    </Button>
  );
}
