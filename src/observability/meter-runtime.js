import path from "node:path";
import { paths } from "../config/paths.js";
import { identityKey, openAIChatUsage, measureCompletion } from "./usage-meter.js";
import { UsageLedger } from "./usage-ledger.js";

export const usageLedger = new UsageLedger(path.join(paths.root, "usage-events.jsonl"));

export function measureModelRequest(create, request, meta) {
  const identity = {
    provider: process.env.METER_PROVIDER ?? "unconfigured",
    model: request.model,
    protocol: process.env.METER_PROTOCOL ?? "unconfigured"
  };
  const adapters = new Map();
  if (process.env.METER_USAGE_SCHEMA === "openai-chat-usage-v1" &&
      process.env.METER_PROVIDER && process.env.METER_PROTOCOL === "openai-chat" &&
      request.model === process.env.METER_MODEL) {
    adapters.set(identityKey(identity), openAIChatUsage);
  }
  return measureCompletion(create, request, {
    ...meta, identity, adapters, record: event => usageLedger.append(event)
  });
}