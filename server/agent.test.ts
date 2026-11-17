import test from 'node:test'
import assert from 'node:assert/strict'
import {createAgent as createProductionAgent,validateReply,safetyReply,deepseekModel} from './agent'
import type {AgentCheckpoint,Model} from './agent'
import {serializeAgentContext} from './agent-context'
import {reviewAgentOutput} from './agent-evaluation'
import {toolSchema} from './agent-tools'
import type {AgentTools,ToolRequest} from './agent-tools'
import {withObservationFixture} from './test-agent'
const createAgent=(...args:Parameters<typeof createProductionAgent>)=>createProductionAgent(args[0]?withObservationFixture(args[0]):undefined,args[1],args[2])
const input={domain:'private' as const,context:JSON.stringify({messages:[{id:'10',role:'user',text:'我想开始一个表达练习'}]}),lastMessage:'我想开始一个表达练习',messageIds:['10'],userMessageIds:['10']}
const draftInput={...input,context:JSON.stringify({messages:[{id:'10',role:'user',text:'请帮我整理表达'}]}),lastMessage:'请帮我整理表达'}
const supportInput={...input,context:JSON.stringify({messages:[{id:'10',role:'user',text:'请查一下目前有哪些真人专业支持'}]}),lastMessage:'请查一下目前有哪些真人专业支持'}
const plan=(extra:Record<string,unknown>={})=>JSON.stringify({intent:'整理表达',strategy:'listen',evidence_ids:['10'],uncertainty:'感受待本人确认',needs_human:false,...extra})
const tool:AgentTools=async request=>({request,result:{steps:['只描述事实，感受请本人确认']},source_ids:[],user_source_ids:[]})

test('agent reads evidence and a guide before preparing a sourced private practice',async()=>{
  let plans=0;const calls:ToolRequest[]=[],saved:AgentCheckpoint[]=[]
  const result=await createAgent(async(prompt,json)=>{
    if(!json){assert.ok(prompt.includes('旧原话'));return '我把你的话整理成了待核对的表达。感受和请求都可以修改。'}
    if(!plans++)return plan({tools:[{name:'search_history',query:'那句话'},{name:'practice_guide',kind:'nvc'}]})
    assert.ok(prompt.includes('旧原话'))
    return plan({evidence_ids:['2','10'],proposals:[{kind:'nvc',value:{observation:'对方打断了我',feeling:'委屈',need:'被听见',request:'能让我先说完吗'},source_ids:['2','10']}]})
  },undefined,{tools:async request=>{calls.push(request);return request.name==='search_history'?{request,result:[{content:'旧原话'}],source_ids:['2'],user_source_ids:['2']}:tool(request)},checkpoint:async state=>{saved.push(state)}}).invoke({input:draftInput})
  assert.equal(calls.length,2);assert.equal(result.assessment.proposals[0].kind,'nvc');assert.equal(result.progress.phase,'complete');assert.equal(saved.at(-1)?.phase,'complete');assert.equal(result.progress.trace.filter(s=>s.stage==='tool').length,2)
})

test('a failed response resumes after successful tools, without rerunning retrieval or planning',async()=>{
  let checkpoint:AgentCheckpoint|undefined,plans=0,tools=0
  const first:Model=async(_prompt,json)=>{if(!json)throw Error('MODEL_HTTP_503');return plan({tools:plans++?[]:[{name:'practice_guide',kind:'nvc'}]})}
  await assert.rejects(createAgent(first,undefined,{tools:async r=>{tools++;return tool(r)},checkpoint:async s=>{checkpoint=s}}).invoke({input}),/MODEL_HTTP_503/)
  assert.equal(checkpoint?.phase,'respond')
  const result=await createAgent(async(_prompt,json)=>{assert.equal(json,false);return '可以先按照你的节奏说。'},undefined,{resume:checkpoint,tools:async()=>{throw Error('must not repeat tools')}}).invoke({input})
  assert.equal(tools,1);assert.equal(plans,2);assert.equal(result.reply,'可以先按照你的节奏说。')
  const restored=await createAgent(async()=>{throw Error('must not regenerate complete checkpoint')},undefined,{resume:result.progress}).invoke({input});assert.equal(restored.reply,result.reply)
})

