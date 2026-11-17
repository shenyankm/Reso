import {createHash} from 'node:crypto'
import {z} from 'zod'

const jsonByteLimit=256*1024
const code=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/)
const uuid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const digest=z.string().regex(/^[0-9a-f]{64}$/)
const uniqueCodes=(max:number)=>z.array(code).max(max).refine(v=>new Set(v).size===v.length,'Duplicate code')
const text=(min:number,max:number)=>z.string().refine(v=>[...v].length>=min&&[...v].length<=max,'Invalid code-point length')
const timestamp=z.union([z.string().datetime(),z.date()])

// Native PostgreSQL JSONB values only. Reject raw duplicate keys before parsing; never rewrite legacy bytes.
export function canonicalJson(value:unknown):string{
  const chunks:string[]=[],active=new Set<object>();let bytes=0,nodes=0
  const append=(part:string)=>{bytes+=Buffer.byteLength(part,'utf8');if(bytes>jsonByteLimit)throw Error('NATIVE_JSON_TOO_LARGE');chunks.push(part)}
  const string=(s:string)=>{
    if(s.length>jsonByteLimit)throw Error('NATIVE_JSON_TOO_LARGE')
    for(let i=0;i<s.length;i++){
      const unit=s.charCodeAt(i)
      if(unit===0)throw Error('NATIVE_JSON_NUL')
      if(unit>=0xd800&&unit<=0xdbff){const next=s.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw Error('NATIVE_JSON_INVALID_UNICODE')}
      else if(unit>=0xdc00&&unit<=0xdfff)throw Error('NATIVE_JSON_INVALID_UNICODE')
    }
    append(JSON.stringify(s))
  }
  const visit=(v:unknown,depth:number)=>{
    if(depth>64||++nodes>50000)throw Error('NATIVE_JSON_TOO_COMPLEX')
    if(v===null){append('null');return}
    if(typeof v==='string'){string(v);return}
    if(typeof v==='boolean'){append(v?'true':'false');return}
    if(typeof v==='number'){if(!Number.isFinite(v))throw Error('NATIVE_JSON_INVALID_NUMBER');append(JSON.stringify(v));return}
    if(typeof v!=='object')throw Error('NATIVE_JSON_INVALID_VALUE')
    const array=Array.isArray(v),prototype=Object.getPrototypeOf(v)
    if((array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)||Object.getOwnPropertySymbols(v).length)throw Error('NATIVE_JSON_INVALID_OBJECT')
    if(active.has(v))throw Error('NATIVE_JSON_CYCLE')
    active.add(v)
    const descriptors=Object.getOwnPropertyDescriptors(v)
    const keys=Object.keys(descriptors)
    if(array){
      if(keys.length!==v.length+1)throw Error('NATIVE_JSON_INVALID_ARRAY')
      append('[')
      for(let i=0;i<v.length;i++){
        const item=descriptors[String(i)]
        if(!item?.enumerable||!('value'in item))throw Error('NATIVE_JSON_INVALID_ARRAY')
        if(i)append(',');visit(item.value,depth+1)
      }
      append(']')
    }else{
      append('{')
      keys.sort().forEach((key,i)=>{
        const item=descriptors[key]
        if(!item.enumerable||!('value'in item))throw Error('NATIVE_JSON_INVALID_OBJECT')
        if(i)append(',');string(key);append(':');visit(item.value,depth+1)
      })
      append('}')
    }
    active.delete(v)
  }
  visit(value,0);return chunks.join('')
}

export const nativeJsonSha256=(value:unknown)=>createHash('sha256').update(canonicalJson(value),'utf8').digest('hex')

const stateSignalValues:Record<string,readonly string[]>={expression_privacy:['unknown','reported_private','reported_not_private'],support_preference:['unknown','listen_only','ask_before_guidance','explore','action_support','pause'],insight_state:['unknown','not_explored','emerging','user_articulated'],relationship_dependency:['unknown','not_needed','possible','explicitly_requested']}
const codeSignal=z.object({field:z.enum(['domain','intent','emotion_intensity','event_clarity','readiness','risk_signal','previous_safety_state','record_request','refusal_target','expression_privacy','support_preference','insight_state','relationship_dependency']),operator:z.enum(['eq','in','not_in']),values:uniqueCodes(16).min(1)}).strict()
  .refine(v=>v.operator!=='eq'||v.values.length===1,'eq requires one value')
  .refine(v=>!stateSignalValues[v.field]||v.values.every(value=>stateSignalValues[v.field].includes(value)),'State signals require registered values and separate backend evidence checks')
const booleanSignal=z.object({field:z.enum(['understanding_confirmed','user_requested_method','method_declined','room_intervention_needed','third_party_motive_uncertain','advice_declined']),operator:z.literal('eq'),value:z.boolean()}).strict()
const confidenceSignal=z.object({field:z.literal('confidence'),operator:z.enum(['eq','lt','lte','gt','gte']),value:z.number().min(0).max(1)}).strict()
export const ruleConditionsSchema=z.object({match:z.enum(['all','any']),signals:z.array(z.union([codeSignal,booleanSignal,confidenceSignal])).min(1).max(16)}).strict()
export const responseRequirementsSchema=z.object({depth:z.enum(['acknowledge','clarify','explore','guide','reflect','safety']),care_focus:z.array(z.enum(['feeling','effort','need','choice','uncertainty'])).min(1).max(5).refine(v=>new Set(v).size===v.length),hypothesis_style:z.literal('tentative_and_verify'),separate_fact_and_inference:z.literal(true),respect_refusal:z.literal(true),avoid_diagnosis:z.literal(true),guidance:text(1,2000)}).strict()

