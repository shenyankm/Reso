import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import MvpApp from './MvpApp'
import './styles.css'

const root=createRoot(document.getElementById('root')!)
if(new URLSearchParams(location.search).has('preview')){
  import('./App').then(({default:App})=>root.render(<StrictMode><App/></StrictMode>)).catch(()=>{root.render(<p role="alert">演示页面未能加载，请刷新重试。</p>)})
}else root.render(<StrictMode><MvpApp/></StrictMode>)
