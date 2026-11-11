---
status: accepted
---

# Single-plane gameplay with the existing 3D chunks

Gameplay moves to Z=1 above a permanent floor at Z=0. Players, NPCs, mining,
placement, ore generation, and thrown items stay on that plane. We retain the
eight-level chunk allocation and multiplayer generation, streaming, visibility,
and edit-replay structure to avoid a simultaneous storage and network rewrite.
Depth tint, upper-layer shadows, and view-level controls disappear. Existing
remembered-terrain tint remains. This trades unused vertical storage for a
smaller migration while making portrait play and world navigation simpler.
