import {
  AgentHealthSchema,
  StartServerResponseSchema,
  type AgentHealth,
  type StartServerRequest,
  type StartServerResponse,
} from "@rushsite/shared"

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export interface AgentApi {
  health(agentUrl: string): Promise<AgentHealth>
  start(agentUrl: string, req: StartServerRequest): Promise<StartServerResponse>
  stop(agentUrl: string, matchId: string): Promise<void>
}

// HTTP client for the Go host agent
export class HttpAgentClient implements AgentApi {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  private async call(agentUrl: string, path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${agentUrl.replace(/\/+$/, "")}${path}`
    let res: Response
    try {
      res = await this.fetchFn(url, {
        ...init,
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      throw new AgentError(`agent ${url} unreachable: ${(err as Error).message}`)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new AgentError(`agent ${url} returned ${res.status} ${body.slice(0, 200)}`, res.status)
    }
    return res
  }

  async health(agentUrl: string): Promise<AgentHealth> {
    const res = await this.call(agentUrl, "/health")
    return AgentHealthSchema.parse(await res.json())
  }

  async start(agentUrl: string, req: StartServerRequest): Promise<StartServerResponse> {
    const res = await this.call(agentUrl, "/servers", { method: "POST", body: JSON.stringify(req) })
    return StartServerResponseSchema.parse(await res.json())
  }

  async stop(agentUrl: string, matchId: string): Promise<void> {
    try {
      await this.call(agentUrl, `/servers/${encodeURIComponent(matchId)}`, { method: "DELETE" })
    } catch (err) {
      // Already gone is fine
      if (err instanceof AgentError && err.status === 404) return
      throw err
    }
  }
}
