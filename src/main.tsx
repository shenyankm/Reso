import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import MvpApp from './MvpApp'
import './styles.css'

const root=createRoot(document.getElementById('root')!)
const query=new URLSearchParams(location.search)
const standaloneRoadshow=import.meta.env.VITE_RESO_ROADSHOW_ONLY==='1'
if(standaloneRoadshow||query.has('roadshow')){
  import('./roadshow/Roadshow').then(({default:Roadshow})=>root.render(<StrictMode><Roadshow standalone={standaloneRoadshow}/></StrictMode>)).catch(()=>{root.render(<p role="alert">体验 Reso未能加载，请刷新重试。</p>)})
}else if(query.has('preview')){
  import('./App').then(({default:App})=>root.render(<StrictMode><App/></StrictMode>)).catch(()=>{root.render(<p role="alert">演示页面未能加载，请刷新重试。</p>)})
}else root.render(<StrictMode><MvpApp/></StrictMode>)
