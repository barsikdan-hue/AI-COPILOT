import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepare} from './runner.mjs';
import {makePlan,runOnce,analyse,claimOnce} from './calibration.mjs';
const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url)));
const questions=JSON.parse(readFileSync(new URL('./questions.json',import.meta.url)));
const ready=()=>makePlan(prepare(cases,questions),'budget.mixed-owner','mock-head');
const body=()=>({model:'jev-mock',answers:Object.fromEntries(questions.map(q=>[q.id,{type:'choice',choice:'UNKNOWN',probabilities:{YES:0.1,NO:0.1,UNKNOWN:0.8},confidence:0.8}]))});
test('exact payload has one text,64 questions,no labels and one explicit paraphrase pair',()=>{
  const p=ready(),req=JSON.parse(p.payload);assert.equal(typeof req.state,'string');assert.equal(Object.keys(req.questions).length,64);
  assert(!/"expected"\s*:/.test(p.payload));assert.equal(p.rows.length,64);assert.equal(p.rows.find(r=>r.question_id==='q64').expected,'YES');
  assert.deepEqual(p.paraphrases,[['q31','q64']]);assert.equal(p.max_calls,1);
});
test('missing gate/key and altered payload cannot call transport',async()=>{
  let calls=0;const transport=()=>{calls++;};const p=ready();
  await assert.rejects(runOnce(p,{apiKey:'mock-key',transport}),/OWNER_GATE/);
  await assert.rejects(runOnce(p,{approvedHash:p.approval_hash,transport}),/JEV_AI_API_KEY/);
  p.payload+=' ';await assert.rejects(runOnce(p,{approvedHash:p.approval_hash,apiKey:'mock-key',transport}),/PAYLOAD/);assert.equal(calls,0);
});
test('500/429 and transport exceptions get one attempt with no retry',async()=>{
  for(const status of [500,429]) {let calls=0;const p=ready();const r=await runOnce(p,{approvedHash:p.approval_hash,apiKey:'mock-key',claim:()=>{},transport:async()=>{calls++;return {status,ok:false,headers:new Headers(),text:async()=>'{"error":{"message":"failure"}}'};}});assert.equal(calls,1);assert.equal(r.live_calls_used,1);assert.equal(r.status,'HTTP_ERROR_STOP');}
  const p=ready();let calls=0;const r=await runOnce(p,{approvedHash:p.approval_hash,apiKey:'mock-key',claim:()=>{},transport:async()=>{calls++;throw Error('mock-key');}});assert.equal(calls,1);assert(!JSON.stringify(r).includes('mock-key'));
});
test('success parses64answers, actual charged credit and sanitized raw output',async()=>{
  const p=ready();let calls=0;const r=await runOnce(p,{approvedHash:p.approval_hash,apiKey:'mock-key',claim:()=>{},transport:async(url,init)=>{calls++;assert.equal(init.body,p.payload);assert.equal(init.redirect,'error');return {status:200,ok:true,headers:new Headers({'X-Jev-Credits-Charged':'1'}),text:async()=>JSON.stringify(body())};}});
  assert.equal(calls,1);assert.equal(r.questions,64);assert.equal(r.credit_charged,1);assert.equal(r.status,'SUCCESS');assert.equal(r.rows.length,64);
});
test('reflected secret is redacted before any raw artifact and no response is scored',async()=>{
  const p=ready();const b=body();b.extra='mock-key';const r=await runOnce(p,{approvedHash:p.approval_hash,apiKey:'mock-key',claim:()=>{},transport:async()=>({status:200,ok:true,headers:new Headers(),text:async()=>JSON.stringify(b)})});
  assert(!JSON.stringify(r).includes('mock-key'));assert.equal(r.status,'SECRET_REFLECTION_STOP');assert.equal(r.metrics,null);
});
test('exclusive credit lock rejects a second attempt',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jev-one-'));const path=join(dir,'lock.json');try {claimOnce(path,ready());assert.throws(()=>claimOnce(path,ready()));}finally {rmSync(path);rmdirSync(dir);}
});
test('non-200 success status stops and malformed billing never proves a charged credit',async()=>{
  for(const [status,billing] of [[201,1],[200,true],[200,[]],[200,{}],[200,'   ']]) {
    const p=ready();let calls=0;const b=body();b.billing={credits_charged:billing};
    const r=await runOnce(p,{approvedHash:p.approval_hash,apiKey:'mock-key',claim:()=>{},transport:async()=>{calls++;return {status,ok:true,headers:new Headers(),text:async()=>JSON.stringify(b)};}});
    assert.equal(calls,1);
    if(status!==200){assert.equal(r.status,'HTTP_ERROR_STOP');assert.equal(r.metrics,null);}else assert.equal(r.credit_charged,null);
  }
});
test('answerable and UNKNOWN metrics use separate denominators and class recall includes abstention',()=>{
  const rows=[['YES','YES'],['YES','UNKNOWN'],['NO','YES'],['NO','NO'],['UNKNOWN','YES'],['UNKNOWN','UNKNOWN']].map(([expected,jev_answer],i)=>({expected,jev_answer,question_id:'x'+i,predicate_category:'test'}));
  const m=analyse(rows,[]);assert.equal(m.answerable.count,4);assert.equal(m.answerable.accuracy,0.5);assert.equal(m.answerable.YES.precision,0.5);assert.equal(m.answerable.YES.recall,0.5);assert.equal(m.answerable.YES.false_negatives,1);
  assert.equal(m.unknown.count,2);assert.equal(m.unknown.correct_abstention,1);assert.equal(m.unknown.unsupported_assertion_rate,0.5);
});
test('range and ceiling can coexist; paraphrase records label and probability differences',()=>{
  const rows=['q33','q34','q31','q64'].map(question_id=>({question_id,expected:'YES',jev_answer:'YES',predicate_category:'budget',jev_probability:{YES:0.8,NO:0.1,UNKNOWN:0.1},confidence:0.8}));
  rows[3].jev_probability={YES:0.7,NO:0.2,UNKNOWN:0.1};rows[3].confidence=0.7;
  const m=analyse(rows,[['q31','q64']]);assert.equal(m.contradictions.length,0);assert.equal(m.paraphrase_instability,0);
  assert(Math.abs(m.paraphrases[0].probability_absolute_deltas.YES-0.1)<1e-9);
});
