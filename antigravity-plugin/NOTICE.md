# Third-Party Notices & License Attribution

**Antigravity Blender (`antigravity-blender-plugin`)** is a Google Antigravity native MCP plugin fork built on top of [`sixtysevenlf/dsh-blender-plugin`](https://github.com/sixtysevenlf/dsh-blender-plugin). All upstream license terms and copyright notices are strictly preserved below.

## 1. Upstream Core Runtime & Gateway (`sixtysevenlf/dsh-blender-plugin`)
- **Repository**: https://github.com/sixtysevenlf/dsh-blender-plugin
- **License**: BSD-3-Clause
- **Copyright**: Copyright (c) 2026, sixtyseven67. All rights reserved.
- **Usage**: `antigravity-plugin/mcp-server/` spawns and communicates with the compiled upstream Gateway (`../lib/runtime/gateway.js`) over local HTTP (`127.0.0.1:39877`) without modifying upstream `src/` or `runtime/`.

## 2. Upstream Blender Extension (`extension/dsh_blender_bridge.zip`)
- **License**: GNU General Public License v3.0 or later (GPL-3.0-or-later)
- **Copyright**: Copyright (C) 2026 sixtyseven67 and contributors.
- **Upstream Attribution**: Derived from `blender-mcp` by Siddharth Ahuja (https://github.com/ahujasid/blender-mcp, MIT License, Copyright (c) 2025 Siddharth Ahuja).
- **Boundary**: The Blender extension runs inside Blender as a separate process communicating over loopback WebSocket (`ws://127.0.0.1:39877/addon`).

## 3. Upstream Modeling Skill (`skills/blender-modeling/`)
- **License**: MIT License
- **Upstream Attribution**:
  - `RobLe3/cc-blender-skill` (https://github.com/RobLe3/cc-blender-skill, MIT)
  - `arjun988/blender-skills` (https://github.com/arjun988/blender-skills, MIT)

## 4. Clean-Room Antigravity Enhancements (No External GPL-3.0 Code Copied)
- Runtime `bpy` API introspection (`blender_api_lookup`) is independently implemented from scratch in this repository; no external GPL-3.0 source code is copied.
- Automotive LookDev & AgX Studio presets (`blender_lookdev_preset`), sports-car workflow SOP (`skills/sports-car-workflow/`), modeling gates (`rules/blender-modeling-gates.md`), and read-only MCP Resources (`blender://gateway/doctor`, `blender://scene/summary`) are independently implemented for Google Antigravity + Blender 4.5 LTS.
