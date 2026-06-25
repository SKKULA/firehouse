/* Firehouse popup — same app as the website, but auth runs through the
   background service worker (chrome.identity) and the session lives in
   chrome.storage so it survives the popup closing during sign-in. */

const SUPABASE_URL      = 'https://vicfnkbsrcmemhffuqyq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__ouGswb_yT67VCufAJY-Zg_KVw5b_tv';
const ALLOWED_DOMAIN    = 'kula.ai';
const ADMIN_EMAILS      = ['saikausik@kula.ai'];

const SHIFT_HOURS = 9, BREAK_HOURS = 1;
const TARGET_SECONDS = (SHIFT_HOURS - BREAK_HOURS) * 3600;
const TYPES = {
  issue:{label:'New ticket triage/troubleshooting',cls:'issue'}, call:{label:'Customer call',cls:'call'},
  offline:{label:'Pylon Clean up',cls:'offline'}, project:{label:'Project',cls:'project'},
  demo:{label:'Demo / implementation call',cls:'demo'},
  troubleshoot:{label:'Ticket troubleshooting',cls:'troubleshoot'},
  intoffline:{label:'Internal offline work with engineering',cls:'intoffline'},
  followup:{label:'Ticket follow up',cls:'followup'},
  linear:{label:'Linear clean up',cls:'linear'},
  oncall:{label:'On call sync',cls:'oncall'},
  closure:{label:'Ticket closure',cls:'closure'},
};

// chrome.storage-backed adapter — must match background.js so they share one session.
const chromeStorageAdapter = {
  getItem: (key) => chrome.storage.local.get(key).then((r) => r[key] ?? null),
  setItem: (key, value) => chrome.storage.local.set({ [key]: value }),
  removeItem: (key) => chrome.storage.local.remove(key),
};
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: chromeStorageAdapter, persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, flowType:'pkce' },
});

const $ = (id) => document.getElementById(id);
let currentUser = null, currentName = null, isAdmin = false;
let entriesCache = [], timer = null, startTs = null, booted = false;

/* ---------- Data ---------- */
function loadEntries(){ return entriesCache; }
async function refreshEntries(){
  const { data, error } = await sb.from('entries').select('*').order('start_ts', {ascending:false});
  if(error){ console.error(error); return; }
  entriesCache = data.map(r=>({ id:r.id, user:r.user_email, name:r.user_name, type:r.type, customer:r.customer,
    note:r.note, start:Number(r.start_ts), end:Number(r.end_ts), seconds:r.seconds, manual:r.manual }));
}
async function addEntry(e){
  const { error } = await sb.from('entries').insert({ user_email:currentUser, user_name:currentName, type:e.type,
    customer:e.customer, note:e.note, start_ts:e.start, end_ts:e.end, seconds:e.seconds, manual:!!e.manual });
  if(error){ alert('Could not save: '+error.message); return false; }
  await refreshEntries(); return true;
}
async function delEntryRemote(id){
  const { error } = await sb.from('entries').delete().eq('id', id);
  if(error){ alert('Could not delete: '+error.message); return; }
  await refreshEntries();
}

