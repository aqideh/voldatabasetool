(function installReportingMetrics(){
  const MAX_REPORTING_METRICS=50;
  const MAX_REPORTING_LABEL_LENGTH=80;
  const MAX_REPORTING_NOTE_LENGTH=180;
  const MAX_REPORTING_VALUE=1000000000;
  const MAP_TUTORS_ID='map-tutors';

  function normaliseMetricValue(value){
    if(value===''||value==null)return null;
    const number=Number(value);
    if(!Number.isFinite(number)||number<0||Math.floor(number)!==number)return null;
    return Math.min(number,MAX_REPORTING_VALUE);
  }

  function normaliseMetric(raw,index){
    const source=raw&&typeof raw==='object'?raw:{};
    const fallbackId='reporting-metric-'+String(index+1);
    return{
      id:safeText(source.id||fallbackId,'id'),
      label:safeText(source.label||'', 'reportingMetricLabel').slice(0,MAX_REPORTING_LABEL_LENGTH),
      value:normaliseMetricValue(source.value),
      note:safeText(source.note||'', 'reportingMetricNote').slice(0,MAX_REPORTING_NOTE_LENGTH)
    };
  }

  function defaultMapTutorMetric(){
    return{id:MAP_TUTORS_ID,label:'MAP Tutors',value:null,note:'Reported by another department'};
  }

  function normaliseMetrics(value){
    const source=Array.isArray(value)?value.slice(0,MAX_REPORTING_METRICS):[];
    const out=[];
    source.forEach(function(raw,index){
      const metric=normaliseMetric(raw,index);
      if(!metric.label)return;
      if(out.some(function(item){return item.id===metric.id;}))metric.id=makeId('metric');
      out.push(metric);
    });
    if(!out.some(function(item){return item.id===MAP_TUTORS_ID;}))out.unshift(defaultMapTutorMetric());
    return out.slice(0,MAX_REPORTING_METRICS);
  }

  const previousValidateJsonSave=validateJsonSave;
  validateJsonSave=function(raw){
    const cleaned=previousValidateJsonSave(raw);
    const source=raw&&typeof raw==='object'?raw:{};
    cleaned.reportingMetrics=normaliseMetrics(source.reportingMetrics);
    return cleaned;
  };

  function metrics(){
    appData.reportingMetrics=normaliseMetrics(appData.reportingMetrics);
    return appData.reportingMetrics;
  }

  function metricDisplayValue(metric){return metric.value==null?'—':String(metric.value);}

  function renderEditorRows(){
    return metrics().map(function(metric){
      const protectedMetric=metric.id===MAP_TUTORS_ID;
      return '<div class="card reporting-metric-editor" data-reporting-metric="'+escapeHtml(metric.id)+'">'+
        '<div class="grid">'+
          '<div><label>Label</label><input class="reporting-metric-label" maxlength="'+MAX_REPORTING_LABEL_LENGTH+'" value="'+escapeHtml(metric.label)+'" '+(protectedMetric?'readonly':'')+'></div>'+
          '<div><label>Number</label><input class="reporting-metric-value" type="number" min="0" max="'+MAX_REPORTING_VALUE+'" step="1" value="'+(metric.value==null?'':escapeHtml(metric.value))+'" placeholder="Enter number"></div>'+
          '<div><label>Note</label><input class="reporting-metric-note" maxlength="'+MAX_REPORTING_NOTE_LENGTH+'" value="'+escapeHtml(metric.note)+'" placeholder="Optional source or context"></div>'+
        '</div>'+
        '<div class="row"><button type="button" class="reporting-metric-save primary">Save figure</button>'+
        (protectedMetric?'':'<button type="button" class="reporting-metric-delete danger">Delete</button>')+
        '</div></div>';
    }).join('');
  }

  function renderSection(){
    const cards=metrics().map(function(metric){return renderMetricCard(metric.label,metricDisplayValue(metric),metric.note||'manual reporting figure');}).join('');
    return '<div id="dashboardReportingMetrics">'+
      '<div class="card"><h2>Manual Reporting Figures</h2><p class="muted">Use this for headline numbers supplied outside MakLom, such as MAP Tutors. These figures are stored with the local database and included in JSON backups.</p><div class="dashboard-kpis">'+cards+'</div></div>'+
      '<div class="card"><h3>Update Reporting Figures</h3><p class="muted">MAP Tutors is included by default. Add other numeric reporting figures as needed.</p>'+renderEditorRows()+
        '<div class="card"><h4>Add another figure</h4><div class="grid"><div><label for="newReportingMetricLabel">Label</label><input id="newReportingMetricLabel" maxlength="'+MAX_REPORTING_LABEL_LENGTH+'" placeholder="e.g. Outreach Participants"></div><div><label for="newReportingMetricValue">Number</label><input id="newReportingMetricValue" type="number" min="0" max="'+MAX_REPORTING_VALUE+'" step="1" placeholder="Enter number"></div><div><label for="newReportingMetricNote">Note</label><input id="newReportingMetricNote" maxlength="'+MAX_REPORTING_NOTE_LENGTH+'" placeholder="Optional source or context"></div></div><div class="row"><button id="addReportingMetric" type="button">Add reporting figure</button></div></div>'+
      '</div></div>';
  }

  function saveMetricFromEditor(editor){
    const id=editor.dataset.reportingMetric;
    const metric=metrics().find(function(item){return item.id===id;});
    if(!metric)return;
    const label=cleanText(editor.querySelector('.reporting-metric-label').value).slice(0,MAX_REPORTING_LABEL_LENGTH);
    const rawValue=cleanText(editor.querySelector('.reporting-metric-value').value);
    const note=cleanText(editor.querySelector('.reporting-metric-note').value).slice(0,MAX_REPORTING_NOTE_LENGTH);
    if(!label){alert('Reporting figure label is required.');return;}
    if(rawValue!==''&&normaliseMetricValue(rawValue)==null){alert('Reporting figure must be a whole number of 0 or more.');return;}
    metric.label=id===MAP_TUTORS_ID?'MAP Tutors':label;
    metric.value=normaliseMetricValue(rawValue);
    metric.note=note;
    saveData();
    renderDashboard();
  }

  function addMetric(){
    const label=cleanText(document.getElementById('newReportingMetricLabel').value).slice(0,MAX_REPORTING_LABEL_LENGTH);
    const rawValue=cleanText(document.getElementById('newReportingMetricValue').value);
    const note=cleanText(document.getElementById('newReportingMetricNote').value).slice(0,MAX_REPORTING_NOTE_LENGTH);
    if(!label){alert('Reporting figure label is required.');return;}
    if(rawValue!==''&&normaliseMetricValue(rawValue)==null){alert('Reporting figure must be a whole number of 0 or more.');return;}
    if(metrics().length>=MAX_REPORTING_METRICS){alert('Maximum reporting figures reached.');return;}
    appData.reportingMetrics.push({id:makeId('metric'),label:label,value:normaliseMetricValue(rawValue),note:note});
    saveData();
    renderDashboard();
  }

  function deleteMetric(editor){
    const id=editor.dataset.reportingMetric;
    if(id===MAP_TUTORS_ID)return;
    appData.reportingMetrics=metrics().filter(function(item){return item.id!==id;});
    saveData();
    renderDashboard();
  }

  function wireSection(){
    document.querySelectorAll('.reporting-metric-editor').forEach(function(editor){
      const saveButton=editor.querySelector('.reporting-metric-save');
      if(saveButton)saveButton.addEventListener('click',function(){saveMetricFromEditor(editor);});
      const deleteButton=editor.querySelector('.reporting-metric-delete');
      if(deleteButton)deleteButton.addEventListener('click',function(){deleteMetric(editor);});
    });
    const addButton=document.getElementById('addReportingMetric');
    if(addButton)addButton.addEventListener('click',addMetric);
  }

  function appendSection(){
    const target=document.getElementById('dashboardContent');
    if(!target)return;
    const old=document.getElementById('dashboardReportingMetrics');
    if(old)old.remove();
    target.insertAdjacentHTML('beforeend',renderSection());
    wireSection();
  }

  const previousRenderDashboard=renderDashboard;
  renderDashboard=function(){previousRenderDashboard();appendSection();};
  renderDashboard();
})();
