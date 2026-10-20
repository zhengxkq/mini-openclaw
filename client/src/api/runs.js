// client/src/api/runs.js
export async function stopRun(sessionId, runId) {
    const response = await fetch(`/api/runs/${runId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
    });
    return response.ok;
}