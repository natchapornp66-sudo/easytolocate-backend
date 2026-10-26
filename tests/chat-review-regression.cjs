require('dotenv').config();
const { Pool } = require('pg');
const fs = require('node:fs');
const pool = new Pool(require('../config').databaseOptions);
const stamp = Date.now(), results = [], rentals = [];
let a, b, outsider, item;
async function call(url, method='GET', body, user) {
 const headers=user?{Authorization:`Bearer ${user.token}`} : {};
 if(body && !(body instanceof FormData)) headers['Content-Type']='application/json';
 const r=await fetch((process.env.TEST_API_URL || 'http://localhost:5000/api')+url,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 return {status:r.status,data:(r.headers.get('content-type')||'').includes('json')?await r.json():await r.arrayBuffer()};
}
function check(name,actual,expected) {const pass=actual===expected;results.push({name,actual,expected,pass});console.log(`${pass?'PASS':'FAIL'} ${name}: ${actual}`);}
async function account(role) {
 const email=`qa.chat.${role}.${stamp}@example.invalid`,password=`QaChat-${stamp}!`;
 await call('/auth/register','POST',{email,password,full_name:`QA CHAT ${role}`});
 const r=await call('/auth/login','POST',{email,password});return {id:r.data.data.id,token:r.data.token};
}
async function fixture(completed=true) {
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const r=await call('/rentals','POST',{item_id:item,start_date:today,end_date:today,agreement_accepted:true},a);
 if(r.status!==201)throw new Error('Rental fixture failed'); const id=r.data.data.rental_id;rentals.push(id);
 // Only this new QA rental is completed directly to isolate review validation. Full rental workflow has its own regression suite.
 if(completed)await pool.query('UPDATE rentals SET status=$1 WHERE rental_id=$2 AND borrower_id=$3',['completed',id,a.id]);
 return id;
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function review(id,comment='QA valid review',rating='4',photos=0,invalid=false) {const f=new FormData();f.set('rental_id',id);f.set('comment',comment);f.set('rating',rating);for(let i=0;i<photos;i++)f.append('photos',new Blob([invalid?Buffer.from('not png'):png],{type:'image/png'}),'QA.png');return f;}
async function main(){
 a=await account('sender');b=await account('recipient');outsider=await account('outsider');
 check('anonymous chat blocked',(await call('/chats')).status,401);
 check('invalid recipient rejected',(await call('/chats/not-a-uuid/messages','POST',{message:'QA'},a)).status,400);
 check('missing recipient rejected',(await call(`/chats/${crypto.randomUUID()}/messages`,'POST',{message:'QA'},a)).status,404);
 check('non-string message rejected',(await call(`/chats/${b.id}/messages`,'POST',{message:42},a)).status,400);
 check('long message rejected',(await call(`/chats/${b.id}/messages`,'POST',{message:'x'.repeat(3001)},a)).status,400);
 check('empty message rejected',(await call(`/chats/${b.id}/messages`,'POST',{message:'   '},a)).status,400);
 check('self message rejected',(await call(`/chats/${a.id}/messages`,'POST',{message:'QA'},a)).status,400);
 check('sender spoof blocked',(await call(`/chats/${b.id}/messages`,'POST',{sender_id:outsider.id,message:'QA'},a)).status,403);
 check('invalid rental ID rejected',(await call(`/chats/${b.id}/messages`,'POST',{message:'QA',rental_id:'invalid'},a)).status,400);
 check('send message',(await call(`/chats/${b.id}/messages`,'POST',{message:'QA delivered message'},a)).status,201);
 const inbox=await call('/chats','GET',undefined,b);
 check('unread count before opening',inbox.data.data.find(c=>c.chat_id===a.id)?.unread_count,1);
 const read=await call(`/chats/${a.id}/messages`,'GET',undefined,b);
 check('recipient sees message',read.data.data.some(m=>m.message==='QA delivered message'),true);
 const after=await call('/chats','GET',undefined,b);check('unread count clears after opening',after.data.data.find(c=>c.chat_id===a.id)?.unread_count,0);
 const unread=await pool.query('SELECT COUNT(*)::int AS n FROM chat_messages WHERE sender_id=$1 AND receiver_id=$2 AND is_read=FALSE',[a.id,b.id]);check('read persisted in DB',unread.rows[0].n,0);
 check('reverse reply',(await call(`/chats/${a.id}/messages`,'POST',{message:'QA reply'},b)).status,201);
 const history=await call(`/chats/${b.id}/messages`,'GET',undefined,a);check('two-way history',history.data.data.some(m=>m.message==='QA reply'),true);
 const isolated=await call(`/chats/${b.id}/messages`,'GET',undefined,outsider);check('outsider gets no private history',isolated.data.data.length,0);
 check('query spoof blocked',(await call(`/chats/${b.id}/messages?userId=${a.id}`,'GET',undefined,outsider)).status,403);
 const cat=(await call('/categories')).data[0].category_id;
 const created=await call('/items','POST',{category_id:cat,title:`QA CHAT REVIEW ${stamp}`,description:'QA only',conditions:'QA',daily_price:100,images:[]},b);item=created.data.data.item_id;
 const pending=await fixture(false);
 check('review before completion blocked',(await call('/reviews','POST',review(pending),a)).status,400);
 check('review requires authentication',(await call('/reviews','POST',review(pending))).status,401);
 check('malformed review rental rejected',(await call('/reviews','POST',review('not-a-uuid'),a)).status,400);
 check('blank comment rejected',(await call('/reviews','POST',review(await fixture(),'  '),a)).status,400);
 check('overlong comment rejected',(await call('/reviews','POST',review(await fixture(),'x'.repeat(3001)),a)).status,400);
 check('fake review image rejected',(await call('/reviews','POST',review(await fixture(),'QA image','4',1,true),a)).status,400);
 const valid=await fixture();
 check('owner cannot review own item',(await call('/reviews','POST',review(valid),b)).status,403);
 check('outsider cannot review',(await call('/reviews','POST',review(valid),outsider)).status,403);
 check('invalid rating rejected',(await call('/reviews','POST',review(valid,'QA','4.5'),a)).status,400);
 check('more than five photos blocked',(await call('/reviews','POST',review(valid,'QA','4',6),a)).status,400);
 const posted=await call('/reviews','POST',review(valid,'QA review with image','4',1),a);check('post valid review with photo',posted.status,201);
 check('duplicate review blocked',(await call('/reviews','POST',review(valid),a)).status,409);
 const race=await fixture();const simultaneous=await Promise.all([call('/reviews','POST',review(race,'QA parallel A','5'),a),call('/reviews','POST',review(race,'QA parallel B','5'),a)]);
 check('one simultaneous review wins',simultaneous.filter(r=>r.status===201).length,1);check('other simultaneous review blocked',simultaneous.filter(r=>r.status===409).length,1);
 const count=await pool.query('SELECT COUNT(*)::int AS n FROM reviews WHERE rental_id=$1',[race]);check('one stored review per rental',count.rows[0].n,1);
 const listing=await call(`/items/${item}/reviews`);check('public review includes photo',listing.data.some(r=>r.rental_id===valid&&r.photo_urls.length===1),true);
 const expected=await pool.query('SELECT ROUND(AVG(rating)::numeric,2) AS score FROM reviews WHERE reviewee_id=$1',[b.id]);
 const profile=await call('/auth/me','GET',undefined,b);check('profile score follows actual reviews',Number(profile.data.data.trust_score),Number(expected.rows[0].score));
 const notices=await call('/notifications','GET',undefined,b);check('review notices persisted exactly once per valid review',notices.data.data.filter(n=>n.type==='review').length,2);
}
main().catch(e=>{console.error(e.message);results.push({name:'unexpected failure',error:e.message,pass:false});}).finally(async()=>{
 if(a&&b)for(const id of rentals){
  const current=await call(`/rentals/${id}`,'GET',undefined,a).catch(()=>null);
  if(current?.data?.data?.status==='pending')await call(`/rentals/${id}/status`,'PATCH',{status:'rejected'},b).catch(()=>{});
 }
 if(item&&b)await call(`/items/${item}/status`,'PATCH',{status:'inactive'},b);
 fs.writeFileSync('chat-review-regression-result.json',JSON.stringify({stamp,item,rentals,results},null,2));await pool.end();if(results.some(r=>!r.pass))process.exitCode=1;
});
