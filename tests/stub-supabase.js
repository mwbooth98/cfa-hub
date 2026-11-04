// Stand-in for supabase-js used by tests/smoke.js. It keeps a fake "docs" table in localStorage so it survives
// reloads, and window.__db.fail ('network' | 'auth' | null) makes every request fail the way the real client would.
(function(){
  const KEY='__stubdb';
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||null}catch(e){return null}};
  const db=window.__db={rows:load()||[],fail:localStorage.getItem(KEY+'-fail')||null,signedIn:localStorage.getItem(KEY+'-out')!=='1',
    save(){localStorage.setItem(KEY,JSON.stringify(this.rows))},
    setFail(f){this.fail=f;f?localStorage.setItem(KEY+'-fail',f):localStorage.removeItem(KEY+'-fail')},
    find(c){return this.rows.filter(r=>r.coll===c)}};
  const err=()=>db.fail==='auth'?{status:401,code:'PGRST301',message:'JWT expired'}:db.fail==='network'?{message:'TypeError: Failed to fetch'}:null;
  const later=v=>Promise.resolve(v);
  function table(){
    const q={_eq:{},
      select(){return q},
      range(a,b){const e=err();return later(e?{data:null,error:e}:{data:db.rows.slice(a,b+1).map(r=>({coll:r.coll,id:r.id,data:r.data})),error:null})},
      upsert(row){const e=err();if(!e){db.rows=db.rows.filter(r=>!(r.coll===row.coll&&r.id===row.id));db.rows.push({coll:row.coll,id:row.id,data:JSON.parse(JSON.stringify(row.data))});db.save()}return later({error:e})},
      delete(){q._del=true;return q},
      eq(k,v){q._eq[k]=v;return q},
      then(res,rej){const e=err();if(q._del&&!e){db.rows=db.rows.filter(r=>!(r.coll===q._eq.coll&&r.id===q._eq.id));db.save()}return later({error:e}).then(res,rej)}};
    return q;
  }
  const listeners=[];
  window.supabase={createClient(){return {from:table,auth:{
    getSession:async()=>({data:{session:db.signedIn?{user:{id:'u1'}}:null}}),
    signOut:async()=>{db.signedIn=false;localStorage.setItem(KEY+'-out','1');listeners.forEach(f=>f('SIGNED_OUT'))},
    signInWithPassword:async()=>{db.signedIn=true;localStorage.removeItem(KEY+'-out');return {data:{user:{id:'u1'}},error:null}},
    onAuthStateChange:f=>{listeners.push(f);return {data:{subscription:{unsubscribe(){}}}}}}}}};
})();
