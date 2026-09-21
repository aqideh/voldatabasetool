(function(root){
  'use strict';

  const REQUIRED_HEADERS=[
    'event_title','event_venue','date','shift','shift_starts_at','shift_ends_at',
    'volunteer_name','contact_number','email','attendance_status',
    'checked_in_at','checked_out_at'
  ];
  const ATTENDED_STATUSES=new Set(['checked_in','checked_out']);

  function clean(value){return String(value==null?'':value).trim();}
  function lower(value){return clean(value).toLowerCase();}
  function phone(value){return clean(value).replace(/\D/g,'');}
  function number(value){const n=Number(value);return Number.isFinite(n)?n:0;}
  function hashString(value){
    let h=2166136261;
    const s=String(value==null?'':value);
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
    return(h>>>0).toString(36);
  }
  function validDate(value){
    const d=new Date(value);
    return Number.isFinite(d.getTime())?d:null;
  }
  function localParts(value){
    const d=validDate(value);
    if(!d)return null;
    const parts=new Intl.DateTimeFormat('en-CA',{
      timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(d).reduce(function(out,p){if(p.type!=='literal')out[p.type]=p.value;return out;},{});
    return{
      date:parts.year+'-'+parts.month+'-'+parts.day,
      time:parts.hour+':'+parts.minute,
      instant:d
    };
  }
  function isoInstant(ms){return Number.isFinite(ms)?new Date(ms).toISOString():null;}
  function minDate(values){const x=values.filter(Boolean).sort();return x[0]||'';}
  function maxDate(values){const x=values.filter(Boolean).sort();return x[x.length-1]||'';}
  function identity(row){
    return lower(row.volunteer_person_key)||lower(row.email)||phone(row.contact_number)||lower(row.volunteer_name);
  }
  function eventKey(row){return lower(row.event_title)+'|'+lower(row.event_venue);}
  function shiftKey(row){return clean(row.date)+'|'+lower(row.shift);}
  function sourceKey(row){
    return [
      lower(row.event_title),clean(row.date),lower(row.shift),identity(row)
    ].join('|');
  }
  function validateHeaders(headers){
    const set=new Set((headers||[]).map(clean));
    return REQUIRED_HEADERS.filter(function(h){return !set.has(h);});
  }
  function normaliseRow(row,index){
    const out={};
    Object.keys(row||{}).forEach(function(k){out[clean(k)]=clean(row[k]);});
    out._rowNumber=index+2;
    out._identity=identity(out);
    out._eventKey=eventKey(out);
    out._shiftKey=shiftKey(out);
    out._sourceKey=sourceKey(out);
    out._attendanceId='event_report_att_'+hashString(out._sourceKey);
    out._eventIdSuggested='event_report_event_'+hashString(out._eventKey+'|'+clean(out.date));
    out._shiftIdSuggested='event_report_shift_'+hashString(out._eventKey+'|'+out._shiftKey);
    out._shiftStart=validDate(out.shift_starts_at);
    out._shiftEnd=validDate(out.shift_ends_at);
    out._checkIn=validDate(out.checked_in_at);
    out._checkOut=validDate(out.checked_out_at);
    out._eventCheckIn=validDate(out.event_day_checked_in_at);
    out._eventCheckOut=validDate(out.event_day_checked_out_at);
    out._attended=ATTENDED_STATUSES.has(lower(out.attendance_status));
    return out;
  }
  function warningSummary(rows){
    const warnings={
      checkoutAfterShiftEnd:0,
      checkinBeforeShiftStart:0,
      checkedInWithoutCheckout:0,
      invalidShiftTimestamps:0,
      missingIdentity:0
    };
    rows.forEach(function(r){
      if(!r._shiftStart||!r._shiftEnd)warnings.invalidShiftTimestamps++;
      if(!r._identity)warnings.missingIdentity++;
      if(r._checkOut&&r._shiftEnd&&r._checkOut.getTime()>r._shiftEnd.getTime())warnings.checkoutAfterShiftEnd++;
      if(r._checkIn&&r._shiftStart&&r._checkIn.getTime()<r._shiftStart.getTime())warnings.checkinBeforeShiftStart++;
      if(lower(r.attendance_status)==='checked_in'&&!r._checkOut)warnings.checkedInWithoutCheckout++;
    });
    return warnings;
  }
  function buildEvents(rows){
    const groups={};
    rows.forEach(function(r){
      if(!groups[r._eventKey])groups[r._eventKey]={key:r._eventKey,title:clean(r.event_title)||'Untitled event',venue:clean(r.event_venue),rows:[],shifts:{}};
      const g=groups[r._eventKey];g.rows.push(r);
      if(!g.shifts[r._shiftKey]){
        const start=localParts(r.shift_starts_at),end=localParts(r.shift_ends_at);
        g.shifts[r._shiftKey]={
          key:r._shiftKey,
          name:clean(r.shift)||'General',
          date:clean(r.date)||(start&&start.date)||'',
          start_time:start&&start.time||null,
          end_time:end&&end.time||null,
          rows:[]
        };
      }
      g.shifts[r._shiftKey].rows.push(r);
    });
    return Object.keys(groups).map(function(key){
      const g=groups[key],dates=g.rows.map(function(r){return clean(r.date);}).filter(Boolean);
      g.start_date=minDate(dates);g.end_date=maxDate(dates);g.shiftList=Object.keys(g.shifts).map(function(k){return g.shifts[k];}).sort(function(a,b){return a.date.localeCompare(b.date)||String(a.start_time||'').localeCompare(String(b.start_time||''))||a.name.localeCompare(b.name);});
      g.suggestedId='event_report_event_'+hashString(g.key+'|'+g.start_date+'|'+g.end_date);
      return g;
    }).sort(function(a,b){return a.start_date.localeCompare(b.start_date)||a.title.localeCompare(b.title);});
  }
  function allocateAttendance(rows){
    const result={};
    const continuous={};
    rows.forEach(function(r){
      const type=lower(r.continuous_attendance_type);
      const session=clean(r.attendance_session_id);
      if(type&&session){
        const key=r._identity+'|'+clean(r.date)+'|'+session;
        if(!continuous[key])continuous[key]=[];
        continuous[key].push(r);
      }
    });

    const handled=new Set();
    Object.keys(continuous).forEach(function(key){
      const group=continuous[key].slice().sort(function(a,b){return number(a._shiftStart&&a._shiftStart.getTime())-number(b._shiftStart&&b._shiftStart.getTime());});
      const hasExtension=group.some(function(r){return lower(r.continuous_attendance_type)==='extended_on_site';});
      if(group.length<2||!hasExtension)return;
      const starts=group.map(function(r){return r._eventCheckIn||r._checkIn;}).filter(Boolean).map(function(d){return d.getTime();});
      const ends=group.map(function(r){return r._eventCheckOut||r._checkOut;}).filter(Boolean).map(function(d){return d.getTime();});
      if(!starts.length||!ends.length)return;
      const globalStart=Math.min.apply(null,starts),globalEnd=Math.max.apply(null,ends);
      group.forEach(function(r,i){
        handled.add(r._sourceKey);
        let minutes=0,signIn=null,signOut=null;
        if(r._attended&&r._shiftStart&&r._shiftEnd&&globalEnd>globalStart){
          const shiftStart=r._shiftStart.getTime(),shiftEnd=r._shiftEnd.getTime();
          let endBoundary=shiftEnd;
          const next=group[i+1];
          if(next&&next._shiftStart&&next._shiftStart.getTime()<shiftEnd)endBoundary=next._shiftStart.getTime();
          const start=Math.max(globalStart,shiftStart);
          const end=Math.min(globalEnd,endBoundary);
          if(end>start){minutes=Math.round((end-start)/60000);signIn=isoInstant(start);signOut=isoInstant(end);}
        }
        result[r._sourceKey]={
          attended:r._attended,
          duration_minutes:minutes,
          sign_in_at:signIn,
          sign_out_at:signOut,
          calculated_duration_minutes:minutes||0,
          note:'Continuous attendance auto-allocated across overlapping shifts; credited time is capped to this shift window.'
        };
      });
    });

    rows.forEach(function(r){
      if(handled.has(r._sourceKey))return;
      const status=lower(r.attendance_status);
      let minutes=0,signIn=null,signOut=null,note='';
      if(status==='checked_out'&&r._checkIn&&r._checkOut&&r._shiftStart&&r._shiftEnd){
        const start=Math.max(r._checkIn.getTime(),r._shiftStart.getTime());
        const end=Math.min(r._checkOut.getTime(),r._shiftEnd.getTime());
        if(end>start){minutes=Math.round((end-start)/60000);signIn=isoInstant(start);signOut=isoInstant(end);}
        if(r._checkIn.getTime()<r._shiftStart.getTime()||r._checkOut.getTime()>r._shiftEnd.getTime())note='Attendance timestamps were capped to the scheduled shift window.';
      }else if(status==='checked_in'&&r._checkIn){
        const start=r._shiftStart?Math.max(r._checkIn.getTime(),r._shiftStart.getTime()):r._checkIn.getTime();
        signIn=isoInstant(start);
        note='Checked in without a checkout; imported as attended with 0 credited minutes pending staff review.';
      }else if(status==='absent'){
        note='Source attendance status: absent.';
      }else if(status==='withdrawn'){
        note='Source attendance status: withdrawn.';
      }else if(status){
        note='Source attendance status: '+status+'.';
      }
      result[r._sourceKey]={
        attended:r._attended,
        duration_minutes:minutes,
        sign_in_at:signIn,
        sign_out_at:signOut,
        calculated_duration_minutes:status==='checked_in'&&!r._checkOut?null:minutes,
        note:note
      };
    });
    return result;
  }
  function analyse(rawRows,headers){
    const missingHeaders=validateHeaders(headers);
    if(missingHeaders.length)return{ok:false,missingHeaders:missingHeaders,rows:[],events:[],summary:null};
    const rows=(rawRows||[]).filter(function(row){return Object.keys(row||{}).some(function(k){return clean(row[k]);});}).map(normaliseRow);
    const events=buildEvents(rows);
    const allocation=allocateAttendance(rows);
    const statusCounts={};
    let creditedMinutes=0;
    rows.forEach(function(r){
      const status=lower(r.attendance_status)||'blank';
      statusCounts[status]=(statusCounts[status]||0)+1;
      r._allocation=allocation[r._sourceKey]||{attended:false,duration_minutes:0,sign_in_at:null,sign_out_at:null,calculated_duration_minutes:0,note:''};
      creditedMinutes+=r._allocation.duration_minutes||0;
    });
    const continuousSessions=new Set(rows.filter(function(r){return lower(r.continuous_attendance_type)==='extended_on_site'&&clean(r.attendance_session_id);}).map(function(r){return r._identity+'|'+clean(r.date)+'|'+clean(r.attendance_session_id);}));
    return{
      ok:true,
      missingHeaders:[],
      rows:rows,
      events:events,
      summary:{
        rows:rows.length,
        events:events.length,
        shifts:events.reduce(function(t,e){return t+e.shiftList.length;},0),
        statusCounts:statusCounts,
        warnings:warningSummary(rows),
        continuousSessions:continuousSessions.size,
        creditedMinutes:creditedMinutes
      }
    };
  }

  root.MaklomEventReportImportCore={
    REQUIRED_HEADERS:REQUIRED_HEADERS.slice(),
    clean:clean,lower:lower,phone:phone,hashString:hashString,
    localParts:localParts,validateHeaders:validateHeaders,
    analyse:analyse
  };
})(typeof window!=='undefined'?window:globalThis);
