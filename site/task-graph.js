import {compareTaskUnlock} from './task-requirements.js';

// Only actual tasks occupy graph rows. Cumulative conditions and prerequisites
// outside the current list are shown on the task card and in its detail.
export function taskGraphRecords(tasks,catalogue=tasks){
  const all=new Map(catalogue.map(task=>[task.id,task]));
  function ancestors(task){
    const seen=new Set();
    function visit(current){for(const id of current.dependencies||[])if(!seen.has(id)){seen.add(id);if(all.has(id))visit(all.get(id));}}
    visit(task);seen.delete(task.id);return seen;
  }
  return tasks.map(task=>({...task,dependencies:[...new Set(task.dependencies||[])],requiredTaskCount:ancestors(task).size}));
}

export function layoutTaskGraph(tasks,{cardWidth=236,cardHeight=174,cardHeights=new Map(),columnGap=28,rowGap=54}={}){
  if(!tasks.length)return [];
  const records=new Map(tasks.map(task=>[task.id,task])),ids=[...records.keys()];
  const compare=(a,b)=>compareTaskUnlock(records.get(a),records.get(b));
  const edges=[],external=new Map(),outgoing=new Map(ids.map(id=>[id,[]]));
  for(const task of records.values()){
    const outside=[];
    for(const id of new Set(task.dependencies||[])){
      if(!records.has(id)){outside.push(id);continue;}
      edges.push({from:id,to:task.id});outgoing.get(id).push(task.id);
    }
    external.set(task.id,outside);
  }
  // Condense malformed cycles before assigning rows; never drop a task or hang.
  let sequence=0;
  const indices=new Map(),low=new Map(),stack=[],stacked=new Set(),blocks=[];
  function visit(id){
    indices.set(id,sequence);low.set(id,sequence++);stack.push(id);stacked.add(id);
    for(const next of outgoing.get(id)){
      if(!indices.has(next)){visit(next);low.set(id,Math.min(low.get(id),low.get(next)));}
      else if(stacked.has(next))low.set(id,Math.min(low.get(id),indices.get(next)));
    }
    if(low.get(id)===indices.get(id)){
      const block=[];let next;
      do{next=stack.pop();stacked.delete(next);block.push(next);}while(next!==id);
      blocks.push(block);
    }
  }
  for(const id of ids)if(!indices.has(id))visit(id);
  const blockOf=new Map();blocks.forEach((block,i)=>block.forEach(id=>blockOf.set(id,i)));
  const parents=blocks.map(()=>new Set()),children=blocks.map(()=>new Set());
  for(const {from,to} of edges){const a=blockOf.get(from),b=blockOf.get(to);if(a!==b){children[a].add(b);parents[b].add(a);}}
  const indegree=parents.map(p=>p.size),rank=blocks.map(()=>0),ready=indegree.flatMap((n,i)=>n===0?[i]:[]);
  for(let i=0;i<ready.length;i++)for(const next of children[ready[i]]){
    rank[next]=Math.max(rank[next],rank[ready[i]]+1);if(--indegree[next]===0)ready.push(next);
  }
  const cycleIds=new Set(blocks.filter(block=>block.length>1||edges.some(e=>e.from===block[0]&&e.to===block[0])).flat());
  // Independent chains get their own horizontal space. A long edge can never
  // push a different chain to the right or route around the whole catalogue.
  const adjacent=new Map(ids.map(id=>[id,[]]));
  for(const {from,to} of edges){adjacent.get(from).push(to);adjacent.get(to).push(from);}
  const seen=new Set(),chains=[];
  for(const id of ids){
    if(seen.has(id))continue;
    const chain=[id];seen.add(id);
    for(let i=0;i<chain.length;i++)for(const next of adjacent.get(chain[i]))if(!seen.has(next)){seen.add(next);chain.push(next);}
    chains.push(chain);
  }
  const firstRoot=chain=>chain.filter(id=>rank[blockOf.get(id)]===0).sort(compare)[0];
  chains.sort((a,b)=>compare(firstRoot(a),firstRoot(b)));
  const nodes=[],routed=[],components=[];let offset=0,height=0;
  for(const chain of chains){
    const members=new Set(chain),chainEdges=edges.filter(e=>members.has(e.from)),rows=[],layout=new Map(),routes=new Map();
    function addNode(id,row,width,real){
      const node={id,row,width,real,before:[],after:[],x:0};layout.set(id,node);(rows[row]||=[]).push(node);return node;
    }
    for(const id of chain)addNode(id,rank[blockOf.get(id)],cardWidth,true);
    function connect(a,b){a.after.push(b);b.before.push(a);}
    for(const [i,edge] of chainEdges.entries()){
      const from=layout.get(edge.from),to=layout.get(edge.to);
      if(from.row===to.row){routes.set(edge,[]);continue;}
      const route=[from];
      // Virtual nodes reserve clear vertical lanes in every crossed row. They
      // are geometry only, never artificial tasks or prerequisite conditions.
      for(let row=from.row+1;row<to.row;row++)route.push(addNode(`route:${i}:${row}`,row,20,false));
      route.push(to);for(let j=1;j<route.length;j++)connect(route[j-1],route[j]);routes.set(edge,route);
    }
    const stable=(a,b)=>a.real&&b.real?compare(a.id,b.id):Number(b.real)-Number(a.real)||a.id.localeCompare(b.id);
    rows.forEach(row=>row.sort(stable));
    const mean=values=>values.reduce((sum,x)=>sum+x,0)/values.length;
    function reorder(row,direction){
      const order=new Map(rows.flatMap(r=>r.map((n,i)=>[n,i])));
      const score=node=>node[direction].length?mean(node[direction].map(n=>order.get(n))):order.get(node);
      row.sort((a,b)=>score(a)-score(b)||stable(a,b));
    }
    for(let pass=0;pass<4;pass++){
      for(let row=1;row<rows.length;row++)reorder(rows[row],'before');
      for(let row=rows.length-2;row>0;row--)reorder(rows[row],'after');
    }
    const rowWidth=row=>row.reduce((sum,n)=>sum+n.width,0)+Math.max(0,row.length-1)*columnGap;
    const width=Math.max(...rows.map(rowWidth));
    for(const row of rows){let x=(width-rowWidth(row))/2;for(const node of row){node.x=x;x+=node.width+columnGap;}}
    // Align short chains vertically while retaining collision-free row order.
    function align(row,direction){
      let right=-columnGap;
      for(const node of row){
        const neighbors=node[direction],desired=neighbors.length?mean(neighbors.map(n=>n.x+n.width/2))-node.width/2:node.x;
        node.x=Math.max(right+columnGap,desired);right=node.x+node.width;
      }
      let left=width+columnGap;
      for(const node of [...row].reverse()){node.x=Math.min(node.x,left-columnGap-node.width);left=node.x;}
    }
    for(let pass=0;pass<4;pass++){
      for(let row=1;row<rows.length;row++)align(rows[row],'before');
      for(let row=rows.length-2;row>=0;row--)align(rows[row],'after');
    }
    let top=0;
    const rowBottom=[];
    rows.forEach((row,index)=>{
      const rowHeight=Math.max(cardHeight,...row.filter(n=>n.real).map(n=>cardHeights.get(n.id)||0));
      for(const node of row){node.y=top;node.height=node.real?Math.max(cardHeight,cardHeights.get(node.id)||0):rowHeight;}
      rowBottom[index]=top+rowHeight;top+=rowHeight+rowGap;
    });
    for(const id of chain){const n=layout.get(id);nodes.push({id,x:n.x+offset,y:n.y,width:n.width,height:n.height,external:external.get(id),cycle:cycleIds.has(id)});}
    for(const [i,edge] of chainEdges.entries()){
      const route=routes.get(edge),points=[];
      if(route.length){
        const first=route[0];points.push([first.x+first.width/2+offset,first.y+first.height+1]);
        for(let j=1;j<route.length;j++){
          const a=route[j-1],b=route[j],x1=a.x+a.width/2+offset,x2=b.x+b.width/2+offset;
          const turn=rowBottom[a.row]+rowGap/2+(i%5-2)*3;
          points.push([x1,turn],[x2,turn],[x2,b.real?b.y-6:b.y+b.height]);
        }
      }
      routed.push({...edge,cycle:!route.length,points});
    }
    components.push({ids:chain,x:offset,width,height:top-rowGap});
    height=Math.max(height,top-rowGap);offset+=width+columnGap*2;
  }
  // Preserve original edge order for deterministic consumers and diagnostics.
  const edgeOrder=new Map(edges.map((e,i)=>[`${e.from}>${e.to}`,i]));
  routed.sort((a,b)=>edgeOrder.get(`${a.from}>${a.to}`)-edgeOrder.get(`${b.from}>${b.to}`));
  return [{ids,width:offset-columnGap*2,height,nodes,edges:routed,components}];
}

export function groupTasksByMap(tasks,maps){
  const groups=new Map(maps.map(map=>[map.id,{...map,tasks:[]}]));
  groups.set('other',{id:'other',name:'其他',tasks:[]});
  for(const task of tasks){
    const ids=[...new Set(task.mapIds||[])].filter(id=>groups.has(id)&&id!=='other');
    for(const id of ids.length?ids:['other'])groups.get(id).tasks.push(task);
  }
  return [...groups.values()].filter(group=>group.tasks.length);
}
