// A specification is not a passing implementation. Only linked passing tests
// can close a requirement, and later build steps remain explicitly pending.

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || manifest.release !== 'v1.2' || !Array.isArray(manifest.requirements)) {
    return ['Expected a v1.2 requirement manifest'];
  }
  if (!Number.isInteger(manifest.built_through_step) || manifest.built_through_step < 0 || manifest.built_through_step > 5) {
    errors.push('built_through_step must be an integer from 0 to 5');
  }
  const ids = new Set();
  for (const r of manifest.requirements) {
    const id = r?.id;
    if (typeof id !== 'string' || !/^V12-\d{2,3}$/.test(id) || ids.has(id)) errors.push(`Invalid or duplicate requirement id: ${id}`);
    ids.add(id);
    if (!Number.isInteger(r?.step) || r.step < 0 || r.step > 5 || !manifest.steps?.[r.step]) errors.push(`${id}: invalid build step`);
    if (typeof r?.text !== 'string' || !r.text.trim()) errors.push(`${id}: missing rule`);
    if (!Array.isArray(r?.source) || !r.source.length || r.source.some(s => typeof s !== 'string' || !s.trim())) errors.push(`${id}: missing source`);
    if (r?.replaces !== null && typeof r?.replaces !== 'string') errors.push(`${id}: invalid replaced rule`);
    if (!Array.isArray(r?.tests)) {
      errors.push(`${id}: tests must be an array`);
      continue;
    }
    const refs = new Set();
    for (const t of r.tests) {
      if (typeof t?.file !== 'string' || !/^(?:worker\/)?tests\/(?:[\w-]+\/)*[\w.-]+\.(?:ts|mjs)$/.test(t.file) || typeof t?.title !== 'string' || !t.title.trim()) errors.push(`${id}: invalid test reference`);
      const ref = `${t?.file}::${t?.title}`;
      if (refs.has(ref)) errors.push(`${id}: duplicate test reference`);
      refs.add(ref);
    }
  }
  if (!manifest.requirements.length) errors.push('The requirement manifest is empty');
  return errors;
}

export function requirementLedger(manifest, rows) {
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(errors.join('\n'));
  return manifest.requirements.map(r => {
    const linked = r.tests.map(t => rows.filter(row => row.file === t.file && row.title === t.title && row.ids.includes(r.id)));
    const missing = !linked.length || linked.some(matches => !matches.length);
    const results = linked.flat();
    const failed = results.some(row => row.status === 'failed' || row.status === 'timedOut');
    const passed = !missing && results.length > 0 && results.every(row => row.status === 'passed');
    const due = r.step <= manifest.built_through_step;
    const status = failed ? 'failed' : passed ? 'passed' : due ? 'missing passing evidence' : 'not built';
    return { ...r, due, status, blocking: due && !passed };
  });
}

const cell = value => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
export function renderRequirementLedger(ledger) {
  return [
    '## Requirement ledger (v1.2)', '',
    'Target rules, not a claim that every feature exists. Only linked tests close a rule; future steps remain not built.', '',
    '| ID | Step | Rule | Replaces | Evidence |',
    '| --- | --- | --- | --- | --- |',
    ...ledger.map(r => `| ${r.id} | ${r.step} | ${cell(r.text)} | ${cell(r.replaces ?? '—')} | ${r.status} |`),
    '',
  ];
}
