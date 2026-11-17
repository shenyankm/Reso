import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {canonicalJson,nativeJsonSha256,agentRuleBodySchema,agentRuleContentSha256,agentRuleSetSha256,agentPolicyContentSchema,ruleConditionsSchema,responseRequirementsSchema,assertAgentPolicyEditable,verifyPublishedAgentPolicySnapshot,verifyReviewIdentity} from './policy-integrity'

const policyId='10000000-0000-4000-8000-000000000001'
const now=new Date('2026-11-17T02:00:00Z')
const body=()=>({rule_code:'listen',source_rule_code:null,source_type:'engineering_supplement' as const,source_reference:'Synthetic policy test; not Wang approval',priority_group:'willingness' as const,priority:1,schema_version:1 as const,conditions:{match:'all' as const,signals:[{field:'readiness' as const,operator:'eq' as const,values:['listening']}]},stage_codes:['listening'],route_code:'A',skill_code:'emotion_support',allowed_tools:[],forbidden_actions:['start_practice'],required_confirmations:[],response_requirements:{depth:'acknowledge' as const,care_focus:['feeling' as const,'choice' as const],hypothesis_style:'tentative_and_verify' as const,separate_fact_and_inference:true as const,respect_refusal:true as const,avoid_diagnosis:true as const,guidance:'先承接感受，是否继续由本人决定。'}})
const rule=(suffix='2',code='listen')=>{
  const data={...body(),rule_code:code}
  return{...data,id:'10000000-0000-4000-8000-'+suffix.padStart(12,'0'),policy_version_id:policyId,content_sha256:agentRuleContentSha256(data),created_by:'synthetic-editor',created_at:'2026-11-16T00:00:00Z'}
}
function policy(rows:unknown[]=[rule()]){
  const content={type:'agent' as const,notice:'Synthetic engineering fixture, not an approved policy',rules:[],professional_review_required:true}
  return{id:policyId,policy_key:'synthetic-agent',version:1,category:'agent',locale:'zh-CN',region_scope:['synthetic-region'],content,content_sha256:nativeJsonSha256(content),schema_version:1,status:'published',effective_at:'2026-11-17T00:00:00Z',expires_at:'2026-11-18T00:00:00Z',reviewed_by:'synthetic-reviewer',reviewed_at:'2026-11-16T23:00:00Z',review_evidence_file_id:null,created_by:'synthetic-editor',created_at:'2026-11-16T00:00:00Z',rules_sha256:agentRuleSetSha256(policyId,rows)}
}

test('native canonicalization sorts UTF-16 keys recursively and preserves array order',()=>{
  const input=JSON.parse('{"2":"two","10":"ten","😀":"emoji","דּ":"letter","a":[{"z":1,"a":2},false,null]}')
  assert.equal(canonicalJson(input),'{"10":"ten","2":"two","a":[{"a":2,"z":1},false,null],"😀":"emoji","דּ":"letter"}')
  assert.equal(nativeJsonSha256(input),nativeJsonSha256({a:[{a:2,z:1},false,null],'דּ':'letter','😀':'emoji','10':'ten','2':'two'}))
  assert.notEqual(nativeJsonSha256([1,2]),nativeJsonSha256([2,1]))
  const proto=JSON.parse('{"__proto__":{"a":1},"constructor":2}')
  assert.equal(canonicalJson(proto),'{"__proto__":{"a":1},"constructor":2}')
  assert.equal(Object.getPrototypeOf(proto),Object.prototype)
})

test('RFC 8785 number behavior uses ECMAScript finite numbers without Unicode normalization',()=>{
  assert.equal(canonicalJson([-0,333333333.33333329,1e30,4.50,2e-3,1e-27]),'[0,333333333.3333333,1e+30,4.5,0.002,1e-27]')
  assert.equal(canonicalJson([Number.MIN_VALUE,Number.MAX_VALUE]),'[5e-324,1.7976931348623157e+308]')
  assert.notEqual(nativeJsonSha256('é'),nativeJsonSha256('e\u0301'))
  assert.equal(canonicalJson('\n\u000f"\\'),JSON.stringify('\n\u000f"\\'))
  assert.equal(nativeJsonSha256({a:1}),createHash('sha256').update('{"a":1}').digest('hex'))
})

