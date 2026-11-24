import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutTaskGraph, groupTasksByMap, taskGraphRecords } from '../../site/task-graph.js';
import {taskCardRequirements,taskVisiblePrerequisites,taskUnlockOrder,compareTaskUnlock} from '../../site/task-requirements.js';
import {presentTraders,TRADER_ORDER,STORY_TRADER_ID,KERMAN_TRADER_ID} from '../../site/task-presentation.js';
import fs from 'node:fs';

test('cumulative conditions stay on their real task, with no artificial gate or mandatory contributor edges',()=>{
  const progress={variableId:'g',compareMethod:'>=',value:2,contributors:[{taskId:'a'},{taskId:'b'},{taskId:'c'}]};
  const all=[{id:'a'},{id:'b'},{id:'c'},{id:'d',prerequisites:[{progressRequirement:progress}]},{id:'e',prerequisites:[{progressRequirement:progress}]}];
  const before=JSON.stringify(all),records=taskGraphRecords(all,all);
  assert.equal(records.length,all.length);assert.equal(JSON.stringify(all),before);
  const edges=layoutTaskGraph(records).flatMap(g=>g.edges);
  assert.deepEqual(edges,[]);assert.ok(layoutTaskGraph(records)[0].nodes.every(n=>n.y===0));
});

test('cross-tier prerequisites remain on root cards without moving roots below other groups',()=>{
  const a={id:'a',group:'1',traderId:'other',dependencies:['older']},b={id:'b',group:'4',traderId:'current',dependencies:['a','missing']};
  const records=taskGraphRecords([b],[a,b,{id:'older'}]);
  assert.equal(records.length,1);assert.equal(records[0].requiredTaskCount,3);
  const graph=layoutTaskGraph(records)[0];assert.deepEqual(graph.edges,[]);
  assert.deepEqual(graph.nodes[0].external,['a','missing']);assert.equal(graph.nodes[0].y,0);
});

test('independent roots all share the top row, ordered from lower to higher requirements', () => {
  const task=(id,count,level=0)=>({id,level,prerequisites:[{type:'GlobalVariableValue',raw:{value:count,compareMethod:'>='}}]});
  const graph = layoutTaskGraph([task('four',4),task('two',2),task('oneHigh',1,10),task('one',1),{id:'none'}])[0];
  assert.deepEqual([...graph.nodes].sort((a,b)=>a.x-b.x).map(n=>n.id),['none','one','oneHigh','two','four']);
  assert.ok(graph.nodes.every(node=>node.y===0));assert.equal(graph.edges.length,0);
});

test('variable-height requirements leave room for every card and descending arrow',()=>{
  const graph=layoutTaskGraph([{id:'a'},{id:'b',dependencies:['a']},{id:'c'}],{cardHeights:new Map([['a',390],['c',260]])})[0];
  const nodes=new Map(graph.nodes.map(n=>[n.id,n]));assert.equal(nodes.get('a').height,390);assert.equal(nodes.get('b').y,444);assert.equal(nodes.get('c').y,0);
});

test('card text counts only verified unit tasks and preserves weighted, unknown and other requirements',()=>{
  const progress={value:2,compareMethod:'>=',contributors:[{contribution:1}],alternatives:[]};
  const task={prerequisites:[{type:'Quest',taskId:'x',text:'指定任务'},{type:'GlobalVariableValue',progressRequirement:progress,text:'任务进度至少 2'},{type:'Level',text:'角色等级至少 5'},{type:'GlobalVariableValue',text:'任务进度至少 1'},{type:'GlobalVariableValue',text:'商人任务进度至少 3',progressRequirement:{...progress,alternatives:[{contribution:2}]}}]};
  assert.deepEqual(taskCardRequirements(task),['先完成至少 2 项相关任务','角色等级至少 5','任务进度至少 1','商人任务进度至少 3']);
  assert.deepEqual(taskCardRequirements({prerequisites:[{type:'GlobalVariableValue',text:'累计超过 2',progressRequirement:{...progress,compareMethod:'>'}}]}),['先完成至少 3 项相关任务']);
});

