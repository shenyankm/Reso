import { createApp } from './app'
const {app}=await createApp()
try{await app.listen({host:'127.0.0.1',port:8787})}catch(error){await app.close();throw error}
console.log('Reso API ready at http://127.0.0.1:8787')
let closing=false
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(closing)return;closing=true;void app.close().then(()=>process.exit(0),()=>process.exit(1))})