test('four tool calls is a hard budget and repeated requests cannot make an unbounded loop',async()=>{
  let tools=0,plans=0
  await assert.rejects(createAgent(async()=>plan({tools:[{name:'search_history',query:String(plans++)}]}),undefined,{tools:async r=>{tools++;return tool(r)}}).invoke({input}),/AGENT_TOOL_BUDGET/)
  assert.equal(tools,4);assert.equal(plans,6)
  let repeatTools=0
  await assert.rejects(createAgent(async()=>plan({tools:[{name:'search_history',query:'same'}]}),undefined,{tools:async r=>{repeatTools++;return tool(r)}}).invoke({input}),/AGENT_REPEATED_TOOL/)
  assert.equal(repeatTools,1)
})

test('private proposals require real user sources and the method guide; room proposals are rejected',async()=>{
  const proposal={kind:'nvc',value:{observation:'事',feeling:'感受',need:'需要',request:'请求'},source_ids:['10']}
  await assert.rejects(createAgent(async()=>plan({proposals:[proposal]})).invoke({input:draftInput}),/REQUIRES_GUIDE/)
  await assert.rejects(createAgent(async()=>plan({proposals:[{kind:'summary',value:{summary:'伪造'},source_ids:['999']}]})).invoke({input}),/UNKNOWN_EVIDENCE/)
  await assert.rejects(createAgent(async()=>plan({proposals:[{kind:'summary',value:{summary:'待核对'},source_ids:['10']}]})).invoke({input:{...input,userMessageIds:[]}}),/UNKNOWN_EVIDENCE/)
  await assert.rejects(createAgent(async()=>plan({proposals:[{kind:'summary',value:{summary:'私人'},source_ids:['10']}]})).invoke({input:{...input,domain:'room'}}),/ROOM_PRIVATE_PROPOSAL/)
  assert.equal(toolSchema.safeParse({name:'search_history',query:'a',eventId:'foreign'}).success,false)
  assert.equal(toolSchema.safeParse({name:'execute_sql',sql:'SELECT 1'}).success,false)
})

test('malformed plans and unsafe output have one bounded repair, provider errors are preserved',async()=>{
  let jsonCalls=0,textCalls=0
  const result=await createAgent(async(_prompt,json)=>json?(jsonCalls++?plan():'invalid JSON'):(textCalls++?'先把希望说的话留在这里。':'我已经帮你分享了摘要。')).invoke({input})
  assert.equal(jsonCalls,2);assert.equal(textCalls,2);assert.equal(result.reply,'先把希望说的话留在这里。')
  assert.doesNotThrow(()=>validateReply('请求可以写成：“能让我先说完吗？”你想先改哪部分？'))
  for(const reply of ['你确诊抑郁症','我已经为你预约了。','怎么了？你想怎么办？','<think>内部内容</think>'])assert.throws(()=>validateReply(reply),/OUTPUT_/)
  await assert.rejects(createAgent(async()=>{throw Error('MODEL_HTTP_401')}).invoke({input}),/MODEL_HTTP_401/)
})

test('safety overrides a restored response, silence has no proposals, and cancellation is propagated',async()=>{
  let calls=0
  const graph=createAgent(async()=>{calls++;throw Error('provider should not run')})
  const result=await graph.invoke({input:{...input,lastMessage:'我不想活了'}})
  assert.equal(calls,0);assert.equal(result.reply,safetyReply);assert.deepEqual(result.assessment.proposals,[])
  const silent=await createProductionAgent(withObservationFixture(async()=>plan({strategy:'silent'}),{room_intervention_needed:false})).invoke({input:{...input,domain:'room'}})
  assert.equal(silent.reply,'')
  await assert.rejects(createAgent(async(_p,_j,signal)=>{signal?.throwIfAborted();return plan()},AbortSignal.abort()).invoke({input}))
})


