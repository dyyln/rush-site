import type { Metadata } from "next";
import { BRAND_NAME } from "@rushsite/shared";
import { steamLoginUrl } from "@/lib/api";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "Sign in" };

type Props = { searchParams: Promise<{ returnTo?: string; error?: string }> };

// Only same site paths are allowed as a return target
function safeReturn(v: string | undefined): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/play";
}

export default async function LoginPage({ searchParams }: Props) {
  const { returnTo, error } = await searchParams;
  const href = steamLoginUrl(safeReturn(returnTo));

  return (
    <div className={`container page ${styles.wrap}`}>
      <section className={styles.panel} aria-labelledby="login-heading">
        <p className="eyebrow">{BRAND_NAME}</p>
        <h1 id="login-heading">Sign in</h1>
        <p className="muted">We never see your Steam password.</p>
        {error && (
          <p className={styles.error} role="alert">
            Steam sign in did not complete. Try again.
          </p>
        )}
        <a href={href} className={styles.steam}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="15" cy="9" r="3" fill="currentColor" />
            <circle cx="8.5" cy="15.5" r="2" fill="currentColor" />
            <path d="M8.5 15.5L15 9" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span>Sign in with Steam</span>
        </a>
      </section>
    </div>
  );
}
