import {
  CHAT_GLOBAL_CHANNEL,
  type ChatAuthor,
  type ChatHistoryResponse,
  type ChatMessage,
  type ChatMuteStatus,
} from "@rushsite/shared";
import { ApiError, api } from "@/lib/api";
import { isMock } from "@/lib/env";
import { MOCK_ME, mockCall, mockSteamId } from "@/lib/mock";

// Mock mode keeps a small local channel so the sidebar can be built without the api
const mockAuthors: ChatAuthor[] = [
  { steamId: mockSteamId(3), displayName: "kestrel", avatarUrl: null, trustLevel: "trusted", tier: "platinum", admin: false },
  { steamId: mockSteamId(4), displayName: "vanta", avatarUrl: null, trustLevel: "verified", tier: "gold", admin: false },
  { steamId: mockSteamId(5), displayName: "oxbow", avatarUrl: null, trustLevel: "new", tier: "unranked", admin: false },
];
const mockLines = ["anyone for rush", "gg that last round was close", "aim_redline is so good", "queue times fine tonight", "2v2 duo? need one"];
let mockMessages: ChatMessage[] | null = null;

function seedMock(): ChatMessage[] {
  if (mockMessages) return mockMessages;
  const start = Date.now() - mockLines.length * 90_000;
  mockMessages = mockLines.map((body, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    channel: CHAT_GLOBAL_CHANNEL,
    author: mockAuthors[i % mockAuthors.length]!,
    body,
    createdAt: new Date(start + i * 90_000).toISOString(),
  }));
  return mockMessages;
}

export const chatApi = {
  history(before?: string): Promise<ChatHistoryResponse> {
    if (isMock) {
      return mockCall(() => ({
        channel: CHAT_GLOBAL_CHANNEL,
        messages: before ? [] : [...seedMock()],
        me: { muted: null },
      }));
    }
    return api.get<ChatHistoryResponse>("/chat/messages", { channel: CHAT_GLOBAL_CHANNEL, before });
  },

  async post(body: string): Promise<ChatMessage> {
    if (isMock) {
      return mockCall(() => {
        const message: ChatMessage = {
          id: crypto.randomUUID(),
          channel: CHAT_GLOBAL_CHANNEL,
          author: {
            steamId: MOCK_ME.steamId,
            displayName: MOCK_ME.displayName,
            avatarUrl: MOCK_ME.avatarUrl,
            trustLevel: MOCK_ME.trustLevel,
            tier: "silver",
            admin: !!MOCK_ME.isAdmin,
          },
          body: body.trim(),
          createdAt: new Date().toISOString(),
        };
        seedMock().push(message);
        return message;
      });
    }
    return (await api.post<{ message: ChatMessage }>("/chat/messages", { channel: CHAT_GLOBAL_CHANNEL, body })).message;
  },

  async deleteMessage(id: string): Promise<void> {
    if (isMock) {
      await mockCall(() => {
        mockMessages = seedMock().filter((m) => m.id !== id);
      });
      return;
    }
    await api.del(`/admin/chat/messages/${encodeURIComponent(id)}`);
  },

  // Null minutes is permanent
  async mute(steamId: string, minutes: number | null, reason: string): Promise<ChatMuteStatus> {
    if (isMock) {
      return mockCall(() => ({ until: minutes === null ? null : new Date(Date.now() + minutes * 60_000).toISOString(), reason }));
    }
    return (await api.put<{ mute: ChatMuteStatus }>(`/admin/chat/mutes/${steamId}`, { minutes, reason })).mute;
  },

  async unmute(steamId: string): Promise<void> {
    if (isMock) return mockCall(() => undefined);
    await api.del(`/admin/chat/mutes/${steamId}`);
  },
};

export function chatError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Sign in again to chat.";
    return e.message || e.code;
  }
  return "Could not reach chat. Try again.";
}

export type Refusal = { code: string; message: string; until: number | null };

const WAIT_TEXT: Record<string, (sec: number) => string> = {
  chat_rate_limited: (s) => `You are sending messages too fast. You can post again in ${s}s.`,
  chat_slow_mode: (s) => `Slow mode is on. You can post again in ${s}s.`,
  chat_duplicate: (s) => `You just said that. Say something new, or wait ${s}s.`,
};

// A refused post as shown under the composer. Timed refusals count down to until
export function refusalFrom(e: unknown, now = Date.now()): Refusal {
  if (!(e instanceof ApiError)) return { code: "network", message: chatError(e), until: null };
  const retry = Number((e.details as { retryAfterSec?: unknown } | undefined)?.retryAfterSec);
  const until = Number.isFinite(retry) && retry > 0 ? now + retry * 1000 : null;
  return { code: e.code, message: chatError(e), until };
}

export function refusalText(r: Refusal, now = Date.now()): string {
  if (r.until === null) return r.message;
  const left = Math.max(1, Math.ceil((r.until - now) / 1000));
  return WAIT_TEXT[r.code]?.(left) ?? `${r.message.replace(/\s*Wait \d+s.*$/, "")} Try again in ${left}s.`;
}

export function mutedFrom(e: unknown): ChatMuteStatus | null {
  if (!(e instanceof ApiError) || e.code !== "chat_muted") return null;
  const d = (e.details ?? {}) as Partial<ChatMuteStatus>;
  return { until: d.until ?? null, reason: d.reason ?? "" };
}
