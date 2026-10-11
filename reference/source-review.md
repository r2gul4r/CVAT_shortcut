# Public CVAT and Chrome source review

Reviewed 2026-10-02 using public web sources only. No company CVAT instance, browser page, or confidential file was accessed. CVAT `develop` is a moving branch; the installed company version is unknown and has not been tested.

| Source | Evidence used |
| --- | --- |
| [CVAT controls-side-bar.tsx](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/components/annotation-page/standard-workspace/controls-side-bar/controls-side-bar.tsx) | Sidebar uses `.cvat-canvas-controls-sidebar`. Tool visibility depends on available label types. Disabled controls account for absent labels/deleted frames. |
| [CVAT tools-control.tsx](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/components/annotation-page/standard-workspace/controls-side-bar/tools-control.tsx) | AI sidebar icon uses `.cvat-tools-control`. Disabled state uses `.cvat-disabled-canvas-control`. Active state uses `.cvat-active-canvas-control`; clicking it can disable interaction. No models can mean no rendered tool. |
| [CVAT draw-mask-control.tsx](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/components/annotation-page/standard-workspace/controls-side-bar/draw-mask-control.tsx) | New-mask sidebar icon uses `.cvat-draw-mask-control`; its popover type is `draw-mask`. An active icon click can finish/disable drawing, so the extension skips active tools. |
| [CVAT handle-popover-visibility.tsx](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/components/annotation-page/standard-workspace/controls-side-bar/handle-popover-visibility.tsx) | Current wrapper uses a click trigger and adds `cvat-<type>-popover`, yielding `.cvat-tools-control-popover` and `.cvat-draw-mask-popover`. The extension clicks the inactive icon once and checks for that visible panel. |
| [CVAT draw-shape-popover.tsx](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/components/annotation-page/standard-workspace/controls-side-bar/draw-shape-popover.tsx) | Mask Shape button class is `.cvat-draw-mask-shape-button`; it calls the existing onDrawShape handler. Version 1.2.0 clicks it once within the visible mask popup. |
| [CVAT Brush documentation](https://docs.cvat.ai/docs/annotation/manual-annotation/shapes/annotation-with-brush-tool/) | Creating a new mask starts from the sidebar Brush tool and continues through label choice and Shape. Version 1.2.0 preserves the selected label and starts through Shape. |
| [CVAT AI tools documentation](https://docs.cvat.ai/docs/annotation/auto-annotation/ai-tools/) | AI tool setup involves a menu, label, and interactor/model selection. Version 1.2.0 preserves those selections and clicks Interact to enter normal interactive mode. |
| [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) | Temporary tab access follows an explicit extension invocation, avoiding broad persistent host access. |
| [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) | Programmatic script injection can use activeTab and scripting; isolated world avoids sharing extension JavaScript globals with the page. |
| [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage) | Local extension storage retains settings on the computer without using sync storage. |

Version 1.2.0 additional selector review:

- AI start: `button.cvat-tools-interact-button` inside `.cvat-tools-control-popover-content` in one visible `.cvat-tools-control-popover`. The public handler configures canvas interaction using the current model, label, and bounding-box option. Detector/Track buttons have different classes and are never clicked.
- Brush start: `button.cvat-draw-mask-shape-button` inside `.cvat-draw-shape-popover-content` in one visible `.cvat-draw-mask-popover`. Generic Shape buttons and buttons for other shape types are excluded.
- [Public BrushTools source](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/components/annotation-page/canvas/views/canvas2d/brush-tools.tsx) shares the same `brushSize` state and `.cvat-brush-tools-brush-size` InputNumber between DRAW and EDIT. It shows `.cvat-brush-tools-toolbox` for both modes. `.cvat-brush-tools-active-tool` identifies Brush/Eraser versus polygon modes. The size minimum is 1; CVAT source declares no maximum. The extension independently bounds wheel changes to 500.
- [Public canvasView source](https://github.com/cvat-ai/cvat/blob/develop/cvat-canvas/src/typescript/canvasView.ts) defines `#cvat_canvas_wrapper`, which CVAT mounts in `.cvat-canvas-container`.
- [Public masksHandler source](https://github.com/cvat-ai/cvat/blob/develop/cvat-canvas/src/typescript/masksHandler.ts) uses `.cvat_masks_canvas_wrapper`. Its Alt+right-drag size adjustment applies to drawing and editing. The extension uses the shared input instead of synthesizing this gesture.
- CVAT's wheel handling distinguishes physical Ctrl from touchpad pinch. Version 1.3.1 leaves all Ctrl-wheel events native and offers only Alt/Shift brush-size modifiers; the extension does not distinguish or intercept pinch gestures.

These three public brush/canvas files were downloaded into this reference folder solely for review; they are not shipped in the extension ZIP. Their original MIT notices are intact. No company source or data was accessed.

Version 1.3.0 default-label review:

- [CVAT LabelSelector](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/components/label-selector/label-selector.tsx) uses `.cvat-label-selector-option` for label display, `data-label={label.name}` on options, `optionLabelProp='label'`, and `virtual={false}`. The extension identifies the label control by this marker within the active tool's content/pane, so the model selector is excluded.
- [rc-select input source](https://github.com/react-component/select/blob/v14.16.8/src/Selector/Input.tsx) links the combobox to its listbox using `aria-controls`; [OptionList](https://github.com/react-component/select/blob/v14.16.8/src/OptionList.tsx) forwards data attributes to role=option DOM when virtualization is disabled. The extension follows only that exact listbox owner, not a global label-text search.
- [rc-select Selector source](https://github.com/react-component/select/blob/v14.16.8/src/Selector/index.tsx) opens on mousedown and focuses its input on click. The extension sends a paired mousedown/up and click only to the scoped label selector, then clicks one exact enabled label option. It confirms the selected name and closed dropdown before Interact/Shape. The specific rc-select source documents the supported DOM contract; the company browser version has not been inspected.

Compatibility policy: use reviewed classes on a supported HTTP(S) CVAT job route. Start buttons and the intended label option must be unique, visible, enabled, and owned by the correct popup. Readiness is bounded to 1.2 seconds and canceled by context changes. The visible mask toolbox blocks keyboard activation while editing. Wheel sizing requires a pointer hit on the mask canvas and an active unambiguous size control. Ignore unsupported DOM rather than guessing. Only the new-annotation label selector is intentionally changed; existing annotations, models, and other options are untouched. No React internals, canvas APIs, inference endpoints, image reads, or synthetic canvas strokes are used.

## 1.7.2 popover event regression

CVAT `handle-popover-visibility.tsx` dispatches `new MouseEvent('mousedown', { bubbles: true })` when a popover opens. This event defaults to buttons=0 and has no paired mouseup. Treating it as a left-button press caused pending activation to stop at the new mouseButtons guard. The fix ignores buttonless down notifications and preserves tracked real presses.
Source: https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/components/annotation-page/standard-workspace/controls-side-bar/handle-popover-visibility.tsx
