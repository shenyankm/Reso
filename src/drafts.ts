import {useEffect,useState} from 'react'

type Draft={values:Record<string,string>;revision:number}
const prefix='reso:draft:'
const memory=new Map<string,Draft>()
export const draftKey=(userId:string,eventId:string,kind:string)=>`${prefix}${encodeURIComponent(userId)}:${encodeURIComponent(eventId)}:${kind}`

export function readDraft(key:string,initial:Draft,storage?:Pick<Storage,'getItem'>):Draft{
  try{
    const value=JSON.parse(storage?.getItem(key)||'null') as Draft|null
    if(value&&Number.isSafeInteger(value.revision)&&value.revision>=0&&value.values&&Object.keys(value.values).length===Object.keys(initial.values).length&&Object.keys(initial.values).every(field=>typeof value.values[field]==='string'&&value.values[field].length<=5000))return value
  }catch{}
  return memory.get(key)||initial
}
function storage(){try{return window.localStorage}catch{return undefined}}
function remove(key:string){memory.delete(key);try{storage()?.removeItem(key)}catch{}}
export function hasDrafts(userId:string){
  const scope=`${prefix}${encodeURIComponent(userId)}:`
  if([...memory.keys()].some(key=>key.startsWith(scope)))return true
  try{const local=storage();if(local)for(let i=0;i<local.length;i++)if(local.key(i)?.startsWith(scope))return true}catch{}
  return false
}
export function clearDrafts(userId?:string,eventId?:string){
  const scope=userId?`${prefix}${encodeURIComponent(userId)}:${eventId?`${encodeURIComponent(eventId)}:`:''}`:prefix
  for(const key of memory.keys())if(key.startsWith(scope))memory.delete(key)
  try{const local=storage();if(local)for(let i=local.length-1;i>=0;i--){const key=local.key(i);if(key?.startsWith(scope))local.removeItem(key)}}catch{}
}

export function useDraft(userId:string,eventId:string,kind:string,values:Record<string,string>,revision=0){
  const key=draftKey(userId,eventId,kind),initial={values,revision},serialized=JSON.stringify(values)
  const load=()=>{const draft=userId&&eventId?readDraft(key,initial,storage()):initial;return{key,...draft,dirty:JSON.stringify(draft.values)!==serialized,persistent:true}}
  const [state,setState]=useState(load)
  const current=state.key===key?state:load()
  useEffect(()=>{setState(previous=>previous.key!==key?load():previous.dirty?previous:{key,values,revision,dirty:false,persistent:true})},[key,serialized,revision])
  function update(next:Record<string,string>){
    const dirty=JSON.stringify(next)!==serialized,draft={values:next,revision:dirty&&current.dirty?current.revision:revision}
    let persistent=true
    if(userId&&eventId&&dirty){memory.set(key,draft);try{const local=storage();if(!local)throw new Error('Storage unavailable');local.setItem(key,JSON.stringify(draft))}catch{persistent=false}}
    else remove(key)
    setState({key,...draft,dirty,persistent})
  }
  function saved(nextRevision=revision){remove(key);setState({key,values:current.values,revision:nextRevision,dirty:false,persistent:true})}
  function reset(){remove(key);setState({key,...initial,dirty:false,persistent:true})}
  function rebase(nextRevision=revision){const next={...current,revision:nextRevision};memory.set(key,next);try{storage()?.setItem(key,JSON.stringify(next))}catch{}setState(next)}
  return{...current,update,saved,reset,rebase}
}
