import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepare} from './runner.mjs';
import {makePlan as calibrationPlan} from './calibration.mjs';
import {remainingPlan,runRemaining} from './remaining.mjs';
const load=name=>JSON.parse(readFileSync(new URL(name,import.meta.url)));
const benchmark=prepare(load('./cases.json'),load('./questions.json'));
const priorPlan=calibrationPlan(benchmark,'budget.mixed-owner','previous-head');
const body=()=>({model:'jev-mock',answers:Object.fromEntries(benchmark.questions.map(q=>[q.id,{type:'choice',choice:'UNKNOWN',probabilities:{YES:0.1,NO:0.1,UNKNOWN:0.8},confidence:0.8}]))});
const prior={status:'SUCCESS',head:'previous-head',case_id:'budget.mixed-owner',payload_sha256:priorPlan.payload_sha256,approval_hash:priorPlan.approval_hash,live_calls_used:1,questions:64,rows:priorPlan.rows.map(r=>({...r,jev_answer:'UNKNOWN'})),credit_charged:1,latency_ms:900};
const plan=()=>remainingPlan(benchmark,prior,priorPlan.payload,'mock-head');
test('resume excludes the already executed owner case and retains its64 actual rows',()=>{
  const p=plan();assert.equal(p.calls.length,19);assert(!p.calls.some(c=>c.case_id==='budget.mixed-owner'));assert.equal(p.prior.rows.length,64);
  assert(p.calls.every(c=>Object.keys(JSON.parse(c.payload).questions).length===64&&!/"expected"\s*:/.test(c.payload)));
});
test('unapproved or altered payload cannot spend a credit',async()=>{
  const p=plan();let calls=0;const transport=()=>{calls++;};
  await assert.rejects(runRemaining(p,{apiKey:'mock-secret',transport}),/OWNER_GATE/);
  p.calls[0].payload+=' ';await assert.rejects(runRemaining(p,{approvedHash:p.approval_hash,apiKey:'mock-secret',transport}),/CHANGED/);assert.equal(calls,0);
});
test('exactly19 calls, sequential journals, no repeat, no expected labels, raw billing',async()=>{
  const p=plan();let count=0;const events=[];const r=await runRemaining(p,{approvedHash:p.approval_hash,apiKey:'mock-secret',claim:()=>events.push('claim'),beforeAttempt:c=>events.push('journal:'+c.case_id),checkpoint:()=>events.push('save'),transport:async(url,init)=>{count++;assert.equal(init.redirect,'error');assert(!/"expected"\s*:/.test(init.body));assert(events.at(-1).startsWith('journal:'));return {status:200,ok:true,headers:new Headers({'X-Jev-Credits-Charged':'1'}),text:async()=>JSON.stringify(body())};}});
  assert.equal(count,19);assert.equal(r.calls_attempted,19);assert.equal(r.rows.length,1280);assert.equal(r.status,'COMPLETED');assert.equal(r.calls.every(c=>c.credit_charged===1),true);assert.equal(events[0],'claim');
});
test('uncertain/error request stops without retry and preserves previous results',async()=>{
  for(const mode of ['throw','201','malformed','reflection']){
    const p=plan();let count=0;const r=await runRemaining(p,{approvedHash:p.approval_hash,apiKey:'mock-secret',claim:()=>{},beforeAttempt:()=>{},checkpoint:()=>{},transport:async()=>{count++;if(mode==='throw')throw Error('mock-secret');return {status:mode==='201'?201:200,ok:true,headers:new Headers(),text:async()=>mode==='malformed'?'not json':mode==='reflection'?'mock-secret':JSON.stringify(body())};}});
    assert.equal(count,1);assert.equal(r.calls_attempted,1);assert.equal(r.rows.filter(x=>x.case_id==='budget.mixed-owner').length,64);assert.equal(r.status,'STOPPED_API_OUTCOME');assert(!JSON.stringify(r).includes('mock-secret'));
  }
});
