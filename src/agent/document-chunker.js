// src/agent/document-chunker.js
const HEADING = /^(#{1,6})\s+(.+)$/;
const FENCE = /^\s*(```|~~~)/;

function splitLong(block, maxChars) {
  const pieces = [];
  let current = null;
  block.lines.forEach((line, offset) => {
    const lineNo = block.startLine + offset;
    for (let start = 0; start < Math.max(line.length, 1); start += maxChars) {
      const part = line.slice(start, start + maxChars);
      if (current && current.body.length + 1 + part.length > maxChars) {
        pieces.push(current);
        current = null;
      }
      if (current) {
        current.body += "\n" + part;
        current.endLine = lineNo;
      } else {
        current = { heading: block.heading, startLine: lineNo, endLine: lineNo, body: part };
      }
    }
  });
  if (current) pieces.push(current);
  return pieces;
}

export function chunkDocument(text, { maxChars = 600 } = {}) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const headings = [];
  const blocks = [];
    let block = null;
  let inFence = false;
  const close = () => {
    if (block) blocks.push(block);
    block = null;
  };

  lines.forEach((line, offset) => {
    if (FENCE.test(line)) inFence = !inFence;
    const match = !inFence && line.match(HEADING);
    if (match) {
      close();
      headings.length = match[1].length - 1;
      headings.push(match[2].trim());
      return;
    }
    if (!inFence && !line.trim()) {
      close();
      return;
    }
    block ??= { heading: headings.filter(Boolean).join(" > "), startLine: offset + 1, lines: [] };
    block.lines.push(line);
    block.endLine = offset + 1;
  });
  close();

  const pieces = [];
  for (const next of blocks) {
    const body = next.lines.join("\n");
    const last = pieces.at(-1);
    if (body.length > maxChars) {
      pieces.push(...splitLong(next, maxChars));
    } else if (last && last.heading === next.heading && last.body.length + 2 + body.length <= maxChars) {
      last.body += "\n\n" + body;
      last.endLine = next.endLine;
    } else {
      pieces.push({ heading: next.heading, startLine: next.startLine, endLine: next.endLine, body });
    }
  }

  return pieces.map((piece, index) => ({
    index, startLine: piece.startLine, endLine: piece.endLine, heading: piece.heading,
    text: piece.heading ? `${piece.heading}\n${piece.body}` : piece.body
  }));
}