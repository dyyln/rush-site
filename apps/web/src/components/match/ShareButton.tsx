"use client";

import { Button } from "@/components/ui/Button";
import { CheckIcon, useCopyFeedback } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import buttonStyles from "@/components/ui/Button.module.css";
import { ShareIcon } from "./icons";

export function ShareButton({ matchId }: { matchId: string }) {
  const toast = useToast();
  const { copied, copy } = useCopyFeedback();
  const share = async () => {
    const url = `${window.location.origin}/matches/${matchId}/card`;
    if (!(await copy(url))) toast.push({ title: "Could not copy the link", body: <code className="mono">{url}</code>, tone: "error", durationMs: 10000 });
  };
  return (
    <Button variant="secondary" className={copied ? buttonStyles.copied : undefined} icon={copied ? <CheckIcon /> : <ShareIcon />} onClick={share}>
      <span aria-live="polite">{copied ? "Copied" : "Share"}</span>
    </Button>
  );
}
