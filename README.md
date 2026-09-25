# ComfyUI Sidebar Hider

A small ComfyUI custom node that allow to hide and rearrange icons in the
left vertical sidebar toolbar.

<img src="screenshot.png" width="400" alt="Right-click menu with toggle switches and drag grips">

Right-click the toolbar to hide, show, or reorder icons. Reset restores defaults. Optional auto-hide reveals the toolbar at the screen edge. Click outside or press `<span>Esc</span>` to close.
## Install

Copy this folder to your ComfyUI `custom_nodes` directory, for example:

```text
ComfyUI/custom_nodes/comfyui-sidebar-hider/
  __init__.py
  js/sidebarHider.js
```

Then restart ComfyUI (the backend must restart so it picks up the new
extension) and refresh the browser window.
