import { useState } from 'react'
import { ArrowRight, Check, ChevronRight, HandHeart, MessageCircle, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { Button } from './components'
import './mvp-welcome.css'

const promises = [
  { icon: UserRound, color: 'purple', title: '分享内容由你决定', text: '你可以选择分享什么，也可以删除自己的事件记录。' },
  { icon: HandHeart, color: 'green', title: '聊什么、说多少，按你的节奏来', text: '你可以慢慢来，随时停止或删除记录。' },
  { icon: MessageCircle, color: 'pink', title: '有些事，也可以和咨询师聊聊', text: '如果你愿意，我可以帮你了解可用的专业支持。' },
]

export const welcomeNotices = {
  用户协议: [
    'Reso 提供 AI 关系理解和沟通练习。你可以自主决定主题、停止对话或邀请他人。',
    'AI 回复供参考。Reso 不提供诊断、治疗或实时紧急救助。标有「体验」的专业支持资料用于测试。',
  ],
  隐私政策: [
    '账号与记录保存在 Reso 的服务器。私人聊天默认不会分享给其他用户。房间聊天对房间成员可见，分享私人摘要前需要你确认。',
    '使用 AI 回复时，相关内容会发送给 DeepSeek；主动使用语音转写时，录音会发送给豆包。你可以在「我的」中查看隐私与数据选项，并删除自己创建的事件。',
  ],
  监护人协助: [
    '你可以找信任的监护人或老师一起商量。是否邀请他人参与、是否分享事件摘要，由你决定。',
    '如果你正处于即时危险，请联系当地紧急服务，并向身边可信任的成年人求助。',
  ],
}
export type WelcomeNotice = keyof typeof welcomeNotices

export default function MvpWelcome({ invitationTitle, onStart, onNotice }: {
  invitationTitle: string | undefined
  onStart: () => void
  onNotice: (notice: WelcomeNotice) => void
}) {
  const [agreed, setAgreed] = useState(false)

  return <main className="welcome-scroll mvp-welcome" aria-label="Reso 开始页">
    <section className="welcome-hero">
      <div className="welcome-copy">
        <p className="mvp-welcome-edition">青少年版</p>
        <h1>你好，<br/>我是 Reso</h1>
        <h2>AI 关系理解与沟通引导者</h2>
        <p>我们可以从一件你在意的小事开始，<br/>慢慢理清发生了什么。</p>
      </div>
      <img src="/assets/reso-welcome.webp" width="356" height="525" alt="Reso 抱着爱心向你招手"/>
      <Sparkles className="mvp-welcome-sparkle" aria-hidden="true"/>
    </section>
    <section className="privacy-highlight">
      <div className="feature-icon blue" aria-hidden="true"><ShieldCheck/></div>
      <div><p>先让你安心</p><h2>你的对话默认私密</h2><span>你的信息会被严格保护，<br/>只在获得授权的范围内使用。</span></div>
      <Sparkles className="tiny-sparkle" aria-hidden="true"/>
    </section>
    <section className="welcome-promises">
      {promises.map(({ icon: Icon, color, title, text }) => <div className="promise" key={title}>
        <div className={`feature-icon ${color}`} aria-hidden="true"><Icon/></div>
        <div><h2>{title}</h2><p>{text}</p></div>
      </div>)}
    </section>
    <footer className="welcome-actions mvp-welcome-actions">
      {invitationTitle!==undefined&&<p className="welcome-invitation">会谈邀请 · {invitationTitle}</p>}
      <div className="mvp-welcome-agreement">
        <label className="check-row">
          <span className="mvp-welcome-check">
            <input type="checkbox" aria-label="同意用户协议和隐私政策" checked={agreed} onChange={event=>setAgreed(event.target.checked)}/>
            <Check aria-hidden="true"/>
          </span>
          我已阅读并同意
        </label>
        <span><button type="button" className="inline-link" onClick={()=>onNotice('用户协议')}>《用户协议》</button>和<button type="button" className="inline-link" onClick={()=>onNotice('隐私政策')}>《隐私政策》</button></span>
      </div>
      <Button disabled={!agreed} onClick={onStart}>{invitationTitle!==undefined?'登录并查看邀请':'开始聊聊'}<ArrowRight aria-hidden="true"/></Button>
      <button type="button" className="guardian-link" onClick={()=>onNotice('监护人协助')}>未满18岁？了解监护人协助<ChevronRight aria-hidden="true"/></button>
    </footer>
  </main>
}
