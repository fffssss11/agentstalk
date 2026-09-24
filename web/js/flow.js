'use strict';
// Task flow (dispatch → execute → independent review → integration) and the records view.
let flowKey='', recordsKey='', recordsMode='full';
const recordsOpen=new Map();

function renderDispatches() {
  const box=$('workflow-dispatch');if(!box||!state||state.session.id!==selected)return;
  const history=dispatchHistory.get(selected), events=dispatchEvents().slice(0,8);
  const html=events.map(e=>{
    const live=connected&&state.session.status==='active'&&history?.live.has(e.id), elapsed=live?Math.min(4.2,(Date.now()-history.live.get(e.id))/1000):0;
    return `<article class="dispatch-event" data-dispatch-id="${esc(e.id)}" data-live="${!!live}" style="--elapsed:-${elapsed.toFixed(1)}s"><div class="dispatch-route"><span class="dispatch-person" title="${esc(instanceLabel(e.from))}">${avatar(e.from,'sm')}<strong>${esc(name(e.from))}${isExtraInstance(e.from)?`<small>${esc(e.from)}</small>`:''}</strong></span><span class="dispatch-wire" aria-hidden="true">${icon('arrow','xs')}</span><span class="dispatch-person" title="${esc(instanceLabel(e.to))}">${avatar(e.to,'sm')}<strong>${esc(name(e.to))}${isExtraInstance(e.to)?`<small>${esc(e.to)}</small>`:''}</strong></span><span class="sp"></span><small>${e.type==='reassign'?'转交':'派发'}</small></div><button class="dispatch-task" type="button" data-flow-target="${esc(e.task)}" title="${esc(e.body)}"><span>${esc(e.task)}</span>${esc(e.title)}</button><time datetime="${esc(e.ts)}">${esc(stamp(e.ts))}</time></article>`;
  }).join('');
  // Animation delay belongs to the original arrival, never to a poll or view switch.
  keyedCards(box,html,'data-dispatch-id');
  $('dispatch-empty').hidden=events.length>0;
  $('dispatch-live-label').textContent=connected?'已同步 · 最近 '+events.length+' 次派发':'连接中断 · 保留已有记录';
}
function renderWorkflowTree() {
  const tasks=state.tasks, byId=new Map(tasks.map(t=>[t.id,t])), level=new Map(), remaining=new Map(byId);
  // Each task appears once; dependency links connect fan-in/fan-out across levels.
  // Old or damaged graphs remain visible without recursive traversal.
  while(remaining.size) {
    let changed=false;
    for(const [id,t] of remaining) {
      const deps=t.depends_on||[];
      if(deps.every(d=>level.has(d))) {level.set(id,deps.length?Math.max(...deps.map(d=>level.get(d)))+1:0);remaining.delete(id);changed=true;}
    }
    if(!changed)break;
  }
  const search=$('workflow-search').value.trim().toLocaleLowerCase();
  const matches=t=>[t.id,t.title,t.body,t.from,name(t.from),t.owner,name(t.owner),t.reviewer,name(t.reviewer),t.integration_plan].join(' ').toLocaleLowerCase().includes(search);
  const visible=tasks.filter(matches), expanded=new Set([...$('workflow-tree').querySelectorAll('details[open]')].map(n=>n.dataset.evidence));
  $('workflow-meta').textContent=`派发 → 执行 → 独立验收 → 整合 · ${tasks.length} 项任务 · ${tasks.filter(t=>t.state==='已完成').length} 项验收通过${search?' · 匹配 '+visible.length+' 项':''} · 悬停查看上下游`;
  function member(id) {return id?`<span class="flow-person" title="${esc(instanceLabel(id))}">${avatar(id,'sm')}<span>${esc(name(id))}${isExtraInstance(id)?`<small>${esc(id)}</small>`:''}${state.agents[id]?.model?`<small>标注 ${esc(state.agents[id].model)}</small>`:''}</span></span>`:'<span class="unspecified">未指定</span>';}
  function link(id) {return `<button type="button" class="dependency-link" data-flow-target="${esc(id)}">${esc(id)}</button>`;}
  function card(t) {
    const logs=t.log||[],review=[...logs].reverse().find(e=>e.type==='review'),done=[...logs].reverse().find(e=>e.type==='done');
    const reassign=[...logs].reverse().find(e=>e.type==='reassign');
    const integrations=tasks.filter(n=>n.stage==='integration'&&(n.depends_on||[]).includes(t.id));
    const currentReview=review&&t.state==='已完成'&&review.verdict==='pass';
    const deps=t.depends_on||[], waiting=t.waiting_for||[];
    const record=[{from:t.from,body:t.body,id:t.source_id,type:'task',...(t.initial_workflow||{})},...logs].filter(e=>['task','workflow','reassign','done','review','blocked'].includes(e.type));
    return `<article class="flow-task ${t.stage==='integration'?'integration-task':''}" data-flow-task="${esc(t.id)}" data-deps="${esc(deps.join(','))}" tabindex="-1" data-state="${esc(t.state)}"><header><span class="mono">${esc(t.id)}</span><span>· ${t.stage==='integration'?'整合':'执行'}</span><span class="flow-state badge ${taskBadge(t.state)}">${esc(t.state)}</span></header><h3>${esc(t.title)}</h3><div class="flow-task-activity"></div><div class="flow-assignment"><div><small>原始派发</small>${member(t.from)}</div><span class="arrow" aria-hidden="true">${icon('arrow','xs')}</span><div><small>当前执行${reassign?' · 已转交':''}</small>${member(t.owner)}</div><span class="arrow" aria-hidden="true">${icon('arrow','xs')}</span><div><small>预定验收</small>${member(t.reviewer)}</div></div><div class="flow-review"><strong>${currentReview?'验收通过':review?'最近审查记录':'尚无审查记录'}</strong>${review?`<span>${esc(name(review.from))} · ${review.verdict==='pass'?'通过':'退回'}${!currentReview?' · 以当前任务状态为准':''}</span>`:'<span>等待执行交付与独立审查</span>'}</div>${deps.length?`<div class="flow-dependencies"><small>前置交付</small>${deps.map(link).join('')}<p>${waiting.length?'尚待验收：'+esc(waiting.join('、')):'前置交付均已验收通过'}</p></div>`:''}<div class="flow-integration"><small>${t.stage==='integration'?'整合方式与最终交付':'后续整合'}</small><p>${t.integration_plan?esc(t.integration_plan):t.stage==='integration'?'<span class="unspecified">整合方式未指定</span>':integrations.length?integrations.map(n=>link(n.id)+' · '+esc(name(n.owner))).join('；'):'<span class="unspecified">未指定</span>'}</p></div>${done?`<p class="flow-result"><small>最近提交${t.state==='已完成'?'':' · 未代表当前验收通过'}</small>${esc((done.result||done.body||'').slice(0,180))}</p>`:''}<details class="flow-evidence" data-evidence="${esc(t.id)}" ${expanded.has(t.id)?'open':''}><summary>查看任务与记录依据 · ${record.length}</summary>${record.map(e=>`<div><small>${esc(types[e.type]||e.type)} · ${esc(name(e.from))} · ${esc(e.id||'旧记录未标识')}</small><p>${esc(e.body)}</p>${'reviewer' in e?`<p>预定验收：${esc(e.reviewer?name(e.reviewer):'未指定')}</p>`:''}${'stage' in e?`<p>阶段类型：${e.stage==='integration'?'整合':'执行'}</p>`:''}${'integration_plan' in e?`<p>整合说明：${esc(e.integration_plan||'未指定')}</p>`:''}</div>`).join('')}</details></article>`;
  }
  const execution=visible.filter(t=>t.stage!=='integration'), integration=visible.filter(t=>t.stage==='integration');
  const levels=[...new Set(execution.map(t=>level.has(t.id)?level.get(t.id):-1))].sort((a,b)=>a<0?1:b<0?-1:a-b);
  const columns=levels.map(l=>`<section class="flow-level"><h3>${l<0?'依赖记录异常，需主导核对':'阶段 '+(l+1)}<small>${l===0?'无前置依赖':l>0?'前置交付通过后推进':''}</small></h3>${execution.filter(t=>(level.get(t.id)??-1)===l).map(card).join('')}</section>`);
  if(integration.length)columns.push(`<section class="flow-level integration-level"><h3>整合<small>stage = integration</small></h3>${integration.map(card).join('')}</section>`);
  $('workflow-tree').innerHTML=`<div class="flow-root">${avatar(state.session.lead)}<div><small class="muted">当前统筹</small><br><strong>${esc(name(state.session.lead))}</strong></div><span class="muted">各任务保留实际派发记录；待审查不计入已完成。</span><span class="count">${tasks.filter(t=>t.state==='已完成').length} / ${tasks.length}</span></div>${visible.length?`<div class="flow-columns" id="flow-columns">${columns.join('')}</div>`:''}${!visible.length?`<p class="observation-empty">${tasks.length?'没有匹配的任务。清空关键词查看完整流程。':'尚未发布任务。主导创建正式任务后，派工与验收流程将在这里展开。'}</p>`:''}${!tasks.some(t=>t.stage==='integration')?'<div class="integration-unset">最终整合安排未指定。主导可以发布带 depends_on 的整合任务并标记 stage=integration，写明整合负责人、方案和独立验收人。</div>':''}`;
}
function renderFlow() {
  if(!state||state.session.id!==selected)return;
  renderDispatches();
  const key=JSON.stringify([selected,state.session.lead,state.session.instance_revision,state.tasks,$('workflow-search').value]);
  if(key!==flowKey){renderWorkflowTree();flowKey=key;}
  updateFlowActivity();
}
// Cheap enough to run on every poll, even while the flow view is hidden, so no stale glyph survives.
function updateFlowActivity() {
  if(!state)return;
  for(const card of document.querySelectorAll('[data-flow-task]')) {
    const task=state.tasks.find(t=>t.id===card.dataset.flowTask), slot=card.querySelector('.flow-task-activity');
    if(!slot)continue;
    const html=task?.state==='进行中'?activityHTML(task.owner):'';
    if(!html)slot.replaceChildren();else if(!slot.firstElementChild)slot.innerHTML=html;
  }
}
function focusFlowTask(id) {
  $('workflow-search').value='';flowKey='';renderFlow();
  const target=[...$('workflow-tree').querySelectorAll('[data-flow-task]')].find(n=>n.dataset.flowTask===id);
  if(target){target.scrollIntoView({block:'center',inline:'center',behavior:reducedMotion()?'instant':'smooth'});target.focus({preventScroll:true});}
}
$('workflow-search').oninput=()=>{flowKey='';renderFlow();};
$('workflow-scroll').onclick=e=>{const link=e.target.closest('[data-flow-target]');if(link)focusFlowTask(link.dataset.flowTarget);};
// Hover a card to highlight its upstream and downstream tasks.
function relatedTasks(id) {
  const tasks=state?.tasks||[],up=new Set(),down=new Set();
  const walkUp=x=>{for(const d of tasks.find(t=>t.id===x)?.depends_on||[])if(!up.has(d)){up.add(d);walkUp(d);}};
  const walkDown=x=>{for(const t of tasks)if((t.depends_on||[]).includes(x)&&!down.has(t.id)){down.add(t.id);walkDown(t.id);}};
  walkUp(id);walkDown(id);return new Set([...up,...down]);
}
$('workflow-tree').addEventListener('mouseover',e=>{
  const card=e.target.closest('.flow-task'),columns=$('flow-columns');if(!card||!columns)return;
  const related=relatedTasks(card.dataset.flowTask);if(!related.size){columns.classList.remove('dimming');return;}
  columns.classList.add('dimming');
  for(const c of columns.querySelectorAll('.flow-task')){c.classList.toggle('hl',related.has(c.dataset.flowTask));c.classList.toggle('hl-self',c===card);}
});
$('workflow-tree').addEventListener('mouseleave',()=>$('flow-columns')?.classList.remove('dimming'));

