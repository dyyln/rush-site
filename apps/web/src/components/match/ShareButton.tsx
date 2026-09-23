"use client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "./copy";
import { ShareIcon } from "./icons";

export function ShareButton({ matchId }: { matchId: string }) {
  const toast = useToast();
  const share = async () => {
    const url = `${window.location.origin}/matches/${matchId}/card`;
    if (await copyText(url)) toast.push({ title: "Score card link copied", tone: "success" });
    else toast.push({ title: "Could not copy the link", body: <code className="mono">{url}</code>, tone: "error", durationMs: 10000 });
  };
  return (
    <Button variant="secondary" icon={<ShareIcon />} onClick={share}>
      Share
    </Button>
  );
}
