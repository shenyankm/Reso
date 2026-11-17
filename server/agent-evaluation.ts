import {z} from 'zod'
import type {Model} from './agent'
const verdict=z.object({pass:z.boolean(),reason:z.string().max(1200)})
export async function reviewAgentOutput(model:Model,prompt:string){
  const raw=await model(prompt,true)
  try{return verdict.parse(JSON.parse(raw))}catch{
    const repaired=verdict.parse(JSON.parse(await model(`以下审核结果JSON格式或字段不合法。只修复JSON格式为 {"pass":boolean,"reason":string}，保留原有结论和依据，不重新评判、不改变通过与否。\n${raw}`,true)))
    const original=raw.match(/"pass"\s*:\s*(true|false)/)?.[1]
    if(original&&repaired.pass!==(original==='true'))throw Error('REVIEW_DECISION_CHANGED')
    return repaired
  }
}
