---
status: accepted
---

# Continuous horizontal positions with discrete elevation steps

Entities use continuous x/y center positions and square collision footprints
while terrain and logical z remain on the tile grid. This replaces whole-tile
travel so keyboard and controller input can stop or turn between tile centers;
one-level elevation changes remain short committed actions to keep terrain
traversal and host authority clear. The extra work is footprint collision,
support checks, and network presentation rather than the cost of decimal
coordinates. The agreed behavior is recorded in
[the movement design](../movement-design.md).
