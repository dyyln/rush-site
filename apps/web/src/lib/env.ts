export const isMock = process.env.NEXT_PUBLIC_MOCK === "1";

export const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

export const wsUrl =
  process.env.NEXT_PUBLIC_WS_URL ?? apiUrl.replace(/^http/, "ws") + "/ws";