export const agentPolicyContentSchema=z.object({type:z.literal('agent'),notice:text(1,20000),rules:z.array(z.object({code,description:text(1,3000),allowed_codes:uniqueCodes(32),parameters:z.array(z.object({name:code,value:z.union([text(0,200),z.number().min(-1e9).max(1e9),z.boolean()])}).strict()).max(32)}).strict()).max(128),professional_review_required:z.boolean()}).strict()
const legacyAgentRuleBodySchema=z.object({
  rule_code:code,source_rule_code:z.string().min(1).nullable(),source_type:z.enum(['provided_material','engineering_supplement']),source_reference:z.string().min(1),
  priority_group:z.enum(['safety','authorization','willingness','stage','method','style']),priority:z.number().int().min(0).max(2147483647),schema_version:z.literal(1),
  conditions:ruleConditionsSchema,stage_codes:uniqueCodes(32),route_code:code,skill_code:code,allowed_tools:uniqueCodes(32),forbidden_actions:uniqueCodes(32),required_confirmations:uniqueCodes(32),response_requirements:responseRequirementsSchema,
}).strict()
const currentAgentRuleBodySchema=legacyAgentRuleBodySchema.extend({schema_version:z.literal(2),skill_codes:uniqueCodes(8).min(1)})
const primarySkillMatches=(value:{skill_code:string;skill_codes:string[]})=>value.skill_codes[0]===value.skill_code
export const agentRuleBodySchema=z.discriminatedUnion('schema_version',[legacyAgentRuleBodySchema,currentAgentRuleBodySchema.refine(primarySkillMatches,'Primary skill must be first')])
const ruleMetadata={id:uuid,policy_version_id:uuid,content_sha256:digest,created_by:z.string().min(1),created_at:timestamp}
const storedRuleSchema=z.discriminatedUnion('schema_version',[legacyAgentRuleBodySchema.extend(ruleMetadata),currentAgentRuleBodySchema.extend(ruleMetadata).refine(primarySkillMatches,'Primary skill must be first')])

export function agentRuleContentSha256(body:unknown){return nativeJsonSha256(agentRuleBodySchema.parse(body))}

export function agentRuleSetSha256(policyVersionId:string,rows:unknown[]):string{
  uuid.parse(policyVersionId)
  const rules=z.array(storedRuleSchema).parse(rows),ids=new Set<string>(),codes=new Set<string>()
  const items=rules.map(row=>{
    if(row.policy_version_id!==policyVersionId)throw Error('POLICY_RULE_WRONG_PARENT')
    if(ids.has(row.id)||codes.has(row.rule_code))throw Error('POLICY_RULE_DUPLICATE')
    ids.add(row.id);codes.add(row.rule_code)
    const {id,policy_version_id,content_sha256,created_by,created_at,...body}=row
    if(agentRuleContentSha256(body)!==content_sha256)throw Error('POLICY_RULE_HASH_MISMATCH')
    return{rule_code:row.rule_code,id,content_sha256}
  })
  items.sort((a,b)=>a.rule_code<b.rule_code?-1:a.rule_code>b.rule_code?1:0)
  return nativeJsonSha256(items.map(({id,content_sha256})=>({id,content_sha256})))
}

// Call only with the actual locked parent row. This is a state guard, not permission to edit a policy.
export function assertAgentPolicyEditable(parent:{category:string;status:string}){
  if(parent.category!=='agent'||parent.status!=='draft')throw Error('POLICY_RULES_FROZEN')
}

const policySnapshotSchema=z.object({
  id:uuid,policy_key:code,version:z.number().int().positive().max(2147483647),category:z.literal('agent'),locale:z.string().min(1),region_scope:uniqueCodes(100).min(1),content:agentPolicyContentSchema,content_sha256:digest,schema_version:z.literal(1),
  status:z.literal('published'),effective_at:timestamp,expires_at:timestamp.nullable(),reviewed_by:z.string().min(1),reviewed_at:timestamp,review_evidence_file_id:uuid.nullable(),created_by:z.string().min(1),created_at:timestamp,rules_sha256:digest,
}).strict()

// Integrity/lifecycle only: current role, qualification, region and disclosure authorization remain separate gates.
export function verifyPublishedAgentPolicySnapshot(value:unknown,rows:unknown[],now:Date){
  const p=policySnapshotSchema.parse(value),at=now.getTime()
  if(!Number.isFinite(at)||new Date(p.effective_at).getTime()>at||new Date(p.reviewed_at).getTime()>at||p.expires_at!==null&&new Date(p.expires_at).getTime()<=at)throw Error('POLICY_NOT_EFFECTIVE')
  if(!rows.length)throw Error('POLICY_RULES_MISSING')
  if(nativeJsonSha256(p.content)!==p.content_sha256||agentRuleSetSha256(p.id,rows)!==p.rules_sha256)throw Error('POLICY_HASH_MISMATCH')
}

const reviewIdentitySchema=z.object({reviewed_by:z.string().min(1),assignment:z.object({user_id:z.string().min(1),credential_id:uuid,granted_by:z.string().min(1),revoked_at:timestamp.nullable()}).strict(),credential:z.object({id:uuid,subject_user_id:z.string().min(1),status:z.literal('verified'),verified_by:z.string().min(1)}).strict()}).strict()
// Consistency of trusted review records only; this does not establish the role's authority or credential sufficiency.
export function verifyReviewIdentity(value:unknown){
  const {reviewed_by,assignment,credential}=reviewIdentitySchema.parse(value)
  if(assignment.user_id!==reviewed_by||credential.subject_user_id!==reviewed_by||assignment.credential_id!==credential.id||assignment.granted_by===reviewed_by||assignment.revoked_at!==null||credential.verified_by===reviewed_by)throw Error('POLICY_REVIEW_IDENTITY_MISMATCH')
}
