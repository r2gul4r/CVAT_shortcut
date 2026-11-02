/* Synthetic CVAT location attributes; actual setter merge and native history contract. */
(() => {
  const clone=v=>JSON.parse(JSON.stringify(v));
  const locationAttr=(extra={})=>({id:11,name:'location',inputType:'radio',values:['tag','sticker'],mutable:false,defaultValue:'tag',...extra});
  function create(){
    const labels=[{id:1,name:'barcode',type:'skeleton',attributes:[locationAttr(),{id:12,name:'other',inputType:'text',values:[],defaultValue:'keep'}]},{id:2,name:'box',type:'rectangle',attributes:[locationAttr()]},{id:3,name:'barcode-other',type:'skeleton',attributes:[locationAttr({id:31,values:['Tag','Sticker']})]}];
    const shape=(id,frame,label=1,type='skeleton',attrs={11:'tag',12:'keep'})=>({clientID:id,frame,label_id:label,type,attributes:attrs,points:[],rotation:0,group:7,source:'auto',outside:false,occluded:false,elements:type==='skeleton'?[{clientID:id*100,type:'points',frame,label_id:101,attributes:{99:'joint'},points:[12,34],group:0,source:'auto',outside:false,occluded:false}]:[]});
    let records=[shape(1,0),shape(2,2,1,'skeleton',{11:'sticker',12:'keep'}),shape(3,0,2,'rectangle'),shape(4,4,3,'skeleton',{31:'Tag'})],count=0,history=[],deleted=new Set(),failAt=0,unsupported=false;const api={};
    function native(record){
      const value={clientID:record.clientID,serverID:record.serverID,parentID:null,objectType:'shape',shapeType:record.type,frame:record.frame,label:labels.find(l=>l.id===record.label_id)||{id:record.label_id},group:{id:record.group},points:clone(record.points),rotation:record.rotation||0,source:record.source,outside:record.outside,occluded:record.occluded,lock:!!record.lock,isGroundTruth:!!record.gt,elements:record.elements?.map(native)};
      let attrs=clone(record.attributes);Object.defineProperty(value,'attributes',{enumerable:true,get:()=>attrs,set:delta=>{attrs={...attrs,...delta};}});
      value.save=async()=>{if(failAt===count+1)throw Error('Synthetic save error');if(api.onSave)await api.onSave(record);history.push(clone(records));record.attributes=clone(attrs);record.source='manual';count++;return native(record);};return value;
    }
    function serial(o){return {id:o.serverID,frame:o.frame,label_id:o.label_id,type:o.type,points:o.points,rotation:o.rotation||0,group:o.group,source:o.source,outside:o.outside,occluded:o.occluded,attributes:Object.entries(o.attributes).map(([id,value])=>({spec_id:Number(id),value})),elements:o.elements?.map(serial)};}
    const job={id:18,taskId:1,dimension:'2d',startFrame:0,stopFrame:9,labels,annotations:{async export(){if(api.onExport)await api.onExport();return clone({shapes:records.map(serial),tracks:api.tracks||[],tags:[]});},async get(frame,all,filters){if(api.onGet)await api.onGet(frame);return records.filter(o=>o.frame===frame).map(native);}},frames:{async get(frame){return {deleted:deleted.has(frame)};}},actions:{async get(){return {undo:history.map((_,i)=>['Changed attributes',0,i]),redo:[]};},async undo(){records=history.pop();}}};
    const a={workspace:'Standard',job:{instance:job,labels},canvas:{ready:true,instance:{mode:()=>api.mode||'idle'}},player:{frame:{number:0,data:{deleted:false}},playing:false},annotations:{states:[],filters:[],history:{undo:[],redo:[]}}};
    const store={getState:()=>({annotation:a}),dispatch(action){if(action.type==='FETCH_ANNOTATIONS_SUCCESS'&&!unsupported){a.annotations.states=action.payload.states;a.annotations.history=action.payload.history;}}};
    Object.assign(api,{job,store,a,labels,records:()=>records,count:()=>count,shape,deleteFrame:n=>deleted.add(n),failAt:n=>failAt=n,unsupported:v=>unsupported=v});return api;
  }
  if(typeof module==='object'&&module.exports){module.exports={create,locationAttr};return;}
  window.locationFixture=create();if(window.viewFixture)locationFixture.a.canvas.instance=viewFixture.a.canvas.instance;
  document.querySelector('.cvat-canvas-controls-sidebar').__reactFiber$view={memoizedProps:{store:locationFixture.store}};
})();
