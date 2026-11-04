const test=require('node:test'),assert=require('node:assert/strict');
const {planFrame,createService}=require('../extension/group-native.js');
const {create,box,skeleton}=require('./group-fixture.js');
const polygon=(id,points=[0,0,100,0,100,100,0,100],extra={})=>box(id,points,{shapeType:'polygon',label:{id:3,name:'poly'},...extra});
const setup=records=>{
 global.location={origin:'http://cvat.test',pathname:'/tasks/1/jobs/18'};const f=create(records),run=createService(()=>f,()=>()=>{});
 const call=(action,extra={})=>run({version:1,origin:location.origin,path:location.pathname,action,...extra});
 return {f,call,preview:(extra={})=>call('preview',{scope:'all',extendExisting:true,...extra}),apply:p=>call('apply',{token:p.token})};
};
test('polygon without box groups all enclosed skeletons',()=>{const p=planFrame([polygon(1),skeleton(2),skeleton(3)],0);assert.deepEqual(p.groups,[{frame:0,polygon:1,skeletons:[2,3]}]);});
test('one versus two skeletons in independent polygons produces two groups',()=>{const p=planFrame([polygon(1),skeleton(2),polygon(3,[200,0,300,0,300,100,200,100]),skeleton(4,[[210,10],[290,90]]),skeleton(5,[[220,10],[280,80]])],0);assert.deepEqual(p.groups.map(g=>g.skeletons.length),[1,2]);});
test('box polygon and shared skeleton form one group without deleting box',()=>{assert.deepEqual(planFrame([box(1),polygon(2),skeleton(3)],0).groups,[{frame:0,box:1,polygon:2,skeletons:[3]}]);});
test('empty polygons and empty boxes are unchanged',()=>{const p=planFrame([box(1),polygon(2)],0);assert.equal(p.groups.length,0);assert.equal(p.empty,2);});
test('concave indentation is outside despite being inside bounding box',()=>{const shape=polygon(1,[0,0,100,0,100,30,30,30,30,100,0,100]);assert.equal(planFrame([shape,skeleton(2,[[40,40],[80,80]])],0).groups.length,0);assert.equal(planFrame([shape,skeleton(2,[[20,20],[20,80]])],0).groups.length,1);});
test('triangle actual outline excludes bounding box corners',()=>{assert.equal(planFrame([polygon(1,[0,0,100,0,0,100]),skeleton(2,[[60,60],[90,90]])],0).groups.length,0);});
test('boundary vertices and edges are included',()=>{assert.equal(planFrame([polygon(1),skeleton(2,[[0,0],[100,50],[0,100]])],0).groups.length,1);});
test('clockwise and explicitly closed polygons are supported',()=>{for(const pts of [[0,0,0,100,100,100,100,0],[0,0,100,0,100,100,0,100,0,0]])assert.equal(planFrame([polygon(1,pts),skeleton(2)],0).groups.length,1);});
for(const pts of [[0,0,50,0,100,0],[0,0,100,0,100],[0,0,100,0,NaN,100]])test('invalid polygon excluded '+pts,()=>{const p=planFrame([polygon(1,pts),skeleton(2)],0);assert.equal(p.groups.length,0);assert.match(p.invalid[0].reason,/폴리곤/);});
test('nonzero polygon rotation rejected rather than guessing origin',()=>{assert.equal(planFrame([polygon(1,undefined,{rotation:5}),skeleton(2)],0).groups.length,0);});
test('two polygons containing the same center join one group',()=>{const p=planFrame([polygon(1),polygon(2),skeleton(3)],0);assert.deepEqual(p.groups,[{frame:0,polygons:[1,2],skeletons:[3]}]);});
test('shared polygon connects both matching boxes and skeletons',()=>{const p=planFrame([box(1),box(2,[200,0,300,100]),polygon(3,[0,0,300,0,300,100,0,100]),skeleton(4),skeleton(5,[[210,10],[290,90]])],0);assert.equal(p.groups.length,1);assert.deepEqual(p.groups[0].boxes,[1,2]);assert.deepEqual(p.groups[0].skeletons,[4,5]);});
test('locked or tracked polygon blocks whole mixed group',()=>{for(const extra of [{lock:true},{objectType:'track'}])assert.equal(planFrame([box(1),polygon(2,undefined,extra),skeleton(3)],0).groups.length,0);});
test('existing complete box group gains new polygon, all data except group preserved',async()=>{
 const s=setup([box(1,undefined,{group:{id:7}}),skeleton(2,undefined,{group:{id:7}}),polygon(3)]),before=JSON.stringify(s.f.records());
 const p=await s.preview();assert(!p.error,p.error);assert.deepEqual(p.groups[0].previousGroups,[7]);const result=await s.apply(p);assert(!result.error,result.error);assert.equal(result.applied,1);assert.equal(new Set(s.f.records().map(o=>o.group.id)).size,1);assert.notEqual(s.f.records()[0].group.id,7);
 const after=s.f.records().map(o=>({...o,group:JSON.parse(before).find(v=>v.clientID===o.clientID).group}));assert.deepEqual(after,JSON.parse(before));
 await s.f.job.actions.undo();assert.deepEqual(s.f.records(),JSON.parse(before));
});
test('legacy opt-out no longer blocks adding the polygon',async()=>{const s=setup([box(1,undefined,{group:{id:7}}),skeleton(2,undefined,{group:{id:7}}),polygon(3)]);assert.equal((await s.preview({extendExisting:false})).groups.length,1);});
test('already grouped polygon is not regrouped on repeat',async()=>{const s=setup([polygon(1),skeleton(2)]);assert.equal((await s.apply(await s.preview())).applied,1);assert.equal((await s.preview()).groups.length,0);});
test('other-frame membership does not block local regrouping',async()=>{const s=setup([box(1,undefined,{group:{id:7}}),skeleton(2,undefined,{group:{id:7}}),polygon(3),box(4,undefined,{frame:2,group:{id:7}})]);const before=JSON.stringify(s.f.records()[3]);assert.equal((await s.apply(await s.preview({scope:'current'}))).applied,1);assert.equal(JSON.stringify(s.f.records()[3]),before);assert.equal(s.f.records()[0].group.id,s.f.records()[2].group.id);});
test('unrelated same-frame group member remains unchanged',async()=>{const s=setup([box(1,undefined,{group:{id:7}}),skeleton(2,undefined,{group:{id:7}}),polygon(3),box(4,[200,0,300,100],{group:{id:7}})]);assert.equal((await s.apply(await s.preview())).applied,1);assert.equal(s.f.records()[3].group.id,7);assert.equal(s.f.records()[0].group.id,s.f.records()[2].group.id);});
test('matching objects from different old groups are regrouped',async()=>{const s=setup([box(1,undefined,{group:{id:7}}),skeleton(2,undefined,{group:{id:8}}),polygon(3)]);const before=JSON.stringify(s.f.records());assert.equal((await s.apply(await s.preview())).applied,1);assert.equal(new Set(s.f.records().map(o=>o.group.id)).size,1);await s.f.job.actions.undo();assert.equal(JSON.stringify(s.f.records()),before);});
test('extra skeleton joins polygon box and previous group',async()=>{const s=setup([box(1,undefined,{group:{id:7}}),skeleton(2,undefined,{group:{id:7}}),polygon(3),skeleton(4)]);const before=JSON.stringify(s.f.records());assert.equal((await s.apply(await s.preview())).applied,1);assert.equal(new Set(s.f.records().map(o=>o.group.id)).size,1);await s.f.job.actions.undo();assert.equal(JSON.stringify(s.f.records()),before);});
test('whole Job supports polygon-only later frames and preserves frame position',async()=>{const s=setup([box(1),skeleton(2),polygon(3,undefined,{frame:3}),skeleton(4,undefined,{frame:3}),skeleton(5,undefined,{frame:3})]);const p=await s.preview();assert.deepEqual(p.groups.map(g=>g.frame),[0,3]);assert.equal((await s.apply(p)).applied,2);assert.equal(s.f.a.player.frame.number,0);});
test('polygon geometry mutation invalidates preview',async()=>{const s=setup([polygon(1),skeleton(2)]),p=await s.preview();s.f.records()[0].points[0]=5;assert((await s.apply(p)).error);assert.equal(s.f.count(),0);});
test('existing group membership mutation invalidates preview',async()=>{const s=setup([box(1,undefined,{group:{id:7}}),skeleton(2,undefined,{group:{id:7}}),polygon(3)]),p=await s.preview();s.f.records().push(box(9,undefined,{frame:5,group:{id:7}}));assert((await s.apply(p)).error);assert.equal(s.f.count(),0);});

