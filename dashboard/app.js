const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const API_BASE=$('meta[name="dashboard-api"]').content;
const catalog={
  gpu:{label:"RTX 5090",target:3499,icon:"fa-microchip"},
  macbook:{label:"MacBook",target:699,icon:"fa-laptop"},
  ram:{label:"DDR5 RAM",target:199,icon:"fa-memory"}
};
const state={category:"gpu",market:null,deals:[],dealFilter:"all",improvement:[],limit:3};
let marketChart,improvementChart,toastTimer;

const money=(n,currency="USD")=>new Intl.NumberFormat("en-US",{style:"currency",currency,maximumFractionDigits:n<1000?2:0}).format(n);
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const safeUrl=value=>{try{const url=new URL(value);return["http:","https:"].includes(url.protocol)?url.href:"#"}catch{return"#"}};
const relativeTime=value=>{const minutes=Math.max(0,Math.round((Date.now()-new Date(value))/60000));return minutes<1?"just now":minutes<60?`${minutes} min ago`:`${Math.round(minutes/60)}h ago`};
const sourceNote=row=>`${row.source_name} · ${row.collection_method==="scraped"?"scraped via Apify":"official API"}`;
const showToast=message=>{const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2600)};

async function api(path){
  const response=await fetch(`${API_BASE}${path}`,{headers:{"Accept":"application/json"}});
  const payload=await response.json();
  if(!response.ok)throw new Error(payload.error||`API ${response.status}`);
  return payload;
}

function showPage(id){
  const page=$(`#${id}-page`);
  if(!page)return;
  $$(".page").forEach(el=>el.classList.toggle("active",el===page));
  $$(".nav-link[data-page]").forEach(el=>el.classList.toggle("active",el.dataset.page===id));
  $(".rail").classList.remove("open");
  window.scrollTo({top:0,behavior:"smooth"});
  history.replaceState(null,"",`#${id}`);
  if(id==="dashboard")setTimeout(()=>marketChart?.resize(),0);
  if(id==="leaderboard")setTimeout(()=>improvementChart?.resize(),0);
}

function renderListingRows(rows){
  if(!rows.length){
    $("#listing-list").innerHTML='<div class="empty-state"><i class="fa-solid fa-database"></i><strong>No live listings yet</strong><small>Run the marketplace ingester, then refresh.</small></div>';
    return;
  }
  $("#listing-list").innerHTML=rows.slice(0,3).map(row=>`
    <a class="listing" href="${safeUrl(row.listing_url)}" target="_blank" rel="noreferrer">
      ${row.image_url?`<img class="listing-image" src="${safeUrl(row.image_url)}" alt="">`:`<span class="listing-icon"><i class="fa-solid ${catalog[row.category].icon}"></i></span>`}
      <div><strong>${esc(row.title)}</strong><small>${esc(sourceNote(row))}</small></div>
      <div class="listing-price"><b>${money(row.total_price,row.currency)}</b><span class="source-tag">open listing</span></div>
    </a>`).join("");
}

function renderMarketChart(rows){
  const shown=rows.slice(0,state.limit), target=+$("#target-price").value, product=catalog[state.category];
  marketChart?.destroy();
  marketChart=new Chart($("#price-chart"),{type:"line",data:{
    labels:shown.map((row,index)=>`${row.source_name} ${index+1}`),
    datasets:[
      {label:"Live listing",data:shown.map(row=>row.total_price),borderColor:"#171711",backgroundColor:"#28754c",borderWidth:2,pointRadius:4,pointHoverRadius:6,tension:.2},
      {label:"Your target",data:shown.map(()=>target),borderColor:"#a64c3c",borderDash:[4,4],borderWidth:1,pointRadius:0}
    ]
  },options:{animation:false,responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:"index"},plugins:{
    legend:{display:false},
    tooltip:{backgroundColor:"#171711",titleFont:{family:"DM Mono"},bodyFont:{family:"DM Sans"},callbacks:{
      title:items=>shown[items[0].dataIndex]?.title||product.label,
      label:context=>`${context.dataset.label}: ${money(context.parsed.y)}`
    }}
  },scales:{
    x:{grid:{display:false},ticks:{font:{family:"DM Mono",size:9},color:"#77736a"}},
    y:{grid:{color:"#ded8cc"},ticks:{callback:value=>money(value),font:{family:"DM Mono",size:9},color:"#77736a"}}
  }}});
}

