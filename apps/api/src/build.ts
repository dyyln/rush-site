// The commit this image was built from. The Dockerfile bakes these in from build args,
// so they are null in dev and tests.
export type BuildInfo = { sha: string | null; subject: string | null; builtAt: string | null }

const nonEmpty = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : null)

export function buildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return { sha: nonEmpty(env.BUILD_SHA), subject: nonEmpty(env.BUILD_SUBJECT), builtAt: nonEmpty(env.BUILD_TIME) }
}
