// src/channels/http.js
import Fastify from "fastify";
import cors from "@fastify/cors";
import { BaseChannel } from "./base.js";
import { AgentRunError } from "../agent/run-policy.js";
import { documentStore, documentIndex, documentEmbedding } from "../agent/document-runtime.js";
import { chunkDocument } from "../agent/document-chunker.js";
import { resolveSource } from "../agent/citations.js";

const documentErrorStatus = {
    INVALID_DOCUMENT: 400,
    INVALID_CITATION: 400,
    DOCUMENT_NOT_FOUND: 404,
    SOURCE_NOT_FOUND: 404,
    DOCUMENT_VERSION_CONFLICT: 409,
    SOURCE_DELETED: 410,
    SOURCE_OUTDATED: 410
};

function documentSummary(doc) {
    return {
        id: doc.id, name: doc.name, version: doc.version, importedAt: doc.importedAt,
        lines: doc.content.split("\n").length,
        chunks: chunkDocument(doc.content).length
    };
}

function sendDocumentError(reply, error) {
    if (!(error instanceof AgentRunError)) throw error;
    return reply.code(documentErrorStatus[error.code] ?? 500)
        .send({ code: error.code, error: error.message });
}

export class HttpChannel extends BaseChannel {
    #fastify;
    #port;
    #sseClients = new Map();
    #messageQueue = new Map();

    constructor(port = 3000) {
        super("http");  // ← 调用父类构造函数，设置 this.name = "http"
        this.#port = port;
        this.#fastify = Fastify({ logger: false });
    }

    // 实现父类要求的 start()
    async start() {
        await this.#fastify.register(cors, {
            origin: true,
            methods: ["GET", "POST", "OPTIONS"]
        });

        this.#registerRoutes();

        await this.#fastify.listen({ port: this.#port, host: "0.0.0.0" });
        console.log(`[HTTP] 服务启动，端口 ${this.#port}`);
    }

    // 实现父类要求的 send()
    // 用于发送完整消息（Heartbeat 推送、错误提示等）
    async send(sessionId, text) {
        const client = this.#sseClients.get(sessionId);

        const payload = {
            type: "message",
            text,
            timestamp: new Date().toISOString()
        };

        if (client && !client.destroyed) {
            client.write(`data: ${JSON.stringify(payload)}\n\n`);
        } else {
            // SSE 还没建立，先缓存
            if (!this.#messageQueue.has(sessionId)) {
                this.#messageQueue.set(sessionId, []);
            }
            this.#messageQueue.get(sessionId).push(payload);
        }
    }

    // 实现父类要求的 stop()
    async stop() {
        await this.#fastify.close();
        console.log("[HTTP] 服务已停止");
    }

    // ── HTTP 专属方法（SSE 流式推送）──────────────────────────

    async sendChunk(sessionId, chunk) {
        this.#writeSSE(sessionId, { type: "chunk", text: chunk });
    }

    async sendToolCall(sessionId, toolCall) {
        this.#writeSSE(sessionId, { type: "tool_call", ...toolCall });
    }

    async sendRunEvent(sessionId, event) {
        this.#writeSSE(sessionId, { type: "run_event", event });
    }

    async sendDone(sessionId) {
        this.#writeSSE(sessionId, { type: "done" });
    }

    async sendTyping(sessionId) {
        this.#writeSSE(sessionId, { type: "typing" });
    }

    async sendError(sessionId, message) {
        this.#writeSSE(sessionId, { type: "error", message });
    }

    // ── 私有方法 ──────────────────────────────────────────────

    // 统一的 SSE 写入，避免每个方法重复这段逻辑
    #writeSSE(sessionId, payload) {
        const client = this.#sseClients.get(sessionId);
        if (client && !client.destroyed) {
            client.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
    }

    #registerRoutes() {
        const fastify = this.#fastify;

        fastify.get("/health", async () => ({
            status: "ok",
            time: new Date().toISOString()
        }));

        fastify.post("/api/chat", async (req, reply) => {
            const { sessionId, message } = req.body;
            if (!sessionId || !message) {
                return reply.code(400).send({ error: "缺少 sessionId 或 message" });
            }

            this.onMessage?.({
                sessionId: `http-${sessionId}`,
                text: message,
                channelName: "http"
            });

            return { ok: true };
        });

        fastify.get("/api/chat/stream", async (req, reply) => {
            const { sessionId } = req.query;
            if (!sessionId) {
                return reply.code(400).send({ error: "缺少 sessionId" });
            }

            const fullSessionId = `http-${sessionId}`;

            reply.raw.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            });

            this.#sseClients.set(fullSessionId, reply.raw);
            console.log(`[HTTP] SSE 连接建立: ${fullSessionId}`);

            // 发送缓存的消息
            const queued = this.#messageQueue.get(fullSessionId) ?? [];
            for (const msg of queued) {
                reply.raw.write(`data: ${JSON.stringify(msg)}\n\n`);
            }
            this.#messageQueue.delete(fullSessionId);

            // 心跳防超时
            const heartbeat = setInterval(() => {
                if (!reply.raw.destroyed) {
                    reply.raw.write(": heartbeat\n\n");
                }
            }, 15000);

            req.raw.on("close", () => {
                clearInterval(heartbeat);
                this.#sseClients.delete(fullSessionId);
                console.log(`[HTTP] SSE 连接断开: ${fullSessionId}`);
            });

            await new Promise(() => { });
        });

        fastify.get("/api/sessions", async () => {
            const sessions = [...this.#sseClients.keys()].map(id => ({
                sessionId: id.replace("http-", ""),
                connected: true
            }));
            return { sessions };
        });

        fastify.post("/api/sessions", async () => {
            const sessionId = `session-${Date.now()}`;
            return { sessionId };
        });

        fastify.get("/api/documents", async (req, reply) => {
            try {
                return { documents: documentStore.list().map(documentSummary) };
            } catch (error) {
                return sendDocumentError(reply, error);
            }
        });

        fastify.post("/api/documents", async (req, reply) => {
            try {
                const doc = documentStore.save({ name: req.body?.name, content: req.body?.content });
                let indexError = null;
                try {
                    documentIndex.prune(documentStore, documentEmbedding);
                    await documentIndex.vectorsFor([doc], documentEmbedding);
                } catch (error) {
                    if (!(error instanceof AgentRunError)) throw error;
                    indexError = `${error.code}：${error.message}`;
                }
                return { document: documentSummary(doc), indexed: indexError === null, indexError };
            } catch (error) {
                return sendDocumentError(reply, error);
            }
        });
        fastify.get("/api/documents/sources/:ref", async (req, reply) => {
            try {
                return resolveSource(documentStore, req.params.ref);
            } catch (error) {
                return sendDocumentError(reply, error);
            }
        });

        fastify.get("/api/documents/:id/chunks", async (req, reply) => {
            try {
                const doc = documentStore.list().find(item => item.id === req.params.id);
                if (!doc) return reply.code(404).send({ code: "DOCUMENT_NOT_FOUND", error: "没有这份有效资料。" });
                return { name: doc.name, version: doc.version, chunks: chunkDocument(doc.content) };
            } catch (error) {
                return sendDocumentError(reply, error);
            }
        });

        fastify.delete("/api/documents/:id", async (req, reply) => {
            try {
                const doc = documentStore.remove(req.params.id, Number(req.query.version));
                documentIndex.prune(documentStore, documentEmbedding);
                return { deleted: doc.id, version: doc.version };
            } catch (error) {
                return sendDocumentError(reply, error);
            }
        });
    }
}