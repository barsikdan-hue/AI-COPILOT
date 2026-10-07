// Local canonical observation only. No remote model or network calls.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInitialState} from '../../src/services/conversationStore.ts';
import {advanceLocalConversation} from '../../src/services/localAnalysisEngine.ts';
const here=dirname(fileURLToPath(import.meta.url));
const cases=JSON.parse(readFileSync(resolve(here,'cases.json'),'utf8'));
const questions=JSON.parse(readFileSync(resolve(here,'questions.json'),'utf8'));
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(here,'../..'),encoding:'utf8'}).trim();
if(head!=='04238a2bcbaad771161aa21c157e358a94bee772') throw Error('SOURCE_HEAD_CHANGED');
const observations=cases.map(c=>{
  let state=createInitialState(); const history=[]; let event=null;
  for(const [index,input] of c.turns.entries()) {
    const turn={...input,id:c.case_id+'-'+index,sessionId:'jev-experiment-'+c.case_id,source:input.speaker==='client'?'call_audio':'microphone',timestamp:(index+1)*10000,isFinal:true,revision:index+1};
    history.push(turn); const result=advanceLocalConversation(state,turn,history);state=result.state;event=result.event;
  }
  const budget=state.budget.value;
  const exact=typeof budget==='string'?budget.match(/^(\d+(?:\.\d+)?) млн руб$/u):null;
  const projections={};
  for(const q of questions) {
    let answer='NOT_COMPARABLE';
    if(q.key==='budget_m' && exact) answer=Number(exact[1])===q.equals?'YES':'NO';
    if(q.key==='budget_known' && exact) answer='YES';
    if(q.key==='mortgage_rejected' && state.dialogueControl?.rejectedBranches?.includes('ипотеку')) answer='YES';
    projections[q.id]={answer,status:answer==='NOT_COMPARABLE'?'NOT_COMPARABLE':'OBSERVED_NOT_VALIDATED'};
  }
  return {case_id:c.case_id,budget:state.budget,downPayment:state.downPayment,paymentMethod:state.paymentMethod,rejectedBranches:state.dialogueControl?.rejectedBranches||[],event:event?{type:event.type,rejectedBranch:event.rejectedBranch}:null,active_finance_facts:state.confirmedFacts.filter(f=>['budget','downPayment','down_payment','paymentMethod'].includes(f.category)&&!['superseded','rejected'].includes(f.lifecycleStatus||'')).map(f=>({category:f.category,value:f.value,lifecycleStatus:f.lifecycleStatus,turnId:f.turnId})),projections};
});
const file=resolve(here,'outputs/dry-run/core-observations.json');
writeFileSync(file,JSON.stringify({source_head:head,cases_sha256:createHash('sha256').update(readFileSync(resolve(here,'cases.json'))).digest('hex'),status:'OBSERVED_NOT_VALIDATED: full baseline 1986 PASS / 2 timeout FAIL / 1 SKIP',trace:'src/services/conversationStore.ts::createInitialState -> src/services/localAnalysisEngine.ts::advanceLocalConversation -> canonical finance fields and rejectedBranches',observations},null,2)+'\n');
const comparable=observations.reduce((n,o)=>n+Object.values(o.projections).filter(p=>p.answer!=='NOT_COMPARABLE').length,0);
console.log(JSON.stringify({cases:observations.length,projected_decisions:comparable,status:'OBSERVED_NOT_VALIDATED',file}));