test('all merchant groups preserve edges, ordered chain roots and collision-free cards and routes',()=>{
  const catalogue=JSON.parse(fs.readFileSync(new URL('../../site/data/tasks/catalog.json',import.meta.url)));
  for(const trader of catalogue.traders)for(const group of ['1','2','3','4','core']){
    const tasks=catalogue.tasks.filter(t=>t.traderId===trader.id&&t.group===group);if(!tasks.length)continue;
    const records=taskGraphRecords(tasks,catalogue.tasks),graph=layoutTaskGraph(records)[0],nodes=new Map(graph.nodes.map(n=>[n.id,n]));
    assert.equal(nodes.size,tasks.length);
    for(const task of tasks){const internal=task.dependencies.filter(id=>nodes.has(id));if(!internal.length)assert.equal(nodes.get(task.id).y,0,task.name);for(const id of internal)assert.ok(graph.edges.some(e=>e.from===id&&e.to===task.id));}
    const firstRoots=[];
    for(const component of graph.components){
      const roots=component.ids.map(id=>nodes.get(id)).filter(n=>n.y===0).sort((a,b)=>a.x-b.x).map(n=>records.find(r=>r.id===n.id));
      for(let i=1;i<roots.length;i++)assert.ok(compareTaskUnlock(roots[i-1],roots[i])<=0);
      firstRoots.push(roots[0]);
    }
    for(let i=1;i<firstRoots.length;i++)assert.ok(compareTaskUnlock(firstRoots[i-1],firstRoots[i])<=0);
    for(const edge of graph.edges)if(!edge.cycle)assert.ok(nodes.get(edge.from).y+nodes.get(edge.from).height<nodes.get(edge.to).y);
    for(let i=0;i<graph.nodes.length;i++)for(const b of graph.nodes.slice(i+1)){const a=graph.nodes[i];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);}
    assertClearRoutes(graph);
  }
});

function assertClearRoutes(graph){
  const epsilon=0.001;
  for(const edge of graph.edges){
    if(edge.cycle)continue;
    const component=graph.components.find(c=>c.ids.includes(edge.from));
    for(const [i,b] of edge.points.entries()){
      assert.ok(b[0]>=component.x-epsilon&&b[0]<=component.x+component.width+epsilon,'route stays inside its chain');
      if(!i)continue;const a=edge.points[i-1];
      assert.ok(a[0]===b[0]||a[1]===b[1]);assert.ok(b[1]>=a[1]);
      for(const n of graph.nodes){
        const crosses=a[0]===b[0]
          ?a[0]>n.x+epsilon&&a[0]<n.x+n.width-epsilon&&Math.max(a[1],b[1])>n.y+epsilon&&Math.min(a[1],b[1])<n.y+n.height-epsilon
          :a[1]>n.y+epsilon&&a[1]<n.y+n.height-epsilon&&Math.max(a[0],b[0])>n.x+epsilon&&Math.min(a[0],b[0])<n.x+n.width-epsilon;
        assert.equal(crosses,false,`${edge.from}>${edge.to} crosses ${n.id}`);
      }
    }
  }
}

test('straight chains stay vertical and long edges use local free lanes, including measured card heights',()=>{
  const chain=[{id:'a'},{id:'b',dependencies:['a']},{id:'c',dependencies:['b']}];
  assert.equal(new Set(layoutTaskGraph(chain)[0].nodes.map(n=>n.x)).size,1);
  const graph=layoutTaskGraph([...chain,{id:'d',dependencies:['a','c']},...Array.from({length:20},(_,i)=>({id:`separate${i}`}))],{cardHeights:new Map([['b',430],['d',320]])})[0];
  assertClearRoutes(graph);
  const local=graph.components.find(c=>c.ids.includes('d'));
  assert.ok(local.width<236*2,'only a narrow lane is needed beside the chain');
  const edge=graph.edges.find(e=>e.from==='a'&&e.to==='d');
  assert.ok(edge.points.length>4);assert.equal(graph.nodes.length,24);
});

