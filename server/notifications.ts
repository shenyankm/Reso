import { z } from 'zod'
import type { Database } from './db'
import type { Domain } from '../shared/types'
import type {PoolClient} from 'pg'
import type {EventEmitter} from 'node:events'

export const eventNotification = z.object({
  eventId: z.string().uuid(),
  domain: z.enum(['private','room']),
  refreshUserId: z.string().min(1).max(100).optional(),
})
export type EventNotification = z.infer<typeof eventNotification>
export type Notify = (eventId: string, domain: Domain, refreshUserId?: string) => Promise<void>

export async function publishUpdate(database: Database, eventId: string, domain: Domain, refreshUserId?: string) {
  const notification = eventNotification.parse({ eventId, domain, refreshUserId })
  try{await database.pool.query("SELECT pg_notify('reso_updates',$1)", [JSON.stringify(notification)])}
  catch{console.error('Update notification unavailable; clients will recover through periodic refresh.')}
}

export async function listenForUpdates(database:Database,updates:EventEmitter){
  let client:PoolClient|null=null,closed=false,timer:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|undefined
  function reconnect(){
    if(closed||timer)return
    timer=setTimeout(()=>{timer=undefined;pending=connect().catch(()=>{reconnect()})},1000)
    timer.unref()
  }
  async function connect(){
    const current=await database.pool.connect()
    if(closed){current.release();return}
    client=current
    const lost=()=>{
      if(client!==current)return
      client=null;current.release(true)
      console.error('Update listener disconnected; reconnecting.')
      reconnect()
    }
    current.on('error',lost);current.once('end',lost)
    current.on('notification',notification=>{
      if(client!==current||closed)return
      try{
        const parsed=eventNotification.safeParse(JSON.parse(notification.payload||'null'))
        if(parsed.success)updates.emit('update',parsed.data)
      }catch{/* Malformed notifications cannot broaden visibility. */}
    })
    try{await current.query('LISTEN reso_updates')}
    catch(error){lost();throw error}
  }
  try{await connect()}catch(error){closed=true;if(timer)clearTimeout(timer);throw error}
  return{
    get connected(){return client!==null},
    async close(){
      closed=true;if(timer)clearTimeout(timer)
      await pending?.catch(()=>{})
      const current=client;client=null
      if(current){try{await current.query('UNLISTEN *')}catch{/* A lost listener still needs release. */}finally{current.release(true)}}
    },
  }
}
