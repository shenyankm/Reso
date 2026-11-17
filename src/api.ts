import {methodOfferFeature} from '../shared/capabilities'
export class ApiError extends Error { constructor(message:string,public status:number,public path=''){super(message)} }
export async function api<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST',signal?:AbortSignal):Promise<T>{
  const deadline=AbortSignal.timeout(15000)
  try{
    const response=await fetch(`/api${path}`,{method,credentials:'same-origin',signal:signal?AbortSignal.any([signal,deadline]):deadline,headers:{'X-Reso-Features':methodOfferFeature,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
    let data:unknown
    try{data=await response.json()}catch{throw new ApiError('服务返回了无法读取的结果，请稍后重试',response.ok?502:response.status,path)}
    if(!response.ok){
      const error=data&&typeof data==='object'?data as {error?:unknown;message?:unknown;code?:string}:null
      const authentication=path==='/auth/sign-in/email'||path==='/auth/sign-up/email'
      const authMessages:Record<string,string>={INVALID_EMAIL_OR_PASSWORD:'邮箱或密码不正确，请修改后重试',INVALID_EMAIL:'邮箱格式不正确，请检查后重试',PASSWORD_TOO_SHORT:'密码至少需要 10 位',PASSWORD_TOO_LONG:'密码过长，请缩短后重试',USER_ALREADY_EXISTS:'该邮箱已注册，请直接登录',USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:'该邮箱已注册，请直接登录'}
      const message=authentication?(authMessages[error?.code||'']||(response.status===429?'尝试次数较多，请稍后再试':'账号服务暂时未完成请求，请稍后重试')):typeof error?.error==='string'?error.error:typeof error?.message==='string'?error.message:'操作未完成，请重试'
      throw new ApiError(message,response.status,path)
    }
    return data as T
  }catch(error){
    if(signal?.aborted)throw new DOMException('Request cancelled','AbortError')
    if(deadline.aborted)throw new ApiError('请求超时，结果尚未确认。请检查网络后重试，当前输入仍保留',0,path)
    if(error instanceof ApiError)throw error
    throw new ApiError('网络连接未完成，请检查连接后重试',0,path)
  }
}
export function clientId(){
  if(crypto.randomUUID)return crypto.randomUUID()
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128
  const hex=Array.from(b,n=>n.toString(16).padStart(2,'0')).join('')
  return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}
