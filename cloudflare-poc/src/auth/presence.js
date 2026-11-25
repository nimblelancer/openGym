// Upstream live presence is intentionally ephemeral. One row for the single-owner MVP.
const number=v=>Number.isFinite(+v)?+v:0;
export class Presence {
  constructor(){this.row=null;}
  current(uid,now=Date.now()){
    const p=this.row;
    if(!p||p.uid!==uid)return null;
    if(now-p.updatedAt>=70000||(p.hiddenAt!==undefined&&now-p.hiddenAt>=45000)){this.row=null;return null;}
    return p;
  }
  update(uid,b,now=Date.now()){
    const p=this.current(uid,now);
    if(b.active)this.row={uid,name:typeof b.name==='string'?b.name.slice(0,60):'',exIdx:number(b.exIdx),exTotal:number(b.exTotal),setsDone:number(b.setsDone),setsTotal:number(b.setsTotal),startedAt:number(b.startedAt)||now,updatedAt:now};
    else if(b.reason==='hidden'){if(p&&p.hiddenAt===undefined)p.hiddenAt=now;}
    else this.clear(uid);
  }
  clear(uid){if(this.row?.uid===uid)this.row=null;}
}
