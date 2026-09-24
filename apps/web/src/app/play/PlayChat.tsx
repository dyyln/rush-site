"use client";

import { ChatBody } from "@/components/chat/ChatBody";
import styles from "./play.module.css";

// Global chat inside Play's side panel. The site wide chat sidebar is hidden on Play
export function PlayChat() {
  return <ChatBody open className={styles.chat} />;
}
