import test from 'node:test';
import assert from 'node:assert/strict';
import {readFreshHierarchy} from '../plugins/metro-android/hierarchy.mjs';

test('a failed UIAutomator dump cannot reuse a previous successful hierarchy', async()=>{
  const calls=[];
  const adb=async(...args)=>{calls.push(args);return args.includes('dump')?'ERROR: could not get idle state.':'<hierarchy><node resource-id="old-revision"/></hierarchy>';};
  await assert.rejects(readFreshHierarchy(adb),/fresh|ready/i);
  assert.equal(calls.some(c=>c[0]==='exec-out'),false);
});

test('a successful dump removes old evidence first and returns current hierarchy',async()=>{
  const calls=[];
  const adb=async(...args)=>{calls.push(args);return args.includes('dump')?'UI hierchary dumped to: /sdcard/uih-managed.xml':args[0]==='exec-out'?'<hierarchy><node resource-id="current-revision"/></hierarchy>':'';};
  assert.match(await readFreshHierarchy(adb),/current-revision/);
  assert.deepEqual(calls.map(c=>c.slice(0,2)),[['shell','rm'],['shell','uiautomator'],['exec-out','cat']]);
});
