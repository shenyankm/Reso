import {useEffect,useMemo,useRef,useState} from 'react'

export function ProgressiveReply({text,animate,onStart,onChunk,onComplete}:{text:string;animate:boolean;onStart:()=>void;onChunk:()=>void;onComplete?:()=>void}){
  const characters=useMemo(()=>Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(text),part=>part.segment),[text])
  const [play]=useState(()=>animate&&typeof window!=='undefined'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [length,setLength]=useState(()=>play?1:characters.length)
  const callbacks=useRef({onStart,onChunk,onComplete});callbacks.current={onStart,onChunk,onComplete}
  const completed=useRef(false)
  useEffect(()=>{
    callbacks.current.onStart()
    if(!play)return
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)'),start=performance.now()
    let frame=0
    const finish=()=>{cancelAnimationFrame(frame);setLength(characters.length)}
    const changed=()=>{if(preference.matches||document.hidden)finish()}
    const tick=(now:number)=>{
      const next=Math.min(characters.length,1+Math.floor((now-start)/30))
      setLength(next)
      if(next<characters.length)frame=requestAnimationFrame(tick)
    }
    if(preference.matches||document.hidden)finish();else frame=requestAnimationFrame(tick)
    preference.addEventListener('change',changed);document.addEventListener('visibilitychange',changed)
    return()=>{cancelAnimationFrame(frame);preference.removeEventListener('change',changed);document.removeEventListener('visibilitychange',changed)}
  },[play,characters])
  useEffect(()=>{if(play)callbacks.current.onChunk()},[play,length])
  useEffect(()=>{
    if(length<characters.length||completed.current)return
    completed.current=true
    callbacks.current.onComplete?.()
  },[length,characters.length])
  return <span className="progressive-reply" data-revealing={length<characters.length}>
    <span aria-hidden="true" className="reply-visible">{characters.slice(0,length).join('')}</span>
    <span className="sr-only">{text}</span>
  </span>
}
