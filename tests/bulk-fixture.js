/* Synthetic native CVAT object model. No server persistence or company data. */
(() => {
  const labels=[{id:1,name:'A',type:'any',color:'#fa7868',attributes:[]},{id:2,name:'B',type:'any',color:'#22b573',attributes:[]},{id:3,name:'Polygon only',type:'polygon',color:'#3558ed',attributes:[]},{id:4,name:'D',type:'any',color:'#dc39d7',attributes:[]}];
  let records=[],dirty=false,history=[],mutations=0,failAt=0,unsupported=false,deletedFrames=new Set();
  const clone=value=>JSON.parse(JSON.stringify(value));
  const api={};
  function wrap(record,frame){
    const value={clientID:record.clientID,serverID:record.id,parentID:null,objectType:record.objectType,frame:record.objectType==='track'?frame:record.frame,shapeType:record.type,label:labels.find(l=>l.id===record.label_id),lock:Boolean(record.lock),isGroundTruth:Boolean(record.gt)};
    value.delete=async()=>{if(failAt&&mutations+1===failAt)throw Error('Synthetic delete failure');history.push(clone(record));record.removed=true;mutations++;dirty=true;return true;};
    value.save=async()=>{if(failAt&&mutations+1===failAt)throw Error('Synthetic save failure');history.push(clone(record));record.label_id=value.label.id;record.attributes=[];mutations++;dirty=true;return wrap(record,frame);};return value;
  }
  const job={id:12,taskId:1,dimension:'2d',startFrame:0,stopFrame:99,labels,
    annotations:{
      async export(){return {shapes:records.filter(r=>!r.removed&&r.objectType==='shape').map(({objectType,removed,lock,gt,...r})=>clone(r)),tracks:records.filter(r=>!r.removed&&r.objectType==='track').map(({objectType,removed,lock,gt,...r})=>clone(r)),tags:[]};},
      async get(frame,all,filters){if(api.pauseGet)await api.pauseGet();if(deletedFrames.has(frame))return [];return records.filter(r=>!r.removed&&(r.objectType==='shape'?r.frame===frame:all||r.frame<=frame)).map(r=>wrap(r,frame));},
      async hasUnsavedChanges(){return dirty;}
    },actions:{async get(){return {undo:history.map((r,i)=>['changed',r.frame,i]),redo:[]};}}
  };
  window.state={annotation:{workspace:'Standard',job:{instance:job},canvas:{ready:true,instance:{mode:()=>window.mode||'idle'}},player:{frame:{number:3,fetching:false},playing:false},annotations:{states:[],filters:[],saving:{uploading:false}}}};
  const store={getState:()=>window.state,dispatch(action){if(action.type==='FETCH_ANNOTATIONS_SUCCESS'&&!unsupported){window.state.annotation.annotations.states=action.payload.states;window.state.annotation.annotations.history=action.payload.history;}}};
  const side=document.querySelector('.cvat-canvas-controls-sidebar');side.__reactFiber$fixture={memoizedProps:{store},return:null};
  Object.assign(api,{job,store,labels,records:()=>records,read:()=>clone(records),mutations:()=>mutations,dirty:()=>dirty,save(){dirty=false;},setDirty(value){dirty=value;},failAt(value){failAt=value;},unsupported(value){unsupported=value;},deleteFrame(frame){deletedFrames.add(frame);},reset(extra=[]){
    records=[{id:11,clientID:11,objectType:'shape',frame:1,label_id:1,type:'mask',points:[2,3,4,5],attributes:[]},{id:12,clientID:12,objectType:'shape',frame:3,label_id:1,type:'polygon',points:[1,1,4,1,4,4],attributes:[]},{id:13,clientID:13,objectType:'shape',frame:3,label_id:2,type:'mask',points:[5,5,8,8],attributes:[]},{id:14,clientID:14,objectType:'shape',frame:5,label_id:1,type:'polygon',points:[0,0,3,0,3,3],attributes:[]},...clone(extra)];dirty=false;history=[];mutations=0;failAt=0;unsupported=false;deletedFrames=new Set();api.pauseGet=null;window.mode='idle';
  }});api.reset();window.bulkFixture=api;
})();
