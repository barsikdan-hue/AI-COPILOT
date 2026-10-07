import {readFileSync,writeFileSync,mkdirSync,appendFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {prepare,parseAnswers,URL} from './runner.mjs';
import {makePlan as calibrationPlan} from './calibration.mjs';
const BASE='04238a2bcbaad771161aa21c157e358a94bee772';
const labels=['YES','NO','UNKNOWN'];
const hash=x=>createHash('sha256').update(x).digest('hex');
const check=(x,msg)=>{if(!x)throw Error(msg);};
const digest=p=>hash(JSON.stringify({head:p.head,base:BASE,prior:p.prior,previous:p.previous,recovered:p.recovered,calls:p.calls,questions:p.questions,endpoint:URL,max_calls:19,timeout:30000,source_files:['remaining.mjs','runner.mjs','calibration.mjs'].map(f=>hash(readFileSync(new globalThis.URL(f,import.meta.url))))}));
function validateAnswers(body,questions){
  // Exact alias documented at https://jev-ai.pro/docs, Decisions compatibility.
  const aliases={'typesafe/jev-1.13-20260917':'jev-1.13.0','typesafe/jev-1.13':'jev-1.13.0','~typesafe/jev-latest':'jev-latest','typesafe/jev-latest':'jev-latest','typesafe-ai/jev':'jev-latest'};
  const model=Object.hasOwn(aliases,body?.model)?aliases[body.model]:body?.model;
  return parseAnswers({...body,model},questions);
}
export function remainingPlan(benchmark,prior,priorPayload,head,previous=null){
  check(prior.status==='SUCCESS'&&prior.live_calls_used===1&&prior.questions===64,'PRIOR_CALL_NOT_SUCCESSFUL');
  const original=calibrationPlan(benchmark,prior.case_id,prior.head);
  check(priorPayload===original.payload&&prior.payload_sha256===original.payload_sha256&&prior.approval_hash===original.approval_hash,'PRIOR_PROVENANCE_CHANGED');
  check(prior.rows?.length===64&&new Set(prior.rows.map(r=>r.question_id)).size===64,'PRIOR_ROWS');
  for(const r of prior.rows){const expected=original.rows.find(x=>x.question_id===r.question_id);check(expected&&r.case_id===prior.case_id&&r.expected===expected.expected&&r.question===expected.question&&JSON.stringify(r.input)===JSON.stringify(expected.input)&&labels.includes(r.jev_answer),'PRIOR_ROWS_CHANGED');}
  const all=benchmark.cases.flatMap((c,i)=>c.case_id===prior.case_id?[]:[{case_id:c.case_id,payload:JSON.stringify(benchmark.requests[i]),rows:benchmark.rows.filter(r=>r.case_id===c.case_id)}]);
  check(all.length===19&&new Set(all.map(c=>c.case_id)).size===19,'REMAINING_CALL_CAP');
  const recovered={calls:[],rows:[]};
  if(previous){
    check(previous.source_base===BASE&&JSON.stringify(previous.prior)===JSON.stringify(prior)&&previous.calls_attempted===previous.calls.length&&previous.calls_attempted>0&&previous.calls_attempted<19&&new Set(previous.calls.map(c=>c.case_id)).size===previous.calls.length,'PREVIOUS_RUN_SHAPE');
    for(const c of previous.calls){
      const original=all.find(x=>x.case_id===c.case_id);check(original&&c.http_status===200&&c.payload_sha256===hash(original.payload)&&typeof c.raw_body==='string','PREVIOUS_CALL_PROVENANCE');
      const decoded=JSON.parse(c.raw_body),answers=validateAnswers(decoded,benchmark.questions);
      recovered.calls.push({...c,original_status:c.original_status??c.status,status:'SUCCESS',model:decoded.model,offline_revalidated:true});
      recovered.rows.push(...original.rows.map(row=>({...row,jev_answer:answers[row.question_id].answer,jev_probability:answers[row.question_id].probabilities,confidence:answers[row.question_id].confidence,latency_ms:c.latency_ms,pass:row.expected===answers[row.question_id].answer,model:decoded.model})));
    }
  }
  const calls=all.filter(c=>!recovered.calls.some(r=>r.case_id===c.case_id));
  check(calls.length===19-recovered.calls.length,'REMAINING_CALL_CAP');
  for(const c of calls)check(Object.keys(JSON.parse(c.payload).questions).length===64&&Buffer.byteLength(c.payload)<=256000&&!/"expected"\s*:/.test(c.payload),'WIRE_SHAPE');
  const p={head,prior,previous,recovered,calls,questions:benchmark.questions,max_calls:19};return {...p,approval_hash:digest(p)};
}
const number=x=>(typeof x==='number'||typeof x==='string'&&x.trim())&&Number.isFinite(Number(x))&&Number(x)>=0?Number(x):null;
export async function runRemaining(plan,options={}){
  check(options.approvedHash===plan.approval_hash,'OWNER_GATE_REQUIRED');check(digest(plan)===plan.approval_hash,'PLAN_CHANGED');
  check(options.apiKey?.trim(),'JEV_AI_API_KEY_MISSING');check(typeof options.claim==='function'&&typeof options.beforeAttempt==='function'&&typeof options.checkpoint==='function','PERSISTENT_GATE_REQUIRED');
  await options.claim();
  const result={status:'IN_PROGRESS',head:plan.head,source_base:BASE,approval_hash:plan.approval_hash,prior:plan.prior,calls_attempted:plan.recovered.calls.length,calls:structuredClone(plan.recovered.calls),rows:[...structuredClone(plan.prior.rows),...structuredClone(plan.recovered.rows),...structuredClone(plan.calls.flatMap(c=>c.rows))]};
  for(const c of plan.calls){
    check(digest(plan)===plan.approval_hash&&result.calls_attempted<19,'PLAN_CHANGED');
    await options.beforeAttempt({case_id:c.case_id,attempt:result.calls_attempted+1,payload_sha256:hash(c.payload)});
    result.calls_attempted++;
    const call={case_id:c.case_id,status:'REQUEST_OUTCOME_UNCERTAIN',http_status:null,payload_sha256:hash(c.payload),credit_charged:null,billing_headers:{},raw_body:null,latency_ms:null};result.calls.push(call);
    const rows=result.rows.filter(r=>r.case_id===c.case_id),start=performance.now();
    try{
      const response=await(options.transport||fetch)(URL,{method:'POST',headers:{Authorization:'Bearer '+options.apiKey,'Content-Type':'application/json',Accept:'application/json'},body:c.payload,redirect:'error',signal:AbortSignal.timeout(30000)});
      call.http_status=response.status;
      for(const name of ['X-Jev-Credits-Charged','X-Jev-Paid-Input-Tokens-Used','X-Jev-Model-Multiplier','X-Jev-Credits-Remaining','X-Jev-Tokens-Remaining'])call.billing_headers[name]=number(response.headers?.get(name));
      const raw=await response.text();call.latency_ms=performance.now()-start;check(Buffer.byteLength(raw)<=1048576,'RESPONSE_TOO_LARGE');
      call.raw_body=raw.replaceAll(options.apiKey,'[REDACTED_SECRET]');call.secret_reflection=raw.includes(options.apiKey);check(!call.secret_reflection,'SECRET_REFLECTION');
      let decoded=null;try{decoded=JSON.parse(raw);}catch{}
      if(decoded&&JSON.stringify(decoded).includes(options.apiKey)){call.secret_reflection=true;call.raw_body='[REDACTED_SECRET_RESPONSE]';throw Error('SECRET_REFLECTION');}
      call.credit_charged=call.billing_headers['X-Jev-Credits-Charged']??number(decoded?.billing?.credits_charged);
      check(response.status===200&&response.ok,'NON_200_STOP');check(decoded&&!decoded.model?.includes(options.apiKey),'UNSAFE_MODEL');
      const answers=validateAnswers(decoded,plan.questions);call.model=decoded.model;
      for(const row of rows)Object.assign(row,{jev_answer:answers[row.question_id].answer,jev_probability:answers[row.question_id].probabilities,confidence:answers[row.question_id].confidence,latency_ms:call.latency_ms,pass:row.expected===answers[row.question_id].answer,model:decoded.model});
      call.status='SUCCESS';
    }catch{
      call.latency_ms=performance.now()-start;call.status=call.http_status===null?'REQUEST_OUTCOME_UNCERTAIN':'HTTP_OR_INVALID_RESPONSE_STOP';
      for(const row of rows)Object.assign(row,{jev_answer:'ERROR',pass:false,latency_ms:call.latency_ms});result.status='STOPPED_API_OUTCOME';
      await options.checkpoint(result);
      if(options.continueOnErrors&&!call.secret_reflection){result.status='IN_PROGRESS';continue;}break;
    }
    await options.checkpoint(result);
  }
  if(result.calls_attempted===19&&result.calls.every(c=>c.status==='SUCCESS'))result.status='COMPLETED';
  else if(result.calls_attempted===19&&options.continueOnErrors&&!result.calls.some(c=>c.secret_reflection))result.status='COMPLETED_WITH_ERRORS';
  await options.checkpoint(result);return result;
}
async function main(){
  const args=process.argv.slice(2);check(args.every(a=>a==='--dry-run'||a==='--live'||a.startsWith('--artifacts=')||a.startsWith('--prior=')||a.startsWith('--resume=')||a.startsWith('--owner-remaining-19-approved=')),'UNKNOWN_ARGUMENT');
  check(args.includes('--live')!==args.includes('--dry-run'),'EXPLICIT_MODE_REQUIRED');
  const option=k=>args.find(a=>a.startsWith(k+'='))?.slice(k.length+1),out=option('--artifacts'),priorDir=option('--prior');
  check(out&&priorDir&&isAbsolute(out)&&isAbsolute(priorDir),'ABSOLUTE_ARTIFACT_PATHS_REQUIRED');
  const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');check(resolve(out)!==root&&!resolve(out).toLowerCase().startsWith(root.toLowerCase()+'\\'),'EXTERNAL_ARTIFACTS_REQUIRED');
  const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',maxBuffer:16777216}).trim();
  check(git('branch','--show-current')==='experiment/jev-benchmark'&&git('status','--porcelain')==='','CLEAN_EXPERIMENT_BRANCH_REQUIRED');
  const head=git('rev-parse','HEAD');check(git('ls-remote','--heads','origin','refs/heads/experiment/jev-benchmark').split(/\s+/)[0]===head,'ACTUAL_REMOTE_HEAD_REQUIRED');
  execFileSync('git',['merge-base','--is-ancestor',BASE,'HEAD'],{cwd:root});
  check(git('diff','--name-only',BASE,'HEAD','--','src','package.json','package-lock.json','server.ts','server-entry.ts')==='','PRODUCTION_DIFF');
  const benchmark=prepare(JSON.parse(readFileSync(resolve(here,'cases.json'))),JSON.parse(readFileSync(resolve(here,'questions.json'))));
  for(const c of benchmark.cases)check(readFileSync(resolve(root,c.source.path),'utf8').includes(c.source.anchor),'SOURCE_ANCHOR_CHANGED');
  const prior=JSON.parse(readFileSync(resolve(priorDir,'result.json')));execFileSync('git',['merge-base','--is-ancestor',prior.head,'HEAD'],{cwd:root});
  const resumeDir=option('--resume');let previous=null;
  if(resumeDir){
    check(isAbsolute(resumeDir)&&resolve(resumeDir)!==resolve(out),'SEPARATE_RESUME_ARTIFACTS_REQUIRED');previous=JSON.parse(readFileSync(resolve(resumeDir,'results.json')));
    execFileSync('git',['merge-base','--is-ancestor',previous.head,'HEAD'],{cwd:root});
    const common=resolve(root,git('rev-parse','--git-common-dir'));
    const matchingLocks=readdirSync(common).filter(f=>/^jev-owner-remaining-19.*\.json$/u.test(f)).map(f=>JSON.parse(readFileSync(resolve(common,f)))).filter(g=>g.head===previous.head&&g.approval_hash===previous.approval_hash);
    check(matchingLocks.length===1,'PREVIOUS_GATE_MISMATCH');
    const journal=readFileSync(resolve(resumeDir,'attempts.jsonl'),'utf8').trim().split(/\r?\n/).map(x=>JSON.parse(x));
    const offset=previous.calls_attempted-journal.length;
    check(offset>=0&&journal.length>0&&previous.calls.slice(0,offset).every(c=>c.offline_revalidated)&&journal.every((a,i)=>a.case_id===previous.calls[offset+i].case_id&&a.payload_sha256===previous.calls[offset+i].payload_sha256&&a.attempt===offset+i+1),'PREVIOUS_JOURNAL_MISMATCH');
    for(const c of previous.calls)check(readFileSync(resolve(resumeDir,c.case_id+'.raw.txt'),'utf8')===c.raw_body,'PREVIOUS_RAW_MISMATCH');
  }
  const plan=remainingPlan(benchmark,prior,readFileSync(resolve(priorDir,'payload.json'),'utf8'),head,previous);
  mkdirSync(out,{recursive:true});const manifestPath=resolve(out,'manifest.json');
  if(args.includes('--dry-run')){
    writeFileSync(manifestPath,JSON.stringify({head,approval_hash:plan.approval_hash,max_new_calls:plan.calls.length,reused_case:prior.case_id,reused_paid_calls:plan.recovered.calls.map(c=>c.case_id),questions_per_call:64,total_decisions:1280,calls:plan.calls.map(c=>({case_id:c.case_id,payload_sha256:hash(c.payload),bytes:Buffer.byteLength(c.payload)})),no_inference:true},null,2)+'\n');
    for(const c of plan.calls)writeFileSync(resolve(out,c.case_id+'.payload.json'),c.payload);
    console.log(JSON.stringify({status:'DRY_RUN_PASS',head,approval_hash:plan.approval_hash,new_calls:plan.calls.length,reused:1+plan.recovered.calls.length,questions_per_case:64,inference_calls:0}));return;
  }
  const manifest=JSON.parse(readFileSync(manifestPath));check(manifest.head===head&&manifest.approval_hash===plan.approval_hash,'FINAL_DRY_RUN_CHANGED');
  for(const c of plan.calls)check(readFileSync(resolve(out,c.case_id+'.payload.json'),'utf8')===c.payload,'EXACT_PAYLOAD_CHANGED');
  const key=process.env.JEV_AI_API_KEY,save=result=>{const s=JSON.stringify(result,null,2)+'\n';check(!s.includes(key),'SECRET_OUTPUT_STOP');writeFileSync(resolve(out,'results.json'),s);for(const c of result.calls)if(c.raw_body!==null)writeFileSync(resolve(out,c.case_id+'.raw.txt'),c.raw_body);};
  const lock=resolve(root,git('rev-parse','--git-common-dir'),previous?'jev-owner-remaining-19-resume-'+hash(JSON.stringify(previous.calls)).slice(0,16)+'.json':'jev-owner-remaining-19-credit-gate.json');
  const result=await runRemaining(plan,{approvedHash:option('--owner-remaining-19-approved'),apiKey:key,continueOnErrors:true,claim:()=>writeFileSync(lock,JSON.stringify({owner_gate:'COMPLETE_REMAINING_19',head,approval_hash:plan.approval_hash,max_new_calls:plan.calls.length,total_new_call_cap:19,prior_case:prior.case_id,created_at:new Date().toISOString()}),{flag:'wx'}),beforeAttempt:a=>appendFileSync(resolve(out,'attempts.jsonl'),JSON.stringify({...a,time:new Date().toISOString()})+'\n'),checkpoint:r=>{save(r);const c=r.calls.at(-1);if(c)console.log(JSON.stringify({completed:r.calls_attempted,case_id:c.case_id,status:c.status,http_status:c.http_status,credit:c.credit_charged,latency_ms:c.latency_ms}));}});
  console.log(JSON.stringify({status:result.status,new_calls:result.calls_attempted-plan.recovered.calls.length,total_calls_including_prior:result.calls_attempted+1,artifact:resolve(out,'results.json')}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('REMAINING_BENCHMARK_STOP: local gate/output error; no automatic retry.');process.exitCode=1;});