/* ---------- Auth (via background worker) ---------- */
function showLoginError(msg){ const b=$('loginError'); b.textContent=msg; b.classList.remove('hidden'); }
async function signIn(){
  const btn = $('signInBtn'); btn.disabled = true;
  $('loginHint').textContent = 'Opening Google… complete sign-in in the window that appears.';
  try {
    const res = await chrome.runtime.sendMessage({ type:'signin' });
    if(res && res.ok){ location.reload(); }
    else { btn.disabled=false; showLoginError(res && res.error ? res.error : 'Sign-in failed. Try again.'); }
  } catch(err){
    btn.disabled=false; showLoginError('Sign-in failed: '+(err && err.message || err));
  }
}
async function signOut(){
  if(timer){ if(!confirm('A timer is running. Sign out and discard it?')) return; cancelTimer(); }
  try { await chrome.runtime.sendMessage({ type:'signout' }); } catch(e){}
  await sb.auth.signOut().catch(()=>{});
  location.reload();
}
async function handleSession(session){
  if(!session){ showView('login'); return; }
  const email = (session.user.email||'').toLowerCase();
  if(!email.endsWith('@'+ALLOWED_DOMAIN)){
    await sb.auth.signOut().catch(()=>{});
    showView('login'); showLoginError(`Access is limited to @${ALLOWED_DOMAIN} accounts. ${email} is not allowed.`);
    return;
  }
  if(booted) return; booted = true;
  currentUser = email;
  currentName = (session.user.user_metadata && (session.user.user_metadata.full_name || session.user.user_metadata.name)) || email.split('@')[0];
  isAdmin = ADMIN_EMAILS.map(s=>s.toLowerCase()).includes(email);
  $('whoAvatar').textContent = currentName.trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
  $('whoAvatar').title = currentName;
  $('tabAdmin').classList.toggle('hidden', !isAdmin);
  showView('app'); showTab('track');
  await restoreRunning();
  try { await refreshEntries(); showTab('track'); }
  catch(err){ console.error(err); alert('Signed in, but could not load entries: '+(err && err.message)); }
}
function showView(v){
  $('loginView').classList.toggle('hidden', v!=='login');
  $('loadingView').classList.toggle('hidden', v!=='loading');
  $('appView').classList.toggle('hidden', v!=='app');
}

/* ---------- Timer (persists across popup close) ---------- */
const RUN_KEY = 'firehouse_running';
function persistRunning(){
  chrome.storage.local.set({ [RUN_KEY]: { startTs, type:$('activityType').value, customer:$('customer').value, note:$('note').value } });
}
function clearRunning(){ chrome.storage.local.remove(RUN_KEY); }
function showRunningUI(type, customer){
  $('startBtn').classList.add('hidden'); $('stopBtn').classList.remove('hidden'); $('cancelBtn').classList.remove('hidden');
  $('timerDisplay').classList.add('live'); lockInputs(true);
  const meta=$('liveMeta'); meta.classList.remove('hidden'); meta.textContent = `${TYPES[type].label} • ${customer}`;
  tick(); timer = setInterval(tick, 1000);
}
async function restoreRunning(){
  const r = (await chrome.storage.local.get(RUN_KEY))[RUN_KEY];
  if(!r || !r.startTs) return;
  $('activityType').value = r.type; $('customer').value = r.customer||''; $('note').value = r.note||'';
  startTs = r.startTs;
  showRunningUI(r.type, r.customer||'');
}
function startTimer(){
  const customer = $('customer').value.trim();
  const type = $('activityType').value;
  if(!customer){ alert('Please enter the customer this activity is for.'); $('customer').focus(); return; }
  startTs = Date.now();
  persistRunning();
  showRunningUI(type, customer);
}
function tick(){ $('timerDisplay').textContent = fmt(Date.now()-startTs); }
async function stopTimer(){
  const elapsed = Date.now() - startTs;
  const ok = await addEntry({ type:$('activityType').value, customer:$('customer').value.trim(),
    note:$('note').value.trim(), start:startTs, end:Date.now(), seconds:Math.round(elapsed/1000) });
  if(ok){ resetTimer(); renderToday(); fireBurst('Logged'); }
}
function cancelTimer(){ resetTimer(); }
function resetTimer(){
  clearRunning();
  if(timer){ clearInterval(timer); timer=null; } startTs=null;
  $('timerDisplay').textContent='00:00:00'; $('timerDisplay').classList.remove('live');
  $('startBtn').classList.remove('hidden'); $('stopBtn').classList.add('hidden'); $('cancelBtn').classList.add('hidden');
  $('liveMeta').classList.add('hidden'); $('customer').value=''; $('note').value=''; lockInputs(false);
}
function lockInputs(on){ ['activityType','customer','note'].forEach(id=>$(id).disabled=on); }
function updateCustomerLabel(){
  const t=$('activityType').value;
  $('customerLabel').textContent = (t==='offline'||t==='project') ? 'Customer (or "Internal")' : 'Customer';
}