test('loyalty prerequisites are restored on cards and detail and participate in ordering without changing sources',()=>{
  const loyalty={type:'TraderLoyalty',raw:{value:4,compareMethod:'>='},text:'信任度至少 4'};
  const task={id:'a',prerequisites:[loyalty]},before=JSON.stringify(task);
  assert.deepEqual(taskVisiblePrerequisites(task),[loyalty]);assert.deepEqual(taskCardRequirements(task),['信任度至少 4']);
  assert.ok(compareTaskUnlock(task,{id:'a'})>0);assert.equal(JSON.stringify(task),before);
  assert.deepEqual(taskCardRequirements({...task,prerequisites:[loyalty,{type:'Level',text:'角色等级至少 5'}]}),['信任度至少 4','角色等级至少 5']);
  assert.equal(taskUnlockOrder({prerequisites:[{type:'GlobalVariableValue',raw:{value:3,compareMethod:'>='},dialogueRequirement:{}}]})[0],0);
});

test('trader presentation uses requested order and exact Kerman portrait without mutating catalogue',()=>{
  const catalogue=JSON.parse(fs.readFileSync(new URL('../../site/data/tasks/catalog.json',import.meta.url)));
  const before=JSON.stringify(catalogue.traders),traders=presentTraders(catalogue.traders);
  assert.deepEqual(traders.map(t=>t.id),TRADER_ORDER);assert.equal(traders.at(-1).id,STORY_TRADER_ID);
  assert.equal(traders.at(-1).imageKey,KERMAN_TRADER_ID);assert.equal(JSON.stringify(catalogue.traders),before);
  const assets=JSON.parse(fs.readFileSync(new URL('../../site/data/tasks/assets/manifest.json',import.meta.url)));
  assert.ok(fs.existsSync(new URL(`../../site/${assets.traders[KERMAN_TRADER_ID].file}`,import.meta.url)));
});

test('branching and merging keeps every real prerequisite arrow and descends', () => {
  const graph = layoutTaskGraph([
    { id: 'a' }, { id: 'b', dependencies: ['a'] }, { id: 'c', dependencies: ['a'] }, { id: 'd', dependencies: ['b', 'c'] },
  ])[0];
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  assert.deepEqual(graph.edges.map(edge => `${edge.from}>${edge.to}`), ['a>b', 'a>c', 'b>d', 'c>d']);
  assert.equal(nodes.get('b').y, nodes.get('c').y);
  assert.notEqual(nodes.get('b').x, nodes.get('c').x);
  for (const edge of graph.edges) assert.ok(nodes.get(edge.from).y < nodes.get(edge.to).y);
});

test('external and cross-group prerequisites are retained without phantom cards', () => {
  const graph = layoutTaskGraph([{ id: 'b', dependencies: ['external', 'external'] }])[0];
  assert.deepEqual(graph.nodes[0].external, ['external']);
  assert.deepEqual(graph.ids, ['b']);
  assert.equal(graph.edges.length, 0);
});

test('cycles do not hang or drop following quests and are explicitly flagged', () => {
  const graph = layoutTaskGraph([{ id: 'a', dependencies: ['b'] }, { id: 'b', dependencies: ['a'] }, { id: 'c', dependencies: ['b'] }])[0];
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.filter(edge => edge.cycle).length, 2);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  assert.equal(nodes.get('a').cycle, true);
  assert.ok(nodes.get('c').y > nodes.get('b').y);
});

test('multi-map tasks repeat once per map; collection-only tasks go to other', () => {
  const tasks = [{ id: 'a', mapIds: ['woods', 'factory', 'woods'] }, { id: 'b', mapIds: [] }];
  const groups = groupTasksByMap(tasks, [{ id: 'factory', name: '工厂' }, { id: 'woods', name: '森林' }]);
  assert.deepEqual(groups.map(group => [group.id, group.tasks.map(task => task.id)]), [['factory', ['a']], ['woods', ['a']], ['other', ['b']]]);
});
