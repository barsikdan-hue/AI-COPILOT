import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {prepare,parseAnswers,URL} from './runner.mjs';
const BASE='04238a2bcbaad771161aa21c157e358a94bee772';
const labels=['YES','NO','UNKNOWN'];
const hash=s=>createHash('sha256').update(s).digest('hex');
const check=(x,msg)=>{if(!x)throw Error(msg);};
const digest=p=>hash(JSON.stringify({head:p.head,case_id:p.case_id,payload:p.payload,rows:p.rows,paraphrases:p.paraphrases,max_calls:1,endpoint:URL,timeout_ms:30000,calibration_hash:hash(readFileSync(fileURLToPath(import.meta.url)))}));
export function makePlan(benchmark,case_id,head) {
  const i=benchmark.cases.findIndex(c=>c.case_id===case_id);check(i>=0,'CASE_NOT_FOUND');
  const c=benchmark.cases[i];check(c.turns.length===1 && c.turns[0].speaker==='client','EXACTLY_ONE_TEXT_REQUIRED');
  const request=structuredClone(benchmark.requests[i]);request.state=c.turns[0].text;
  const rows=structuredClone(benchmark.rows.filter(r=>r.case_id===case_id));
  check(rows.find(r=>r.question_id==='q31').expected==='YES','PARAPHRASE_GROUND_TRUTH');
  const paraphrase='According to the supplied text, is the customer\'s own current purchase budget exactly 20 million rubles?';
  request.questions.q64.instructions=request.questions.q31.instructions+' Equivalent wording for this control: '+paraphrase;
  const paraRow=rows.find(r=>r.question_id==='q64');Object.assign(paraRow,{question:paraphrase,expected:'YES',predicate_category:'budget_paraphrase',primary:true});
  const payload=JSON.stringify(request);
  check(typeof request.state==='string' && request.state.trim() && Object.keys(request.questions).length===64,'PAYLOAD_SHAPE');
  check(!/"expected"\s*:/.test(payload) && Buffer.byteLength(payload)<=256000,'NO_GROUND_TRUTH_IN_WIRE');
  const plan={head,case_id,max_calls:1,source_base:BASE,payload,payload_sha256:hash(payload),rows,paraphrases:[['q31','q64']],questions:benchmark.questions};
  return {...plan,approval_hash:digest(plan)};
}
function counts(rows,key) {return Object.fromEntries([...labels,'OTHER'].map(l=>[l,rows.filter(r=>(labels.includes(r[key])?r[key]:'OTHER')===l).length]));}
function classMetrics(rows,label) {
  const tp=rows.filter(r=>r.expected===label&&r.jev_answer===label).length;
  const fp=rows.filter(r=>r.expected!==label&&r.jev_answer===label).length;
  const fn=rows.filter(r=>r.expected===label&&r.jev_answer!==label).length;
  return {true_positives:tp,false_positives:fp,false_negatives:fn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,F1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null};
}
export function analyse(rows,paraphrases) {
  const answerable=rows.filter(r=>r.expected!=='UNKNOWN');const unknown=rows.filter(r=>r.expected==='UNKNOWN');
  const values=new Map(rows.map(r=>[r.question_id,r.jev_answer]));const contradictions=[];
  for(const group of [['q01','q04','q05'],['q11','q12'],['q21','q22'],['q22','q28'],['q30','q31','q32'],['q33','q40'],['q34','q40']]) {
    const yes=group.filter(id=>values.get(id)==='YES');if(yes.length>1)contradictions.push({rule:'mutually exclusive predicates',question_ids:yes});
  }
  for(const [trigger,target,label] of [['q07','q06','YES'],['q31','q35','YES'],['q31','q36','YES'],['q31','q37','YES'],['q30','q37','NO'],['q32','q35','NO']]) {
    const actual=values.get(target);if(values.get(trigger)==='YES' && labels.includes(actual) && actual!=='UNKNOWN' && actual!==label)contradictions.push({rule:'logical quantity implication',question_ids:[trigger,target],expected_target:label,actual_target:actual});
  }
  const paraphrase_results=paraphrases.map(([a,b])=>{const ra=rows.find(r=>r.question_id===a),rb=rows.find(r=>r.question_id===b);return {question_ids:[a,b],answers:[values.get(a),values.get(b)],unstable:values.get(a)!==values.get(b),probability_absolute_deltas:ra?.jev_probability&&rb?.jev_probability?Object.fromEntries(labels.map(l=>[l,Math.abs(ra.jev_probability[l]-rb.jev_probability[l])])):null,confidence_absolute_delta:typeof ra?.confidence==='number'&&typeof rb?.confidence==='number'?Math.abs(ra.confidence-rb.confidence):null};});
  return {expected:counts(rows,'expected'),predicted:counts(rows,'jev_answer'),answerable:{count:answerable.length,expected_YES:answerable.filter(r=>r.expected==='YES').length,expected_NO:answerable.filter(r=>r.expected==='NO').length,accuracy:answerable.length?answerable.filter(r=>r.expected===r.jev_answer).length/answerable.length:null,YES:classMetrics(answerable,'YES'),NO:classMetrics(answerable,'NO')},unknown:{count:unknown.length,correct_abstention:unknown.filter(r=>r.jev_answer==='UNKNOWN').length,correct_abstention_rate:unknown.length?unknown.filter(r=>r.jev_answer==='UNKNOWN').length/unknown.length:null,unsupported_assertions:unknown.filter(r=>['YES','NO'].includes(r.jev_answer)).length,unsupported_assertion_rate:unknown.length?unknown.filter(r=>['YES','NO'].includes(r.jev_answer)).length/unknown.length:null},by_category:Object.fromEntries([...new Set(rows.map(r=>r.predicate_category))].map(c=>{const group=rows.filter(r=>r.predicate_category===c);return [c,{count:group.length,expected:counts(group,'expected'),predicted:counts(group,'jev_answer'),correct:group.filter(r=>r.expected===r.jev_answer).length}];})),contradictions,paraphrases:paraphrase_results,paraphrase_instability:paraphrase_results.filter(p=>p.unstable).length,overall_accuracy_secondary:rows.length?rows.filter(r=>r.expected===r.jev_answer).length/rows.length:null};
}
export function claimOnce(path,plan) {writeFileSync(path,JSON.stringify({max_calls:1,owner_gate:'ONE_CALL_CALIBRATION_ONLY',head:plan.head,payload_sha256:plan.payload_sha256,approval_hash:plan.approval_hash,claimed_at:new Date().toISOString()}),{flag:'wx'});}
const number=x=>(typeof x==='number'||(typeof x==='string'&&x.trim()!==''))&&Number.isFinite(Number(x))&&Number(x)>=0?Number(x):null;
export async function runOnce(plan,options={}) {
  check(options.approvedHash===plan.approval_hash,'OWNER_GATE_REQUIRED');
  check(hash(plan.payload)===plan.payload_sha256 && digest(plan)===plan.approval_hash,'PAYLOAD_CHANGED');
  check(options.apiKey?.trim(),'JEV_AI_API_KEY_MISSING');check(typeof options.claim==='function','EXCLUSIVE_CREDIT_LOCK_REQUIRED');
  const request=JSON.parse(plan.payload);check(plan.max_calls===1 && typeof request.state==='string' && Object.keys(request.questions).length===64,'ONE_CALL_CAP');
  await options.claim();
  const rows=structuredClone(plan.rows);for(const row of rows)row.jev_answer='OTHER';
  const result={status:'REQUEST_ERROR_OUTCOME_UNCERTAIN',head:plan.head,case_id:plan.case_id,payload_sha256:plan.payload_sha256,approval_hash:plan.approval_hash,live_calls_used:1,questions:64,http_status:null,credit_charged:null,latency_ms:null,raw_body:null,billing_headers:{},rows,metrics:null,secret_reflection:false};
  const start=performance.now();
  try {
    check(digest(plan)===plan.approval_hash,'PAYLOAD_CHANGED');
    const response=await (options.transport||fetch)(URL,{method:'POST',headers:{Authorization:'Bearer '+options.apiKey,'Content-Type':'application/json',Accept:'application/json'},body:plan.payload,redirect:'error',signal:AbortSignal.timeout(30000)});
    result.http_status=response.status;
    for(const name of ['X-Jev-Credits-Charged','X-Jev-Paid-Input-Tokens-Used','X-Jev-Model-Multiplier','X-Jev-Credits-Remaining','X-Jev-Tokens-Remaining']) result.billing_headers[name]=number(response.headers?.get(name));
    const raw=await response.text();result.latency_ms=performance.now()-start;
    check(Buffer.byteLength(raw)<=1048576,'RESPONSE_TOO_LARGE');
    result.secret_reflection=raw.includes(options.apiKey);result.raw_body=raw.replaceAll(options.apiKey,'[REDACTED_SECRET]');
    if(result.secret_reflection){result.status='SECRET_REFLECTION_STOP';return result;}
    let decoded=null;try{decoded=JSON.parse(raw);}catch{}
    result.credit_charged=result.billing_headers['X-Jev-Credits-Charged']??number(decoded?.billing?.credits_charged);
    if(response.status!==200||!response.ok){result.status='HTTP_ERROR_STOP';return result;}
    check(decoded && !decoded.model?.includes(options.apiKey),'UNSAFE_MODEL');
    const answers=parseAnswers(decoded,plan.questions);
    for(const row of rows)Object.assign(row,{jev_answer:answers[row.question_id].answer,jev_probability:answers[row.question_id].probabilities,confidence:answers[row.question_id].confidence,latency_ms:result.latency_ms,pass:row.expected===answers[row.question_id].answer});
    result.model=decoded.model;result.metrics=analyse(rows,plan.paraphrases);result.status='SUCCESS';
    return result;
  }catch{result.latency_ms=performance.now()-start;result.status=result.http_status===null?'REQUEST_ERROR_OUTCOME_UNCERTAIN':'INVALID_OR_AMBIGUOUS_API_RESULT_STOP';return result;}
}
async function main(){
  const args=process.argv.slice(2);check(args.every(a=>a==='--dry-run'||a==='--live'||a.startsWith('--artifacts=')||a.startsWith('--owner-calibration-approved=')),'UNKNOWN_ARGUMENT');
  const live=args.includes('--live');check(!(live&&args.includes('--dry-run')),'CONFLICTING_MODES');
  const out=args.find(a=>a.startsWith('--artifacts='))?.slice('--artifacts='.length);check(out&&isAbsolute(out),'ABSOLUTE_ARTIFACT_PATH_REQUIRED');
  const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
  check(!resolve(out).toLowerCase().startsWith(root.toLowerCase()+'\\'),'EXTERNAL_ARTIFACT_PATH_REQUIRED');
  const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
  check(git('branch','--show-current')==='experiment/jev-benchmark','BRANCH_CHANGED');
  execFileSync('git',['merge-base','--is-ancestor',BASE,'HEAD'],{cwd:root});
  check(git('status','--porcelain')==='','WORKTREE_NOT_CLEAN');
  check(git('rev-parse','origin/experiment/jev-benchmark')===git('rev-parse','HEAD'),'REMOTE_HEAD_NOT_MATCHED');
  check(git('diff','--name-only',BASE,'HEAD','--','src','package.json','package-lock.json','server.ts','server-entry.ts')==='','PRODUCTION_DIFF');
  const benchmark=prepare(JSON.parse(readFileSync(resolve(here,'cases.json'),'utf8')),JSON.parse(readFileSync(resolve(here,'questions.json'),'utf8')));
  const plan=makePlan(benchmark,'budget.mixed-owner',git('rev-parse','HEAD'));
  const source=benchmark.cases.find(c=>c.case_id===plan.case_id).source;check(readFileSync(resolve(root,source.path),'utf8').includes(source.anchor),'SOURCE_ANCHOR');
  mkdirSync(out,{recursive:true});
  const manifestPath=resolve(out,'manifest.json'),payloadPath=resolve(out,'payload.json');
  if(!live){writeFileSync(payloadPath,plan.payload);writeFileSync(manifestPath,JSON.stringify({head:plan.head,source_base:BASE,case_id:plan.case_id,max_calls:1,text_count:1,questions:64,payload_sha256:plan.payload_sha256,payload_bytes:Buffer.byteLength(plan.payload),approval_hash:plan.approval_hash,expected:counts(plan.rows,'expected'),paraphrases:plan.paraphrases,expected_labels_in_wire:false,api_calls:0},null,2)+'\n');writeFileSync(resolve(out,'expected.json'),JSON.stringify(plan.rows,null,2)+'\n');console.log(JSON.stringify({status:'FINAL_DRY_RUN_PASS',head:plan.head,text_count:1,questions:64,payload_sha256:plan.payload_sha256,approval_hash:plan.approval_hash,expected:counts(plan.rows,'expected'),calls:0}));return;}
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));check(manifest.head===plan.head&&manifest.payload_sha256===plan.payload_sha256&&manifest.approval_hash===plan.approval_hash,'FINAL_DRY_RUN_MISMATCH');
  check(readFileSync(payloadPath,'utf8')===plan.payload,'EXACT_WIRE_BYTES_MISMATCH');
  const approved=args.find(a=>a.startsWith('--owner-calibration-approved='))?.split('=')[1];
  const lock=resolve(root,git('rev-parse','--git-common-dir'),'jev-owner-calibration-credit-gate.json');
  const result=await runOnce(plan,{approvedHash:approved,apiKey:process.env.JEV_AI_API_KEY,claim:()=>claimOnce(lock,plan)});
  const serialized=JSON.stringify(result,null,2)+'\n';check(!serialized.includes(process.env.JEV_AI_API_KEY),'SECRET_OUTPUT_STOP');
  writeFileSync(resolve(out,'raw-response.txt'),result.raw_body||'NO_RESPONSE_RECEIVED\n',{flag:'wx'});
  writeFileSync(resolve(out,'result.json'),serialized,{flag:'wx'});
  console.log(JSON.stringify({status:result.status,head:result.head,live_calls_used:result.live_calls_used,questions:64,http_status:result.http_status,credit_charged:result.credit_charged,latency_ms:result.latency_ms,metrics:result.metrics,artifact:resolve(out,'result.json')}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('CALIBRATION_STOP: gate/provenance/output failure. Never retry automatically.');process.exitCode=1;});
