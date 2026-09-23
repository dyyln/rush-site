"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { isMock } from "@/lib/env";
import { mockAdmin } from "../_lib/mock";
import { ManualBan } from "../_components/ManualBan";
import { PageHeader } from "../_components/parts";
import styles from "../admin.module.css";

// Accepts a SteamID64 or a steamcommunity.com/profiles/ URL
function parseSteamId(input: string): string | null {
  const m = input.trim().match(/(\d{17})/);
  return m ? m[1]! : null;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();

  return (
    <>
      <PageHeader title="Users" description="Look up a player by SteamID64 to see trust signals, ratings and history." />
      <Card>
        <form
          className={styles.formRow}
          onSubmit={(e) => {
            e.preventDefault();
            const id = parseSteamId(value);
            if (!id) return setError("Enter a 17 digit SteamID64 or a Steam profile URL");
            router.push(`/admin/users/${id}`);
          }}
        >
          <Input
            label="SteamID64"
            placeholder="76561198000000000"
            inputMode="numeric"
            value={value}
            error={error}
            onChange={(e) => {
              setValue(e.target.value);
              setError(undefined);
            }}
          />
          <Button type="submit">Look up</Button>
        </form>
      </Card>
      <ManualBan />
      {isMock && (
        <Card title="Sample players">
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {mockAdmin.sampleSteamIds().map((id) => (
              <li key={id}>
                <Link href={`/admin/users/${id}`} className="mono">
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
