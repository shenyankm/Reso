import assert from 'node:assert/strict'
import test from 'node:test'
import { acts, parseScene, scenes } from './demo.ts'

test('only known preview scenes can be opened from the URL', () => {
  for (const scene of scenes) assert.equal(parseScene(`#${scene.id}`), scene.id)
  assert.equal(parseScene('#unknown'), 'welcome')
  assert.equal(parseScene(''), 'welcome')
  assert.equal(parseScene('#/chat'), 'chat')
  assert.equal(new Set(scenes.map(scene => scene.id)).size, scenes.length)
})

test('the introduction is followed by five acts, with the story saved at the end', () => {
  assert.equal(acts.length, 6)
  assert.equal(acts[0].chapter, '开始之前')
  assert.equal(acts[4].title, '这些画里的我')
  assert.equal(acts[5].title, '我的故事')
})
