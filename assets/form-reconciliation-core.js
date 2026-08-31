(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MaklomFormReconciliationCore=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const C={};
  const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  const SIGN_IN_HEADERS=['Response ID','Timestamp','Download Status','Full Name','Email Address','Phone Number','Event Deployed For:','Number of Shirts Collected','Shirt Size'];
  const SIGN_OUT_BASE_HEADERS=['Response ID','Timestamp','Download Status','Full Name','Email Address','Phone Number','Event Deployed For:'];

  C.clean=function(v){return String(v==null?'':v).trim();};
  C.lower=function(v){return C.clean(v).toLowerCase();};
  C.normalizeEmail=function(v){return C.lower(v).replace(/\s+/g,'');};
  C.normalizePhone=function(v){const digits=C.clean(v).replace(/\D/g,'');return digits.length>8?digits.slice(-8):digits;};
  C.normalizeName=function(v){
    let s=C.clean(v).normalize?C.clean(v).normalize('NFKD'):C.clean(v);
    s=s.replace(/[\u0300-\u036f]/g,'').toLowerCase();
    s=s.replace(/\b(binte|binti|bin|bt)\b/g,' ');
    return s.replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  };
  C.normalizeEvent=function(v){return C.lower(v).replace(/\s+/g,' ').replace(/[–—]/g,'-');};
  C.identityKey=function(row){return C.normalizeEmail(row.email)||C.normalizePhone(row.phone)||C.normalizeName(row.name);};
  C.hashString=function(value){let h=2166136261;value=String(value||'');for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(36);};

  C.parseCsvRows=function(text){
    text=String(text==null?'':text).replace(/^\uFEFF/,'');
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}
        else if(ch==='"')quoted=false;
        else field+=ch;
      }else if(ch==='"')quoted=true;
      else if(ch===','){row.push(field);field='';}
      else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
      else field+=ch;
    }
    if(field!==''||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
    return rows;
  };

  C.headerIndex=function(rows){return rows.findIndex(function(r){return r&&C.clean(r[0])==='Response ID'&&r.indexOf('Timestamp')>-1;});};
  C.rowsToObjects=function(rows,headerIndex){
    const headers=rows[headerIndex]||[];
    return rows.slice(headerIndex+1).filter(function(r){return r&&r.some(function(v){return C.clean(v)!=='';});}).map(function(r){const out={};headers.forEach(function(h,i){out[C.clean(h)]=r[i]==null?'':r[i];});return out;});
  };
  C.assertHeaders=function(headers,required,label){
    const missing=required.filter(function(h){return headers.indexOf(h)===-1;});
    if(missing.length)throw new Error(label+' CSV is missing required columns: '+missing.join(', '));
  };

  C.parseTimestamp=function(value){
    const s=C.clean(value);
    const m=s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+([AP]M)$/i);
    if(!m)return null;
    const month=MONTHS[m[2].toLowerCase()];if(!month)return null;
    let hour=Number(m[4]);const ap=m[7].toUpperCase();if(ap==='PM'&&hour!==12)hour+=12;if(ap==='AM'&&hour===12)hour=0;
    const pad=function(n){return String(n).padStart(2,'0');};
    const date=m[3]+'-'+pad(month)+'-'+pad(Number(m[1]));
    const iso=date+'T'+pad(hour)+':'+m[5]+':'+m[6]+'+08:00';
    const ms=Date.parse(iso);if(!Number.isFinite(ms))return null;
    return{raw:s,iso:iso,date:date,ms:ms};
  };

  C.integer=function(v){const n=Number(C.clean(v));return Number.isFinite(n)&&n>=0&&Math.floor(n)===n?n:0;};
  C.rating=function(v){const n=Number(C.clean(v));return Number.isFinite(n)&&n>=1&&n<=5?n:null;};
  C.submissionId=function(type,responseId){return'form_'+(type==='sign_in'?'in':'out')+'_'+C.clean(responseId).replace(/[^A-Za-z0-9_-]/g,'');};

  C.parseSignInCsv=function(text,fileName){
    const rows=C.parseCsvRows(text),hi=C.headerIndex(rows);if(hi<0)throw new Error('Could not find the sign-in response header row.');
    const headers=rows[hi].map(C.clean);C.assertHeaders(headers,SIGN_IN_HEADERS,'Sign-in');
    return C.rowsToObjects(rows,hi).map(function(raw){
      const t=C.parseTimestamp(raw.Timestamp);if(!t)throw new Error('Invalid sign-in timestamp: '+raw.Timestamp);
      return{id:C.submissionId('sign_in',raw['Response ID']),type:'sign_in',responseId:C.clean(raw['Response ID']),fileName:C.clean(fileName),timestamp:t,name:C.clean(raw['Full Name']),email:C.clean(raw['Email Address']),phone:C.clean(raw['Phone Number']),eventName:C.clean(raw['Event Deployed For:']),shirtQuantity:C.integer(raw['Number of Shirts Collected']),shirtSize:C.clean(raw['Shirt Size']),raw:raw};
    });
  };

  C.parseSignOutCsv=function(text,fileName){
    const rows=C.parseCsvRows(text),hi=C.headerIndex(rows);if(hi<0)throw new Error('Could not find the sign-out response header row.');
    const headers=rows[hi].map(C.clean);C.assertHeaders(headers,SIGN_OUT_BASE_HEADERS,'Sign-out');
    const findHeader=function(fragment){return headers.find(function(h){return C.lower(h).indexOf(fragment)>-1;})||'';};
    const ageH=findHeader('age group'),genderH=findHeader('gender'),tenureH=findHeader('how long have you been volunteering'),freqH=findHeader('how frequently do you volunteer');
    const briefingH=findHeader('thorough briefing'),onboardH=findHeader('onboarding process'),roleH=findHeader('satisfied with the assigned role'),supportH=findHeader('approachable and supportive');
    const improveH=findHeader('improve your volunteer experience'),recommendH=findHeader('would you recommend volunteering'),referralH=findHeader('interested in volunteering or referring');
    return C.rowsToObjects(rows,hi).map(function(raw){
      const t=C.parseTimestamp(raw.Timestamp);if(!t)throw new Error('Invalid sign-out timestamp: '+raw.Timestamp);
      return{id:C.submissionId('sign_out',raw['Response ID']),type:'sign_out',responseId:C.clean(raw['Response ID']),fileName:C.clean(fileName),timestamp:t,name:C.clean(raw['Full Name']),email:C.clean(raw['Email Address']),phone:C.clean(raw['Phone Number']),eventName:C.clean(raw['Event Deployed For:']),feedback:{ageGroup:C.clean(raw[ageH]),gender:C.clean(raw[genderH]),tenure:C.clean(raw[tenureH]),frequency:C.clean(raw[freqH]),briefing:C.rating(raw[briefingH]),onboarding:C.rating(raw[onboardH]),roleSatisfaction:C.rating(raw[roleH]),staffSupport:C.rating(raw[supportH]),improvement:C.clean(raw[improveH]),recommend:C.clean(raw[recommendH]),referralEmail:C.clean(raw[referralH])},raw:raw};
    });
  };

  C.bigrams=function(s){s=C.normalizeName(s).replace(/\s/g,'');if(s.length<2)return s?[s]:[];const out=[];for(let i=0;i<s.length-1;i++)out.push(s.slice(i,i+2));return out;};
  C.nameSimilarity=function(a,b){
    const x=C.normalizeName(a),y=C.normalizeName(b);if(!x||!y)return 0;if(x===y)return 1;
    const xt=x.split(' ').filter(Boolean),yt=y.split(' ').filter(Boolean),shorter=xt.length<=yt.length?xt:yt,longer=xt.length<=yt.length?yt:xt;
    if(shorter.length>=2&&shorter.every(function(t){return longer.indexOf(t)>-1;}))return 0.92;
    const A=C.bigrams(x),B=C.bigrams(y);if(!A.length||!B.length)return 0;const counts={};A.forEach(function(v){counts[v]=(counts[v]||0)+1;});let hit=0;B.forEach(function(v){if(counts[v]){hit++;counts[v]--;}});return(2*hit)/(A.length+B.length);
  };

  C.identityEvidence=function(a,b){
    const emailA=C.normalizeEmail(a.email),emailB=C.normalizeEmail(b.email),phoneA=C.normalizePhone(a.phone),phoneB=C.normalizePhone(b.phone),nameSim=C.nameSimilarity(a.name,b.name);
    return{email:!!(emailA&&emailB&&emailA===emailB),phone:!!(phoneA&&phoneB&&phoneA===phoneB),nameExact:!!(C.normalizeName(a.name)&&C.normalizeName(a.name)===C.normalizeName(b.name)),nameSimilarity:nameSim};
  };

  C.pairCandidate=function(signIn,signOut){
    const delta=(signOut.timestamp.ms-signIn.timestamp.ms)/60000;
    const ev=C.identityEvidence(signIn,signOut);
    const sameEvent=C.normalizeEvent(signIn.eventName)===C.normalizeEvent(signOut.eventName);
    const sameDate=signIn.timestamp.date===signOut.timestamp.date;
    const maxMinutes=(sameEvent&&(ev.email||ev.phone))?30*60:18*60;
    if(delta<-15||delta>maxMinutes)return null;
    if(!ev.email&&!ev.phone&&ev.nameSimilarity<0.88)return null;
    let score=(ev.email?45:0)+(ev.phone?45:0)+(ev.nameExact?20:Math.round(ev.nameSimilarity*18))+(sameEvent?25:0)+(sameDate?15:0);
    if(!ev.email&&!ev.phone)score-=15;
    if(score<55)return null;
    return{score:Math.min(100,score),deltaMinutes:Math.max(0,Math.round(delta)),sameEvent:sameEvent,sameDate:sameDate,evidence:ev};
  };

  C.findPairs=function(signIns,signOuts){
    const candidates=[];
    signIns.forEach(function(a,i){signOuts.forEach(function(b,j){const c=C.pairCandidate(a,b);if(c)candidates.push({i:i,j:j,meta:c});});});
    candidates.sort(function(a,b){
      if(b.meta.score!==a.meta.score)return b.meta.score-a.meta.score;
      if(Number(b.meta.sameEvent)!==Number(a.meta.sameEvent))return Number(b.meta.sameEvent)-Number(a.meta.sameEvent);
      const ain=signIns[a.i].timestamp.ms,bin=signIns[b.i].timestamp.ms;if(ain!==bin)return ain-bin;
      return signOuts[a.j].timestamp.ms-signOuts[b.j].timestamp.ms;
    });
    const usedIn={},usedOut={},pairs=[];
    candidates.forEach(function(c){if(usedIn[c.i]||usedOut[c.j])return;usedIn[c.i]=true;usedOut[c.j]=true;pairs.push({signIn:signIns[c.i],signOut:signOuts[c.j],meta:c.meta});});
    return{pairs:pairs,unmatchedSignIns:signIns.filter(function(_,i){return !usedIn[i];}),unmatchedSignOuts:signOuts.filter(function(_,i){return !usedOut[i];})};
  };

  C.volunteerMatch=function(session,volunteers){
    const sources=[session.signIn,session.signOut].filter(Boolean);if(!sources.length)return null;
    const ranked=(volunteers||[]).map(function(v){
      let best=null;
      sources.forEach(function(source){
        const ev=C.identityEvidence(source,{name:v.name,email:v.email,phone:v.phone});
        const score=(ev.email?45:0)+(ev.phone?45:0)+(ev.nameExact?20:Math.round(ev.nameSimilarity*18));
        if(!best||score>best.score)best={score:score,evidence:ev};
      });
      return{volunteer:v,score:Math.min(100,best?best.score:0),evidence:best&&best.evidence||{}};
    }).filter(function(x){return x.score>=45;}).sort(function(a,b){return b.score-a.score;});
    if(!ranked.length)return null;
    const first=ranked[0],second=ranked[1];
    return{id:first.volunteer.id,name:first.volunteer.name,email:first.volunteer.email||'',phone:first.volunteer.phone||'',confidence:first.score,ambiguous:!!(second&&first.score-second.score<15),reason:[first.evidence.email?'email':'',first.evidence.phone?'phone':'',first.evidence.nameExact?'name':''].filter(Boolean).join('+')||'fuzzy name'};
  };

  C.duplicateSubmissionIds=function(signIns,signOuts){
    const flagged={};
    [['in',signIns],['out',signOuts]].forEach(function(pair){
      const groups={};pair[1].forEach(function(r){const key=[pair[0],C.identityKey(r),C.normalizeEvent(r.eventName),r.timestamp.date].join('|');(groups[key]=groups[key]||[]).push(r);});
      Object.keys(groups).forEach(function(k){if(groups[k].length>1)groups[k].forEach(function(r){flagged[r.id]=true;});});
    });
    return flagged;
  };

  C.makeSession=function(signIn,signOut,meta,duplicateIds,volunteers){
    const flags=[];
    let matchStatus='matched';
    if(!signIn){matchStatus='missing_sign_in';flags.push('missing_sign_in');}
    if(!signOut){matchStatus='missing_sign_out';flags.push('missing_sign_out');}
    if(signIn&&signOut&&!meta.sameEvent)flags.push('event_mismatch');
    if((signIn&&duplicateIds[signIn.id])||(signOut&&duplicateIds[signOut.id]))flags.push('possible_duplicate');
    const calculated=signIn&&signOut?Math.max(0,Math.round((signOut.timestamp.ms-signIn.timestamp.ms)/60000)):null;
    if(calculated!=null&&calculated>600)flags.push('long_duration');
    const source=signIn||signOut;
    const eventOptions=[];[signIn&&signIn.eventName,signOut&&signOut.eventName].filter(Boolean).forEach(function(v){if(eventOptions.indexOf(v)<0)eventOptions.push(v);});
    const session={id:'rec_'+C.hashString((signIn?signIn.id:'')+'|'+(signOut?signOut.id:'')),signIn:signIn||null,signOut:signOut||null,matchStatus:matchStatus,matchConfidence:meta?meta.score:0,matchReason:meta?([meta.evidence.email?'email':'',meta.evidence.phone?'phone':'',meta.evidence.nameExact?'name':'',meta.sameEvent?'event':'',meta.sameDate?'date':''].filter(Boolean).join('+')):'single form response',eventName:source?source.eventName:'',eventOptions:eventOptions,eventDate:source?source.timestamp.date:'',calculatedMinutes:calculated,staffCreditedMinutes:null,staffCreditNote:'',included:true,reviewAcknowledged:flags.length===0,reviewFlags:flags};
    session.volunteerMatch=C.volunteerMatch(session,volunteers);
    if(!session.volunteerMatch){session.reviewFlags.push('volunteer_unmatched');session.reviewAcknowledged=false;}
    else if(session.volunteerMatch.ambiguous){session.reviewFlags.push('volunteer_ambiguous');session.reviewAcknowledged=false;}
    return session;
  };

  C.reconcile=function(signIns,signOuts,volunteers){
    signIns=signIns||[];signOuts=signOuts||[];
    const duplicateIds=C.duplicateSubmissionIds(signIns,signOuts),found=C.findPairs(signIns,signOuts),sessions=[];
    found.pairs.forEach(function(p){sessions.push(C.makeSession(p.signIn,p.signOut,p.meta,duplicateIds,volunteers));});
    found.unmatchedSignIns.forEach(function(r){sessions.push(C.makeSession(r,null,null,duplicateIds,volunteers));});
    found.unmatchedSignOuts.forEach(function(r){sessions.push(C.makeSession(null,r,null,duplicateIds,volunteers));});
    sessions.sort(function(a,b){const am=(a.signIn||a.signOut).timestamp.ms,bm=(b.signIn||b.signOut).timestamp.ms;return bm-am;});
    return sessions;
  };

  C.batchId=function(signIns,signOuts){const ids=(signIns||[]).concat(signOuts||[]).map(function(r){return r.id;}).sort();return'batch_'+C.hashString(ids.join('|'));};
  C.finalMinutes=function(session){return session.staffCreditedMinutes==null?(session.calculatedMinutes==null?0:session.calculatedMinutes):Math.max(0,Math.round(Number(session.staffCreditedMinutes)||0));};
  C.formatMinutes=function(value){if(value==null)return'—';const n=Math.max(0,Math.round(Number(value)||0)),h=Math.floor(n/60),m=n%60;if(h&&m)return h+'h '+m+'m';if(h)return h+'h';return m+'m';};

  C.shirtSummary=function(sessions){
    const sizes={},issues=[];let total=0,flagged=0;
    (sessions||[]).forEach(function(s){if(s.included===false||!s.signIn)return;const q=Math.max(0,Number(s.signIn.shirtQuantity)||0);if(!q)return;const size=C.clean(s.signIn.shirtSize)||'Unspecified';sizes[size]=(sizes[size]||0)+q;total+=q;if(s.reviewFlags.indexOf('possible_duplicate')>-1)flagged+=q;issues.push({sessionId:s.id,name:s.signIn.name,eventName:s.eventName,eventDate:s.eventDate,size:size,quantity:q,flagged:s.reviewFlags.indexOf('possible_duplicate')>-1});});
    return{total:total,flaggedQuantity:flagged,sizes:sizes,issues:issues};
  };

  C.feedbackSummary=function(sessions){
    const keys=['briefing','onboarding','roleSatisfaction','staffSupport'],sums={briefing:0,onboarding:0,roleSatisfaction:0,staffSupport:0},counts={briefing:0,onboarding:0,roleSatisfaction:0,staffSupport:0},responses=[];let yes=0,no=0;
    (sessions||[]).forEach(function(s){if(s.included===false||!s.signOut||!s.signOut.feedback)return;const f=s.signOut.feedback;keys.forEach(function(k){if(Number.isFinite(f[k])){sums[k]+=f[k];counts[k]++;}});const rec=C.lower(f.recommend);if(rec==='yes')yes++;else if(rec==='no')no++;responses.push({sessionId:s.id,name:s.signOut.name,eventName:s.eventName,eventDate:s.eventDate,improvement:f.improvement,recommend:f.recommend,referralEmail:f.referralEmail,feedback:f});});
    const averages={};keys.forEach(function(k){averages[k]=counts[k]?Math.round((sums[k]/counts[k])*100)/100:null;});return{count:responses.length,averages:averages,recommendYes:yes,recommendNo:no,responses:responses};
  };

  C.serializeSubmission=function(r,batchId){
    const f=r.feedback||{};
    return{id:r.id,batch_id:batchId,submission_type:r.type,source_response_id:r.responseId,source_file_name:r.fileName||null,submitted_at:r.timestamp.iso,submitted_date:r.timestamp.date,full_name:r.name,email:r.email||null,phone:r.phone||null,event_name:r.eventName,shirt_quantity:r.type==='sign_in'?r.shirtQuantity:0,shirt_size:r.type==='sign_in'?(r.shirtSize||null):null,age_group:r.type==='sign_out'?(f.ageGroup||null):null,gender:r.type==='sign_out'?(f.gender||null):null,volunteer_tenure:r.type==='sign_out'?(f.tenure||null):null,volunteer_frequency:r.type==='sign_out'?(f.frequency||null):null,briefing_rating:r.type==='sign_out'?f.briefing:null,onboarding_rating:r.type==='sign_out'?f.onboarding:null,role_satisfaction_rating:r.type==='sign_out'?f.roleSatisfaction:null,staff_support_rating:r.type==='sign_out'?f.staffSupport:null,improvement_feedback:r.type==='sign_out'?(f.improvement||null):null,recommendation:r.type==='sign_out'?(f.recommend||null):null,referral_email:r.type==='sign_out'?(f.referralEmail||null):null,raw_payload:r.raw||{}};
  };

  C.serializeReconciliation=function(s,batchId){
    return{id:s.id,batch_id:batchId,volunteer_id:s.volunteerMatch&&s.volunteerMatch.id||null,sign_in_submission_id:s.signIn&&s.signIn.id||null,sign_out_submission_id:s.signOut&&s.signOut.id||null,event_name:s.eventName,event_date:s.eventDate,sign_in_at:s.signIn&&s.signIn.timestamp.iso||null,sign_out_at:s.signOut&&s.signOut.timestamp.iso||null,calculated_duration_minutes:s.calculatedMinutes,staff_credited_duration_minutes:s.staffCreditedMinutes,staff_credit_note:s.staffCreditNote||null,match_status:s.matchStatus,match_confidence:s.matchConfidence,match_reason:s.matchReason||null,review_flags:s.reviewFlags||[],included:s.included!==false,review_acknowledged:!!s.reviewAcknowledged};
  };

  return C;
});