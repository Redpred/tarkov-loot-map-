// All serialized coordinates and grid cells use the original Unity XYZ.
export const SPATIAL_VERSION = 1;
export const COLLISION_CELL_SIZE = 8;

export function buildCollisionCells(boxes, size = COLLISION_CELL_SIZE) {
  const cells = new Map(), large = [];
  for (let i = 0; i < boxes.length / 6; i++) {
    const b = i * 6;
    const x0 = Math.floor(boxes[b] / size), x1 = Math.floor(boxes[b + 3] / size);
    const z0 = Math.floor(boxes[b + 2] / size), z1 = Math.floor(boxes[b + 5] / size);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 256) { large.push(i); continue; }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const key = x + ',' + z;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    }
  }
  return {size, cells: [...cells], large};
}

export function buildSpatialData(manifest, buffer) {
  const meshes = manifest.meshes.map(m => {
    const positions = new Float32Array(buffer, m.positionOffset, m.vertices * 3);
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
      box[axis] = Math.min(box[axis], positions[i + axis]);
      box[axis + 3] = Math.max(box[axis + 3], positions[i + axis]);
    }
    const center = box.slice(0, 3).map((min, i) => (min + box[i + 3]) / 2);
    let radiusSquared = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const dx = positions[i] - center[0], dy = positions[i + 1] - center[1], dz = positions[i + 2] - center[2];
      radiusSquared = Math.max(radiusSquared, dx * dx + dy * dy + dz * dz);
    }
    const boxes = new Float32Array(buffer, m.boundsOffset, m.instances * 6);
    return {box, sphere: [...center, Math.sqrt(radiusSquared)], collision: buildCollisionCells(boxes)};
  });
  return {version: SPATIAL_VERSION, geometrySha256: manifest.sha256, meshes};
}
