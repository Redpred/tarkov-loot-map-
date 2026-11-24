// Dataset values stay in Unity world coordinates. Reflection is applied only at
// the rendering boundary, where Three.js uses the opposite handedness.
export const UNITY_TO_VIEW_SCALE = [1, 1, -1];

export function unityToView({x, y, z}) {
  return {x, y, z: -z};
}
