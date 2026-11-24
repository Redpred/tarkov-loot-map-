// Reviewed scene component associations. Never use the off-map position of a
// global quest controller: resolve its event to the actual interaction object.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const raw=read('data/tasks/20261013-901f569/raw/spt/database/templates/quests.json');
const specs=[
  ['shoreline',29,8131,29,8510,'CardReader','CardReader failure event completes the exact quest condition'],
  ['shoreline',29,8437,29,8510,'CardReader','CardReader card success passes party restriction to grant_terminal_transit_access; HandlerOr 8596'],
  ['shoreline',29,8569,29,8510,'CardReader','CardReader card success passes party restriction to grant_terminal_transit_access; HandlerOr 8596'],
  ['shoreline',29,8465,29,8574,'HandlerRequirementsWithFailedTrigger','On-site intercom requirement handler emits speaker_interacton_failed'],
  ['interchange',64,159149,64,159145,'Switch','Same GameObject switch event'],
  ['interchange',64,159172,64,159165,'Switch','Switch -> plant action -> completion event on the same interaction assembly'],
  ['interchange',64,159623,64,159616,'Switch','Same GameObject power panel; Enable_Panel_Switch_01 requirements emit Enable_Panel'],
  ['interchange',64,159624,64,159616,'Switch','Same GameObject power panel; Enable_Panel_Switch_01 requirements emit Enable_Panel'],
  ['terminal',633,49,629,4375,'Switch','Exact Water_remove_1178689405 event from the pump button'],
  ['terminal',633,50,629,4375,'Switch','Exact Water_remove_1178689405 event from the pump button'],
  ['terminal',633,51,629,4363,'KeycardDoor','Exact open_door event emitted by the maintenance door'],
  ['terminal',633,54,629,4363,'KeycardDoor','Exact open_door event emitted by the maintenance door'],
  ['icebreaker',704,22621,704,23005,'Door','Same GameObject exact completion event'],
  ['icebreaker',704,22642,704,23002,'Door','Same GameObject exact completion event'],
  ['icebreaker',704,22774,704,23003,'Door','Same GameObject exact completion event'],
  ['icebreaker',704,22810,704,23006,'Door','Same GameObject exact completion event'],
  ['icebreaker',704,22683,704,22800,'HandlerPlantAction','Repair plant action emits exact completion event'],
  ['icebreaker',704,22736,704,22783,'HandlerPlantAction','Repair plant action emits exact completion event'],
  ['icebreaker',704,22751,704,22767,'HandlerPlantAction','Repair plant action emits exact completion event'],
  ['icebreaker',704,22752,704,23014,'Switch','Rezak_01_722179887 switch -> HandlerDelay 23176 -> Unlock_01_722179887'],
  ['icebreaker',704,23010,704,23177,'HandlerExplosion','Exact planted charge explosion and chain unlock event at the charge'],
  ['icebreaker',704,23011,704,23177,'HandlerExplosion','Exact planted charge explosion and chain unlock event at the charge'],
];
function string(b,at){const n=b.readInt32LE(at);if(n<1||n>200||at+4+n>b.length)throw Error('Unexpected quest event payload');return [b.subarray(at+4,at+4+n).toString('utf8'),(at+4+n+3)&~3];}
const maps=new Map(),result=[];
for(const [mapId,level,handlerId,anchorLevel,anchorId,expectedClass,association] of specs){
  const file=`work/task-repair-20261013/client-inspection/${mapId}.json`;
  if(!maps.has(mapId))maps.set(mapId,read(file));const rows=maps.get(mapId);
  const handler=rows.find(r=>r.level===level&&r.componentId===handlerId),anchor=rows.find(r=>r.level===anchorLevel&&r.componentId===anchorId);
  if(!handler?.active||handler.class!=='HandlerCompleteQuestCondition'||!anchor?.active||anchor.class!==expectedClass)throw Error(`Interaction evidence changed: ${mapId}/${handlerId}`);
  const payload=Buffer.from(handler.payloadHex,'hex'),[eventId,next]=string(payload,0),[sourceQuestId,then]=string(payload,next),[objectiveId]=string(payload,then);
  if(!raw[sourceQuestId]?.conditions?.AvailableForFinish?.some(c=>c.id===objectiveId))throw Error(`Unknown task condition: ${sourceQuestId}/${objectiveId}`);
  if(Math.abs(anchor.position.x)>=1050&&anchor.position.z===-900)throw Error('Global event controller is not a usable location');
  result.push({mapId,sourceQuestId,objectiveId,sourceId:eventId,position:anchor.position,outline:[],sourceEvidence:{path:file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),handler:{level,componentId:handlerId,gameObjectId:handler.gameObjectId},anchor:{level:anchorLevel,componentId:anchorId,gameObjectId:anchor.gameObjectId,class:anchor.class},eventId,association}});
}
fs.writeFileSync(path.join(root,'work/task-repair-20261013/verified-interactions.json'),JSON.stringify(result,null,2));
console.log(`${result.length} interaction positions for ${new Set(result.map(r=>r.objectiveId)).size} exact task objectives`);
