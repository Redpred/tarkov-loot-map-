import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Matrix4, Vector3, Object3D } from 'three';
import { UNITY_TO_VIEW_SCALE, unityToView } from '../../site/factory-coordinates.js';

test('Unity world handedness changes once while source coordinates remain unchanged',()=>{
  const source={x:17,y:2,z:31};
  const view=unityToView(source);
  assert.deepEqual(view,{x:17,y:2,z:-31});
  assert.deepEqual(source,{x:17,y:2,z:31});
  const matrix=new Matrix4().makeScale(...UNITY_TO_VIEW_SCALE);
  assert.equal(matrix.determinant(),-1);
  assert.deepEqual(new Vector3(17,2,31).applyMatrix4(matrix).toArray(),Object.values(view));
});

test('rendered mesh anchor, loot marker and camera/hit-test coordinates agree for a sheared instance',()=>{
  const world=new Group();world.scale.set(...UNITY_TO_VIEW_SCALE);
  const mesh=new Object3D();mesh.matrixAutoUpdate=false;
  mesh.matrix.set(2,.5,0,10, 0,1,0,20, 0,0,-3,30, 0,0,0,1);
  world.add(mesh);
  const local=new Vector3(1,2,3);
  const unity=local.clone().applyMatrix4(mesh.matrix);
  const marker=new Object3D();marker.position.copy(unity);world.add(marker);
  world.updateMatrixWorld(true);
  const rendered=local.clone().applyMatrix4(mesh.matrixWorld);
  const clicked=unityToView(unity);
  assert.deepEqual(rendered.toArray(),[13,22,-21]);
  assert.deepEqual(marker.getWorldPosition(new Vector3()).toArray(),rendered.toArray());
  assert.deepEqual(Object.values(clicked),rendered.toArray());
});
