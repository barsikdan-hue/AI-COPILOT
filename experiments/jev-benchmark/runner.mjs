import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

export const URL = 'https://jev-ai.pro/api/v1/systemone';
const BASE = '04238a2bcbaad771161aa21c157e358a94bee772';
const labels = ['YES','NO','UNKNOWN'];
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const approvalDigest=p=>sha({base:p.base,cases:p.cases,questions:p.questions,requests:p.requests,endpoint:p.endpoint,max_calls:20,timeout_ms:30000,runner_sha256:p.runner_sha256});
const requireCondition = (condition, message) => { if(!condition) throw new Error(message); };
const scope = 'Evaluate the customer after all supplied turns in chronological order. The latest explicit correction supersedes earlier evidence for the same owner and subject. An agent question supplies context, not a customer fact. Relatives are separate owners; conditional consideration is not commitment. Never infer NO merely from absence. YES means entailed, NO means contradicted, UNKNOWN means neither is established. Speech-act questions about the latest client turn concern what that turn explicitly says.';
function primaryCategories(category, caseId) {
  if(caseId.startsWith('mortgage.')) return ['mortgage','payment'];
  if(caseId.startsWith('dp.')) return ['down_payment','ownership'];
  if(category.includes('ownership')) return ['ownership','budget','down_payment'];
  if(category.includes('down_payment') || category==='negation') return ['down_payment'];
  if(category.includes('mortgage')) return ['mortgage','payment'];
  if(category.includes('budget')) return ['budget','ownership','correction'];
  if(category==='ambiguity_unknown') return ['mortgage'];
  if(category==='own_funds') return ['payment'];
  return ['correction','payment','down_payment'];
}
export function prepare(cases, questions) {
  requireCondition(cases.length===20 && questions.length===64,'DATASET_SIZE');
  requireCondition(new Set(cases.map(c=>c.case_id)).size===20,'DUPLICATE_CASE');
  requireCondition(new Set(questions.map(q=>q.id)).size===64,'DUPLICATE_QUESTION');
  requireCondition(new Set(questions.map(q=>q.question)).size===64,'DUPLICATE_PREDICATE');
  const rows=[];
  const requests=cases.map(c=>{
    requireCondition(c.decisions.length===64 && new Set(c.decisions.map(d=>d.question_id)).size===64,'DECISION_COUNT');
    const expected=new Map(c.decisions.map(d=>[d.question_id,d.expected]));
    const definitions={};
    for(const q of questions) {
      requireCondition(labels.includes(expected.get(q.id)),'GROUND_TRUTH');
      definitions[q.id]={type:'choice',instructions:scope+' '+q.question,criteria:{YES:'The supplied turns support the predicate.',NO:'The supplied turns support the contradiction of the predicate.',UNKNOWN:'The turns do not establish either the predicate or its contradiction.'}};
      rows.push({case_id:c.case_id,category:c.category,predicate_category:q.category,question_id:q.id,question:q.question,input:c.turns,expected:expected.get(q.id),ai_copilot:'NOT_COMPARABLE',jev_answer:'NOT_RUN',jev_probability:null,confidence:null,latency_ms:null,pass:null,primary:primaryCategories(c.category,c.case_id).includes(q.category)});
    }
    const request={model:'jev-latest',state:{turns:c.turns},questions:definitions};
    requireCondition(Buffer.byteLength(JSON.stringify(request),'utf8')<=256000,'REQUEST_TOO_LARGE');
    return request;
  });
  const runner_sha256=createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  const plan={base:BASE,endpoint:URL,total_decisions:1280,cases,questions,requests,rows,runner_sha256};
  return {...plan,approval_hash:approvalDigest(plan)};
}
export function parseAnswers(body, questions) {
  requireCondition(body && typeof body.model==='string' && /^jev-[a-z0-9.-]{1,60}$/u.test(body.model) && body.answers && typeof body.answers==='object','RESPONSE_SHAPE');
  const keys=Object.keys(body.answers);
  requireCondition(keys.length===questions.length && questions.every(q=>keys.includes(q.id)),'RESPONSE_QUESTION_IDS');
  const out={};
  for(const q of questions) {
    const a=body.answers[q.id];
    requireCondition(a && a.type==='choice' && labels.includes(a.choice),'RESPONSE_LABEL');
    requireCondition(a.probabilities && Object.keys(a.probabilities).length===3 && labels.every(k=>typeof a.probabilities[k]==='number' && Number.isFinite(a.probabilities[k]) && a.probabilities[k]>=0 && a.probabilities[k]<=1),'RESPONSE_PROBABILITIES');
    requireCondition(Math.abs(labels.reduce((n,k)=>n+a.probabilities[k],0)-1)<=0.02,'RESPONSE_PROBABILITY_SUM');
    requireCondition(typeof a.confidence==='number' && Number.isFinite(a.confidence) && a.confidence>=0 && a.confidence<=1,'RESPONSE_CONFIDENCE');
    out[q.id]={answer:a.choice,probabilities:a.probabilities,confidence:a.confidence};
  }
  return out;
}
function aggregate(rows) {
  const valid=rows.filter(r=>labels.includes(r.jev_answer));
  const correct=valid.filter(r=>r.jev_answer===r.expected).length;
  const notRun=rows.filter(r=>r.jev_answer==='NOT_RUN').length;
  return {total_decisions:rows.length,valid_decisions:valid.length,not_run:notRun,correct,accuracy:rows.length && notRun===0 ? correct/rows.length:null,completed_accuracy:rows.length>notRun?correct/(rows.length-notRun):null,false_positives:rows.filter(r=>r.expected==='NO'&&r.jev_answer==='YES').length,false_negatives:rows.filter(r=>r.expected==='YES'&&r.jev_answer==='NO').length,unsupported_positives:rows.filter(r=>r.expected==='UNKNOWN'&&r.jev_answer==='YES').length,unknown:rows.filter(r=>r.jev_answer==='UNKNOWN').length,expected_unknown:rows.filter(r=>r.expected==='UNKNOWN').length,errors:rows.filter(r=>r.jev_answer==='ERROR').length,binary_expected_decisions:rows.filter(r=>r.expected!=='UNKNOWN').length,binary_correct:rows.filter(r=>r.expected!=='UNKNOWN'&&r.expected===r.jev_answer).length};
}
export function summarize(rows) {
  const all=aggregate(rows);
  const by_category={}; const by_predicate_category={};
  for(const key of new Set(rows.map(r=>r.category))) by_category[key]=aggregate(rows.filter(r=>r.category===key));
  for(const key of new Set(rows.map(r=>r.predicate_category))) by_predicate_category[key]=aggregate(rows.filter(r=>r.predicate_category===key));
  const times=[...new Map(rows.filter(r=>typeof r.latency_ms==='number').map(r=>[r.case_id,r.latency_ms])).values()].sort((a,b)=>a-b);
  const n=times.length;
  const confusion=Object.fromEntries(labels.map(l=>[l,Object.fromEntries([...labels,'ERROR','NOT_RUN'].map(a=>[a,rows.filter(r=>r.expected===l&&r.jev_answer===a).length]))]));
  return {...all,unknown_error:all.unknown+all.errors,positive_abstentions:rows.filter(r=>r.expected==='YES'&&r.jev_answer==='UNKNOWN').length,constant_unknown_baseline:rows.length?all.expected_unknown/rows.length:null,confusion,primary:aggregate(rows.filter(r=>r.primary)),by_category,by_predicate_category,latency:{unit:'one HTTP call, shared by 64 decision rows',samples:n,median_ms:n?(times[Math.floor((n-1)/2)]+times[Math.ceil((n-1)/2)])/2:null,p95_ms:n?times[Math.ceil(n*0.95)-1]:null}};
}
export async function execute(plan, options={}) {
  const rows=structuredClone(plan.rows); let calls_attempted=0;
  const result=()=>({mode:options.live?'LIVE':'DRY_RUN',base:plan.base,approval_hash:plan.approval_hash,calls_attempted,rows,metrics:summarize(rows),core_validation:'NOT_VALIDATED: unresolved Windows baseline failures'});
  if(!options.live) return result();
  requireCondition(options.approvedHash===plan.approval_hash,'OWNER_GATE_REQUIRED: exact approval hash');
  requireCondition(approvalDigest(plan)===plan.approval_hash && prepare(plan.cases,plan.questions).approval_hash===plan.approval_hash,'OWNER_GATE_PAYLOAD_CHANGED');
  requireCondition(typeof options.apiKey==='string' && options.apiKey.trim().length>0,'JEV_AI_API_KEY_MISSING');
  requireCondition(plan.requests.length===20,'CALL_CAP');
  const transport=options.transport || fetch;
  for(let i=0;i<plan.requests.length;i++) {
    calls_attempted++;
    await options.beforeAttempt?.({case_id:plan.cases[i].case_id,attempt:calls_attempted,approval_hash:plan.approval_hash});
    const current=rows.filter(r=>r.case_id===plan.cases[i].case_id);
    const start=performance.now();
    try {
      requireCondition(approvalDigest(plan)===plan.approval_hash,'OWNER_GATE_PAYLOAD_CHANGED');
      const response=await transport(URL,{method:'POST',headers:{Authorization:'Bearer '+options.apiKey,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(plan.requests[i]),redirect:'error',signal:AbortSignal.timeout(30000)});
      requireCondition(response.ok,'HTTP_'+Number(response.status));
      const body=await response.json();
      requireCondition(typeof body?.model==='string' && !body.model.includes(options.apiKey),'UNSAFE_MODEL_FIELD');
      const answers=parseAnswers(body,plan.questions);
      const elapsed=performance.now()-start;
      for(const row of current) Object.assign(row,{jev_answer:answers[row.question_id].answer,jev_probability:answers[row.question_id].probabilities,confidence:answers[row.question_id].confidence,latency_ms:elapsed,pass:answers[row.question_id].answer===row.expected,model:body.model});
    } catch {
      for(const row of current) Object.assign(row,{jev_answer:'ERROR',latency_ms:performance.now()-start,pass:false,error:'REQUEST_FAILED_OR_INVALID_RESPONSE: no automatic retry; outcome/billing may be uncertain'});
      await options.checkpoint?.(result());
      break;
    }
    await options.checkpoint?.(result());
  }
  return result();
}
function csv(rows) {
  const keys=['case_id','category','question_id','question','input','expected','ai_copilot','jev_answer','jev_probability','confidence','latency_ms','pass','primary'];
  const esc=x=>'"'+String(x===null||x===undefined?'':typeof x==='object'?JSON.stringify(x):x).replaceAll('"','""')+'"';
  return [keys.map(esc).join(','),...rows.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\n')+'\n';
}
async function main() {
  const here=dirname(fileURLToPath(import.meta.url)); const root=resolve(here,'../..');
  const args=process.argv.slice(2); requireCondition(args.every(a=>a==='--dry-run'||a==='--live'||a.startsWith('--owner-approved=')),'UNKNOWN_ARGUMENT');
  requireCondition(!(args.includes('--live')&&args.includes('--dry-run')),'CONFLICTING_MODES');
  const live=args.includes('--live'); const approvedHash=args.find(a=>a.startsWith('--owner-approved='))?.split('=')[1];
  const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
  requireCondition(git('rev-parse','HEAD')===BASE,'SOURCE_HEAD_CHANGED');
  requireCondition(git('diff','--name-only','HEAD','--','src','server.ts','server-entry.ts','package.json','package-lock.json')==='','PRODUCTION_DIFF');
  const cases=JSON.parse(readFileSync(resolve(here,'cases.json'),'utf8')); const questions=JSON.parse(readFileSync(resolve(here,'questions.json'),'utf8'));
  const plan=prepare(cases,questions); const sources={};
  for(const c of cases) {
    const source=readFileSync(resolve(root,c.source.path),'utf8');
    requireCondition(source.includes(c.source.anchor),'SOURCE_ANCHOR_MISSING: '+c.case_id);
    sources[c.source.path]=createHash('sha256').update(source).digest('hex');
  }
  const out=resolve(here,'outputs',live?'live':'dry-run');
  if(live) {
    requireCondition(approvedHash===plan.approval_hash,'OWNER_GATE_REQUIRED: exact approval hash');
    requireCondition(process.env.JEV_AI_API_KEY?.trim(),'JEV_AI_API_KEY_MISSING');
    const lock=resolve(root,git('rev-parse','--git-path','jev-benchmark-credit-gate.json'));
    writeFileSync(lock,JSON.stringify({approval_hash:plan.approval_hash,max_calls:20,created_at:new Date().toISOString()}),{flag:'wx'});
  }
  mkdirSync(out,{recursive:true});
  const manifest={base:BASE,branch:git('branch','--show-current'),approval_hash:plan.approval_hash,endpoint:URL,model:'jev-latest',cases:20,questions_per_case:64,total_decisions:1280,max_calls:20,request_bytes:plan.requests.map(r=>Buffer.byteLength(JSON.stringify(r),'utf8')),source_sha256:sources,ground_truth_counts:Object.fromEntries(labels.map(l=>[l,plan.rows.filter(r=>r.expected===l).length])),no_inference:!live};
  writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  writeFileSync(resolve(out,'requests.jsonl'),plan.requests.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const persist=result=>{writeFileSync(resolve(out,'results.json'),JSON.stringify(result,null,2)+'\n');writeFileSync(resolve(out,'results.csv'),csv(result.rows));};
  const result=await execute(plan,{live,approvedHash,apiKey:live?process.env.JEV_AI_API_KEY:undefined,beforeAttempt:a=>appendFileSync(resolve(out,'attempts.jsonl'),JSON.stringify({...a,time:new Date().toISOString()})+'\n'),checkpoint:persist});
  persist(result);
  process.stdout.write(JSON.stringify({mode:result.mode,cases:20,decisions:1280,calls_attempted:result.calls_attempted,approval_hash:plan.approval_hash,output:out})+'\n');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(()=>{process.stderr.write('BENCHMARK_STOP: gate, provenance, input, credential or output-lock check failed; no unsafe details logged.\n');process.exitCode=1;});
