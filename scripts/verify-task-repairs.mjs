// Compare this repair against its protected pre-change snapshot, including
// geometry and objective identity. This never edits source or runtime data.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {taskGraphRecords,layoutTaskGraph} from '../site/task-graph.js';
const root=path.resolve(import.meta.dirname,'..'),work='work/task-repair-20261013';
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const before=read(`${work}/backup/site/data/tasks/catalog.json`),after=read('site/data/tasks/catalog.json');
const byId=new Map(after.tasks.map(t=>[t.id,t])),mapCounts=[];
assert.equal(after.tasks.length,before.tasks.length);
for(const task of before.tasks){
  const updated=byId.get(task.id);assert.ok(updated,task.id);
  assert.deepEqual(updated.conditions,task.conditions);assert.deepEqual(updated.rewards,task.rewards);
  assert.deepEqual(updated.dependencies,task.dependencies);
  for(const o of task.objectives){const now=updated.objectives.find(g=>g.id===o.id);assert.ok(now);assert.deepEqual(now.raw,o.raw);assert.equal(now.text,o.text);}
}
for(const map of Object.values(ATLAS_MAPS)){
  const a=read(`${work}/backup/site/data/tasks/maps/${map.id}.json`),b=read(`site/data/tasks/maps/${map.id}.json`),points=new Map(b.points.map(p=>[p.id,p]));
  for(const old of a.points){
    const now=points.get(old.id);assert.ok(now,`Missing old point: ${map.id}/${old.id}`);
    assert.deepEqual(now.position,old.position);assert.deepEqual(now.outline,old.outline);assert.deepEqual(now.poiTypes,old.poiTypes);
    for(const r of old.questObjectives)assert.ok(now.questObjectives.some(n=>n.questId===r.questId&&n.objectiveId===r.objectiveId));
  }
  mapCounts.push({mapId:map.id,before:a.points.length,after:b.points.length,added:b.points.length-a.points.length});
}
const beforeCoverage=read(`${work}/before-coverage.json`),coverage=read('work/task-point-audit-20261013/coverage.json');
const objectiveKey=o=>`${o.taskId}:${o.objectiveId}`,objectives=new Map(coverage.objectives.map(o=>[objectiveKey(o),o]));
const repaired=beforeCoverage.objectives.filter(o=>o.category==='fixed-location'&&o.status!=='complete').map(o=>({before:o,after:objectives.get(objectiveKey(o))}));
assert.equal(coverage.summary.integrityErrors,0);assert.equal(coverage.summary.sourceIntegrity.errors.length,0);
const graphChecks=[];
for(const trader of after.traders)for(const group of ['1','2','3','4','core']){
  const tasks=after.tasks.filter(t=>t.traderId===trader.id&&t.group===group),records=taskGraphRecords(tasks,after.tasks),components=layoutTaskGraph(records);
  assert.equal(components.flatMap(c=>c.nodes).length,records.length);
  const edges=components.flatMap(c=>c.edges),recordById=new Map(records.map(t=>[t.id,t]));
  for(const t of tasks){
    for(const id of t.dependencies)if(byId.has(id))assert.ok(edges.some(e=>e.from===id&&e.to===t.id));
    for(const p of t.prerequisites.filter(p=>p.progressRequirement))assert.ok(edges.some(e=>e.to===t.id&&recordById.get(e.from).requirement?.variableId===p.variableId));
  }
  graphChecks.push({trader:trader.name,group,tasks:tasks.length,nodes:records.length,edges:edges.length,cycles:edges.filter(e=>e.cycle).length});
}
const report={source:after.source,originalTasksPreserved:before.tasks.length,originalObjectivesPreserved:before.tasks.reduce((n,t)=>n+t.objectives.length,0),originalPointsPreserved:mapCounts.reduce((n,m)=>n+m.before,0),newPoints:mapCounts.reduce((n,m)=>n+m.added,0),mapCounts,fixedObjectivesRepaired:repaired.filter(r=>r.after?.status==='complete').length,nonspatialObjectivesReclassified:repaired.filter(r=>r.after?.category!=='fixed-location').length,remaining:repaired.filter(r=>r.after?.category==='fixed-location'&&r.after.status!=='complete').map(r=>r.after),coverage:coverage.summary,graphChecks};
fs.writeFileSync(path.join(root,work,'verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,remaining:report.remaining.map(r=>({task:r.taskName,objective:r.text,requirements:r.requirements})),graphChecks:graphChecks.length},null,2));
