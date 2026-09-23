"use client";

import { useId } from "react";
import styles from "./friends.module.css";

// Name filter used by the friends card, the /friends page and the invite popover
export function SearchBox({ value, onChange, label = "Search friends", placeholder = "Search by name" }: { value: string; onChange: (v: string) => void; label?: string; placeholder?: string }) {
  const id = useId();
  return (
    <div className={styles.search}>
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={styles.searchIcon}>
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input id={id} type="search" autoComplete="off" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
