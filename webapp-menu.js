"use strict";(()=>{const $=id=>document.getElementById(id);const sections={dashboard:[],budget:["budgetForm","categoryBudgetForm"],planning:["extraFeatures"],goals:["savingsForm"],bills:["billsForm"],transactions:["transactionsList"],bank:["browserBankConnect"],alerts:["checkAlert"],support:["supportForm"]};
const cards=Array.from(document.querySelectorAll("main .web-card")).filter(x=>x.id!=="appMenu");
const findCard=id=>$(id)?.closest(".web-card");
const pages={dashboard:cards.filter(x=>x.querySelector(".metric")),budget:[findCard("budgetForm"),findCard("categoryBudgetForm")],planning:[findCard("extraFeatures")],goals:[findCard("savingsForm")],bills:[findCard("billsForm")],transactions:[findCard("transactionsList")],bank:[findCard("browserBankConnect"),findCard("bankStatus")],alerts:[findCard("checkAlert")],support:[findCard("supportForm")]};
const known=new Set(Object.values(pages).flat().filter(Boolean));
function show(name){const selected=pages[name]?name:"dashboard";for(const c of cards)c.classList.toggle("web-page-hidden",!pages[selected].includes(c));for(const b of document.querySelectorAll("[data-page]"))b.setAttribute("aria-current",b.dataset.page===selected?"page":"false");history.replaceState(null,"","#"+selected);}
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>show(b.dataset.page)));
$("bankCheck").addEventListener("click",async()=>{try{const r=await request("/bank-connect/status");$("bankBrowserStatus").textContent=!r.allowed?"Bankkoppeling vereist een geschikt abonnement.":!r.configured?"De bankprovider is nog niet ingesteld.":"Bankprovider beschikbaar. De toestemming en bankselectie via de browser zijn nog niet aangesloten; gebruik voorlopig de Android-app.";}catch(e){$("bankBrowserStatus").textContent="Status niet beschikbaar: "+e.message;}});
request("/me").then(r=>{const role=r.user?.role;$("webAdminLink").hidden=!["owner","moderator"].includes(role);}).catch(()=>{});
show(location.hash.slice(1));})();
