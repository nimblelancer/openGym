// Only for the disposable manual test page. Keep credential objects in memory, never render them.
const out=document.getElementById('status');
const line=s=>{out.textContent+='\n'+s;};
async function api(path,method='GET',body){
  const r=await fetch(path,{method,credentials:'same-origin',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await r.json();line(method+' '+path+' '+r.status+(data.code?' '+data.code:''));
  return {status:r.status,data};
}
const requireOk=r=>{if(r.status!==200)throw new Error('API status '+r.status);return r.data;};
const post=async(path,b)=>requireOk(await api(path,'POST',b));
const actions={
  async register(){
    const box=document.getElementById('setup'),code=box.value;box.value='';
    const o=await post('/api/register/options',{name:'Phase 3 manual fixture',code});
    const c=await navigator.credentials.create({publicKey:PublicKeyCredential.parseCreationOptionsFromJSON(o.options)});
    await post('/api/register/verify',{cid:o.cid,credential:c.toJSON()});line('Registration completed; confirm native prompt was displayed.');
  },
  async me(){const r=await api('/api/me');if(r.status===200)line('Signed in as test owner: '+(r.data.user.name==='Phase 3 manual fixture'));line('Session cookie not readable in JS: '+!document.cookie.includes('gymsid='));},
  async write(){const r=requireOk(await api('/api/data/rev'));await requireOk(await api('/api/data','PUT',{baseRev:r.rev,baseWid:r.wid,stamped:true,state:{workouts:[{id:'manual-fixture',d:'2026-09-01'}],routines:[],_ts:1}}));line('Synthetic workout saved.');},
  async logout(){await post('/api/logout',{});},
  async login(){const o=await post('/api/login/options',{});const c=await navigator.credentials.get({publicKey:PublicKeyCredential.parseRequestOptionsFromJSON(o.options)});await post('/api/login/verify',{cid:o.cid,credential:c.toJSON()});line('Login completed; confirm native prompt was displayed.');},
  async read(){const r=requireOk(await api('/api/data'));line('Synthetic workout present: '+!!r.state?.workouts?.some(w=>w.id==='manual-fixture'));},
  async all(){await post('/api/logout/all',{});},
  async clear(){out.textContent='Ready.';}
};
for(const [id,fn] of Object.entries(actions))document.getElementById(id).addEventListener('click',async()=>{
  const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{await fn();}catch(e){line('Stopped: '+(e.name==='NotAllowedError'?'authenticator cancelled or unavailable':e.name==='InvalidStateError'?'existing credential or invalid authenticator state':'operation failed'));}finally{buttons.forEach(b=>b.disabled=false);}
});
