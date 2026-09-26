import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { NotifyPanel } from "@/components/notify/NotifyPanel";
import { DiscordPanel } from "./DiscordPanel";
import { DisplayPanel } from "./DisplayPanel";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className={`container page ${styles.settings}`}>
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Display and notification choices are saved in this browser only.</p>
        </div>
      </header>
      <DiscordPanel />
      <Card title="Display">
        <DisplayPanel />
      </Card>
      <Card title="Notifications">
        <NotifyPanel />
      </Card>
    </div>
  );
}