test('polygon center match tolerates protruding joints without changing coordinates',async()=>{const s=setup([box(1),polygon(2),skeleton(3,[[-10,10],[90,90]],{group:{id:7}})]),before=JSON.stringify(s.f.records());assert.equal((await s.apply(await s.preview())).applied,1);assert.equal(new Set(s.f.records().map(o=>o.group.id)).size,1);await s.f.job.actions.undo();assert.equal(JSON.stringify(s.f.records()),before);});
test('multiple old groups and multiple containers apply once with idempotent repeat',async()=>{const s=setup([box(1,undefined,{group:{id:7}}),box(2),polygon(3,undefined,{group:{id:8}}),polygon(4),skeleton(5,undefined,{group:{id:9}})]);assert.equal((await s.apply(await s.preview())).applied,1);assert.equal(new Set(s.f.records().map(o=>o.group.id)).size,1);assert.equal((await s.preview()).groups.length,0);});

const bowtie=[0,0,100,100,0,100,100,0];
test('self-crossing polygon with zero signed area includes both filled lobes',()=>{for(const pts of [[[40,10],[60,30]],[[40,70],[60,90]]])assert.equal(planFrame([polygon(1,bowtie),skeleton(2,pts)],0).groups.length,1);assert.equal(planFrame([polygon(1,bowtie),skeleton(2,[[5,40],[15,60]])],0).groups.length,0);});
test('same-direction double winding is filled, unlike evenodd',()=>{const twice=[0,0,100,0,100,100,0,100,0,0,100,0,100,100,0,100];assert.equal(planFrame([polygon(1,twice),skeleton(2)],0).groups.length,1);});
test('opposite winding cancels interior fill',()=>{const cancel=[0,0,100,0,100,100,0,100,0,0,0,100,100,100,100,0];assert.equal(planFrame([polygon(1,cancel),skeleton(2)],0).groups.length,0);});
test('opposite inner loop remains a hole under nonzero fill',()=>{const hole=[0,0,100,0,100,100,0,100,0,0,25,25,25,75,75,75,75,25,25,25,0,0];assert.equal(planFrame([polygon(1,hole),skeleton(2,[[40,40],[60,60]])],0).groups.length,0);assert.equal(planFrame([polygon(1,hole),skeleton(2,[[5,5],[15,15]])],0).groups.length,1);});
test('repeated consecutive and closing vertices preserve original annotation on apply and undo',async()=>{const pts=[0,0,100,0,100,0,100,100,0,100,0,0,0,0];const s=setup([polygon(1,pts),skeleton(2)]),before=JSON.stringify(s.f.records());assert.equal((await s.apply(await s.preview())).applied,1);assert.deepEqual(s.f.records()[0].points,pts);await s.f.job.actions.undo();assert.equal(JSON.stringify(s.f.records()),before);});
test('one invalid polygon does not exclude all skeletons in a frame',async()=>{const s=setup([box(1),polygon(2,bowtie),skeleton(3,[[40,10],[60,30]]),polygon(4,[200,0,250,0,300,0])]);const p=await s.preview();assert.equal(p.groups.length,1);assert.equal(p.invalid.length,1);assert.equal(p.invalid[0].id,4);assert.equal((await s.apply(p)).applied,1);assert.equal(s.f.records()[3].group.id,0);});
test('polygon validation messages distinguish coordinates, rotation and size',()=>{const cases=[[[0,0,100,0,NaN,100],{},/좌표/],[undefined,{rotation:1},/회전/],[Array(2004).fill(1),{},/1,001/]];for(const [pts,extra,reason]of cases){const p=planFrame([polygon(1,pts,extra),skeleton(2)],0);assert.match(p.invalid[0].reason,reason);}});
test('whole Job groups simple and self-crossing polygons without changing vertices',async()=>{const s=setup([polygon(1),skeleton(2),polygon(3,bowtie,{frame:3}),skeleton(4,[[40,10],[60,30]],{frame:3})]),before=JSON.stringify(s.f.records());const p=await s.preview();assert.equal(p.groups.length,2);assert.equal((await s.apply(p)).applied,2);assert.deepEqual(s.f.records()[2].points,bowtie);await s.f.job.actions.undo();await s.f.job.actions.undo();assert.equal(JSON.stringify(s.f.records()),before);});

