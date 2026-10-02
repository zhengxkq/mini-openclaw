export function collectToolDelta(calls, part) {
  if (!Number.isInteger(part.index) || part.index < 0) {
    throw new Error("工具片段缺少有效 index");
  }
  const item = calls[part.index] ??= { id: "", name: "", arguments: "" };
  if (part.id) item.id = part.id;
  item.name += part.function?.name ?? "";
  item.arguments += part.function?.arguments ?? "";
}