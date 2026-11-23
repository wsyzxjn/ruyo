export type ErrorCode = 'UNSUPPORTED_URL' | 'INVALID_OPTIONS' | 'UNSUPPORTED_CONTENT'
  | 'ACCESS_RESTRICTED' | 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'ASSET_ERROR' | 'RENDER_ERROR'

export class RuyoError extends Error {
  constructor(readonly code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RuyoError'
  }
}