test('human support uses the actual directory result rather than replacing it with a generic referral',async()=>{
  let plans=0
  const result=await createProductionAgent(withObservationFixture(async(prompt,json)=>{
    if(json)return plan({strategy:'human_support',needs_human:true,tools:plans++?[]:[{name:'find_support',need:'沟通'}]})
    assert.ok(prompt.includes('find_support'));return '实际目录中暂时没有已核验的可选人员。'
  },{intent:'support',readiness:'willing'}),undefined,{tools:async request=>({request,result:[],source_ids:[],user_source_ids:[]})}).invoke({input:supportInput})
  assert.equal(result.progress.observations.length,1);assert.equal(result.reply,'实际目录中暂时没有已核验的可选人员。')
  assert.equal(result.assessment.route_decision?.route,'F');assert.equal(result.assessment.needs_human,true)
})


test('evaluation repairs malformed verdict JSON once without flipping a failed judgement',async()=>{
  let calls=0
  const repaired=await reviewAgentOutput(async()=>calls++?' {"pass":false,"reason":"失败原因"}':'{"pass":false,"reason":"unescaped "quote"}', 'synthetic rubric')
  assert.equal(repaired.pass,false);assert.equal(calls,2)
  let attempt=0
  await assert.rejects(reviewAgentOutput(async()=>attempt++?'{"pass":true,"reason":"changed"}':'{"pass":false,"reason":broken}', 'synthetic'),/REVIEW_DECISION_CHANGED/)
  await assert.rejects(reviewAgentOutput(async()=>'{broken','synthetic'))
})


test('large context is bounded without losing the latest user message or newest corrections',()=>{
  const data={messages:[...Array.from({length:11},(_,i)=>({id:String(i),text:'历史'.repeat(1500)})),{id:'last',text:'最新用户原话'}],followups:[{reflection:'回访'.repeat(20000)}],understandings:Array.from({length:40},(_,i)=>({id:String(i),content:'修正'.repeat(300)})),perspectives:[],exercise:{story:'故事'.repeat(20000),paused:true}}
  const json=serializeAgentContext(data),bounded=JSON.parse(json)
  assert.ok(json.length<=32000);assert.equal(bounded.context_window_truncated,true);assert.equal(bounded.messages.at(-1).text,'最新用户原话');assert.equal(bounded.understandings[0].id,'0');assert.equal(bounded.understandings[1].id,'1');assert.equal(bounded.exercise.paused,true);assert.equal(data.messages.length,12)
})


test('a final plan supplies the reply without an extra generation call after observation, retaining validation and recovery',async()=>{
  let calls=0,checkpoint:AgentCheckpoint|undefined
  const result=await createAgent(async(_prompt,json)=>{calls++;assert.equal(json,true);return plan({reply:'我听到你想先被完整听见。'})},undefined,{checkpoint:async s=>{checkpoint=s}}).invoke({input})
  assert.equal(calls,1);assert.equal(result.reply,'我听到你想先被完整听见。');assert.equal(checkpoint?.phase,'complete')
  const restored=await createAgent(async()=>{throw Error('must not call again')},undefined,{resume:result.progress}).invoke({input});assert.equal(restored.reply,result.reply)
  let repairs=0
  const checked=await createAgent(async(_p,json)=>json?plan({reply:'我已经帮你分享了内容。'}):(repairs++,'这只是待你确认的建议，尚未分享。')).invoke({input})
  assert.equal(repairs,1);assert.equal(checked.reply,'这只是待你确认的建议，尚未分享。')
})

test('a reply supplied before tools return is discarded and only the final sourced plan is published',async()=>{
  let calls=0
  const result=await createAgent(async(_p,json)=>{assert.equal(json,true);return calls++?plan({reply:'方法已查到，可以按你愿意的节奏整理。'}):plan({tools:[{name:'practice_guide',kind:'nvc'}],reply:'不应发送的工具前猜测'})},undefined,{tools:tool}).invoke({input})
  assert.equal(calls,2);assert.equal(result.reply,'方法已查到，可以按你愿意的节奏整理。')
})