/* ---------- Manual ---------- */
function toggleManual(){
  const f=$('manualForm'); const open = f.classList.toggle('hidden') === false;
  $('manualToggle').textContent = open ? '− Hide' : '+ Add entry';
  if(open && !$('mDate').value) $('mDate').value = dayKey(Date.now());
}
async function saveManual(){
  const date=$('mDate').value, amount=parseFloat($('mAmount').value), unit=$('mUnit').value, customer=$('mCustomer').value.trim();
  if(!date){ alert('Please pick a date.'); return; }
  if(!amount || amount<=0){ alert('Please enter how much time you spent.'); return; }
  if(!customer){ alert('Please enter the customer this activity is for.'); return; }
  const s = new Date(`${date}T12:00`).getTime(); const seconds = Math.round(amount*(unit==='hours'?3600:60));
  const ok = await addEntry({ type:$('mType').value, customer, note:$('mNote').value.trim(), start:s, end:s+seconds*1000, seconds, manual:true });
  if(ok){ ['mAmount','mCustomer','mNote'].forEach(id=>$(id).value=''); renderToday(); fireBurst('Logged'); }
}

/* ---------- Fire confirmation ---------- */
function fireBurst(msg){
  const f=document.createElement('div'); f.className='fire-burst'; f.textContent='🔥';
  document.body.appendChild(f); setTimeout(()=>f.remove(), 1200);
  if(msg){ const t=document.createElement('div'); t.className='fire-toast'; t.textContent=msg;
    document.body.appendChild(t); setTimeout(()=>t.remove(), 1700); }
}

/* ---------- Formatting ---------- */
function fmt(ms){ const s=Math.floor(ms/1000); return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function fmtDur(seconds){ const h=Math.floor(seconds/3600), m=Math.floor((seconds%3600)/60); if(h>0)return `${h}h ${m}m`; if(m>0)return `${m}m`; return `${seconds}s`; }
function fmtHM(seconds){ const h=Math.floor(seconds/3600), m=Math.round((seconds%3600)/60); return `${h}h ${String(m).padStart(2,'0')}m`; }
function isToday(ts){ const d=new Date(ts), n=new Date(); return d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth()&&d.getDate()===n.getDate(); }
function fmtTime(ts){ return new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }
function fmtDate(ts){ return new Date(ts).toLocaleDateString([], {month:'short',day:'numeric'}); }
function dayKey(ts){ const d=new Date(ts); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function dayLabel(ts){ return new Date(ts).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:'numeric'}); }

