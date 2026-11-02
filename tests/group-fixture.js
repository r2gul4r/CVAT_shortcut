/* Local synthetic annotations; no images, server or user data. */
(() => {
  const copy=v=>JSON.parse(JSON.stringify(v));
  const box=(id,points=[0,0,100,100],extra={})=>({clientID:id,frame:0,shapeType:'rectangle',objectType:'shape',points,rotation:0,outside:false,group:{id:0},label:{id:1,name:'box'},parentID:null,lock:false,isGroundTruth:false,...extra});
  const skeleton=(id,points=[[20,20],[80,20],[20,80],[80,80]],extra={})=>({clientID:id,frame:0,shapeType:'skeleton',objectType:'shape',points:[],rotation:0,outside:false,group:{id:0},label:{id:2,name:'barcode'},parentID:null,lock:false,isGroundTruth:false,elements:points.map((p,i)=>({...box(id*100+i,p),shapeType:'points',parentID:id,label:{id:10+i}})),...extra});
  function create(records=[box(1),skeleton(2),box(3,[120,0,220,100])],canvas){
    let items=copy(records),count=0,failAt=0,unsupported=false,history=[];const deleted=new Set(),calls=[],api={};
    const labels=[{id:1,name:'box',type:'rectangle',color:'#fa7868'},{id:2,name:'barcode',type:'skeleton',color:'#22b573'}];
    const serial=o=>({id:o.serverID,type:o.shapeType,label_id:o.label.id,frame:o.frame,points:o.points,rotation:o.rotation,outside:o.outside,group:o.group.id,elements:o.elements?.map(serial),attributes:[]});
    const job={id:18,taskId:1,dimension:'2d',startFrame:0,stopFrame:9,labels,frames:{async get(frame){if(api.onMeta)await api.onMeta(frame);return {deleted:deleted.has(frame)};}},annotations:{
      async export(){if(api.onExport)await api.onExport();return copy({shapes:items.filter(o=>o.objectType==='shape').map(serial),tracks:items.filter(o=>o.objectType==='track').map(o=>({id:o.serverID,group:o.group.id,elements:o.elements?.map(serial),shapes:[serial(o)]})),tags:[]});},
      async get(frame,all,filters){calls.push({frame,all,filters});if(api.onGet)await api.onGet(frame);return items.filter(o=>o.objectType==='track'||o.frame===frame).map(copy);},
      async group(objects,reset){if(reset)throw Error('Unexpected reset');if(failAt===count+1)throw Error('Synthetic grouping failure');if(api.onGroup)await api.onGroup(objects);const id=Math.max(99,...items.map(o=>o.group.id))+1;history.push(copy(items));for(const o of objects)items.find(i=>i.clientID===o.clientID).group.id=id;count++;return id;}
    },actions:{async get(){return {undo:history.map((_,i)=>['Grouped objects',0,i]),redo:[]};},async undo(){items=history.pop();}}};
    const a={workspace:'Standard',job:{instance:job,labels,fetching:false,saving:false},canvas:{ready:true,instance:canvas||{mode:()=>api.mode||'idle'}},player:{frame:{number:0,fetching:false,data:{deleted:false}},frameAngles:Array(10).fill(0),playing:false},annotations:{states:[],filters:[],history:{undo:[],redo:[]},saving:{uploading:false}}};
    const store={getState:()=>({annotation:a}),dispatch(action){if(action.type==='FETCH_ANNOTATIONS_SUCCESS'&&!unsupported){a.annotations.states=action.payload.states;a.annotations.history=action.payload.history;}if(action.type==='UPDATE_ANNOTATIONS_SUCCESS')a.annotations.states=[...a.annotations.states];}};
    Object.assign(api,{job,store,a,calls,records:()=>items,count:()=>count,deleteFrame:f=>deleted.add(f),failAt:n=>failAt=n,unsupported:v=>unsupported=v,box,skeleton});return api;
  }
  if(typeof module==='object'&&module.exports){module.exports={create,box,skeleton};return;}
  window.groupFixture=create(undefined,window.viewFixture?.a.canvas.instance);
  document.querySelector('.cvat-canvas-controls-sidebar').__reactFiber$view={memoizedProps:{store:groupFixture.store}};
})();