test('context budget keeps exact boundaries and trimming order with escaped and Unicode data',()=>{
  const frame={messages:[{text:''},{text:'最新原话'}],followups:[],understandings:[],perspectives:[]}
  const base=JSON.stringify({...frame,context_window_truncated:false}).length
  frame.messages[0].text='x'.repeat(32000-base)
  assert.equal(JSON.parse(serializeAgentContext(frame)).context_window_truncated,false)
  frame.messages[0].text+='x'
  const clipped=JSON.parse(serializeAgentContext(frame));assert.equal(clipped.context_window_truncated,true);assert.equal(clipped.messages.length,1);assert.equal(clipped.messages[0].text,'最新原话')
  const mixed=JSON.parse(serializeAgentContext({messages:[{text:'\\\"😃'.repeat(6000)},{text:'保留\\\"😃'}],followups:[null,undefined,{text:'回访'}],understandings:[],perspectives:[]}))
  assert.equal(mixed.messages[0].text,'保留\\\"😃');assert.deepEqual(mixed.followups,[null,null,{text:'回访'}])
  assert.throws(()=>serializeAgentContext({messages:[{text:'x'.repeat(32001)}]}),/AGENT_CONTEXT_TOO_LARGE/)
})


test('normalization and bounded plan repair do not reuse an inline reply for a rejected action',async()=>{
  let text=0
  const normalized=await createAgent(async(_p,json)=>json?plan({strategy:'silent',reply:'我先旁听。'}):(text++,'这里可以继续按你的节奏聊。')).invoke({input})
  assert.equal(normalized.assessment.strategy,'exercise');assert.equal(normalized.reply,'这里可以继续按你的节奏聊。');assert.equal(text,1)
  let attempts=0
  const human=await createProductionAgent(withObservationFixture(async(_p,json)=>{
    assert.equal(json,true)
    return attempts++?plan({reply:'我们先想想你希望获得怎样的支持。'}):plan({needs_human:true,proposals:[{kind:'summary',value:{summary:'尚未确认'},source_ids:['10']}],reply:'摘要已经整理好，请查看下面的草稿。'})
  },{intent:'support',readiness:'willing'})).invoke({input:supportInput})
  assert.deepEqual(human.assessment.proposals,[]);assert.equal(human.reply,'我们先想想你希望获得怎样的支持。')
  assert.equal(attempts,2);assert.equal(human.assessment.needs_human,true)
})

test('understanding labels default to ordinary chat and do not duplicate record proposals',async()=>{
  const ordinary=await createAgent(async()=>plan({reply:'可以先慢慢说，我在这里听。'})).invoke({input})
  assert.equal(ordinary.assessment.understanding_kind,null)
  for(const understanding_kind of ['summary','inference']){
    const marked=await createAgent(async()=>plan({understanding_kind,reply:'你希望先把自己的计划说完，再一起讨论是否调整。'})).invoke({input})
    assert.equal(marked.assessment.understanding_kind,understanding_kind)
  }
  const proposal=await createAgent(async()=>plan({understanding_kind:'summary',reply:'整理为待核对草稿，还没有保存。',proposals:[{kind:'summary',value:{summary:'先把自己的计划说完'},source_ids:['10']}]})).invoke({input:{...input,lastMessage:'请帮我整理摘要'}})
  assert.equal(proposal.assessment.understanding_kind,null)
  const repaired=await createAgent(async(_prompt,json)=>json?plan({understanding_kind:'summary',reply:'我已经帮你分享了摘要。'}):'可以先把想说的话留在这里。').invoke({input})
  assert.equal(repaired.assessment.understanding_kind,null)
})

