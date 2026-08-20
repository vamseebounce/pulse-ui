/* Pulse — shared Supabase client, auth flow, and small helpers used by every page.
   2026-08-20 restructure: pulled out of the single index.html so Growth/Funnel/Admin
   pages don't each duplicate ~150 lines of auth boilerplate.
   Every page must include the Supabase UMD build (from cdn.jsdelivr.net) before this
   script, and have these elements in the DOM: #auth-screen, #auth-email, #auth-submit,
   #auth-form, #auth-sent, #auth-sent-email, #auth-msg, #pending-screen, #dash, #logout-btn.
   NOTE: never put a literal "</script>" (even inside a comment) in this file — if any
   page ever inlines this script instead of loading it via src=, the HTML parser closes
   the tag early at that exact text regardless of JS comment syntax. */

var SB_URL='https://clkfvmmlgwcvntxnolsv.supabase.co';
var ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2Z2bW1sZ3djdm50eG5vbHN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDQ2NTgsImV4cCI6MjA5MDEyMDY1OH0.FA33GFQisWX_hDeGCWqL5yAZmPcuQRdxZX32I23lyoY';
var sbClient=supabase.createClient(SB_URL,ANON_KEY,{auth:{persistSession:true,storageKey:'pulse_session',autoRefreshToken:true}});
var sbTasks=sbClient.schema('tasks');

/* ---- small formatting helpers, shared across every page ---- */
function nz(v,dp){
  if(v===null||v===undefined)return '—';
  if(dp!==undefined)return Number(v).toFixed(dp);
  var n=Number(v);
  if(isNaN(n))return v;
  return Math.abs(n)>=1000&&Number.isInteger(n)?n.toLocaleString('en-IN'):String(n);
}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function fmtDate(iso){if(!iso)return '—';var d=new Date(iso);return d.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}
function fmtDateOnly(iso){if(!iso)return '—';var d=new Date(iso+'T00:00:00Z');return d.toLocaleDateString('en-IN',{timeZone:'UTC',day:'numeric',month:'short'});}

function showEl(id){document.getElementById(id).style.display='';}
function hideEl(id){document.getElementById(id).style.display='none';}
function showAuthScreen(){document.getElementById('auth-screen').style.display='flex';hideEl('pending-screen');document.getElementById('dash').style.display='none';}
function showPendingScreen(){hideEl('auth-screen');document.getElementById('pending-screen').style.display='flex';document.getElementById('dash').style.display='none';}
function showDash(){hideEl('auth-screen');hideEl('pending-screen');document.getElementById('dash').style.display='block';}

async function sendMagicLink(){
  var email=document.getElementById('auth-email').value.trim().toLowerCase();
  var msg=document.getElementById('auth-msg');
  var btn=document.getElementById('auth-submit');
  if(!email){msg.textContent='Please enter your email.';return;}
  btn.disabled=true;btn.textContent='Sending…';msg.textContent='';
  var res=await sbClient.auth.signInWithOtp({email:email,options:{emailRedirectTo:window.location.origin}});
  btn.disabled=false;btn.textContent='Send magic link';
  if(res.error){msg.textContent=res.error.message||'Failed to send link. Try again.';}
  else{
    document.getElementById('auth-form').style.display='none';
    document.getElementById('auth-sent').style.display='block';
    document.getElementById('auth-sent-email').textContent=email;
  }
}

async function signOut(){await sbClient.auth.signOut();var b=document.getElementById('logout-btn');if(b)b.style.display='none';showAuthScreen();}

/* Wires the auth-email Enter-key handler; each page calls this once its DOM is ready. */
function initAuthFormHandlers(){
  var emailEl=document.getElementById('auth-email');
  if(emailEl)emailEl.addEventListener('keydown',function(e){if(e.key==='Enter')sendMagicLink();});
}

/* Bootstraps the whole auth lifecycle for a page. onReady(session) is called once the
   user is signed in AND is a member (tasks.is_member() true) — i.e. once it's safe to
   load page-specific dashboard data. Every page's own <script> just calls:
     initPulseAuth(function(session){ ...load this page's data... });
*/
function initPulseAuth(onReady){
  initAuthFormHandlers();
  async function onSignedIn(session){
    var logoutBtn=document.getElementById('logout-btn');
    if(logoutBtn)logoutBtn.style.display='block';
    var {data,error}=await sbTasks.rpc('is_member');
    if(error||!data){showPendingScreen();return;}
    showDash();
    onReady(session);
  }
  (async function(){
    var {data:{session}}=await sbClient.auth.getSession();
    if(session){await onSignedIn(session);} else {showAuthScreen();}
    sbClient.auth.onAuthStateChange(async function(event,session){
      if(event==='SIGNED_IN'&&session){await onSignedIn(session);}
      else if(event==='SIGNED_OUT'){var b=document.getElementById('logout-btn');if(b)b.style.display='none';showAuthScreen();}
    });
  })();
}
