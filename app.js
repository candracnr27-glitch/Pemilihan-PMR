let selectedCandidate=null;

function show(id){
  document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  if(id==="vote") loadCandidates();
}
async function api(url,opt={}){const r=await fetch(url,{headers:{"Content-Type":"application/json"},...opt});const d=await r.json();if(!r.ok)throw new Error(d.error||"Terjadi kesalahan");return d}

async function loadCandidates(){
  const data=await api("/api/candidates");
  document.getElementById("candidates").innerHTML=data.map(c=>`
  <div class="candidate" onclick='choose(${JSON.stringify(c)})'>
    <div class="num">${String(c.number).padStart(2,"0")}</div>
    <h3>${esc(c.name)}</h3><b>${esc(c.class_name)}</b>
    <p><strong>Visi:</strong> ${esc(c.vision)}</p><p><strong>Misi:</strong> ${esc(c.mission)}</p>
  </div>`).join("");
}
async function loginVoter(){
 try{const d=await api("/api/login-voter",{method:"POST",body:JSON.stringify({nis:document.getElementById("nis").value})});
 document.getElementById("loginBox").hidden=true;document.getElementById("candidateBox").hidden=false;document.getElementById("welcome").textContent=`Selamat datang, ${d.name}. Pilih satu kandidat.`;loadCandidates();}
 catch(e){document.getElementById("loginMsg").textContent=e.message}
}
function choose(c){selectedCandidate=c;document.getElementById("confirmText").textContent=`Anda memilih nomor ${c.number} — ${c.name}. Pilihan tidak dapat diubah setelah dikirim.`;document.getElementById("modal").hidden=false}
function closeModal(){document.getElementById("modal").hidden=true}
async function submitVote(){
 try{await api("/api/vote",{method:"POST",body:JSON.stringify({candidateId:selectedCandidate.id})});closeModal();alert("Suara berhasil disimpan. Terima kasih sudah memilih!");location.reload();}
 catch(e){alert(e.message)}
}
async function adminLogin(){
 try{await api("/api/admin/login",{method:"POST",body:JSON.stringify({username:adminUser.value,password:adminPass.value})});adminLogin.hidden=true;document.getElementById("adminLogin").hidden=true;document.getElementById("dashboard").hidden=false;loadDashboard();}
 catch(e){adminMsg.textContent=e.message}
}
async function loadDashboard(){
 const s=await api("/api/admin/stats");sTotal.textContent=s.total;sVoted.textContent=s.voted;sNot.textContent=s.notVoted;
 const max=Math.max(...s.candidates.map(x=>x.votes),1);
 results.innerHTML=s.candidates.map(c=>`<div class="bar"><div class="bar-top"><span>${c.number}. ${esc(c.name)}</span><b>${c.votes}</b></div><div class="track"><div class="fill" style="width:${c.votes/max*100}%"></div></div></div>`).join("");
 const vs=await api("/api/admin/voters");
 voters.innerHTML=vs.map(v=>`<div class="voter-row"><span>${esc(v.nis)} — ${esc(v.name)}</span><span class="${v.voted?'voted':''}">${v.voted?'Sudah memilih':'Belum'}</span></div>`).join("");
}
async function addVoter(){
 try{await api("/api/admin/voters",{method:"POST",body:JSON.stringify({nis:newNis.value,name:newName.value})});newNis.value="";newName.value="";loadDashboard();}
 catch(e){alert(e.message)}
}
async function addCandidate(){
 try{await api("/api/admin/candidates",{method:"POST",body:JSON.stringify({number:cNum.value,name:cName.value,class_name:cClass.value,vision:cVision.value,mission:cMission.value})});alert("Kandidat ditambahkan");location.reload();}
 catch(e){alert(e.message)}
}
async function resetVoting(){
 if(!confirm("Yakin menghapus SEMUA suara dan membuka voting kembali?"))return;
 await api("/api/admin/reset-voting",{method:"POST"});loadDashboard();alert("Voting berhasil di-reset.");
}
async function adminLogout(){await api("/api/admin/logout",{method:"POST"});location.reload()}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
loadCandidates();
