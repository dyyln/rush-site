import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { NotifyPanel } from "@/components/notify/NotifyPanel";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className={`container page ${styles.settings}`}>
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Saved in this browser only.</p>
        </div>
      </header>
      <Card title="Notifications">
        <NotifyPanel />
      </Card>
    </div>
  );
}
