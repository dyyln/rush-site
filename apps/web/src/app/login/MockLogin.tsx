"use client";

import { useEffect } from "react";
import { setMockSignedIn } from "@/lib/mock";

// Mock mode has no Steam. Mark the mock user signed in and go back
export function MockLogin({ returnTo }: { returnTo: string }) {
  useEffect(() => {
    setMockSignedIn(true);
    window.location.replace(returnTo);
  }, [returnTo]);
  return null;
}
