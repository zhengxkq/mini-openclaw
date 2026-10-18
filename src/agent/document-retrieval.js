const CODE = /^[a-z][a-z0-9]*-\d[a-z0-9-]*$/;
export const isCode = term => CODE.test(term);

export function searchTerms(text) {
  const normalized = text.normalize("NFKC").toLowerCase();
  const terms = normalized.match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/g) ?? [];
  for (const phrase of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    if (phrase.length === 1) continue;
    for (let i = 0; i < phrase.length - 1; i++) terms.push(phrase.slice(i, i + 2));
  }
  return [...new Set(terms)];
}


export function keywordCandidates(slots, query, { limit = 8, minCoverage = 0.5 } = {}) {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  return slots.map(slot => {
    const words = new Set(searchTerms(`${slot.doc.name}\n${slot.chunk.text}`));
    const matchedTerms = terms.filter(term => words.has(term));
    return { slot, matchedTerms, keywordScore: matchedTerms.length / terms.length };
  }).filter(item => item.keywordScore >= minCoverage || item.matchedTerms.some(isCode))
    .sort((a, b) => b.keywordScore - a.keywordScore).slice(0, limit);
}


const slotKey = slot => JSON.stringify([slot.doc.id, slot.doc.version, slot.chunk.index]);

export function fuseRanks(vector, keyword, { rankConstant = 60 } = {}) {
  const merged = new Map();
  for (const [channel, rows] of [["vector", vector], ["keyword", keyword]]) {
    rows.forEach((row, index) => {
      const key = slotKey(row.slot);
      const item = merged.get(key) ?? { slot: row.slot, score: null, keywordScore: 0,
        vectorRank: null, keywordRank: null, fusedScore: 0 };
      item[`${channel}Rank`] = index + 1;
      item.fusedScore += 1 / (rankConstant + index + 1);
      if (channel === "vector") item.score = row.score;
      else item.keywordScore = row.keywordScore;
      merged.set(key, item);
    });
  }
  return [...merged.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}

export function rerankCandidates(candidates, query) {
  const codes = searchTerms(query).filter(isCode);
  const accepted = [], rejected = [];
  for (const item of candidates) {
    const terms = new Set(searchTerms(`${item.slot.doc.name}\n${item.slot.chunk.text}`));
    const missingCodes = codes.filter(code => !terms.has(code));
    if (missingCodes.length) rejected.push({ ...item, missingCodes });
    else accepted.push(item);
  }
  accepted.sort((a, b) => codes.length
    ? b.keywordScore - a.keywordScore || b.fusedScore - a.fusedScore
    : b.fusedScore - a.fusedScore);
  return { accepted, rejected };
}