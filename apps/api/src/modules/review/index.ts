import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import type { AppContext } from "../../context.js"
import { registerMyReportsRoute, registerReviewAdminRoutes } from "./routes.js"
import { ReviewService } from "./service.js"

export { ReviewService } from "./service.js"

export type ReviewPluginOptions = { ctx: AppContext }

const reviewPlugin: FastifyPluginAsync<ReviewPluginOptions> = async (app: FastifyInstance, opts) => {
  const service = reviewService(opts.ctx)
  registerMyReportsRoute(app, opts.ctx, service)
  // Own scope so the admin gate covers only the admin routes
  await app.register(async (admin) => registerReviewAdminRoutes(admin, opts.ctx, service))
}

// One service per context so the report route and the plugin share it
const services = new WeakMap<AppContext, ReviewService>()
export function reviewService(ctx: AppContext): ReviewService {
  let s = services.get(ctx)
  if (!s) {
    s = new ReviewService(ctx)
    services.set(ctx, s)
  }
  return s
}

export default reviewPlugin
