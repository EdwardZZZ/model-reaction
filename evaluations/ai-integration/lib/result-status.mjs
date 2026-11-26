import assert from 'node:assert/strict';

export function assertResultStatus(result, id = 'attempt') {
  assert.ok(result.stages?.length, `${id}: missing stages`);
  assert.equal(result.initial_status, result.stages[0].status, `${id}: inconsistent initial_status`);
  assert.equal(result.final_status, result.stages.at(-1).status, `${id}: inconsistent final_status`);
}

export function rejectLastStage(original, finding) {
  const result = structuredClone(original);
  const stage = result.stages.at(-1);
  stage.automated_status = stage.status;
  stage.status = 'FAIL';
  stage.manual_constraints = finding;
  result.initial_status = result.stages[0].status;
  result.final_status = stage.status;
  return result;
}
