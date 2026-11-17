import test from 'node:test'
import assert from 'node:assert/strict'
import {readWangCases} from './agent-cases'

test('candidate cases cover critical decisions while remaining explicitly synthetic and unreviewed',()=>{
  const suite=readWangCases()
  assert.equal(suite.cases.length,15);assert.equal(suite.review_status,'pending_professional_review')
  for(const id of ['correction','refusal','persistent_refusal','persistent_safety','method_offer','followup','room','safety'])assert.ok(suite.cases.some(c=>c.id===id))
  assert.ok(suite.cases.filter(c=>c.expected.no_model).length>=2)
  assert.ok(suite.cases.some(c=>c.old&&c.expected.required_tools.includes('search_history')))
})
