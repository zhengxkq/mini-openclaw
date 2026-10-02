export class AgentRunError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentRunError";
    this.code = code;
  }
}
