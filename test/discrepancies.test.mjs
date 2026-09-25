import test from 'node:test';
import assert from 'node:assert/strict';
import {categories,reconcile,blockers} from '../src/discrepancies.mjs';
import {measure,nativeElements} from '../src/evidence.mjs';
const review=(issues=[],resolutions=[])=>({issues,resolutions,coverage:categories.map(category=>({category,status:'reviewed',evidence:'Compared reference and runtime'}))});
const issue={key:'hero',component:'hero',category:'geometry',severity:'major',kind:'layout',description:'Shallow image',expected:'Portrait',actual:'Square',evidence:'Visible bounds',remedy:'Fix ratio'};
test('omission never closes issues; all judges must independently resolve',()=>{
 const ledger=reconcile([],[review([issue])],'a');
 assert.equal(blockers(reconcile(ledger,[review()],'b')).length,1);
 const resolved=review([],[{key:'hero',status:'resolved',evidence:'New bounds match'}]);
 assert.equal(blockers(reconcile(ledger,[resolved,review()],'b')).length,1);
 const closed=reconcile(ledger,[resolved,resolved],'b');assert.equal(blockers(closed).length,0);
 assert.equal(blockers(reconcile(closed,[review()],'c')).length,1);
 assert.equal(blockers(reconcile(ledger,[resolved],'b',{resolve:false})).length,1);
 assert.equal(blockers(reconcile(ledger,[resolved],'b',{component:'nav'})).length,1);
 assert.equal(blockers(reconcile(ledger,[resolved,review([issue])],'b')).length,1);
});
test('native geometry uses viewport fractions, missing evidence fails closed',()=>{
 const capture={pixelRatio:2,hierarchy:'<hierarchy><node resource-id="hero" bounds="[10,20][90,60]"/><node text="Next" bounds="[0,100][40,140]"/></hierarchy>'};
 const check={key:'ratio',component:'hero',selector:'id:hero',metric:'aspectRatio',expected:0.75,tolerance:0.05,severity:'major'};
 assert.equal(measure([check],capture,{width:100,height:200})[0].status,'open');
 assert.equal(measure([{...check,metric:'width',expected:0.8}],capture,{width:100,height:200})[0].status,'resolved');
 assert.equal(measure([{...check,selector:'id:missing'}],capture,{width:100,height:200})[0].status,'unverified');
 assert.equal(measure([{...check,selector:'text:Next',metric:'touchSize',expected:44}],capture,{width:100,height:200})[0].actual,20);
 assert.equal(measure([{...check,metric:'fontSize',expected:32}],capture,{width:100,height:200})[0].status,'unverified');
 assert.equal(nativeElements(capture.hierarchy).length,2);
});
