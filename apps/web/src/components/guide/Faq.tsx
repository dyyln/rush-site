import { Card } from "@/components/ui/Card";
import type { FaqItem } from "@/lib/seo";
import styles from "./guide.module.css";

export function Faq({ items, title = "Questions" }: { items: FaqItem[]; title?: string }) {
  return (
    <Card title={title}>
      <dl className={styles.faq}>
        {items.map((f) => (
          <div key={f.q}>
            <dt>{f.q}</dt>
            <dd>{f.a}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
