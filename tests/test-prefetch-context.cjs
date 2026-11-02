const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolveContext}=require('../extension/prefetch-native.js');
function setup(){
 global.location={origin:'http://cvat.test',pathname:'/tasks/1/jobs/18',protocol:'http:'};global.window={};window.top=window;
 global.Element=class Element{};const side=new Element(),parent=new Element();side.parentElement=parent;
 const job={id:18,taskId:1,dimension:'2d',startFrame:0,stopFrame:9},store={getState:()=>({annotation:{job:{instance:job}}}),dispatch(){}};
 parent.__reactFiber$fixture={memoizedProps:{value:{store}}};global.document={querySelectorAll:()=>[side]};delete global.CVATBatchNativeContext;
 return {side,parent,job,store};
}
test('finds Job directly without any shared group bridge',()=>{const f=setup();assert.deepEqual(resolveContext(),{job:f.job,store:f.store});});
test('old group sentinel and absent shared context do not block native lookup',()=>{const f=setup();global.__cvatShortcutsGroupV1=true;assert.equal(resolveContext().job,f.job);});
test('unrelated Job cannot be selected',()=>{const f=setup();f.job.id=19;assert.throws(resolveContext,/이미지 연결을 확인하지 못했습니다/);});
test('non Job URL produces Korean guidance rather than undefined find',()=>{setup();location.pathname='/tasks';assert.throws(resolveContext,/CVAT Job 화면/);});
test('missing sidebar produces useful error',()=>{setup();document.querySelectorAll=()=>[];assert.throws(resolveContext,/작업 화면을 확인하지 못했습니다/);});
test('cyclic React traversal terminates',()=>{const f=setup();f.parent.__reactFiber$fixture.memoizedProps={};f.parent.__reactFiber$fixture.return=f.parent.__reactFiber$fixture;assert.throws(resolveContext,/이미지 연결을 확인하지 못했습니다/);});
