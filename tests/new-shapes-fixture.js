// Synthetic markup derived from CVAT DrawShapePopover and Ant Design Radio.Button.
(() => {
  for (const type of ['rectangle','skeleton']) {
    const icon=document.createElement('span');icon.className=`cvat-draw-${type}-control`;icon.textContent=type;icon.tabIndex=0;
    document.querySelector('.cvat-canvas-controls-sidebar').append(icon);
    const panel=document.createElement('div');panel.id=type+'-panel';panel.className='ant-popover cvat-draw-shape-popover';panel.hidden=true;
    panel.style.cssText='position:fixed;top:150px;left:300px;width:280px;z-index:10';
    panel.innerHTML=`<div class="cvat-draw-shape-popover-content">Draw new ${type}<select id="${type}-label"><option>polybag</option></select>
      ${type==='rectangle'?`<div class="cvat-draw-shape-popover-drawing-method-selector ant-radio-group">${['By 2 points','By 4 points','Rotated points'].map((value,i)=>`<label class="ant-radio-button-wrapper" style="display:inline-block;padding:6px;border:1px solid #aaa;position:relative"><span class="ant-radio-button"><input type="radio" style="opacity:0;position:absolute" name="drawing-method" value="${value}"></span><span>${['2 Points','4 Points','Rotated'][i]}</span></label>`).join('')}</div>`:''}
      <button class="cvat-draw-${type}-shape-button">Shape</button><button class="cvat-draw-${type}-track-button">Track</button></div>`;
    document.querySelector('#wrong-shape').before(panel);
  }
})();
