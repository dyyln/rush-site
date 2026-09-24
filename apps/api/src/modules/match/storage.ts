import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type { DemoUpload } from "@rushsite/shared"
import type { Env } from "../../env.js"

export type DemoBody = ReadableStream | Buffer

export interface DemoStorage {
  readonly enabled: boolean
  // mapNumber is set for the maps of a series
  presignUpload(matchId: string, mapNumber?: number): Promise<DemoUpload>
  upload(key: string, body: DemoBody): Promise<void>
  // Presigned GET for players downloading the demo
  presignDownload?(key: string, expiresInSec: number): Promise<string>
}

// Upload URL lives long enough for a full match plus upload time. The last map of a Bo5 series fits too
const PUT_EXPIRY_SEC = 6 * 60 * 60

export function demoKey(matchId: string, now = new Date(), mapNumber?: number): string {
  const d = now.toISOString().slice(0, 10)
  return mapNumber ? `demos/${d}/${matchId}_m${mapNumber}.dem` : `demos/${d}/${matchId}.dem`
}

export class S3DemoStorage implements DemoStorage {
  readonly enabled = true
  private readonly client: S3Client

  constructor(private readonly env: Env) {
    this.client = new S3Client({
      region: env.S3_REGION,
      // Presigned URLs must point at an endpoint the game host can reach
      endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    })
  }

  async presignUpload(matchId: string, mapNumber?: number): Promise<DemoUpload> {
    const key = demoKey(matchId, new Date(), mapNumber)
    // No Content-Type in the signature so the plugin can upload with any header
    const cmd = new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key })
    const presignedPutUrl = await getSignedUrl(this.client, cmd, { expiresIn: PUT_EXPIRY_SEC })
    return { bucket: this.env.S3_BUCKET, key, presignedPutUrl }
  }

  async presignDownload(key: string, expiresInSec: number): Promise<string> {
    const file = key.split("/").pop() ?? "demo.dem"
    const cmd = new GetObjectCommand({
      Bucket: this.env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${file}"`,
    })
    return getSignedUrl(this.client, cmd, { expiresIn: expiresInSec })
  }

  async upload(key: string, body: DemoBody): Promise<void> {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(await new Response(body).arrayBuffer())
    await this.client.send(
      new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: bytes, ContentType: "application/octet-stream" }),
    )
  }
}

// Used when no object storage is configured. The plugin upload will fail and the match still counts
export class DisabledDemoStorage implements DemoStorage {
  readonly enabled = false
  constructor(private readonly bucket = "disabled") {}

  async presignUpload(matchId: string, mapNumber?: number): Promise<DemoUpload> {
    return { bucket: this.bucket, key: demoKey(matchId, new Date(), mapNumber), presignedPutUrl: "http://127.0.0.1:9/demo-upload-disabled" }
  }

  async upload(): Promise<void> {
    // Nowhere to put it
  }
}

export function createDemoStorage(env: Env): DemoStorage {
  if (env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) return new S3DemoStorage(env)
  return new DisabledDemoStorage(env.S3_BUCKET)
}
