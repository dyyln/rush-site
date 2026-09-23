import type { CSSProperties } from "react";
import { cx } from "./cx";
import styles from "./Skeleton.module.css";

type SkeletonProps = {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  // text is a line of body copy, block is a panel, avatar matches ui/Avatar
  shape?: "text" | "block" | "circle" | "pill" | "avatar";
  className?: string;
  style?: CSSProperties;
};

// Placeholder shape shown while data loads. Decorative, so wrap groups in a region with aria-busy
export function Skeleton({ width, height, shape = "text", className, style }: SkeletonProps) {
  return <span aria-hidden="true" className={cx(styles.skeleton, styles[shape], className)} style={{ width, height, ...style }} />;
}

// Several text lines. The last one is shorter so it reads like a paragraph
export function SkeletonText({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cx(styles.lines, className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? "60%" : "100%"} />
      ))}
    </span>
  );
}

// Wraps a skeleton layout and tells assistive tech that content is loading
export function SkeletonRegion({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className} aria-busy="true" role="status">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}
