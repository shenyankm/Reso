import { Bot, UsersRound } from 'lucide-react'

export function PrimaryNavigation({
  className, relationships, busy = false, onReso, onRelationships,
}: {
  className: string
  relationships: boolean
  busy?: boolean
  onReso: () => void
  onRelationships: () => void
}) {
  return <nav className={`reso-primary-nav ${className}`} aria-label="主导航">
    <button type="button" aria-current={!relationships ? 'page' : undefined} disabled={busy} onClick={onReso}>
      <span><Bot aria-hidden="true"/></span>Reso
    </button>
    <button type="button" aria-current={relationships ? 'page' : undefined} disabled={busy} onClick={onRelationships}>
      <span><UsersRound aria-hidden="true"/></span>我的关系
    </button>
  </nav>
}
