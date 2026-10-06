import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, FileButton, Group, Paper, Progress, ScrollArea, Select, SimpleGrid, Stack, Table, Text, Textarea, Title,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchReconciliationBatches, fetchReconciliationRows, parseReconciliationWorkbook,
  reviewReconciliationChange, reviewReconciliationMatch, stageReconciliationWorkbook,
  type ReconciliationBatch, type ReconciliationChange, type ReconciliationPreview, type ReconciliationRow,
} from './api';
import { safeDateTime } from '../../lib/utils';

function display(value:string|null|undefined){return value?.trim()||'—';}
function fieldLabel(field:string){return field.replaceAll('_',' ');}
function statusColor(status:string){
  if(status==='confirmed'||status==='approved'||status==='completed')return 'green';
  if(status==='rejected')return 'red';
  if(status==='stale'||status==='needs_confirmation')return 'orange';
  return 'blue';
}

function rowLabel(row:ReconciliationRow){
  return 'Row '+row.source_row_number+' · '+(row.source_name||row.source_volunteer_code||row.target_volunteer_code);
}

export function ProfileReconciliationView({canWrite}:{canWrite:boolean}){
  const qc=useQueryClient();
  const[file,setFile]=useState<File|null>(null);
  const[preview,setPreview]=useState<ReconciliationPreview|null>(null);
  const[selectedBatchId,setSelectedBatchId]=useState<string|null>(()=>sessionStorage.getItem('maklom-profile-reconciliation-batch'));
  const[selectedRowId,setSelectedRowId]=useState<string|null>(null);
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState<{kind:'error'|'success'|'info';text:string}|null>(null);

  const batches=useQuery({queryKey:['profile-reconciliation-batches'],queryFn:fetchReconciliationBatches});
  const activeBatchId=selectedBatchId||batches.data?.[0]?.id||null;
  const rows=useQuery({
    queryKey:['profile-reconciliation-rows',activeBatchId],
    queryFn:()=>fetchReconciliationRows(activeBatchId as string),
    enabled:!!activeBatchId,
  });

  useEffect(()=>{
    if(selectedBatchId)sessionStorage.setItem('maklom-profile-reconciliation-batch',selectedBatchId);
  },[selectedBatchId]);

  useEffect(()=>{
    if(!activeBatchId||!rows.data?.length)return;
    const storageKey='maklom-profile-reconciliation-row:'+activeBatchId;
    const storedRowId=sessionStorage.getItem(storageKey);
    const current=rows.data.find((row)=>row.id===selectedRowId);
    const stored=rows.data.find((row)=>row.id===storedRowId);
    const unresolved=rows.data.find((row)=>
      row.match_status==='needs_confirmation'||
      row.maklom_profile_reconciliation_changes.some((change)=>change.status==='pending')
    );
    const nextId=current?.id||stored?.id||unresolved?.id||rows.data[0].id;
    if(nextId!==selectedRowId)setSelectedRowId(nextId);
  },[activeBatchId,rows.data,selectedRowId]);

  useEffect(()=>{
    if(activeBatchId&&selectedRowId){
      sessionStorage.setItem('maklom-profile-reconciliation-row:'+activeBatchId,selectedRowId);
    }
  },[activeBatchId,selectedRowId]);

  const activeBatch=useMemo(
    ()=>batches.data?.find((batch)=>batch.id===activeBatchId)||null,
    [batches.data,activeBatchId],
  );
  const selectedIndex=Math.max(0,rows.data?.findIndex((row)=>row.id===selectedRowId)??0);
  const activeRow=rows.data?.find((row)=>row.id===selectedRowId)||rows.data?.[0]||null;
  const resolvedChanges=activeRow?.maklom_profile_reconciliation_changes.filter((change)=>change.status!=='pending').length||0;
  const totalChanges=activeRow?.maklom_profile_reconciliation_changes.length||0;

  async function chooseFile(next:File|null){
    if(!next||!canWrite)return;
    setBusy(true);setMessage(null);setFile(next);setPreview(null);
    try{
      const parsed=await parseReconciliationWorkbook(next);
      setPreview(parsed);
      setMessage({kind:'info',text:
        'Parsed '+parsed.sourceRows.toLocaleString()+' spreadsheet rows. '+
        parsed.candidateRows.toLocaleString()+' have existing MakLom contact evidence and may be staged; '+
        parsed.prefilteredUnmatched.toLocaleString()+' have no existing roster match and will not be sent to the database.'
      });
    }catch(error){
      setFile(null);
      setMessage({kind:'error',text:error instanceof Error?error.message:'The workbook could not be parsed.'});
    }finally{setBusy(false);}
  }

  async function stage(){
    if(!file||!preview||!canWrite)return;
    setBusy(true);setMessage(null);
    try{
      const result=await stageReconciliationWorkbook(file,preview);
      setSelectedBatchId(result.batch_id);setSelectedRowId(null);setFile(null);setPreview(null);
      setMessage({kind:'success',text:
        'Staged '+result.matched_rows.toLocaleString()+' existing MakLom volunteer row(s). '+
        result.unmatched_rows.toLocaleString()+' unmatched and '+result.conflict_rows.toLocaleString()+
        ' conflicting spreadsheet row(s) were excluded. No volunteers were created. '+
        result.changes.toLocaleString()+' field-level proposal(s) are ready for review.'
      });
      await qc.invalidateQueries({queryKey:['profile-reconciliation-batches']});
      await qc.invalidateQueries({queryKey:['profile-reconciliation-rows']});
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Could not stage the reconciliation workbook.'});
    }finally{setBusy(false);}
  }

  async function refresh(){
    await Promise.all([
      qc.invalidateQueries({queryKey:['profile-reconciliation-batches']}),
      qc.invalidateQueries({queryKey:['profile-reconciliation-rows']}),
      qc.invalidateQueries({queryKey:['volunteers-v2']}),
      qc.invalidateQueries({queryKey:['volunteer-filter-options-v2']}),
    ]);
  }

  async function reviewMatch(row:ReconciliationRow,decision:'confirmed'|'rejected'){
    if(!canWrite)return;
    setBusy(true);setMessage(null);
    try{
      await reviewReconciliationMatch(row.id,decision);
      setMessage({kind:'success',text:decision==='confirmed'
        ?'Match confirmed. You can now review this row field by field.'
        :'Spreadsheet row rejected. None of its proposed values will be applied.'});
      await refresh();
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Could not review this match.'});
    }finally{setBusy(false);}
  }

  async function reviewChange(change:ReconciliationChange,decision:'approved'|'rejected'){
    if(!canWrite)return;
    setBusy(true);setMessage(null);
    try{
      const result=await reviewReconciliationChange(change.id,decision) as {status?:string};
      setMessage({kind:result?.status==='stale'?'error':'success',text:
        result?.status==='stale'
          ?'This field changed in MakLom after the workbook was staged. It was marked stale and not overwritten.'
          :decision==='approved'?'Field approved and applied to the existing volunteer.':'Field rejected; MakLom was not changed.'
      });
      await refresh();
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Could not review this field.'});
    }finally{setBusy(false);}
  }

  async function acceptAllEmptyFields(row:ReconciliationRow){
    if(!canWrite||row.match_status!=='confirmed')return;
    const pending=row.maklom_profile_reconciliation_changes.filter((change)=>change.status==='pending');
    if(!pending.length||pending.some((change)=>Boolean(change.old_value?.trim())))return;
    setBusy(true);setMessage(null);
    try{
      let approved=0;
      for(const change of pending){
        const result=await reviewReconciliationChange(
          change.id,
          'approved',
          'Accepted all because every proposed target field was empty.'
        ) as {status?:string};
        if(result?.status==='stale'){
          throw new Error('A MakLom field changed after this workbook was staged. The changed field was not overwritten; review the remaining fields individually.');
        }
        approved+=1;
      }
      setMessage({kind:'success',text:approved+' empty field'+(approved===1?' was':'s were')+' accepted for this volunteer.'});
      await refresh();
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Could not accept all empty fields.'});
      await refresh();
    }finally{setBusy(false);}
  }

  const batchOptions=(batches.data||[]).map((batch)=>({
    value:batch.id,
    label:new Date(batch.created_at).toLocaleString('en-SG')+' · '+batch.source_filename,
  }));

  return <Stack gap="md">
    <Group justify="space-between" align="flex-end">
      <div>
        <Title order={2}>Profile Reconciliation</Title>
        <Text c="dimmed" size="sm">Bring useful legacy profile facts into existing MakLom volunteers, one reviewed row at a time.</Text>
      </div>
      {activeBatch&&<Badge size="lg" variant="light" color={statusColor(activeBatch.status)}>{activeBatch.status}</Badge>}
    </Group>

    <Alert color="blue" title="Existing roster only">
      This workflow cannot create volunteers. Spreadsheet rows that do not resolve to a volunteer already in the MakLom roster are excluded. Names are comparison evidence only; they are never used as a standalone identity match.
    </Alert>

    {message&&<Alert color={message.kind==='error'?'red':message.kind==='success'?'green':'blue'}>{message.text}</Alert>}

    <Paper withBorder radius="lg" p="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={4}>Stage a workbook</Title>
          <Text c="dimmed" size="sm">Only approved columns are extracted in the browser. Irrelevant source columns are not stored in the reconciliation queue.</Text>
        </div>
        {canWrite?<FileButton accept=".xlsx,.xls" onChange={(next)=>void chooseFile(next)}>
          {(props)=><Button {...props} variant="default" loading={busy}>Choose volunteer workbook</Button>}
        </FileButton>:<Text size="sm" c="dimmed">Read-only access.</Text>}
      </Group>

      {preview&&<Stack mt="md" gap="sm">
        <SimpleGrid cols={{base:2,md:4}}>
          <Stat label="Source rows" value={preview.sourceRows}/>
          <Stat label="Possible existing matches" value={preview.candidateRows}/>
          <Stat label="No roster match" value={preview.prefilteredUnmatched}/>
          <Stat label="New volunteers" value={0}/>
        </SimpleGrid>
        <Alert color="orange">
          Staging creates review records only. It does not alter volunteer profiles. Actual profile fields change only when you approve each field after confirming the row match.
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={()=>{setFile(null);setPreview(null);setMessage(null);}} disabled={busy}>Cancel</Button>
          <Button onClick={()=>void stage()} loading={busy}>Stage for line-by-line review</Button>
        </Group>
      </Stack>}
    </Paper>

    <Paper withBorder radius="lg" p="md">
      <Select
        label="Reconciliation batch"
        placeholder={batches.isLoading?'Loading batches…':'No reconciliation batches yet'}
        data={batchOptions}
        value={activeBatchId}
        onChange={(value)=>setSelectedBatchId(value)}
        searchable
        clearable={false}
      />
      {activeBatch&&<SimpleGrid cols={{base:2,md:6}} mt="md">
        <Stat label="Spreadsheet rows" value={activeBatch.source_row_count}/>
        <Stat label="Matched existing" value={activeBatch.matched_row_count}/>
        <Stat label="Unmatched excluded" value={activeBatch.unmatched_row_count}/>
        <Stat label="Conflicts excluded" value={activeBatch.conflict_row_count}/>
        <Stat label="Matches to confirm" value={activeBatch.pending_match_count}/>
        <Stat label="Field proposals" value={activeBatch.change_count}/>
      </SimpleGrid>}
    </Paper>

    {activeBatchId&&<Paper withBorder radius="lg" p="lg">
      {!rows.isLoading&&!activeRow&&<Text c="dimmed">This batch has no matched MakLom volunteers to review.</Text>}
      {activeRow&&<Stack gap="md">
        <Group justify="space-between" align="center" wrap="wrap">
          <div>
            <Text size="xs" c="dimmed">Spreadsheet review</Text>
            <Title order={4}>{rowLabel(activeRow)}</Title>
            <Text size="sm" c="dimmed">Matched to {activeRow.target_volunteer_code} · {selectedIndex+1} of {rows.data?.length||0}</Text>
          </div>
          <Group>
            <Button variant="default" disabled={selectedIndex===0||busy} onClick={()=>{const previous=rows.data?.[selectedIndex-1];if(previous)setSelectedRowId(previous.id);}}>Previous</Button>
            <Button variant="default" disabled={selectedIndex>=(rows.data?.length||1)-1||busy} onClick={()=>{const next=rows.data?.[selectedIndex+1];if(next)setSelectedRowId(next.id);}}>Next</Button>
          </Group>
        </Group>

        <Progress value={rows.data?.length?((selectedIndex+1)/rows.data.length)*100:0}/>

        <SimpleGrid cols={{base:1,md:2}}>
          <Paper withBorder radius="md" p="md">
            <Text fw={700} mb="xs">Spreadsheet source</Text>
            <CompareLine label="Excel row" value={String(activeRow.source_row_number)}/>
            <CompareLine label="Legacy code" value={display(activeRow.source_volunteer_code)}/>
            <CompareLine label="Full Name" value={display(activeRow.source_name)}/>
            <CompareLine label="Email" value={display(activeRow.source_email)}/>
            <CompareLine label="Mobile" value={display(activeRow.source_mobile)}/>
          </Paper>
          <Paper withBorder radius="md" p="md">
            <Group justify="space-between" mb="xs"><Text fw={700}>Existing MakLom volunteer</Text><Badge variant="light" color={statusColor(activeRow.match_status)}>{activeRow.match_status.replaceAll('_',' ')}</Badge></Group>
            <CompareLine label="KEL ID" value={activeRow.target_volunteer_code}/>
            <CompareLine label="Name" value={activeRow.target_name_at_stage}/>
            <CompareLine label="Email" value={display(activeRow.target_email_at_stage)}/>
            <CompareLine label="Mobile" value={display(activeRow.target_mobile_at_stage)}/>
          </Paper>
        </SimpleGrid>

        <Paper withBorder radius="md" p="md">
          <Text size="xs" c="dimmed">Why this row matched</Text>
          <Text fw={600}>{activeRow.match_reason}</Text>
          <Text size="xs" c="dimmed" mt={4}>Method: {activeRow.match_method.replaceAll('_',' + ')}</Text>
          {!!activeRow.source_warnings?.length&&<Stack gap={4} mt="sm">{activeRow.source_warnings.map((warning)=><Text key={warning} size="sm" c="orange">• {warning}</Text>)}</Stack>}
        </Paper>

        {activeRow.match_status==='needs_confirmation'&&canWrite&&<Group justify="flex-end">
          <Button color="red" variant="light" loading={busy} onClick={()=>void reviewMatch(activeRow,'rejected')}>Reject row match</Button>
          <Button loading={busy} onClick={()=>void reviewMatch(activeRow,'confirmed')}>Confirm this volunteer</Button>
        </Group>}

        {activeRow.match_status==='rejected'&&<Alert color="red">This source row was rejected. No proposed values from it can be applied.</Alert>}

        <Paper withBorder radius="md" p={0} style={{overflow:'hidden'}}>
          <Group justify="space-between" p="md" align="flex-end">
            <div><Text fw={700}>Field-by-field review</Text><Text size="sm" c="dimmed">{resolvedChanges} of {totalChanges} proposals resolved for this row.</Text></div>
            <Group gap="xs">
              {activeRow.match_status==='confirmed'&&
                activeRow.maklom_profile_reconciliation_changes.some((change)=>change.status==='pending')&&
                activeRow.maklom_profile_reconciliation_changes.filter((change)=>change.status==='pending').every((change)=>!change.old_value?.trim())&&
                canWrite&&<Button size="xs" loading={busy} onClick={()=>void acceptAllEmptyFields(activeRow)}>Accept all empty fields</Button>}
              {activeRow.match_status!=='confirmed'&&<Badge color="orange" variant="light">Confirm match first</Badge>}
            </Group>
          </Group>
          <ScrollArea>
            <Table miw={1050} striped verticalSpacing="sm">
              <Table.Thead><Table.Tr>
                <Table.Th>Field</Table.Th><Table.Th>Source</Table.Th><Table.Th>Current MakLom</Table.Th><Table.Th>Proposed</Table.Th><Table.Th>Transformation</Table.Th><Table.Th>Status / action</Table.Th>
              </Table.Tr></Table.Thead>
              <Table.Tbody>
                {activeRow.maklom_profile_reconciliation_changes.map((change)=><Table.Tr key={change.id}>
                  <Table.Td><Text fw={600}>{fieldLabel(change.field_name)}</Text><Text size="xs" c="dimmed">{change.target_scope==='private_details'?'Private details':'MakLom profile'}</Text></Table.Td>
                  <Table.Td><Text size="sm">{change.source_label}</Text><Text size="xs" c="dimmed">{display(change.source_value)}</Text></Table.Td>
                  <Table.Td>{display(change.old_value)}</Table.Td>
                  <Table.Td><Text fw={600}>{change.proposed_value}</Text></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{change.transformation||'Direct copy after trimming.'}</Text></Table.Td>
                  <Table.Td>
                    {change.status==='pending'&&canWrite?<Group gap="xs" wrap="nowrap">
                      <Button size="compact-xs" variant="light" color="red" disabled={activeRow.match_status!=='confirmed'||busy} onClick={()=>void reviewChange(change,'rejected')}>Reject</Button>
                      <Button size="compact-xs" disabled={activeRow.match_status!=='confirmed'||busy} onClick={()=>void reviewChange(change,'approved')}>Approve</Button>
                    </Group>:<Badge variant="light" color={statusColor(change.status)}>{change.status}</Badge>}
                  </Table.Td>
                </Table.Tr>)}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          {!activeRow.maklom_profile_reconciliation_changes.length&&<Text c="dimmed" ta="center" p="xl">No relevant values differ from MakLom for this row.</Text>}
        </Paper>

        <Group justify="space-between">
          <Text size="xs" c="dimmed">Batch staged {activeBatch?safeDateTime(activeBatch.created_at):'—'}. Review position is saved in this browser session.</Text>
          <Group>
            <Button variant="subtle" disabled={selectedIndex===0||busy} onClick={()=>{const previous=rows.data?.[selectedIndex-1];if(previous)setSelectedRowId(previous.id);}}>Previous volunteer</Button>
            <Button disabled={selectedIndex>=(rows.data?.length||1)-1||busy} onClick={()=>{const next=rows.data?.[selectedIndex+1];if(next)setSelectedRowId(next.id);}}>Next volunteer</Button>
          </Group>
        </Group>
      </Stack>}
    </Paper>}
  </Stack>;
}

function Stat({label,value}:{label:string;value:number}){
  return <Paper withBorder radius="md" p="sm"><Text size="xs" c="dimmed">{label}</Text><Text fw={800} fz="lg">{value.toLocaleString()}</Text></Paper>;
}

function CompareLine({label,value}:{label:string;value:string}){
  return <Group justify="space-between" gap="md" wrap="nowrap" py={3}><Text size="xs" c="dimmed">{label}</Text><Text size="sm" ta="right" style={{wordBreak:'break-word'}}>{value}</Text></Group>;
}
