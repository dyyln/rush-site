"use client";

import { useEffect, useState } from "react";
import type { ChatMessage } from "@rushsite/shared";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { chatApi, chatError } from "./chatApi";
import styles from "./ChatSidebar.module.css";

const DURATIONS = [
  { value: "10", label: "10 minutes" },
  { value: "60", label: "1 hour" },
  { value: "1440", label: "24 hours" },
  { value: "10080", label: "7 days" },
  { value: "permanent", label: "Until lifted" },
];

// Admin tools for one chat message: delete it, or mute or unmute its author
export function ModerateDialog({
  message,
  onClose,
  onDeleted,
}: {
  message: ChatMessage | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [duration, setDuration] = useState("60");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"delete" | "mute" | "unmute" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason("");
    setError(null);
    setBusy(null);
  }, [message?.id]);

  const name = message?.author.displayName ?? "";

  async function run(kind: "delete" | "mute" | "unmute", fn: () => Promise<unknown>, done: string) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      toast.push({ title: done, tone: "success" });
      onClose();
    } catch (e) {
      setError(chatError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={!!message} title={`Moderate ${name}`} onClose={onClose}>
      {message && (
        <div className={styles.modBody}>
          <blockquote className={styles.quote}>{message.body}</blockquote>
          <Button
            variant="danger"
            loading={busy === "delete"}
            disabled={!!busy}
            onClick={() =>
              run(
                "delete",
                async () => {
                  await chatApi.deleteMessage(message.id);
                  onDeleted(message.id);
                },
                "Message deleted",
              )
            }
          >
            Delete message
          </Button>

          <form
            className={styles.modForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim()) {
                setError("Give a reason for the mute.");
                return;
              }
              const minutes = duration === "permanent" ? null : Number(duration);
              void run("mute", () => chatApi.mute(message.author.steamId, minutes, reason.trim()), `${name} muted`);
            }}
          >
            <Select label="Mute for" options={DURATIONS} value={duration} onChange={(e) => setDuration(e.target.value)} />
            <Input label="Reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            <div className={styles.modActions}>
              <Button type="submit" variant="secondary" loading={busy === "mute"} disabled={!!busy}>
                Mute
              </Button>
              <Button
                variant="ghost"
                loading={busy === "unmute"}
                disabled={!!busy}
                onClick={() => run("unmute", () => chatApi.unmute(message.author.steamId), `${name} unmuted`)}
              >
                Lift mute
              </Button>
            </div>
          </form>
          {error && (
            <p className={styles.sendError} role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
