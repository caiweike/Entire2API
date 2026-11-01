export class GatewayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fail(message, code = 'invalid_request') {
  throw new GatewayError(400, code, message);
}

export function safeError(error) {
  return error instanceof GatewayError ? error : new GatewayError(500, 'internal_error', 'The gateway could not complete this request.');
}

export function errorBody(error, protocol, requestId) {
  const e = safeError(error);
  if (protocol === 'anthropic') {
    const type = e.status === 401 ? 'authentication_error' : e.status === 429 ? 'rate_limit_error' : e.status < 500 ? 'invalid_request_error' : 'api_error';
    return { type: 'error', error: { type, message: e.message }, request_id: requestId };
  }
  return { error: { message: e.message, type: e.status < 500 ? 'invalid_request_error' : 'api_error', param: null, code: e.code } };
}
