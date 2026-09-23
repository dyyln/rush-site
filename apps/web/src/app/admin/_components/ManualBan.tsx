"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { adminApi, errorMessage } from "../_lib/client";
import type { ResolvedProfile } from "../_lib/types";
import { ConfirmDialog } from "./parts";
import styles from "../admin.module.css";

// Ban by SteamID64 or profile URL without opening the player page first
export function ManualBan() {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [found, setFound] = useState<ResolvedProfile | null>(null);
  const [errors, setErrors] = useState<{ query?: string; reason?: string; until?: string }>({});
  const [looking, setLooking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function check(): boolean {
    const errs: typeof errors = {};
    if (!query.trim()) errs.query = "Enter a SteamID64 or a Steam profile URL";
    if (!reason.trim()) errs.reason = "A reason is required";
    if (until && new Date(until).getTime() <= Date.now()) errs.until = "Pick a time in the future, or leave it blank for a permanent ban";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function lookup() {
    if (!check()) return;
    setLooking(true);
    setFound(null);
    try {
      const r = await adminApi.resolveProfile(query.trim());
      setFound(r);
      setConfirming(true);
    } catch (e) {
      setErrors({ query: errorMessage(e) });
    } finally {
      setLooking(false);
    }
  }

  const untilIso = until ? new Date(until).toISOString() : null;
  const name = found?.user?.displayName ?? found?.steamId ?? "";

  return (
    <Card title="Ban a player">
      <form
        className={styles.formGrid}
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <div className={styles.formWide}>
          <Input
            label="SteamID64 or profile URL"
            placeholder="https://steamcommunity.com/profiles/76561198000000000"
            value={query}
            error={errors.query}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setErrors((x) => ({ ...x, query: undefined }));
            }}
          />
        </div>
        <Input label="Reason" value={reason} maxLength={500} error={errors.reason} onChange={(e) => setReason(e.target.value)} />
        <Input
          label="Ends (blank for permanent)"
          type="datetime-local"
          value={until}
          error={errors.until}
          hint="Your local time"
          onChange={(e) => setUntil(e.target.value)}
        />
        <div className={`${styles.actions} ${styles.formWide}`}>
          <Button type="submit" variant="danger" loading={looking}>
            Review ban
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming && found !== null}
        title={`Ban ${name}?`}
        body={
          found && (
            <div className="stack">
              <div className={styles.found}>
                <Avatar name={name} src={found.user?.avatarUrl ?? null} size="sm" />
                <Link href={`/admin/users/${found.steamId}`}>{name}</Link>
                <span className={`${styles.muted} mono`}>{found.steamId}</span>
              </div>
              {!found.registered && (
                <p className={styles.muted}>This player has never signed in. An account is created for the ban so it applies at their first sign in.</p>
              )}
              <p>
                {untilIso ? `Until ${new Date(untilIso).toLocaleString("en-GB")}.` : "Permanent."} Reason: {reason.trim()}
              </p>
              <p className={styles.muted}>
                They are signed out and removed from the queue.{" "}
                {untilIso ? "Ratings stay as they are." : "A permanent ban also rolls back their recent wins."}
              </p>
            </div>
          )
        }
        confirmLabel="Ban player"
        danger
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          if (!found) return;
          await adminApi.ban(found.steamId, reason.trim(), untilIso);
          toast.push({ title: `${name} banned`, tone: "success" });
          setQuery("");
          setReason("");
          setUntil("");
          setFound(null);
        }}
      />
    </Card>
  );
}
