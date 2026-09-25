# AGENTS.md - workflow for this project

## Develop here, test in ComfyUI

- This folder is the source of truth. Edit the code here.
- ComfyUI only loads extensions from its own `custom_nodes` directory, so for
  every browser test: copy this folder to
  `<ComfyUI install>/ComfyUI/custom_nodes/comfyui-sidebar-hider`,
  restart the ComfyUI backend, then refresh the browser window.
- The backend keeps serving the OLD JavaScript until it restarts, so always
  restart after a copy. Verify no old process remains before starting a new one.

## Test checklist

1. Right-click a toolbar icon: the menu opens next to the cursor.
2. `Hide: <item>` hides that icon.
3. Unchecking and re-checking an icon in the list toggles it.
4. `Reset to defaults` shows everything again.
5. Auto-hide on: toolbar slides away, returns at the screen edge, stays while
   a sidebar panel is open.
6. Reload the page: hidden icons and auto-hide persist.

## Privacy

Before any commit or push, check changed files for absolute local paths,
usernames, tokens, API keys, emails, or hostnames. Never commit secrets.
