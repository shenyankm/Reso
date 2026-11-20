import { useRef, useState } from 'react'
import { ArrowRight, HandHeart } from 'lucide-react'
import type { Consultant } from '../shared/types'

export function ConsultantMatches({ consultants, matched, busy, onSelect }: {
  consultants: Consultant[]
  matched: boolean
  busy: boolean
  onSelect: (consultant: Consultant) => void
}) {
  const carousel = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(0)

  function destination(index: number) {
    const cards = carousel.current?.children
    const card = cards?.[index] as HTMLElement | undefined
    const first = cards?.[0] as HTMLElement | undefined
    return card && first ? card.offsetLeft - first.offsetLeft : 0
  }

  return <section className="consultant-results" aria-labelledby="consultant-results-title">
    <h2 id="consultant-results-title">{matched?'为你初步挑选':'可申请的咨询师'} · {consultants.length} 位老师</h2>
    <div className="consultant-carousel" ref={carousel} onScroll={event => {
      const left = event.currentTarget.scrollLeft
      const step = destination(1)
      if (step > 0) setCurrent(Math.min(consultants.length - 1, Math.max(0, Math.round(left / step))))
    }}>
      {consultants.map(consultant => <article className="consultant-match" key={consultant.id} aria-label={consultant.name}>
        <div className="consultant-profile">
          <span className="consultant-avatar" aria-hidden="true">{Array.from(consultant.name.trim())[0] || <HandHeart/>}</span>
          <span className="consultant-qualification">{consultant.test_only ? '体验资料' : '资质已核验'}</span>
        </div>
        <div className="consultant-match-copy">
          <h3>{consultant.name}</h3>
          <p className="consultant-approach">{consultant.approach}</p>
          {!!consultant.specialties.length && <p className="consultant-specialties">{consultant.specialties.join(' · ')}</p>}
          <p className="consultant-match-reason">{consultant.recommendation_reason}</p>
          <p className="fineprint">{consultant.qualifications}</p>
          {consultant.service_modes.length > 0 && <p className="fineprint">{consultant.service_modes.join(' · ')}</p>}
          {consultant.availability && <p className="fineprint">{consultant.availability}</p>}
          {consultant.price && <p className="fineprint">{consultant.price}</p>}
          <button type="button" className="button primary consultant-select" disabled={busy}
            aria-label={`了解${consultant.name}的服务`} onClick={() => onSelect(consultant)}>了解并申请 <ArrowRight aria-hidden="true"/></button>
        </div>
      </article>)}
    </div>
    {consultants.length > 1 && <div className="consultant-carousel-nav" role="group" aria-label="切换咨询师">
      {consultants.map((consultant, index) => <button type="button" key={consultant.id}
        aria-label={`查看${consultant.name}`} aria-current={index === current ? 'true' : undefined}
        onClick={() => carousel.current?.scrollTo({ left: destination(index) })}><span/></button>)}
    </div>}
  </section>
}
