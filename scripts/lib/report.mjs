// One error contract for every tool (DX22): problem, plain-language why,
// fix, and a docs anchor. Tools collect problems and print them together.

export function formatProblem({ where, problem, why, id, fix, docs }) {
  const lines = [`✖ ${where ? `${where}: ` : ''}${problem}`];
  if (why) lines.push(`  why: ${why}${id ? ` [${id}]` : ''}`);
  if (fix) lines.push(`  fix: ${fix}`);
  if (docs) lines.push(`  docs: ${docs}`);
  return lines.join('\n');
}

export function printProblems(problems, stream = process.stderr) {
  for (const p of problems) stream.write(`${formatProblem(p)}\n`);
}