test('unsupported, lossy and cyclic native values fail instead of being silently rewritten',()=>{
  const cycle:Record<string,unknown>={};cycle.self=cycle
  let getterCalls=0
  const accessor=Object.defineProperty({},'a',{enumerable:true,get(){getterCalls++;return 1}})
  const hidden=Object.defineProperty({},'a',{enumerable:false,value:1})
  const extra=Object.assign([1],{extra:2})
  for(const invalid of [NaN,Infinity,-Infinity,undefined,1n,Symbol('x'),()=>1,new Date(),new Map(),cycle,accessor,hidden,extra,Array(1),{a:undefined},'\ud800','\udc00',{'\ud800':'key'}])assert.throws(()=>canonicalJson(invalid))
  assert.equal(getterCalls,0)
  for(const value of ['\u0000',{'\u0000':'key'},['text\u0000']])assert.throws(()=>canonicalJson(value),/NATIVE_JSON_NUL/)
  assert.throws(()=>canonicalJson('中'.repeat(90000)),/TOO_LARGE/)
  let deep:unknown=0;for(let i=0;i<66;i++)deep=[deep]
  assert.throws(()=>canonicalJson(deep),/TOO_COMPLEX/)
  assert.throws(()=>canonicalJson(Array(50001).fill(null)),/TOO_COMPLEX/)
})

test('policy field validators agree with the relevant authoritative JSON positive and negative examples',()=>{
  const examples=JSON.parse(readFileSync(new URL('../docs/database-contract-examples-v2.json',import.meta.url),'utf8'))
  const bindings=JSON.parse(readFileSync(new URL('../docs/database-json-contracts-v2.json',import.meta.url),'utf8'))['x-field-bindings']
  const validators:{[key:string]:{safeParse:(v:unknown)=>{success:boolean}}}={'agent_policy_rules.conditions':ruleConditionsSchema,'agent_policy_rules.response_requirements':responseRequirementsSchema}
  let checked=0
  for(const [field,validator]of Object.entries(validators)){
    const pair=examples.field_examples[field]
    assert.equal(validator.safeParse(pair.valid).success,true,field)
    assert.equal(validator.safeParse(pair.invalid).success,false,field);checked+=2
  }
  for(const item of examples.json_cases){
    const validator=validators[item.field]
    if(validator){
      const readable=item.version===bindings[item.field].version||(item.operation==='read'&&item.version===1)
      assert.equal(readable&&validator.safeParse(item.data).success,item.valid,item.name);checked++
    }
  }
  assert.ok(checked>=10)
  assert.equal(agentPolicyContentSchema.safeParse({...policy().content,extra:'must reject'}).success,false)
  assert.equal(agentRuleBodySchema.safeParse({...body(),execute_sql:'must reject'}).success,false)
  const unicode={...body(),response_requirements:{...body().response_requirements,guidance:'😀'.repeat(2000)}}
  assert.doesNotThrow(()=>agentRuleContentSha256(unicode))
  assert.throws(()=>agentRuleContentSha256({...unicode,response_requirements:{...unicode.response_requirements,guidance:'😀'.repeat(2001)}}))
})

test('native rule v2 freezes an ordered skill plan while v1 hashes remain unchanged',()=>{
  const legacy=body()
  assert.equal(agentRuleContentSha256(legacy),'6e2f3d7a41dd92e70f9d160c6ccae3c35a685cbbf9e663a45eead25b6c2c06a2')
  assert.equal(agentRuleBodySchema.safeParse({...legacy,skill_codes:['emotion_support']}).success,false)
  const current={...legacy,schema_version:2,skill_codes:['emotion_support','reflection_check']}
  assert.equal(agentRuleBodySchema.safeParse(current).success,true)
  for(const skill_codes of [[],['reflection_check','emotion_support'],['emotion_support','emotion_support'],Array.from({length:9},(_,i)=>i?'extra-'+i:'emotion_support')])assert.equal(agentRuleBodySchema.safeParse({...current,skill_codes}).success,false)
  const {skill_codes,...missing}=current
  assert.equal(agentRuleBodySchema.safeParse(missing).success,false)
  assert.notEqual(agentRuleContentSha256(current),agentRuleContentSha256({...current,skill_codes:['emotion_support','event_reconstruction']}))
  const row={...rule(),...current,content_sha256:agentRuleContentSha256(current)},p=policy([row])
  assert.doesNotThrow(()=>verifyPublishedAgentPolicySnapshot(p,[row],now))
  const changed={...current,skill_codes:['emotion_support','event_reconstruction']}
  assert.throws(()=>verifyPublishedAgentPolicySnapshot(p,[{...row,...changed,content_sha256:agentRuleContentSha256(changed)}],now),/HASH_MISMATCH/)
})