function renderMarket(payload){
  state.market=payload;
  const rows=payload.listings, meta=payload.meta, product=catalog[state.category], target=+$("#target-price").value;
  const prices=rows.map(row=>row.total_price), best=prices.length?Math.min(...prices):null, max=prices.length?Math.max(...prices):null;
  $("#data-badge").innerHTML='<i class="fa-solid fa-database"></i> Live Supabase';
  $("#sync-status").innerHTML=`<span class="live-dot"></span> Hosted Supabase refreshed <strong>${relativeTime(meta.last_synced_at)}</strong>`;
  $("#chart-title").textContent=`${product.label} current price spread`;
  $("#best-price").textContent=best==null?"—":money(best);
  $("#target-display").textContent=money(target);
  $("#range-display").textContent=best==null?"—":`${money(best)}–${money(max)}`;
  $("#live-listing-count").textContent=String(rows.length);
  $("#metric-listings").textContent=String(rows.length);
  $("#metric-sources").textContent=String(meta.source_count);
  $("#metric-source-names").textContent=meta.sources.join(", ")||"No live sources";
  $("#metric-syncs").textContent=String(meta.successful_syncs);
  $("#metric-last-sync").textContent=`Last sync ${relativeTime(meta.last_synced_at)}`;
  const buy=best!=null&&best<=target, difference=best==null?0:Math.abs(best-target);
  $("#decision-status").textContent=best==null?"NO DATA":buy?"BUY":"WAIT";
  $("#decision-status").className=`status ${buy?"buy":"wait"}`;
  $("#decision-copy").textContent=best==null?"No verified live price":buy?`${money(best)} is within target`:`Best price is ${money(difference)} above target`;
  renderListingRows(rows);
  renderMarketChart(rows);
}

async function loadMarket(category=state.category){
  state.category=category;
  $("#data-badge").innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Loading Supabase';
  try{
    const payload=await api(`/api/marketplace?category=${encodeURIComponent(category)}`);
    renderMarket(payload);
  }catch(error){
    $("#data-badge").innerHTML='<i class="fa-solid fa-triangle-exclamation"></i> API unavailable';
    $("#sync-status").innerHTML='<span class="error-dot"></span> Hosted Supabase connection failed';
    renderMarket({listings:[],meta:{last_synced_at:new Date().toISOString(),source_count:0,sources:[],successful_syncs:0}});
    showToast(error.message);
  }
}

function renderDeals(filter=state.dealFilter){
  state.dealFilter=filter;
  const rows=filter==="all"?state.deals:state.deals.filter(row=>row.category===filter);
  $("#deal-grid").innerHTML=rows.length?rows.map(row=>`
    <article class="deal-card">
      ${row.image_url?`<img class="deal-image" src="${safeUrl(row.image_url)}" alt="">`:`<i class="fa-solid ${catalog[row.category].icon}"></i>`}
      <div class="deal-meta"><span>${esc(row.category)}</span><span>${esc(row.source_name)}</span></div>
      <h2>${esc(row.title)}</h2>
      <footer><div><b>${money(row.total_price,row.currency)}</b><small>${esc(row.condition||"Condition unknown")} · ${esc(row.collection_method)}</small></div><a href="${safeUrl(row.listing_url)}" target="_blank" rel="noreferrer">Check listing <i class="fa-solid fa-arrow-right"></i></a></footer>
    </article>`).join(""):'<div class="empty-state wide"><strong>No live listings in this category.</strong></div>';
}

async function loadDeals(){
  try{
    const payload=await api("/api/marketplace?category=all");
    state.deals=payload.listings;
    renderDeals();
    $(".primary-nav [data-page='deals'] b").textContent=String(payload.listings.length);
  }catch(error){
    state.deals=[];
    renderDeals();
  }
}

const metricCell=(value,ci,format,trend)=>`<td class="${trend}"><b>${format(value)}</b><small>±${format(ci)}</small></td>`;
function trendClass(value,baseline,higherIsBetter){
  const delta=value-baseline;
  if(Math.abs(delta)<.0001)return"same";
  return(higherIsBetter?delta>0:delta<0)?"better":"worse";
}

function renderImprovement(payload){
  state.improvement=payload.runs;
  const runs=payload.runs, baseline=runs.find(run=>run.baseline)||runs.at(-1);
  $("#improvement-evidence").textContent=payload.evidence_status==="illustrative"?"Prototype evaluation history":"Measured verifier history";
  $("#benchmark-note").textContent=`95% confidence intervals · ${payload.evidence_status}`;
  $("#improvement-table").innerHTML=runs.map((run,index)=>{
    const movement=index===0?'<span class="movement up">↑ 1</span>':index===1?'<span class="movement down">↓ 1</span>':'<span class="movement">–</span>';
    return`<tr class="${run.current?"champion":""}">
      <td><span class="rank">${index+1}</span>${movement}</td>
      <td><strong>${esc(run.version)}${run.current?" (current)":""}</strong><small>${esc(run.label)}</small></td>
      ${metricCell(run.decision_quality,run.decision_ci,v=>v.toFixed(3),trendClass(run.decision_quality,baseline.decision_quality,true))}
      ${metricCell(run.landed_price_error,run.landed_ci,v=>`${v.toFixed(1)}%`,trendClass(run.landed_price_error,baseline.landed_price_error,false))}
      ${metricCell(run.latency,run.latency_ci,v=>`${v.toFixed(2)}s`,trendClass(run.latency,baseline.latency,false))}
      ${metricCell(run.valid_url_rate,run.url_ci,v=>`${v.toFixed(1)}%`,trendClass(run.valid_url_rate,baseline.valid_url_rate,true))}
      ${metricCell(run.unsupported_claims,run.claims_ci,v=>`${v.toFixed(2)}%`,trendClass(run.unsupported_claims,baseline.unsupported_claims,false))}
      ${metricCell(run.forecast_regret,run.regret_ci,v=>money(v),trendClass(run.forecast_regret,baseline.forecast_regret,false))}
    </tr>`;
  }).join("");

  const current=runs.find(run=>run.current)||runs[0], decisionGain=(current.decision_quality-baseline.decision_quality)/baseline.decision_quality*100;
  $("#improvement-summary").innerHTML=`
    <p class="eyebrow">Champion delta vs baseline</p>
    <strong>+${decisionGain.toFixed(1)}%</strong><span>decision quality</span>
    <dl><div><dt>Valid URLs</dt><dd>+${(current.valid_url_rate-baseline.valid_url_rate).toFixed(1)} pts</dd></div><div><dt>Unsupported claims</dt><dd>−${(baseline.unsupported_claims-current.unsupported_claims).toFixed(2)} pts</dd></div><div><dt>Forecast regret</dt><dd>−${money(baseline.forecast_regret-current.forecast_regret)}</dd></div></dl>
    <small>${esc(payload.note)}</small>`;
  renderImprovementChart(runs);
}

