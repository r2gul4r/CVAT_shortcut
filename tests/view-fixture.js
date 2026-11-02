/* Synthetic CVAT store/canvas contract. No company images, server or saves. */
(() => {
  const root=document.getElementById('cvat_canvas_wrapper');
  root.style.cssText='position:relative;overflow:hidden;background:#283441;';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.id='view-fixture-svg';svg.setAttribute('width','400');svg.setAttribute('height','240');
  svg.style.cssText='position:absolute;transform-origin:200px 120px;';
  svg.innerHTML='<rect width="400" height="240" fill="#e5e9ee"/><g transform="rotate(17 200 120)"><rect x="140" y="60" width="120" height="120" fill="white" stroke="#475569"/>'+Array.from({length:11},(_,i)=>`<rect x="${150+i*9}" y="70" width="${i%3+2}" height="100" fill="#182332"/>`).join('')+'</g><g id="view-test-skeleton" fill="#ff4a89"><circle cx="140" cy="60" r="3"/><circle cx="260" cy="60" r="3"/><circle cx="140" cy="180" r="3"/><circle cx="260" cy="180" r="3"/></g>';
  root.append(svg);
  let mode='idle',state,events=[],actions=[],saveCalls=0,listeners=new Set();
  const labels=[{id:1,name:'person',type:'any',color:'#ff654d'},{id:2,name:'barcode_6pt',type:'skeleton',color:'#12be73'},{id:3,name:'tag',type:'tag',color:'#999999'}];
  const item=(id,label,hidden=false)=>({clientID:id,objectType:'shape',shapeType:'polygon',label:labels[label-1],hidden,points:[1,2,3,4],save(){saveCalls++;throw Error('Display tools cannot save');}});
  const objects=()=>[item(11,1),item(12,1,true),{...item(13,2),shapeType:'skeleton',elements:[item(101,2),item(102,2,true)]}, {...item(14,3),objectType:'tag'}];
  function makeCanvas(){
    let geometry={angle:0,scale:1,left:10,top:5,offset:0,image:{width:400,height:240},canvas:{width:420,height:250},grid:{width:100,height:100}};
    const model={data:{fittedScale:1,configuration:{adaptiveZoom:false}},imageIsDeleted:false,
      get configuration(){return this.data.configuration;},get geometry(){return structuredClone(geometry);},set geometry(g){geometry=structuredClone(g);},
      notify(reason){events.push(reason);svg.style.left=geometry.left+'px';svg.style.top=geometry.top+'px';svg.style.transform=`scale(${geometry.scale}) rotate(${geometry.angle}deg)`;},
      rotate(a){this.geometry={...this.geometry,angle:((Math.floor(a/90)*90)%360+360)%360};this.notify('image_rotated');},
      zoom(x,y,d){this.geometry={...this.geometry,scale:this.geometry.scale*(d<0?1.2:1/1.2)};this.notify('image_zoomed');},
      resetScale(){this.geometry={...this.geometry,scale:1,left:10,top:5};return true;},
      fit(){if(this.resetScale())this.notify('image_fitted');},
      draw(data){events.push('draw:'+geometry.angle);if(data.enabled)mode='draw';},edit(data){events.push('edit:'+geometry.angle);if(data.enabled)mode='edit';},interact(data){events.push('interact:'+geometry.angle);if(data.enabled)mode='interact';}
    };
    model.notify('setup');
    return {model,view:{transformCanvas(){}},get geometry(){return model.geometry;},html:()=>root,mode:()=>mode,cancel(){events.push('cancel');this.view.drawHandler?.cancel();mode='idle';},rotate:a=>model.rotate(a),draw:d=>model.draw(d),fit:()=>model.fit()};
  }
  const store={getState:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},dispatch(action){
    actions.push(action);const a=state.annotation;
    if(action.type==='UPDATE_ANNOTATIONS_SUCCESS')a.annotations={...a.annotations,states:[...a.annotations.states]};
    if(action.type==='ROTATE_FRAME'){
      a.player.frameAngles=a.player.frameAngles.map((v,i)=>i===action.payload.offset?action.payload.angle:v);
      a.canvas.instance.rotate(a.player.frameAngles[a.player.frame.number-a.job.instance.startFrame]);
    }
    for(const fn of listeners)fn();
  }};
  function job(id=18){
    mode='idle';state={annotation:{workspace:'Standard',job:{instance:{id,dimension:'2d',startFrame:0},labels,fetching:false,saving:false},
      canvas:{instance:makeCanvas(),ready:true,activeControl:'cursor'},player:{frame:{number:0,fetching:false,data:{deleted:false}},frameAngles:Array(5).fill(0),playing:false},
      annotations:{states:objects(),history:{undo:[],redo:[]},filters:[]},drawing:{activeLabelID:2,activeShapeType:'skeleton',activeObjectType:'shape'}},shortcuts:{keyMap:{SWITCH_DRAW_MODE_STANDARD_CONTROLS:{sequences:['n']}}}};
    document.querySelector('.cvat-canvas-controls-sidebar').__reactFiber$view={memoizedProps:{store}};
    return state.annotation;
  }
  function frame(number){const a=state.annotation;a.player.frame.number=number;a.annotations.states=objects();a.canvas.instance.rotate(a.player.frameAngles[number]);for(const fn of listeners)fn();}
  job();
  const catalog=document.createElement('div');catalog.className='cvat-objects-sidebar-labels-list';catalog.innerHTML='<div class="cvat-objects-sidebar-labels-list-header">Items: 3</div>'+labels.map(l=>`<div class="cvat-objects-sidebar-label-item"><span class="cvat-text">${l.name}</span></div>`).join('');document.body.append(catalog);
  const completed=[];
  function enableSkeleton(){
    const canvas=state.annotation.canvas.instance,template=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [index,p]of [[0,0],[50,0],[100,0],[0,100],[50,100],[100,100]].entries()){
      const n=document.createElementNS(template.namespaceURI,'circle');for(const [k,v]of Object.entries({cx:p[0],cy:p[1],'data-label-id':1001+index,'data-node-id':String(index),'data-type':'element'}))n.setAttribute(k,String(v));template.append(n);
    }
    let nativeCalls=0;
    const h={canvas:{node:svg},draw(){nativeCalls++;},cancel(){mode='idle';},transform(){},onDrawDoneDefault(data){completed.push(data);mode='idle';root.dispatchEvent(new CustomEvent('canvas.drawn',{detail:{state:data}}));}};
    canvas.view.drawHandler=h;const native=canvas.model.draw;
    canvas.model.draw=function(data){native.call(this,data);h.draw(data,canvas.geometry);};
    return {h,template,completed,get nativeCalls(){return nativeCalls;}};
  }
  window.viewFixture={enableSkeleton,get a(){return state.annotation;},job,frame,objects,store,events,actions,svg,root,mode:value=>{mode=value;},get saveCalls(){return saveCalls;}};
})();
