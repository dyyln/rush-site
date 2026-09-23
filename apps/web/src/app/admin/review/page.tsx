"use client";

import { FLAG_STATUSES, type FlagStatus } from "@rushsite/shared";
import { useState } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { reviewApi } from "@/components/review/api";
import { FLAG_STATUS } from "@/components/review/copy";
import { ReviewQueueItem } from "@/components/review/ReviewQueueItem";
import styles from "@/components/review/review.module.css";
import { useLiveData } from "../_lib/live";
import { ErrorPanel, PageHeader } from "../_components/parts";

export default function AdminReviewPage() {
  const [status, setStatus] = useState<FlagStatus>("open");
  const live = useLiveData(() => reviewApi.list(status), [status], { kinds: ["user"], pollMs: 30_000 });
  const counts = live.data?.counts;

  return (
    <>
      <PageHeader
        title="Review"
        description="Players flagged by reports. Claim a case, watch the match and rule on it."
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
      />
      <SegmentedControl
        label="Status"
        showLabel={false}
        value={status}
        onChange={setStatus}
        options={FLAG_STATUSES.map((s) => ({ value: s, label: counts ? `${FLAG_STATUS[s].label} ${counts[s]}` : FLAG_STATUS[s].label }))}
      />
      {live.error && !live.data ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="the review queue" />
      ) : !live.data ? (
        <p className="muted" aria-busy="true">
          Loading
        </p>
      ) : live.data.flags.length === 0 ? (
        <p className="muted">No {FLAG_STATUS[status].label.toLowerCase()} cases.</p>
      ) : (
        <ul className={styles.list}>
          {live.data.flags.map((f) => (
            <li key={f.id}>
              <ReviewQueueItem flag={f} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
