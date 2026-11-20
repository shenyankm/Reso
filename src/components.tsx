import {useEffect,useRef,useId} from 'react'
import type {ReactNode} from 'react'
import {ChevronDown,CircleCheck,X} from 'lucide-react'
import type {Message} from './demo'

export function Button({ children, onClick, secondary = false, disabled = false, className = '' }: { children: ReactNode; onClick?: () => void; secondary?: boolean; disabled?: boolean; className?: string }) {
  return <button type="button" className={`${secondary ? 'button secondary' : 'button primary'} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>
}

export function DisclosureSummary({children}:{children:ReactNode}) {
  return <summary className="disclosure-toggle">{children}<ChevronDown aria-hidden="true"/></summary>
}

export function Bubble({ role = 'reso', children, speaker = '妈妈' }: { role?: Message['role']; children: ReactNode; speaker?: string }) {
  return <div className={`bubble ${role}`}>{role === 'mom' && <span className="speaker">{speaker}</span>}{children}</div>
}

export function Dialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null),titleId=useId()
  useEffect(() => { const el = ref.current!; el.showModal(); return () => el.close() }, [])
  return <dialog ref={ref} className="dialog" aria-labelledby={titleId} aria-busy={busy} onCancel={event=>{event.preventDefault();if(!busy)onClose()}} onClick={event => { if (!busy&&event.target === event.currentTarget) onClose() }}>
    <div className="dialog-header"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}><X /></button></div>{children}
  </dialog>
}

export function Card({ children, title, icon, className = '' }: { children: ReactNode; title?: string; icon?: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{title && <div className="card-title">{icon}{<h2>{title}</h2>}</div>}{children}</section>
}


export function SaveStatus({saved,children}:{saved:boolean;children:string}) {
  return children?<p className={`draft-status${saved?' is-saved':''}`} role="status">{saved&&<CircleCheck aria-hidden="true"/>}<span>{children}</span></p>:null
}
