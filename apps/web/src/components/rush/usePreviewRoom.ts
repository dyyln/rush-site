import { useEffect, useState } from "react";

// The room card under the pointer or keyboard focus, drawn in the slot the pick would fill. The boards fall back
// to the viewer's own vote, so a chosen room stays in the slot until the step resolves.
// Clears when the step moves on so a stale preview never sits in the next slot
export function usePreviewRoom(stepIndex: number) {
  const [room, setRoom] = useState<string | null>(null);
  useEffect(() => setRoom(null), [stepIndex]);
  const previewOf = (r: string) => (on: boolean) => setRoom((cur) => (on ? r : cur === r ? null : cur));
  return { previewRoom: room, previewOf };
}
