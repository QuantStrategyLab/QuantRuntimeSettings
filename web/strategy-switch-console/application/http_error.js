export class HttpError extends Error {
  constructor(message, status, details = null) {
    super(message);
    this.status = status;
    this.reason_code = (details && details.reason_code) || message;
    this.reason = (details && details.reason) || "";
  }
}
