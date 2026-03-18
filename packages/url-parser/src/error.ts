export const ERROR_CODES = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
} as const;

type ErrorCode = keyof typeof ERROR_CODES;

export class HTTPError extends Error {
  readonly status: number;

  constructor(
    message: string,
    { code = "INTERNAL_SERVER_ERROR" }: { code?: ErrorCode } = {},
  ) {
    super(message);
    this.status = ERROR_CODES[code];
  }
}
