// src/contracts/errors.mjs — one error type, carrying the HTTP answer with it.
//
// Same shape as ConsentError in src/consent/index.mjs and for the same reason:
// the module knows whether a refusal is the caller's fault (400), a permissions
// problem (403), a missing row (404) or a conflict (409). Encoding that at the
// throw site means the handler maps errors in one line instead of re-deriving a
// status from a string, which is how a 409 ends up reported as a 500.
//
// `message` is written for a staff member or a client to read. Nothing in this
// module produces a message that assumes the reader knows what a column is.

export class ContractError extends Error {
  constructor(message, { status = 400, code = "contract_error", detail = null } = {}) {
    super(message);
    this.name = "ContractError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (message, code = "bad_request", detail = null) =>
  new ContractError(message, { status: 400, code, detail });

export const notFound = (message = "That contract does not exist.", code = "not_found") =>
  new ContractError(message, { status: 404, code });

export const conflict = (message, code = "conflict", detail = null) =>
  new ContractError(message, { status: 409, code, detail });

export const forbidden = (message, code = "forbidden") =>
  new ContractError(message, { status: 403, code });
