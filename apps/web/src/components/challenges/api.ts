// REST client for challenges. Mock mode runs the flows in memory
import type { Challenge, CreateChallengeBody, CreateChallengeResponse } from "@rushsite/shared";
import { isMock } from "@/lib/env";
import { mockAccept, mockCreate, mockDecline, mockGet, mockMine } from "./mock";

type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

async function mocked<T>(fn: () => T): Promise<T> {
  await delay();
  return fn();
}

export function challengeApi(request: Request) {
  const at = (code: string) => `/challenges/${encodeURIComponent(code)}`;
  return {
    async create(body: CreateChallengeBody): Promise<CreateChallengeResponse> {
      if (isMock) return mocked(() => mockCreate(body));
      return request("POST", "/challenges", body);
    },
    async get(code: string): Promise<Challenge> {
      if (isMock) return mocked(() => mockGet(code));
      return (await request<{ challenge: Challenge }>("GET", at(code))).challenge;
    },
    async accept(code: string): Promise<Challenge> {
      if (isMock) return mocked(() => mockAccept(code));
      return (await request<{ challenge: Challenge }>("POST", `${at(code)}/accept`)).challenge;
    },
    async decline(code: string): Promise<Challenge> {
      if (isMock) return mocked(() => mockDecline(code));
      return (await request<{ challenge: Challenge }>("POST", `${at(code)}/decline`)).challenge;
    },
    async mine(): Promise<Challenge[]> {
      if (isMock) return mocked(mockMine);
      return (await request<{ challenges: Challenge[] }>("GET", "/challenges/mine")).challenges;
    },
  };
}
