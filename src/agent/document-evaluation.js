import { checkCitations } from "./citations.js";


export function gradeRetrieval(results, expected) {
  if (expected === null) {
    return { passed: results.length === 0, rank: null, reciprocalRank: null };
  }
  const index = results.findIndex(result =>
    result.name === expected.name && result.heading === expected.heading);
  const rank = index < 0 ? null : index + 1;
  return { passed: rank !== null, rank, reciprocalRank: rank === null ? 0 : 1 / rank };
}

export function gradeAnswer({ answer, messages, requiredFacts = [], forbiddenFacts = [] }) {
  const citationOk = checkCitations({ answer, messages }).action === "accept";
  const missingFacts = requiredFacts.filter(fact => !answer.includes(fact));
  const unexpectedFacts = forbiddenFacts.filter(fact => answer.includes(fact));
  return { citationOk, missingFacts, unexpectedFacts,
    passed: citationOk && missingFacts.length === 0 && unexpectedFacts.length === 0 };
}