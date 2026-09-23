// REST client for friends, presence and in-site party invites. Mock mode runs in memory
import type {
  FriendRequest,
  FriendsPendingResponse,
  FriendsResponse,
  PartyInvite,
  PartyUpdatePayload,
  RecentPlayer,
} from "@rushsite/shared";
import { isMock } from "@/lib/env";
import * as mock from "./mock";

type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

async function mocked<T>(fn: () => T): Promise<T> {
  await delay();
  return fn();
}

export type InviteResult = { invite: PartyInvite; party: PartyUpdatePayload };

export function friendsApi(request: Request) {
  return {
    async list(): Promise<FriendsResponse> {
      if (isMock) return mocked(mock.mockList);
      return request("GET", "/friends");
    },
    async pending(): Promise<FriendsPendingResponse> {
      if (isMock) return mocked(mock.mockPending);
      return request("GET", "/friends/pending");
    },
    async recent(): Promise<RecentPlayer[]> {
      if (isMock) return mocked(mock.mockRecent);
      return (await request<{ players: RecentPlayer[] }>("GET", "/friends/recent")).players;
    },
    // Re-runs the Steam auto-link
    async sync(): Promise<{ steamListAvailable: boolean; linked: number }> {
      if (isMock) return mocked(() => ({ steamListAvailable: true, linked: 0 }));
      return request("POST", "/friends/sync");
    },
    async add(steamId: string): Promise<FriendRequest> {
      if (isMock) return mocked(() => mock.mockSend(steamId));
      return (await request<{ request: FriendRequest }>("POST", "/friends/requests", { steamId })).request;
    },
    async accept(id: string): Promise<FriendRequest> {
      if (isMock) return mocked(() => mock.mockAccept(id));
      return (await request<{ request: FriendRequest }>("POST", `/friends/requests/${id}/accept`)).request;
    },
    async decline(id: string): Promise<FriendRequest> {
      if (isMock) return mocked(() => mock.mockDecline(id));
      return (await request<{ request: FriendRequest }>("POST", `/friends/requests/${id}/decline`)).request;
    },
    async cancel(id: string): Promise<FriendRequest> {
      if (isMock) return mocked(() => mock.mockCancel(id));
      return (await request<{ request: FriendRequest }>("DELETE", `/friends/requests/${id}`)).request;
    },
    async remove(steamId: string): Promise<void> {
      if (isMock) return mocked(() => mock.mockUnfriend(steamId));
      await request("DELETE", `/friends/${steamId}`);
    },
    // In-site invite. The api creates the party when needed
    async invite(steamId: string): Promise<InviteResult> {
      if (isMock) return mocked(() => mock.mockInvite(steamId));
      return request("POST", "/parties/invites", { steamId });
    },
    async acceptInvite(id: string): Promise<InviteResult> {
      if (isMock) return mocked(() => mock.mockAcceptInvite(id));
      return request("POST", `/parties/invites/${id}/accept`);
    },
    async declineInvite(id: string): Promise<PartyInvite> {
      if (isMock) return mocked(() => mock.mockDeclineInvite(id));
      return (await request<{ invite: PartyInvite }>("POST", `/parties/invites/${id}/decline`)).invite;
    },
  };
}
