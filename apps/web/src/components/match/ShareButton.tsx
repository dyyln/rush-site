"use client";

import { Button } from "@/components/ui/Button";
import { CheckIcon, useCopyFeedback } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import buttonStyles from "@/components/ui/Button.module.css";
import { ShareIcon } from "./icons";

// Shares the match page, whose link preview is the match card. The system share sheet where there is one
// (phones), otherwise the link is copied
export function ShareButton({ matchId }: { matchId: string }) {
  const toast = useToast();
  const { copied, copy } = useCopyFeedback();
  const share = async () => {
    const url = `${window.location.origin}/matches/${matchId}`;
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ url });
        return;
      } catch (e) {
        // Closing the share sheet is not an error
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    if (!(await copy(url))) toast.push({ title: "Could not copy the link", body: <code className="mono">{url}</code>, tone: "error", durationMs: 10000 });
  };
  return (
    <Button variant="secondary" className={copied ? buttonStyles.copied : undefined} icon={copied ? <CheckIcon /> : <ShareIcon />} onClick={share}>
      <span aria-live="polite">{copied ? "Copied" : "Share"}</span>
    </Button>
  );
}
