// Markup follows public CVAT DrawPolygonControl and DrawShapePopover.
// Only this suite adds the new control; other regression fixtures remain unchanged.
(() => {
  const icon = document.createElement('span');
  icon.className = 'cvat-draw-polygon-control'; icon.textContent = 'Polygon';
  document.querySelector('.cvat-canvas-controls-sidebar').append(icon);
  const panel = document.createElement('div');
  panel.id = 'polygon-panel'; panel.className = 'ant-popover cvat-draw-shape-popover'; panel.hidden = true;
  panel.innerHTML = `<div class="cvat-draw-shape-popover-content">Draw new polygon
    <select id="polygon-label"><option>person</option></select>
    <label>Number of points: <span class="cvat-draw-shape-popover-points-selector"><input id="polygon-points" role="spinbutton" value="8"></span></label>
    <label>Simplify <button class="cvat-draw-polygon-popover-simplify-switch" role="switch" aria-checked="true" disabled>ON</button></label>
    <button class="cvat-draw-polygon-shape-button">Shape</button>
    <button class="cvat-draw-polygon-track-button">Track</button></div>`;
  document.querySelector('#wrong-shape').before(panel);
})();
