export class PluginError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PluginError";
  }
}

export class NotLinkedError extends PluginError {
  constructor() {
    super("not_linked", "Repo not linked. Run /weft-plugin:memory-link <project-id> <token> first.");
  }
}

export class TokenInvalidError extends PluginError {
  constructor() {
    super("token_invalid", "Project token is invalid or has been rotated. Run /weft-plugin:memory-link with a fresh token.");
  }
}

export class NetworkError extends PluginError {
  constructor(cause: string) {
    super("network", `Memory service unreachable: ${cause}`);
  }
}

export class UnexpectedStatusError extends PluginError {
  constructor(readonly status: number, body: string) {
    super("unexpected_status", `Service returned ${status}: ${body}`);
  }
}

export class InsecureServerError extends PluginError {
  constructor(server: string) {
    super("insecure_server", `Refusing insecure server URL: HTTPS required (localhost exempt). Got: ${server}`);
  }
}
