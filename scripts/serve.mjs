import path from 'node:path';
import { createSiteServer } from './lib/site-server.mjs';
const root=path.resolve(import.meta.dirname,'../site');
const port=Number(process.env.PORT||4175);
createSiteServer(root,{resourceArchive:process.env.DESKTOP_RESOURCE_ARCHIVE}).listen(port,'127.0.0.1',()=>console.log(`Atlas loot encyclopedia: http://127.0.0.1:${port}/factory.html | /streets.html`));