// Records: long-form reading of the same events, independent display mode.
function renderRecords() {
  if(!state||state.session.id!==selected)return;
  const key=JSON.stringify([selected,state.revision,limit,recordsMode]);
  if(key===recordsKey)return;recordsKey=key;
  $('records-meta').textContent=`${state.total} 条消息 · 已加载 ${state.messages.length} 条${limit>=10000&&state.total>10000?' · 更早历史请导出查看':''}`;
  $('records-older').hidden=state.messages.length>=state.total||limit>=10000;
  $('records-list').dataset.detail=recordsMode;
  $('records-list').innerHTML=state.messages.map(m=>{
    const open=recordsOpen.has(m.id)?recordsOpen.get(m.id):recordsMode==='full';
    return `<article class="message ${messageKind(m)}${m.type==='intervention'||m.type==='control'?' intervention':''}" data-id="${esc(m.id)}" data-client="${esc(m.from==='human'?'human':clientId(m.from))}" data-open="${open}">${messageHTML(m).replace('aria-expanded="false"',`aria-expanded="${open}"`)}</article>`;
  }).join('')||'<p class="observation-empty">当前会话还没有消息。</p>';
}
$('records-list').addEventListener('click',e=>{
  const line=e.target.closest('.msg-line');if(!line)return;
  const article=line.closest('.message'),open=article.dataset.open!=='true';
  recordsOpen.set(article.dataset.id,open);article.dataset.open=String(open);line.setAttribute('aria-expanded',String(open));
});
$('records-detail').addEventListener('click',e=>{
  const b=e.target.closest('[data-detail]');if(!b)return;recordsMode=b.dataset.detail;recordsOpen.clear();recordsKey='';
  for(const x of $$('#records-detail [data-detail]'))x.setAttribute('aria-pressed',String(x===b));renderRecords();
});
$('records-older').onclick=()=>{limit=Math.min(10000,limit+300);renderKey='';recordsKey='';sync({fresh:true});};