test('DeepSeek requests high thinking but returns only the final answer',async t=>{
  const previous=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='synthetic-high-thinking-key'
  t.after(()=>{if(previous===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previous})
  let truncated=false
  t.mock.method(globalThis,'fetch',async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));assert.deepEqual(body.thinking,{type:'enabled'});assert.equal(body.reasoning_effort,'high');assert.equal(body.max_tokens,16384);assert.deepEqual(body.response_format,{type:'json_object'})
    return new Response(JSON.stringify({choices:[{finish_reason:truncated?'length':'stop',message:{reasoning_content:'RAW_PRIVATE_REASONING',content:'这是最终回复。'}}]}),{status:200})
  })
  assert.equal(await deepseekModel('合成测试',true),'这是最终回复。')
  truncated=true;await assert.rejects(deepseekModel('合成测试',true),/MODEL_TRUNCATED/)
})

test('public summary survives a checkpoint retry without exposing raw reasoning or repeating completed calls',async()=>{
  let checkpoint:AgentCheckpoint|undefined,plans=0
  await assert.rejects(createAgent(async(_prompt,json)=>{
    if(!json)throw Error('MODEL_HTTP_503')
    plans++;return plan({reply_summary:'先关注你想被听完的需要，其余解释仍待核对。'})
  },undefined,{checkpoint:async value=>{checkpoint=value}}).invoke({input}),/MODEL_HTTP_503/)
  const old={...checkpoint,reasoning_content:'RAW_PRIVATE_REASONING'}
  const result=await createAgent(async(_prompt,json)=>{assert.equal(json,false);return '可以先把你希望被听完的那句话写下来。'},undefined,{resume:old}).invoke({input})
  assert.equal(plans,1);assert.equal(result.progress.reply_summary,'先关注你想被听完的需要，其余解释仍待核对。');assert.equal(result.reply,'可以先把你希望被听完的那句话写下来。')
  assert.ok(!JSON.stringify(result).includes('RAW_PRIVATE_REASONING'));assert.equal('reasoning_content' in result.progress,false)
  const cached=await createAgent(async()=>{throw Error('must not regenerate')},undefined,{resume:result.progress}).invoke({input});assert.equal(cached.progress.reply_summary,result.progress.reply_summary)
  const safety=await createAgent(async()=>{throw Error('must not invoke model for safety')},undefined,{resume:result.progress}).invoke({input:{...input,lastMessage:'我不想活了'}});assert.ok(safety.progress.reply_summary.includes('优先关注安全'))
})

test('long replies get one bounded rewrite and are never silently truncated',async()=>{
  let repairs=0
  const result=await createAgent(async(prompt,json)=>json?plan({reply:'重复的解释。'.repeat(50)}):(repairs++,assert.ok(prompt.includes('最多180字')),'你只是想先被听完，我们先不急着想办法。')).invoke({input})
  assert.equal(repairs,1);assert.equal(result.reply,'你只是想先被听完，我们先不急着想办法。')
  assert.throws(()=>validateReply('长'.repeat(181)))
  await assert.rejects(createAgent(async(_prompt,json)=>json?plan({reply:'长'.repeat(181)}):'长'.repeat(181)).invoke({input}))
})

test('phase checkpoints describe actual work and every completed reply has a bounded public summary',async()=>{
  const phases:string[]=[];let plans=0
  const result=await createAgent(async(_prompt,json)=>json?plan({tools:plans++?[]:[{name:'practice_guide',kind:'nvc'}],reply:plans>1?'我们先从你愿意表达的一句话开始。':''}):'我们先从你愿意表达的一句话开始。',undefined,{tools:tool,checkpoint:async value=>{if(phases.at(-1)!==value.display_phase)phases.push(value.display_phase)}}).invoke({input})
  assert.deepEqual(phases,['understanding','composing','checking','composing','reviewing'])
  assert.ok(result.progress.reply_summary.length>0&&result.progress.reply_summary.length<=120)
  for(const summary of ['内部推理：RAW_PRIVATE_REASONING','<think>RAW_PRIVATE_REASONING</think>','我已经帮你分享了摘要。','长'.repeat(121)]){
    const fallback=await createAgent(async()=>plan({reply:'这轮先听你说。',reply_summary:summary})).invoke({input})
    assert.ok(!fallback.progress.reply_summary.includes('RAW_PRIVATE_REASONING'));assert.notEqual(fallback.progress.reply_summary,summary)
  }
})
