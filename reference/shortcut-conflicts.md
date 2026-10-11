# Public shortcut event audit — 1.4.1

Reviewed 2026-10-02 from public source only. The installed/company CVAT version and its user-custom shortcuts were not inspected.

| Public source | Relevant behavior |
|---|---|
| [CVAT mousetrap-react.tsx](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/utils/mousetrap-react.tsx) | GlobalHotKeys binds each current keyMap sequence using Mousetrap with action keydown. Its wrapper prevents default and stops propagation before calling the action. The map is an internal module export, not a supported page/extension discovery API. |
| [CVAT UI dependencies](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/package.json) | Declares Mousetrap ^1.6.5. |
| [Mousetrap 1.6.5](https://github.com/ccampbell/mousetrap/blob/1.6.5/mousetrap.js) | Default target is document; addEventListener uses capture=false. It listens for keydown/keypress/keyup. The CVAT wrapper selects keydown for its actions. |
| [CVAT canvasView.ts](https://github.com/cvat-ai/cvat/blob/develop/cvat-canvas/src/typescript/canvasView.ts) | Registers canvas wheel at target/bubble and document keydown/keyup for modifier state. Ctrl release clears physical-Ctrl state; Shift release clears temporary resize snapping. Target wheel can zoom and prevent default. |
| [CVAT shortcut documentation](https://docs.cvat.ai/docs/getting_started/shortcuts/) | Users can customize shortcuts; public defaults cannot represent their current settings. |

1.4.0 claimed its initial keydown at document capture but returned without stopping repeated owned keydowns or keyup. A repeated press could therefore reach a native action after the extension had started a tool. 1.4.1 uses window capture and claims the accepted physical press through its safe repeats/nonmodifier release. Modifier release still propagates. Cmd-release recovery retains repeat ownership until a fresh nonrepeat press or keyup, handling absent letter keyup without turning a held key into a native action. Blur clears stale claims. Input/IME guards and unsupported-context pass-through remain deliberate.

Window capture reaches CVAT's reviewed document-bubble/target listeners first even when those were registered before the extension. stopImmediatePropagation blocks later listeners in that phase and downstream listeners; preventDefault suppresses the handled event's default action. The tests include real public Mousetrap 1.6.5 with the CVAT bind contract, prior document-capture and later window-capture probes, release/modifier state, drawing/typing/IME guards, accepted failures, clear/pause, and native wheel probes.

Earlier same-window capture is an unavoidable limitation: preventDefault or cancelBubble from such a listener is respected, but an unmarked earlier action cannot be rolled back. Two tests explicitly demonstrate that limit rather than report it as prevented. Input/IME focus changes can let a keyup through for safety; CVAT's reviewed action contract is keydown. Browser/OS reserved shortcuts, external extensions, custom CVAT forks, and native gesture delivery remain outside synthetic proof.

No private React/Redux/Mousetrap application map, backend endpoint, page global, or company DOM is queried. Runtime warning detection concerns likely Chrome/OS reserved bindings only; duplicate rejection concerns the extension's own two assignments only. Users must compare their chosen keys with CVAT Settings/Shortcuts and avoid overlap, because ignored active-drawing or disabled contexts intentionally retain original CVAT behavior.

Public downloaded snapshots `mousetrap-1.6.5.js` and `mousetrap-react.tsx` are kept in reference/ with their original MIT notices. Only Mousetrap is used in the synthetic tests. Neither file, any test, nor this document is packaged in the extension ZIP. This is a source-contract/propagation audit, not an actual CVAT or isolated-world install test.
