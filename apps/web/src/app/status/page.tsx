import type { Metadata } from "next";
import { StatusView } from "./StatusView";

export const metadata: Metadata = { title: "Server status" };

export default function StatusPage() {
  return <StatusView />;
}