test('body hashes exclude creation metadata, while the policy freezes the complete actual rule identities',()=>{
  const rows=[rule('2','a'),rule('3','b')],p=policy(rows)
  assert.equal(agentRuleSetSha256(policyId,rows),agentRuleSetSha256(policyId,[rows[1],rows[0]]))
  assert.equal(agentRuleSetSha256(policyId,rows),agentRuleSetSha256(policyId,rows.map(r=>({...r,created_by:'other-editor',created_at:new Date('2026-11-16T01:00:00Z')}))))
  assert.doesNotThrow(()=>verifyPublishedAgentPolicySnapshot(p,rows,now))
  assert.throws(()=>verifyPublishedAgentPolicySnapshot(p,rows.slice(1),now),/HASH_MISMATCH/)
  assert.throws(()=>verifyPublishedAgentPolicySnapshot(p,[...rows,rule('4','c')],now),/HASH_MISMATCH/)
  assert.throws(()=>verifyPublishedAgentPolicySnapshot(p,[{...rows[0],id:rule('9').id},rows[1]],now),/HASH_MISMATCH/)
  assert.throws(()=>agentRuleSetSha256(policyId,[rows[0],rows[0]]),/DUPLICATE/)
  assert.throws(()=>agentRuleSetSha256(policyId,[rows[0],{...rows[1],rule_code:'a',content_sha256:agentRuleContentSha256({...body(),rule_code:'a'})}]),/DUPLICATE/)
  assert.throws(()=>agentRuleSetSha256(policyId,[{...rows[0],policy_version_id:rule('9').id}]),/WRONG_PARENT/)
  assert.throws(()=>agentRuleSetSha256(policyId,[{...rows[0],priority:99}]),/HASH_MISMATCH/)
  const changed={...body(),allowed_tools:['safety_check']},rehashed={...rows[0],...changed,content_sha256:agentRuleContentSha256(changed)}
  assert.throws(()=>verifyPublishedAgentPolicySnapshot(p,[rehashed,rows[1]],now),/HASH_MISMATCH/)
})

test('only draft parent rows are editable and published snapshots require current evidence and validity',()=>{
  assert.doesNotThrow(()=>assertAgentPolicyEditable({category:'agent',status:'draft'}))
  for(const status of ['approved','published','retired'])assert.throws(()=>assertAgentPolicyEditable({category:'agent',status}),/FROZEN/)
  assert.throws(()=>assertAgentPolicyEditable({category:'privacy',status:'draft'}),/FROZEN/)
  const rows=[rule()],p=policy(rows)
  for(const status of ['draft','approved','retired'])assert.throws(()=>verifyPublishedAgentPolicySnapshot({...p,status},rows,now))
  for(const changes of [{effective_at:'2026-11-18T00:00:00Z'},{expires_at:now.toISOString()},{reviewed_at:'2026-11-18T00:00:00Z'}])assert.throws(()=>verifyPublishedAgentPolicySnapshot({...p,...changes},rows,now),/NOT_EFFECTIVE/)
  for(const changes of [{reviewed_by:null},{reviewed_at:null},{rules_sha256:null},{schema_version:9}])assert.throws(()=>verifyPublishedAgentPolicySnapshot({...p,...changes},rows,now))
  assert.throws(()=>verifyPublishedAgentPolicySnapshot({...p,content:{...p.content,notice:'Changed'}},rows,now),/HASH_MISMATCH/)
  assert.throws(()=>verifyPublishedAgentPolicySnapshot(policy([]),[],now),/RULES_MISSING/)
  assert.throws(()=>verifyPublishedAgentPolicySnapshot(p,rows,new Date(NaN)),/NOT_EFFECTIVE/)
  assert.doesNotThrow(()=>verifyPublishedAgentPolicySnapshot({...p,region_scope:Array.from({length:100},(_,i)=>'region-'+i)},rows,now))
  for(const region_scope of [[],Array(101).fill('region'),['duplicate','duplicate']])assert.throws(()=>verifyPublishedAgentPolicySnapshot({...p,region_scope},rows,now))
  assert.throws(()=>verifyPublishedAgentPolicySnapshot({...p,version:2147483648},rows,now))
})

test('review evidence cannot borrow another identity, credential or self-granted assignment',()=>{
  const value={reviewed_by:'reviewer',assignment:{user_id:'reviewer',credential_id:rule('6').id,granted_by:'grantor',revoked_at:null},credential:{id:rule('6').id,subject_user_id:'reviewer',status:'verified',verified_by:'verifier'}}
  assert.doesNotThrow(()=>verifyReviewIdentity(value))
  for(const changes of [{user_id:'other'},{credential_id:rule('7').id},{granted_by:'reviewer'},{revoked_at:'2026-11-16T00:00:00Z'}])assert.throws(()=>verifyReviewIdentity({...value,assignment:{...value.assignment,...changes}}))
  for(const changes of [{subject_user_id:'other'},{status:'pending'},{verified_by:'reviewer'}])assert.throws(()=>verifyReviewIdentity({...value,credential:{...value.credential,...changes}}))
})
