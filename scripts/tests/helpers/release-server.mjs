// Local QA fixture for the same ZIP/index URLs that GitHub Releases will serve.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
export function createReleaseFixture(directory) {
  const stats = {index: 0, ranges: 0, full: 0, bytes: 0};
  const server = http.createServer((req,res)=>{
    const name = new URL(req.url,'http://localhost').pathname.slice(1);
    if (!/^(resources-index\.json|resources-[a-z0-9_-]+\.zip)$/.test(name) || req.method !== 'GET') { res.writeHead(404).end(); return; }
    const file = path.join(directory,name);
    fs.promises.stat(file).then(stat=>{
      let start=0,end=stat.size-1,status=200,headers={};
      if (req.headers.range) {
        const match=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
        if(!match){res.writeHead(416).end();return;}
        start=Number(match[1]);end=Number(match[2]);
        if(start>end||end>=stat.size){res.writeHead(416).end();return;}
        headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;status=206;stats.ranges++;
      } else if(name.endsWith('.json'))stats.index++; else stats.full++;
      headers['Content-Length']=end-start+1;stats.bytes+=end-start+1;
      res.writeHead(status,headers);fs.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
    }).catch(()=>res.writeHead(404).end());
  });
  return {server,stats};
}
