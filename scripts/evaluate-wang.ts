import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {createAgent,deepseekModel,promptVersion} from '../server/agent'
import {initialSessionState,sessionStateSchema} from '../server/agent-policy'
import {readWangCases} from '../server/agent-cases'
import {methodCards,followupGuide} from '../shared/methods'
import type {ToolObservation} from '../server/agent-tools'

const suite=readWangCases(),selected=process.argv.slice(2)
if(selected.includes('--check')){
  assert.deepEqual(selected,['--check'])
  console.log(JSON.stringify({cases:suite.cases.length,provenance:suite.provenance,review_status:suite.review_status,databaseAccess:false,providerCalls:0},null,2))
}else{
  if(process.env.EVAL_LIVE!=='1')throw Error('Synthetic data only, no database. Paid model calls require EVAL_LIVE=1 npm run eval:wang; use -- --check for fixture validation only.')
  assert.ok(selected.every(id=>suite.cases.some(c=>c.id===id)),'Unknown Wang evaluation case')
  const directory=join('.data','wang-eval',new Date().toISOString().replace(/[:.]/g,'-'))
  await mkdir(directory,{recursive:true,mode:0o700})
  const sourceHashes=Object.fromEntries(await Promise.all(['server/agent.ts','server/agent-policy.ts','shared/methods.ts','docs/wang-decision-cases.json'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])))
  const results:unknown[]=[]
  for(const c of suite.cases.filter(c=>!selected.length||selected.includes(c.id))){
    const started=Date.now(),scopeKey=`${c.domain}:synthetic-${c.id}`
    const messages=[...c.seeds.map((s,i)=>({id:String(i+10),role:s.role,text:s.content})),{id:'100',role:'user',text:c.message}]
    const sessionState=sessionStateSchema.parse({...initialSessionState(scopeKey),...c.prior_state})
    let calls=0,error='',output:unknown=null
    const modelOutputs:{json:boolean;content:string}[]=[]
    const observations:ToolObservation[]=[]
    try{
      const result=await createAgent(async(...args)=>{calls++;const content=await deepseekModel(...args);modelOutputs.push({json:args[1],content});return content},AbortSignal.timeout(150000),{tools:async request=>{
        let value:unknown=null,source_ids:string[]=[],user_source_ids:string[]=[]
        if(request.name==='retrieve_methods')value=methodCards[request.kind]
        else if(request.name==='practice_guide')value=request.kind==='followup'?followupGuide:methodCards[request.kind]
        else if(request.name==='search_history'){
          const found=c.old?.toLowerCase().includes(request.query.toLowerCase())
          value=found?[{id:'2',author_name:'合成用户',role:'user',content:c.old,truncated:false}]:[]
          if(found){source_ids=['2'];user_source_ids=['2']}
        }else if(request.name==='read_understandings'||request.name==='find_support')value=[]
        else value={kind:request.kind,value:null,provenance:'user_saved',hypothetical:request.kind==='roleplay'}
        const observation={request,result:value,source_ids,user_source_ids};observations.push(observation);return observation
      }}).invoke({input:{domain:c.domain,scopeKey,contextVersion:1,supportsMethodOffers:true,sessionState,lastMessage:c.message,messageIds:messages.map(m=>m.id),userMessageIds:messages.filter(m=>m.role==='user').map(m=>m.id),context:JSON.stringify({domain:c.domain,event:{title:'合成关系情境',user_confirmed_summary:'',initial_summary:''},messages,session_state:sessionState})}})
      output={reply:result.reply,assessment:result.assessment,tools:observations,trace:result.progress.trace}
      assert.ok(result.assessment.route_decision,'Missing trusted route')
      assert.ok(c.expected.routes.includes(result.assessment.route_decision.route),'Unexpected route: '+result.assessment.route_decision.route)
      assert.deepEqual(result.assessment.proposals.map(p=>p.kind).sort(),[...c.expected.proposals].sort(),'Unexpected proposal kinds')
      for(const name of c.expected.required_tools)assert.ok(observations.some(o=>o.request.name===name),'Missing tool: '+name)
      for(const name of c.expected.forbidden_tools)assert.ok(!observations.some(o=>o.request.name===name),'Forbidden tool: '+name)
      if(c.expected.no_model)assert.equal(calls,0)
      if(c.expected.advice_declined!==undefined)assert.equal(result.progress.session_state?.advice_declined,c.expected.advice_declined,'Listening preference must persist')
      if(c.old)assert.ok(observations.some(o=>o.user_source_ids.includes('2')),'Historical answer requires original message retrieval')
      if(c.prior_state.advice_declined&&c.expected.proposals.length===0)assert.equal(result.progress.session_state?.advice_declined,true)
    }catch(e){error=e instanceof Error?e.message:'EVALUATION_FAILED'}
    results.push({id:c.id,hard_checks_passed:!error,error,model_calls:calls,elapsed_ms:Date.now()-started,rubric:c.rubric,human_review_pending:true,modelOutputs,output})
    await writeFile(join(directory,'results.json'),JSON.stringify({promptVersion,model:process.env.DEEPSEEK_MODEL||'deepseek-flash',sourceHashes,provenance:suite.provenance,review_status:suite.review_status,scope:'Real model, production graph and product method cards; synthetic tool data, no database, no application writes, no professional validity claim',results},null,2))
    console.log(`${c.id}: ${error?'FAIL '+error:'PASS structural checks'} (${calls} model calls)`)
    if(error)process.exitCode=1
  }
  console.log('Wang evaluation artifacts:',directory)
}
