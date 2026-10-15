import path from "node:path";
import { paths } from "../config/paths.js";
import { DocumentStore } from "./document-store.js";
import { DocumentIndex } from "./document-index.js";
import { embed, embedBatch, EMBEDDING_DIMENSIONS, EMBEDDING_SPACE } from "../embedding-client.js";

export const documentStore = new DocumentStore(path.join(paths.agentDir(), "documents.json"));
export const documentIndex = new DocumentIndex(path.join(paths.agentDir(), "document-index.json"));
export const documentEmbedding = {
  embed, embedBatch, dimensions: EMBEDDING_DIMENSIONS, space: EMBEDDING_SPACE
};