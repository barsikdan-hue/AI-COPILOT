import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepare, parseAnswers, summarize, execute } from './runner.mjs';
const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)));
const questions = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url)));
const ready = () => prepare(cases, questions);
const reply = () => ({ model: 'jev-mock', answers: Object.fromEntries(questions.map(q => [q.id, {type:'choice', choice:'UNKNOWN', probabilities:{YES:0.1,NO:0.1,UNKNOWN:0.8},confidence:0.8}])) });

test('20 requests of 64 predicates contain no ground truth or credentials', () => {
  const plan=ready(); assert.equal(plan.requests.length,20); assert.equal(plan.total_decisions,1280);
  for(const request of plan.requests) { assert.equal(request.model,'jev-latest'); assert.equal(Object.keys(request.questions).length,64); assert.equal(request.questions.q01.type,'choice'); }
  assert(!/"expected"\s*:/.test(JSON.stringify(plan.requests)));
  assert.throws(()=>prepare(cases.slice(1),questions));
  assert.throws(()=>prepare(cases,[...questions.slice(1),questions[1]]));
});
test('dry-run cannot call transport and leaves Jev scores and latency unavailable', async () => {
  const result=await execute(ready(), {live:false, transport:()=>{throw Error('NETWORK_FORBIDDEN')}});
  assert.equal(result.calls_attempted,0); assert.equal(result.rows.length,1280);
  assert(result.rows.every(r=>r.jev_answer==='NOT_RUN' && r.latency_ms===null && r.pass===null));
  assert.equal(result.metrics.accuracy,null); assert.equal(result.metrics.latency.median_ms,null);
});
test('live execution requires exact owner approval and a process key before transport', async () => {
  let calls=0; const transport=()=>{calls++;};
  await assert.rejects(execute(ready(),{live:true,apiKey:'mock-only',transport}),/OWNER_GATE/);
  await assert.rejects(execute(ready(),{live:true,approvedHash:'wrong',apiKey:'mock-only',transport}),/OWNER_GATE/);
  await assert.rejects(execute(ready(),{live:true,approvedHash:ready().approval_hash,transport}),/JEV_AI_API_KEY/);
  assert.equal(calls,0);
});
test('a 429 consumes one attempt, is never retried, and stops the campaign', async () => {
  let calls=0; const plan=ready();
  const result=await execute(plan,{live:true,approvedHash:plan.approval_hash,apiKey:'mock-only',transport:async()=>{calls++;return {ok:false,status:429};}});
  assert.equal(calls,1); assert.equal(result.calls_attempted,1);
  assert.equal(result.rows.filter(r=>r.jev_answer==='ERROR').length,64);
  assert.equal(result.rows.filter(r=>r.jev_answer==='NOT_RUN').length,1216);
});
test('malformed, missing and extra answers are rejected, probabilities stay numeric', () => {
  const good=reply(); assert.equal(parseAnswers(good,questions).q01.confidence,0.8);
  const missing=reply(); delete missing.answers.q64; assert.throws(()=>parseAnswers(missing,questions));
  const extra=reply(); extra.answers.extra=extra.answers.q01; assert.throws(()=>parseAnswers(extra,questions));
  const bad=reply(); bad.answers.q01.probabilities.YES='0.1'; assert.throws(()=>parseAnswers(bad,questions));
  const unknown=reply(); unknown.answers.q01.choice='maybe'; assert.throws(()=>parseAnswers(unknown,questions));
});
test('metrics keep FP/FN, unknowns, errors, all-decision denominator and unique-call latency', () => {
  const rows=[['NO','YES',10,'a'],['YES','NO',10,'a'],['UNKNOWN','UNKNOWN',30,'b'],['YES','ERROR',null,'c']].map(([expected,jev_answer,latency_ms,case_id])=>({expected,jev_answer,latency_ms,case_id,category:'test',primary:true}));
  const m=summarize(rows); assert.equal(m.total_decisions,4); assert.equal(m.accuracy,0.25);
  assert.equal(m.false_positives,1);assert.equal(m.false_negatives,1);assert.equal(m.unknown,1);assert.equal(m.errors,1);
  assert.equal(m.latency.samples,2);assert.equal(m.latency.median_ms,20);assert.equal(m.latency.p95_ms,30);
});
test('transport failures cannot echo a key and each batch is capped at 20 calls',async()=>{
  const plan=ready(); let calls=0;
  const failed=await execute(plan,{live:true,approvedHash:plan.approval_hash,apiKey:'mock-only-key',transport:async()=>{throw Error('mock-only-key');}});
  assert(!JSON.stringify(failed).includes('mock-only-key'));
  const success=await execute(plan,{live:true,approvedHash:plan.approval_hash,apiKey:'mock-only',transport:async()=>{calls++;return {ok:true,status:200,json:async()=>reply()};}});
  assert.equal(calls,20);assert.equal(success.rows.length,1280);assert.equal(success.calls_attempted,20);
});
test('response metadata cannot echo an API key even on a successful HTTP response',async()=>{
  const plan=ready();const body=reply();body.model='jev-mock-api-key';
  const result=await execute(plan,{live:true,approvedHash:plan.approval_hash,apiKey:'jev-mock-api-key',transport:async()=>({ok:true,status:200,json:async()=>body})});
  assert.equal(result.calls_attempted,1);assert.equal(result.rows[0].jev_answer,'ERROR');
  assert(!JSON.stringify(result).includes('jev-mock-api-key'));
});
test('mutating the wire payload invalidates its existing owner approval before any transport',async()=>{
  const plan=ready();plan.requests[0].questions.q01.instructions='Altered request';let calls=0;
  await assert.rejects(execute(plan,{live:true,approvedHash:plan.approval_hash,apiKey:'mock-only',transport:async()=>{calls++;return {ok:true,status:200,json:async()=>reply()};}}),/OWNER_GATE/);
  assert.equal(calls,0);
});
