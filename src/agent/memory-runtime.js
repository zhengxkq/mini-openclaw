import path from "node:path";
import { paths } from "../config/paths.js";
import { MemoryStore } from "./memory-store.js";

export const memoryStore = new MemoryStore(path.join(paths.agentDir(), "memories.json"));