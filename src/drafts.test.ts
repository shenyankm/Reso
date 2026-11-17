import test from 'node:test'
import assert from 'node:assert/strict'
import {draftKey,readDraft,clearDrafts,hasDrafts} from './drafts'

test('private drafts are scoped to user, event and editor; malformed storage does not enter a form',()=>{
  const a=draftKey('alice','event','nvc'),b=draftKey('bob','event','nvc'),c=draftKey('alice','another','nvc')
  assert.notEqual(a,b);assert.notEqual(a,c);assert.notEqual(a,draftKey('alice','event','roleplay'))
  const initial={revision:4,values:{feeling:''}}
  const stored={revision:2,values:{feeling:'我的草稿🙂'}}
  assert.deepEqual(readDraft(a,initial,{getItem:()=>JSON.stringify(stored)}),stored)
  for(const value of ['broken','null','{"revision":-1,"values":{"feeling":"x"}}','{"revision":2,"values":{"feeling":3}}','{"revision":2,"values":{"other":"x"}}'])assert.deepEqual(readDraft(a,initial,{getItem:()=>value}),initial)
  assert.deepEqual(readDraft(a,initial,{getItem:()=>{throw new Error('disabled')}}),initial)
  clearDrafts('alice','event')
})

test('logout and event deletion clear only Reso draft keys, keeping other application storage intact',t=>{
  const entries=new Map<string,string>([[draftKey('alice','event','nvc'),'a'],[draftKey('alice','another','story'),'b'],[draftKey('bob','event','nvc'),'c'],['other-app:setting','keep']])
  const local={get length(){return entries.size},key:(index:number)=>[...entries.keys()][index]??null,removeItem:(key:string)=>{entries.delete(key)}}
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window')
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:local}})
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window')})
  assert.equal(hasDrafts('alice'),true);assert.equal(hasDrafts('unknown'),false)
  clearDrafts('alice','event');assert.equal(entries.has(draftKey('alice','event','nvc')),false);assert.equal(entries.has(draftKey('alice','another','story')),true)
  clearDrafts('alice');assert.equal(entries.has(draftKey('bob','event','nvc')),true)
  clearDrafts();assert.equal(hasDrafts('alice'),false);assert.deepEqual([...entries],[['other-app:setting','keep']])
})
