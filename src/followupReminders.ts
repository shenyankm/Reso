export type Reminder = {id:string;at:number}
declare global {
  interface Window {
    ResoReminders?: {
      postMessage:(text:string)=>void
      onmessage:((event:{data:string})=>void)|null
    }
  }
}

export function syncDeviceReminders(account:string, entries:Reminder[]) {
  window.ResoReminders?.postMessage(JSON.stringify({
    action:'sync',account,entries,
  }))
}

export function allowDeviceReminders() {
  const bridge=window.ResoReminders
  if(!bridge)return Promise.resolve(false)
  return new Promise<boolean>(resolve=>{
    bridge.onmessage=event=>{bridge.onmessage=null;resolve(event.data==='allowed')}
    try{bridge.postMessage(JSON.stringify({action:'permission'}))}
    catch{bridge.onmessage=null;resolve(false)}
  })
}

export function remindersEnabled(userId:string) {
  try{return localStorage.getItem(`reso-reminders:${userId}`)==='1'}catch{return false}
}

export function rememberReminders(userId:string, enabled:boolean) {
  try{
    if(enabled)localStorage.setItem(`reso-reminders:${userId}`,'1')
    else localStorage.removeItem(`reso-reminders:${userId}`)
  }catch{}
}
