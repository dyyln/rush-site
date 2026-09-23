export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code)
  }
}

export const badRequest = (code: string, message?: string, details?: unknown) => new ApiError(400, code, message, details)
export const unauthorized = (code = "unauthorized") => new ApiError(401, code)
export const forbidden = (code: string, message?: string) => new ApiError(403, code, message)
export const notFound = (code = "not_found") => new ApiError(404, code)
export const conflict = (code: string, message?: string) => new ApiError(409, code, message)
