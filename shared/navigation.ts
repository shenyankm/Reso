const eventLink=/^#event\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(private|room)$/i
export function parseEventLink(hash:string){
  const match=hash.match(eventLink)
  return match?{id:match[1],domain:match[2].toLowerCase() as 'private'|'room'}:null
}
export const eventHash=(id:string,domain:'private'|'room')=>`#event/${id}/${domain}`
