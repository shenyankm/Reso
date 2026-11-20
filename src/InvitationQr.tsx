import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Button } from './components'

export function InvitationQr({ link }: { link: string }) {
  const [image, setImage] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    import('qrcode').then(({ toDataURL })=>toDataURL(link, {width: 320, margin: 4})).then(url => {
      if (active) setImage(url)
    }).catch(() => {
      if (active) setError(true)
    })
    return () => { active = false }
  }, [link])
  return <div className="invitation-qr">
    {image ? <img src={image} width="320" height="320" alt="会谈邀请二维码"/>
      : <p role={error ? 'alert' : 'status'}>{error ? '暂时无法生成二维码，可以复制邀请链接。' : '正在生成二维码…'}</p>}
    <p className="supporting-copy">请只发给受邀的人。扫码后仍需登录并确认加入。</p>
  </div>
}

export function InvitationScanner({ accept }: { accept: (link: string) => boolean }) {
  const [camera, setCamera] = useState(false)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const lifetime = useRef<AbortSignal | null>(null)
  const onAccept = useRef(accept)
  onAccept.current = accept
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller.signal
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!camera) return
    let active = true
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    const hide = () => { if (document.hidden && stream) setCamera(false) }
    document.addEventListener('visibilitychange', hide)
    async function scan() {
      const {default: decode} = await import('jsqr')
      if (!active) return
      stream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:'environment'}}})
      if (!active) {
        stream.getTracks().forEach(track=>track.stop())
        return
      }
      const source = video.current!
      source.srcObject = stream
      await source.play()
      if (!active) return
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', {willReadFrequently:true})!
      timer = setInterval(() => {
        if (document.hidden) { setCamera(false); return }
        if (source.readyState < 2 || !source.videoWidth) return
        const scale = Math.min(1, 640 / Math.max(source.videoWidth, source.videoHeight))
        canvas.width = Math.max(1, Math.round(source.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(source.videoHeight * scale))
        context.drawImage(source, 0, 0, canvas.width, canvas.height)
        const data = context.getImageData(0, 0, canvas.width, canvas.height)
        const code = decode(data.data, data.width, data.height, {inversionAttempts:'dontInvert'})
        if (!code) return
        setCamera(false)
        if (!onAccept.current(code.data)) setError('请扫描当前 Reso 服务生成的邀请码。')
      }, 200)
    }
    void scan().catch(() => {
      if (active) {
        setCamera(false)
        setError('无法使用相机。请检查相机权限，或选择二维码图片。')
      }
    })
    return () => {
      active = false
      clearInterval(timer)
      stream?.getTracks().forEach(track=>track.stop())
      document.removeEventListener('visibilitychange', hide)
    }
  },[camera])

  async function scanImage(file?: File) {
    if (!file) return
    const signal = lifetime.current
    setReading(true);setError('');setCamera(false)
    try {
      if (file.size>15*1024*1024) throw Error('请选用 15 MB 以内的二维码图片。')
      const { default: decode } = await import('jsqr')
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      try {
        if (signal?.aborted) return
        const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height)
      } finally { bitmap.close() }
      const data = canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height)
      const code = decode(data.data,data.width,data.height)
      if (!code || !onAccept.current(code.data)) setError('没有找到当前 Reso 服务的邀请二维码。')
    } catch {
      if (!signal?.aborted) setError(file.size>15*1024*1024?'请选用 15 MB 以内的二维码图片。':'无法读取图片。请试试清晰的二维码截图。')
    } finally { if (!signal?.aborted) setReading(false) }
  }

  return <section className="invite-scanner" aria-label="识别邀请二维码">
    <Button secondary disabled={reading} onClick={()=>{setError('');setCamera(value=>!value)}}><Camera aria-hidden="true"/>{camera?'关闭相机':'扫描邀请二维码'}</Button>
    {camera&&<video aria-label="邀请二维码扫描预览" ref={video} muted playsInline/>}
    <label className="field-label">选择二维码图片
      <input type="file" accept="image/*" disabled={reading} onChange={event=>{
        const file=event.currentTarget.files?.[0]
        event.currentTarget.value=''
        void scanImage(file)
      }}/>
    </label>
    {reading&&<p role="status">正在识别二维码…</p>}
    {error&&<p role="alert" className="form-error">{error}</p>}
  </section>
}