// Synthetic edge-of-image cases, not production coordinates.
const partialJoints=[[-30,-30],[-20,-30],[-30,-20],[10,10],[-10,-20],[-10,-10]];
for(const count of [1,2])test('center outside but '+count+' visible joints connects polygon and box',()=>{
 const pts=partialJoints.map(p=>[...p]);if(count===2)pts[4]=[20,10];
 const plan=planFrame([box(1,[-50,-50,100,100]),polygon(2),skeleton(3,pts)],0);
 assert.deepEqual(plan.groups,[{frame:0,box:1,polygon:2,skeletons:[3]}]);assert.equal(plan.empty,0);
});
test('partial skeleton grouping preserves coordinates and native undo',async()=>{
 const s=setup([box(1,[-50,-50,100,100],{group:{id:7}}),polygon(2),skeleton(3,partialJoints,{group:{id:7}})]),before=JSON.stringify(s.f.records());
 assert.equal((await s.apply(await s.preview())).applied,1);assert.equal(new Set(s.f.records().map(o=>o.group.id)).size,1);
 await s.f.job.actions.undo();assert.equal(JSON.stringify(s.f.records()),before);
});
test('manual group of partial skeleton plus polygon and box remains unchanged',async()=>{
 const s=setup([box(1,[-50,-50,100,100],{group:{id:7}}),polygon(2,undefined,{group:{id:7}}),skeleton(3,partialJoints,{group:{id:7}})]),before=JSON.stringify(s.f.records());
 const p=await s.preview();assert.equal(p.groups.length,0);assert.equal(p.empty,0);assert.equal(p.skipped[0].reason,'이미 같은 그룹');assert.equal(JSON.stringify(s.f.records()),before);assert.equal(s.f.count(),0);
});
test('partial match uses rotated rectangle geometry',()=>{
 const pts=partialJoints.map(([x,y])=>[50-(y-50),50+(x-50)]);
 const p=planFrame([box(1,undefined,{rotation:90}),skeleton(2,pts)],0);assert.equal(p.groups.length,1);
});
