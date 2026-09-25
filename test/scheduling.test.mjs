import test from 'node:test';
import assert from 'node:assert/strict';
import {nextScope} from '../src/scheduling.mjs';

test('blocking screen repairs retain the component cycle and consume attempt slots',()=>{
  const state={iterations:2,scopeCursor:2,bestEvaluation:{blocking:true},plan:{components:[{id:'header'},{id:'hero'}]},config:{budgets:{localIterations:1}}};
  assert.deepEqual(nextScope(state),{component:null,cursor:0});
  // A repair that passes is followed by all local scopes, then screen review.
  state.bestEvaluation.blocking=false;state.scopeCursor=1;
  assert.equal(nextScope(state).component.id,'header');
  state.scopeCursor=2;assert.equal(nextScope(state).component.id,'hero');
  state.scopeCursor=3;assert.equal(nextScope(state).component,null);
  assert.equal(state.iterations,2);
});

test('legacy nonblocking runs preserve their next scheduled component',()=>{
  const state={iterations:2,bestEvaluation:{blocking:false},plan:{components:[{id:'header'},{id:'hero'}]},config:{budgets:{localIterations:1}}};
  assert.equal(nextScope(state).component.id,'hero');
});
