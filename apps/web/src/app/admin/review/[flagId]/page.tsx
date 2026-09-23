"use client";

import type { ReviewDecideResponse, ReviewFlag } from "@rushsite/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { reviewApi } from "@/components/review/api";
import { ReviewCase } from "@/components/review/ReviewCase";
import { useSession } from "@/lib/session";
import { isNotFound } from "../../_lib/client";
import { useLiveData } from "../../_lib/live";
import { ErrorPanel, PageHeader } from "../../_components/parts";

export default function AdminReviewCasePage() {
  const { flagId } = useParams<{ flagId: string }>();
  const { user } = useSession();
  const toast = useToast();
  const live = useLiveData(() => reviewApi.flag(flagId), [flagId], { kinds: ["user"], pollMs: 30_000 });
  const [flag, setFlag] = useState<ReviewFlag>();
  useEffect(() => setFlag(live.data), [live.data]);

  function onChange(next: ReviewFlag, result?: ReviewDecideResponse) {
    setFlag(next);
    if (!result) return;
    const rollback = result.rollback ? ` ${result.rollback.voidedMatches} wins voided.` : "";
    toast.push({
      title: next.status === "confirmed" ? "Cheating confirmed" : "Player cleared",
      body: `${result.reportsUpdated} reports updated.${result.banId ? " Ban applied." : ""}${rollback}`,
      tone: "success",
    });
  }

  if (live.error && !flag) {
    return (
      <>
        <PageHeader title="Case" actions={<Link href="/admin/review">Back to queue</Link>} />
        {isNotFound(live.error) ? <p className="muted">No case with this id.</p> : <ErrorPanel error={live.error} onRetry={live.reload} what="the case" />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={flag ? `Case: ${flag.player.displayName}` : "Case"}
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
        actions={<Link href="/admin/review">Back to queue</Link>}
      />
      {flag ? <ReviewCase flag={flag} viewer={user?.steamId} onChange={onChange} /> : <p className="muted">Loading</p>}
    </>
  );
}
