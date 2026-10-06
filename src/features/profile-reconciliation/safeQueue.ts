import {
  reviewReconciliationChange,
  reviewReconciliationMatch,
  type ReconciliationRow,
} from './api';

export type SafeQueueProgress={done:number;total:number};

function normalizedName(value:string|null|undefined){
  return String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
}

export function isSafeQueueRow(row:ReconciliationRow){
  const pending=row.maklom_profile_reconciliation_changes.filter((change)=>change.status==='pending');
  return (
    row.match_method==='email_mobile' &&
    (row.match_status==='needs_confirmation'||row.match_status==='confirmed') &&
    (row.source_warnings?.length||0)===0 &&
    Boolean(normalizedName(row.source_name)) &&
    normalizedName(row.source_name)===normalizedName(row.target_name_at_stage) &&
    pending.length>0 &&
    pending.every((change)=>!change.old_value?.trim())
  );
}

async function processSafeRow(row:ReconciliationRow){
  if(row.match_status==='needs_confirmation'){
    await reviewReconciliationMatch(
      row.id,
      'confirmed',
      'High-confidence queue: exact email + mobile + normalized name; no warnings.'
    );
  }

  let approvedFields=0;
  const pending=row.maklom_profile_reconciliation_changes.filter((change)=>change.status==='pending');
  for(const change of pending){
    const result=await reviewReconciliationChange(
      change.id,
      'approved',
      'High-confidence queue: destination field was blank.'
    ) as {status?:string};
    if(result?.status==='stale')throw new Error('A destination field changed after staging.');
    approvedFields+=1;
  }
  return approvedFields;
}

export async function processSafeQueueRows(
  rows:ReconciliationRow[],
  onProgress:(progress:SafeQueueProgress)=>void,
){
  let appliedRows=0;
  let approvedFields=0;
  let skippedRows=0;
  const concurrency=6;

  onProgress({done:0,total:rows.length});

  for(let offset=0;offset<rows.length;offset+=concurrency){
    const chunk=rows.slice(offset,offset+concurrency);
    const results=await Promise.allSettled(chunk.map((row)=>processSafeRow(row)));
    results.forEach((result)=>{
      if(result.status==='fulfilled'){
        appliedRows+=1;
        approvedFields+=result.value;
      }else{
        skippedRows+=1;
      }
    });
    onProgress({done:Math.min(offset+chunk.length,rows.length),total:rows.length});
  }

  return{appliedRows,approvedFields,skippedRows};
}