function renderImprovementChart(runs){
  const ordered=[...runs].reverse();
  improvementChart?.destroy();
  improvementChart=new Chart($("#improvement-chart"),{type:"line",data:{labels:ordered.map(run=>run.version),datasets:[
    {label:"Decision quality",data:ordered.map(run=>run.decision_quality),yAxisID:"quality",stepped:"after",borderColor:"#e84c6a",backgroundColor:"#e84c6a",pointRadius:5,borderWidth:3},
    {label:"Forecast regret",data:ordered.map(run=>run.forecast_regret),yAxisID:"regret",borderColor:"#77736a",backgroundColor:"#77736a",borderDash:[4,4],pointRadius:3,borderWidth:1.5}
  ]},options:{animation:false,responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom",labels:{boxWidth:14,font:{family:"DM Sans",size:11}}}},scales:{
    x:{grid:{display:false},ticks:{font:{family:"DM Mono",size:10}}},
    quality:{position:"left",min:.60,max:.80,title:{display:true,text:"Decision quality"},ticks:{font:{family:"DM Mono",size:9}},grid:{color:"#ded8cc"}},
    regret:{position:"right",min:40,max:100,title:{display:true,text:"Regret (USD)"},ticks:{callback:value=>money(value),font:{family:"DM Mono",size:9}},grid:{display:false}}
  }}});
}

async function loadImprovement(){
  try{renderImprovement(await api("/api/improvement"))}
  catch(error){
    $("#improvement-table").innerHTML=`<tr><td colspan="8">Evaluation API unavailable: ${esc(error.message)}</td></tr>`;
    $("#improvement-summary").innerHTML="<strong>No evaluation history</strong><p>Start the dashboard API and refresh.</p>";
  }
}

$$("[data-page]").forEach(el=>el.addEventListener("click",()=>showPage(el.dataset.page)));
$("#mobile-menu").addEventListener("click",()=>$(".rail").classList.toggle("open"));
$("#theme-button").addEventListener("click",()=>document.body.classList.toggle("high-contrast"));
$("#alerts-button").addEventListener("click",()=>showToast("3 local target alerts are configured."));
$("#product-select").addEventListener("change",event=>{$("#target-price").value=catalog[event.target.value].target;loadMarket(event.target.value)});
$("#watch-form").addEventListener("submit",event=>{event.preventDefault();renderMarket(state.market);showToast("Target updated locally. Sign-in is required before saving a Supabase watchlist.")});
$$(".segmented button").forEach(el=>el.addEventListener("click",()=>{$$(".segmented button").forEach(button=>button.classList.toggle("active",button===el));state.limit=+el.dataset.range;renderMarketChart(state.market?.listings||[])}));
$$(".filter-chip").forEach(el=>el.addEventListener("click",()=>{$$(".filter-chip").forEach(button=>button.classList.toggle("active",button===el));renderDeals(el.dataset.filter)}));
$("#benchmark-select").addEventListener("change",event=>$("#benchmark-label").textContent=event.target.value);
$("#run-evaluation").addEventListener("click",async event=>{event.currentTarget.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Refreshing';await loadImprovement();event.currentTarget.innerHTML='<i class="fa-solid fa-check"></i> History refreshed';showToast("Evaluation history refreshed. No policy was changed.")});
$(".toggle").addEventListener("click",event=>event.currentTarget.classList.toggle("active"));
window.addEventListener("hashchange",()=>showPage(location.hash.slice(1)||"dashboard"));

Promise.allSettled([loadMarket(),loadDeals(),loadImprovement()]);
showPage(location.hash.slice(1)||"dashboard");