/* ---------- Tabs ---------- */
function showTab(tab){
  if(tab==='admin' && !isAdmin) return;
  ['track','history','admin'].forEach(t=>{
    $(t+'Tab').classList.toggle('hidden', t!==tab);
    $('tab'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('active', t===tab);
  });
  if(tab==='track') renderToday();
  if(tab==='history') renderHistory();
  if(tab==='admin') renderAdmin();
}

/* ---------- Today ---------- */
function renderToday(){
  const mine = loadEntries().filter(e=>e.user===currentUser && isToday(e.start));
  const total = mine.reduce((a,e)=>a+e.seconds,0);
  const byType={}; mine.forEach(e=>byType[e.type]=(byType[e.type]||0)+e.seconds);
  const topType = Object.entries(byType).sort((a,b)=>b[1]-a[1])[0];
  $('todayStats').innerHTML =
    `<div class="box"><div class="n">${fmtDur(total)}</div><div class="l">Today</div></div>`+
    `<div class="box"><div class="n">${mine.length}</div><div class="l">Entries</div></div>`+
    `<div class="box"><div class="n">${topType?TYPES[topType[0]].label:'—'}</div><div class="l">Top activity</div></div>`;
}

/* ---------- History ---------- */
function renderHistory(){
  const mine = loadEntries().filter(e=>e.user===currentUser).sort((a,b)=>b.start-a.start);
  $('historyCount').textContent = `(${mine.length})`;
  if(mine.length===0){ $('historyTable').innerHTML='<div class="empty">No entries yet. Start a timer to log your first one.</div>'; return; }
  const days={}; mine.forEach(e=>{ const k=dayKey(e.start); (days[k]=days[k]||[]).push(e); });
  let out='';
  Object.keys(days).sort((a,b)=>b.localeCompare(a)).forEach(k=>{
    const list=days[k]; const dayTotal=list.reduce((a,e)=>a+e.seconds,0);
    const pct=Math.min(100, Math.round(dayTotal/TARGET_SECONDS*100));
    const met=dayTotal>=TARGET_SECONDS, remaining=TARGET_SECONDS-dayTotal;
    const col=met?'var(--ok)':(pct>=70?'var(--warn)':'var(--muted)');
    const status=met?`Target met (+${fmtHM(dayTotal-TARGET_SECONDS)})`:`${fmtHM(remaining)} short of ${SHIFT_HOURS-BREAK_HOURS}h`;
    const rows=list.map(e=>`
      <tr>
        <td>${e.manual?'<span class="muted">Manual</span>':fmtTime(e.start)+'–'+fmtTime(e.end)}</td>
        <td><span class="pill ${TYPES[e.type].cls}">${TYPES[e.type].label}</span></td>
        <td>${esc(e.customer)}</td>
        <td><b>${fmtDur(e.seconds)}</b></td>
        <td><button class="ghost small" data-del="${e.id}">✕</button></td>
      </tr>`).join('');
    out+=`
      <div class="card" style="background:var(--panel2); margin-bottom:12px; padding:14px">
        <div class="toolbar" style="margin-bottom:10px">
          <div><b>${dayLabel(list[0].start)}</b> <span class="muted small">· ${list.length} ${list.length===1?'entry':'entries'}</span></div>
          <div style="text-align:right">
            <div style="font-size:17px; font-weight:700">${fmtHM(dayTotal)} <span class="muted small">/ ${SHIFT_HOURS-BREAK_HOURS}h</span></div>
            <div class="small" style="color:${col}">${status}</div>
          </div>
        </div>
        <div style="height:6px; background:var(--line); border-radius:999px; overflow:hidden; margin-bottom:10px">
          <div style="height:100%; width:${pct}%; background:${col}"></div>
        </div>
        <table><thead><tr><th>Time</th><th>Type</th><th>Customer</th><th>Dur</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
  });
  $('historyTable').innerHTML = out;
}
async function delEntry(id){ if(!confirm('Delete this entry?')) return; await delEntryRemote(id); renderHistory(); }

/* ---------- Admin ---------- */
function onRangeChange(){ $('customRange').classList.toggle('hidden', $('adminRange').value!=='custom'); renderAdmin(); }
function startOfWeek(d){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setHours(0,0,0,0); x.setDate(x.getDate()-day); return x.getTime(); }
function rangeFilter(entries){
  const r = $('adminRange') ? $('adminRange').value : 'all';
  if(r==='all') return entries;
  if(r==='today') return entries.filter(e=>isToday(e.start));
  if(r==='week'){ const s=startOfWeek(new Date()); return entries.filter(e=>e.start>=s); }
  if(r==='custom'){
    const f=$('adminFrom').value, t=$('adminTo').value;
    const fs=f?new Date(f+'T00:00').getTime():-Infinity, ts=t?new Date(t+'T23:59:59').getTime():Infinity;
    return entries.filter(e=>e.start>=fs && e.start<=ts);
  }
  return entries;
}
function populateAgentFilter(){
  const sel = $('adminAgent'); if(!sel) return;
  const cur = sel.value;
  const names = [...new Set(loadEntries().map(e=>e.name||e.user))].sort((a,b)=>a.localeCompare(b));
  sel.innerHTML = '<option value="all">All agents</option>' + names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if([...sel.options].some(o=>o.value===cur)) sel.value = cur;
}
function renderAdmin(){
  if(!isAdmin) return;
  populateAgentFilter();
  let all = rangeFilter(loadEntries());
  const agent = $('adminAgent') ? $('adminAgent').value : 'all';
  if(agent!=='all') all = all.filter(e=>(e.name||e.user)===agent);
  const total=all.reduce((a,e)=>a+e.seconds,0);
  const agents=new Set(all.map(e=>e.name||e.user)), customers=new Set(all.map(e=>e.customer));
  $('adminStats').innerHTML=
    `<div class="box"><div class="n">${fmtDur(total)}</div><div class="l">Total</div></div>`+
    `<div class="box"><div class="n">${all.length}</div><div class="l">Entries</div></div>`+
    `<div class="box"><div class="n">${agents.size}</div><div class="l">Agents</div></div>`+
    `<div class="box"><div class="n">${customers.size}</div><div class="l">Customers</div></div>`;
  $('byAgent').innerHTML    = rollupTable(all, 'name',     'Agent');
  $('byCustomer').innerHTML = rollupTable(all, 'customer', 'Customer');
  $('byType').innerHTML     = rollupTable(all, 'type',     'Activity', true);
}
function rollupTable(all, key, header, isType){
  if(all.length===0) return '<div class="empty">No data in this range.</div>';
  const map={};
  all.forEach(e=>{ const k=e[key]||'—'; if(!map[k])map[k]={seconds:0,count:0}; map[k].seconds+=e.seconds; map[k].count++; });
  const sorted=Object.entries(map).sort((a,b)=>b[1].seconds-a[1].seconds);
  const max=sorted[0][1].seconds||1;
  const rows=sorted.map(([k,v])=>{
    const disp=isType?`<span class="pill ${TYPES[k].cls}">${TYPES[k].label}</span>`:esc(k);
    const pct=Math.round(v.seconds/max*100);
    return `<tr><td>${disp}</td><td>${v.count}</td>
      <td><div class="bar-wrap"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><b style="white-space:nowrap">${fmtDur(v.seconds)}</b></div></td></tr>`;
  }).join('');
  return `<table><thead><tr><th>${header}</th><th>#</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------- Export ---------- */
function exportCSV(scope){
  let data = loadEntries();
  if(scope==='mine') data=data.filter(e=>e.user===currentUser);
  if(scope==='all'){
    data=rangeFilter(data);
    const agent = $('adminAgent') ? $('adminAgent').value : 'all';
    if(agent!=='all') data = data.filter(e=>(e.name||e.user)===agent);
  }
  if(data.length===0){ alert('Nothing to export yet.'); return; }
  const head=['Agent','Email','Date','Type','Customer','Note','Seconds','Duration'];
  const lines=[head.join(',')];
  data.sort((a,b)=>b.start-a.start).forEach(e=>{
    lines.push([e.name||'', e.user, fmtDate(e.start), TYPES[e.type].label, e.customer, e.note, e.seconds, fmtDur(e.seconds)].map(csvCell).join(','));
  });
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`firehouse-${scope}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
}
function csvCell(v){ v=String(v??''); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }
function esc(s){ return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ---------- Wiring (no inline handlers allowed in extensions) ---------- */
$('signInBtn').addEventListener('click', signIn);
$('signOutBtn').addEventListener('click', signOut);
document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click', ()=>showTab(b.dataset.tab)));
$('activityType').addEventListener('change', updateCustomerLabel);
$('startBtn').addEventListener('click', startTimer);
$('stopBtn').addEventListener('click', stopTimer);
$('cancelBtn').addEventListener('click', cancelTimer);
$('manualToggle').addEventListener('click', toggleManual);
$('saveManualBtn').addEventListener('click', saveManual);
$('exportMine').addEventListener('click', ()=>exportCSV('mine'));
$('exportAll').addEventListener('click', ()=>exportCSV('all'));
$('adminRange').addEventListener('change', onRangeChange);
$('adminAgent').addEventListener('change', renderAdmin);
$('adminFrom').addEventListener('change', renderAdmin);
$('adminTo').addEventListener('change', renderAdmin);
document.querySelectorAll('.sec-title.collapsible').forEach(el=>el.addEventListener('click', ()=>{
  const d = $(el.dataset.target); const hidden = d.classList.toggle('hidden');
  const c = el.querySelector('.caret'); if(c) c.textContent = hidden ? '▸' : '▾';
}));
$('customer').addEventListener('keydown', e=>{ if(e.key==='Enter' && !timer) startTimer(); });
$('historyTable').addEventListener('click', e=>{ const b=e.target.closest('[data-del]'); if(b) delEntry(b.dataset.del); });

/* ---------- Boot ---------- */
showView('loading');
sb.auth.getSession()
  .then(({data})=>handleSession(data.session))
  .catch(err=>{ console.error('getSession failed', err); showView('login'); });
