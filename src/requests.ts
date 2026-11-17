export function createRequestScope(){
  let controller=new AbortController()
  return{
    get signal(){return controller.signal},
    cancel(){controller.abort()},
    begin(parent?:AbortSignal){
      controller.abort();controller=new AbortController()
      return parent?AbortSignal.any([parent,controller.signal]):controller.signal
    },
  }
}
