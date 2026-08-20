(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EventRetentionAnalytics=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const DAY_MS=24*60*60*1000;

  function text(value){return String(value==null?'':value).trim();}
  function normaliseText(value){return text(value).toLowerCase().replace(/\s+/g,' ');}
  function validDate(value){
    const date=text(value);
    const match=date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match)return false;
    const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]);
    const parsed=new Date(Date.UTC(y,m-1,d));
    return parsed.getUTCFullYear()===y&&parsed.getUTCMonth()===m-1&&parsed.getUTCDate()===d;
  }
  function dayNumber(value){
    if(!validDate(value))return null;
    const parts=value.split('-').map(Number);
    return Math.floor(Date.UTC(parts[0],parts[1]-1,parts[2])/DAY_MS);
  }
  function daysBetween(start,end){
    const a=dayNumber(start),b=dayNumber(end);
    return a===null||b===null?null:b-a;
  }
  function endOfMonth(year,month){
    const last=new Date(Date.UTC(Number(year),Number(month),0));
    return String(last.getUTCFullYear()).padStart(4,'0')+'-'+String(last.getUTCMonth()+1).padStart(2,'0')+'-'+String(last.getUTCDate()).padStart(2,'0');
  }
  function rate(numerator,denominator){return denominator?Math.round((numerator/denominator)*1000)/10:null;}
  function defaultAttended(row){return normaliseText(row&&row.attendance)==='yes';}
  function defaultVolunteerKey(row){
    const email=normaliseText(row&&row.email);
    const phone=text(row&&row.contact).replace(/\D/g,'');
    return email||phone;
  }
  function attended(row,options){return options&&typeof options.isAttended==='function'?!!options.isAttended(row):defaultAttended(row);}
  function volunteerKey(row,options){return options&&typeof options.volunteerKey==='function'?text(options.volunteerKey(row)):defaultVolunteerKey(row);}
  function eventNameKey(row,options){
    if(options&&typeof options.normaliseEventName==='function')return text(options.normaliseEventName(row&&row.eventName));
    return normaliseText(row&&row.eventName);
  }
  function occurrenceKey(row,options){return eventNameKey(row,options)+'|'+text(row&&row.eventDate);}
  function completedRows(rows,options){
    const today=text(options&&options.today);
    return (Array.isArray(rows)?rows:[]).filter(function(row){
      const date=text(row&&row.eventDate);
      return validDate(date)&&(!today||date<=today);
    });
  }
  function latestCompletedDate(rows,options){
    return completedRows(rows,options).reduce(function(latest,row){
      const date=text(row.eventDate);
      return !latest||date>latest?date:latest;
    },'');
  }
  function years(rows,options){
    const seen={};
    completedRows(rows,options).forEach(function(row){seen[text(row.eventDate).slice(0,4)]=true;});
    return Object.keys(seen).filter(Boolean).sort();
  }
  function rowsForYear(rows,year,options){
    const prefix=text(year)+'-';
    return completedRows(rows,options).filter(function(row){return text(row.eventDate).indexOf(prefix)===0;});
  }
  function noShowSummary(rows,year,options){
    const selected=rowsForYear(rows,year,options);
    const attendedCount=selected.filter(function(row){return attended(row,options);}).length;
    const noShowCount=selected.length-attendedCount;
    return{total:selected.length,attended:attendedCount,noShow:noShowCount,rate:rate(noShowCount,selected.length)};
  }
  function monthlyNoShow(rows,year,options){
    const grouped={};
    rowsForYear(rows,year,options).forEach(function(row){
      const month=text(row.eventDate).slice(5,7);
      if(!grouped[month])grouped[month]={month:month,total:0,attended:0,noShow:0,rate:null};
      grouped[month].total+=1;
      if(attended(row,options))grouped[month].attended+=1;else grouped[month].noShow+=1;
    });
    return Object.keys(grouped).sort().map(function(month){const item=grouped[month];item.rate=rate(item.noShow,item.total);return item;});
  }
  function eventNoShow(rows,year,options){
    const grouped={};
    rowsForYear(rows,year,options).forEach(function(row){
      const key=occurrenceKey(row,options);
      if(!grouped[key])grouped[key]={key:key,eventName:text(row.eventName)||'Unnamed event',eventDate:text(row.eventDate),total:0,attended:0,noShow:0,rate:null};
      grouped[key].total+=1;
      if(attended(row,options))grouped[key].attended+=1;else grouped[key].noShow+=1;
    });
    return Object.keys(grouped).map(function(key){const item=grouped[key];item.rate=rate(item.noShow,item.total);return item;}).sort(function(a,b){return b.eventDate.localeCompare(a.eventDate)||a.eventName.localeCompare(b.eventName);});
  }
  function buildAttendanceTimelines(rows,options){
    const timelines={};
    const seen={};
    let missingIdentityRows=0;
    completedRows(rows,options).forEach(function(row){
      if(!attended(row,options))return;
      const key=volunteerKey(row,options);
      if(!key){missingIdentityRows+=1;return;}
      const occurrence=occurrenceKey(row,options);
      const unique=key+'||'+occurrence;
      if(seen[unique])return;
      seen[unique]=true;
      if(!timelines[key])timelines[key]=[];
      timelines[key].push({date:text(row.eventDate),occurrenceKey:occurrence,eventName:text(row.eventName)});
    });
    Object.keys(timelines).forEach(function(key){timelines[key].sort(function(a,b){return a.date.localeCompare(b.date)||a.occurrenceKey.localeCompare(b.occurrenceKey);});});
    return{timelines:timelines,missingIdentityRows:missingIdentityRows};
  }
  function cohortMembers(rows,year,options){
    const built=buildAttendanceTimelines(rows,options);
    const members=[];
    Object.keys(built.timelines).forEach(function(key){
      const events=built.timelines[key];
      if(!events.length)return;
      const first=events[0];
      if(text(first.date).slice(0,4)!==String(year))return;
      members.push({key:key,firstDate:first.date,events:events});
    });
    members.sort(function(a,b){return a.firstDate.localeCompare(b.firstDate)||a.key.localeCompare(b.key);});
    return{members:members,missingIdentityRows:built.missingIdentityRows};
  }
  function returnedWithin(member,windowDays){
    if(!member||!member.events||member.events.length<2)return false;
    for(let i=1;i<member.events.length;i++){
      const delta=daysBetween(member.firstDate,member.events[i].date);
      if(delta!==null&&delta>=0&&delta<=windowDays)return true;
      if(delta!==null&&delta>windowDays)return false;
    }
    return false;
  }
  function retentionSummary(rows,year,windowDays,options){
    const dataThrough=latestCompletedDate(rows,options);
    const cohort=cohortMembers(rows,year,options);
    const eligible=cohort.members.filter(function(member){const age=daysBetween(member.firstDate,dataThrough);return age!==null&&age>=windowDays;});
    const retained=eligible.filter(function(member){return returnedWithin(member,windowDays);}).length;
    const dropped=eligible.length-retained;
    return{
      year:String(year),windowDays:Number(windowDays),dataThroughDate:dataThrough,
      cohortTotal:cohort.members.length,eligible:eligible.length,retained:retained,dropped:dropped,
      immature:cohort.members.length-eligible.length,rate:rate(retained,eligible.length),dropOffRate:rate(dropped,eligible.length),
      missingIdentityRows:cohort.missingIdentityRows
    };
  }
  function monthlyRetention(rows,year,windows,options){
    const dataThrough=latestCompletedDate(rows,options);
    const cohort=cohortMembers(rows,year,options);
    const grouped={};
    cohort.members.forEach(function(member){
      const month=member.firstDate.slice(5,7);
      if(!grouped[month])grouped[month]=[];
      grouped[month].push(member);
    });
    const windowList=(Array.isArray(windows)&&windows.length?windows:[30,60,90]).map(Number);
    return Object.keys(grouped).sort().map(function(month){
      const members=grouped[month];
      const item={month:month,cohortTotal:members.length,windows:{}};
      windowList.forEach(function(windowDays){
        const monthMature=daysBetween(endOfMonth(year,month),dataThrough)>=windowDays;
        if(!monthMature){item.windows[windowDays]={mature:false,eligible:0,retained:0,dropped:0,rate:null,dropOffRate:null};return;}
        const retained=members.filter(function(member){return returnedWithin(member,windowDays);}).length;
        const dropped=members.length-retained;
        item.windows[windowDays]={mature:true,eligible:members.length,retained:retained,dropped:dropped,rate:rate(retained,members.length),dropOffRate:rate(dropped,members.length)};
      });
      return item;
    });
  }

  return{
    validDate:validDate,
    daysBetween:daysBetween,
    completedRows:completedRows,
    latestCompletedDate:latestCompletedDate,
    years:years,
    noShowSummary:noShowSummary,
    monthlyNoShow:monthlyNoShow,
    eventNoShow:eventNoShow,
    buildAttendanceTimelines:buildAttendanceTimelines,
    retentionSummary:retentionSummary,
    monthlyRetention:monthlyRetention
  };
});
