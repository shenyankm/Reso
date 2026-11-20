const eventLink=/^#event\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(private|room)$/i
export function parseEventLink(hash:string){
  const match=hash.match(eventLink)
  return match?{id:match[1],domain:match[2].toLowerCase() as 'private'|'room'}:null
}
export const eventHash=(id:string,domain:'private'|'room')=>`#event/${id}/${domain}`

export function parseInviteHash(hash:string){
  return hash.match(/^#invite\/([A-Za-z0-9_-]{43})$/)?.[1]??null
}

export function parseInvitationLink(input:string,origin:string){
  try{
    const url=new URL(input.trim())
    if(url.origin!==origin||url.pathname!=='/'||url.username||url.password)return null
    return parseInviteHash(url.hash)
  }catch{return null}
}
