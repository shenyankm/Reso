type ExportResult='saved'|'cancelled'|'downloaded'
declare global { interface Window { ResoExport?:{postMessage:(text:string)=>void;onmessage:((event:{data:string})=>void)|null} } }

export async function exportRecord(data:unknown):Promise<ExportResult>{
  const text=JSON.stringify(data,null,2),bridge=window.ResoExport
  if(bridge)return new Promise((resolve,reject)=>{
    bridge.onmessage=event=>{
      bridge.onmessage=null
      try{const result=JSON.parse(event.data);if(result.status==='saved'||result.status==='cancelled')resolve(result.status);else reject(new Error(result.status==='too_large'?'记录过大，请在电脑端导出':'导出未完成，请选择可写入的位置后重试'))}catch{reject(new Error('无法确认导出结果，请重试'))}
    }
    try{bridge.postMessage(text)}catch{bridge.onmessage=null;reject(new Error('无法打开文件保存，请重试'))}
  })
  if('__TAURI_INTERNALS__' in window)throw new Error('请更新 App 后重试导出，或在电脑端导出')
  const href=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a')
  link.href=href;link.download='reso-event.json';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000)
  return 'downloaded'
}
