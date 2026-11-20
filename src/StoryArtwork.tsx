import { useLayoutEffect, useRef } from 'react'

// The same saved text always yields the same illustration on each device.
export function drawStoryArtwork(context: CanvasRenderingContext2D, text: string, chapter: number) {
  let value = chapter + 2166136261
  for (const character of text) value = Math.imul(value ^ character.codePointAt(0)!, 16777619)
  const hue = (value >>> 0) % 360
  const tint = (offset: number, lightness: number) => `hsl(${(hue + offset) % 360} 42% ${lightness}%)`
  const {width, height} = context.canvas
  const sky = context.createLinearGradient(0, 0, width, height)
  sky.addColorStop(0, tint(0, 84))
  sky.addColorStop(1, tint(65, 96))
  context.fillStyle = sky
  context.fillRect(0, 0, width, height)

  const light = width * (.28 + (((value >>> 8) & 0xff) / 255) * .44)
  const glow = context.createRadialGradient(light, height * .32, 0, light, height * .32, height * .37)
  glow.addColorStop(0, '#fff9e9')
  glow.addColorStop(1, '#fff9e900')
  context.fillStyle = glow
  context.fillRect(0, 0, width, height)
  for (let layer = 0; layer < 4; layer++) {
    const bank = height * (.55 + layer * .13)
    const ridge = light + ((layer % 2) ? 1 : -1) * width * .29
    context.fillStyle = tint(34 + layer * 18, 82 - layer * 6)
    context.beginPath()
    context.moveTo(0, bank)
    context.bezierCurveTo(width * .22, bank + height * .31, ridge, bank - height * .42, width, bank - height * .04)
    context.lineTo(width, height)
    context.lineTo(0, height)
    context.fill()
  }
}

export function StoryArtwork({ text, chapter }: { text: string; chapter: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (context) drawStoryArtwork(context, text, chapter)
  }, [text, chapter])
  return <figure className="story-illustration">
    <canvas className="story-art" ref={canvas} width="800" height="390" role="img" aria-label="根据记录生成的风景插图"/>
    <figcaption className="fineprint">由这段记录在设备上生成的配图</figcaption>
  </figure>
}
