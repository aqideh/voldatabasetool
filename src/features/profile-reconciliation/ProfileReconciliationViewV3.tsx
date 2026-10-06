import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, FileButton, Grid, Group, Paper, Progress, ScrollArea, Select, SimpleGrid, Stack, Table, Text, Title,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchReconciliationBatches, fetchReconciliationRows, parseReconciliationWorkbook,
  reviewReconciliationChange, reviewReconciliationMatch, stageReconciliationWorkbook,
  type ReconciliationChange, type ReconciliationPreview, type ReconciliationRow,
} from './api';
import { safeDateTime } from '../../lib/utils';
import { isSafeQueueRow, processSafeQueueRows, type SafeQueueProgress } from './safeQueue';
import './reconciliationMotion.css';

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
  const[safeProgress,setSafeProgress]=useState<SafeQueueProgress|null>(null);
  const[reviewStreak,setReviewStreak]=useState(()=>Number(sessionStorage.getItem('maklom-reconciliation-streak')||0));
  const[lastAction,setLastAction]=useState<{changeId:string;decision:'approved'|'rejected'}|null>(null);
  const[celebration,setCelebration]=useState<string|null>(null);
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

  function bumpStreak(){
    setReviewStreak((current)=>{
      const next=current+1;
      sessionStorage.setItem('maklom-reconciliation-streak',String(next));
      return next;
    });
  }

  function celebrate(label:string){
    setCelebration(label);
    window.setTimeout(()=>setCelebration(null),950);
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
    const completesVolunteer=activeRow?.id===change.row_id&&pendingChanges.length===1;
    setBusy(true);setMessage(null);
    try{
      const result=await reviewReconciliationChange(change.id,decision) as {status?:string};
      setMessage({kind:result?.status==='stale'?'error':'success',text:
        result?.status==='stale'
          ?'This field changed in MakLom after the workbook was staged. It was marked stale and not overwritten.'
          :decision==='approved'?'Field approved and applied to the existing volunteer.':'Field rejected; MakLom was not changed.'
      });
      if(result?.status!=='stale'){
        setLastAction({changeId:change.id,decision});
        window.setTimeout(()=>setLastAction(null),650);
        bumpStreak();
        if(completesVolunteer)celebrate('Volunteer resolved ✦');
      }
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
      setReviewStreak((current)=>{const next=current+approved;sessionStorage.setItem('maklom-reconciliation-streak',String(next));return next;});
      celebrate('Volunteer cleared ✦');
      await refresh();
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Could not accept all empty fields.'});
      await refresh();
    }finally{setBusy(false);}
  }

  async function processSafeQueue(){
    if(!canWrite||!safeQueueRows.length)return;
    setBusy(true);setMessage(null);
    try{
      const result=await processSafeQueueRows(safeQueueRows,setSafeProgress);
      setReviewStreak((current)=>{const next=current+result.approvedFields;sessionStorage.setItem('maklom-reconciliation-streak',String(next));return next;});
      if(result.appliedRows)celebrate(result.appliedRows.toLocaleString()+' safe matches cleared ✦');
      setMessage({
        kind:result.skippedRows?'info':'success',
        text:
          result.appliedRows.toLocaleString()+' high-confidence volunteer'+(result.appliedRows===1?' was':'s were')+
          ' processed and '+result.approvedFields.toLocaleString()+' blank field'+(result.approvedFields===1?' was':'s were')+
          ' accepted.'+
          (result.skippedRows?' '+result.skippedRows.toLocaleString()+' row(s) were skipped because they no longer passed the safety checks.':'')
      });
      await refresh();
    }catch(error){
      setMessage({kind:'error',text:error instanceof Error?error.message:'Could not complete the high-confidence queue.'});
      await refresh();
    }finally{
      setSafeProgress(null);
      setBusy(false);
    }
  }

  const batchOptions=(batches.data||[]).map((batch)=>({
    value:batch.id,
    label:new Date(batch.created_at).toLocaleString('en-SG')+' · '+batch.source_filename,
  }));

  const safeQueueRows=(rows.data||[]).filter(isSafeQueueRow);
  const pendingChanges=activeRow?.maklom_profile_reconciliation_changes.filter((change)=>change.status==='pending')||[];
  const rejectedChanges=activeRow?.maklom_profile_reconciliation_changes.filter((change)=>change.status==='rejected')||[];
  const canAcceptAllEmpty=Boolean(
    canWrite&&activeRow?.match_status==='confirmed'&&pendingChanges.length&&pendingChanges.every((change)=>!change.old_value?.trim())
  );
  const nextUnresolved=rows.data?.slice(selectedIndex+1).find((row)=>
    row.match_status==='needs_confirmation'||
    row.maklom_profile_reconciliation_changes.some((change)=>change.status==='pending')
  )||null;

  function goPrevious(){
    const previous=rows.data?.[selectedIndex-1];
    if(previous)setSelectedRowId(previous.id);
  }
  function goNext(){
    const next=rows.data?.[selectedIndex+1];
    if(next)setSelectedRowId(next.id);
  }

  return <>
    {celebration&&<div className="recon-celebration" aria-hidden="true">
      <div className="recon-celebration-card">{celebration}</div>
      <span className="recon-sparkle">✦</span>
      <span className="recon-sparkle">✧</span>
      <span className="recon-sparkle">✦</span>
      <span className="recon-sparkle">✧</span>
      <span className="recon-sparkle">✦</span>
      <span className="recon-sparkle">✧</span>
    </div>}
    <Stack gap="sm">
    <Group justify="space-between" align="flex-end">
      <div>
        <Title order={2}>Profile Reconciliation</Title>
        <Text c="dimmed" size="sm">Review legacy profile data against the existing MakLom roster.</Text>
      </div>
      {activeBatch&&<Badge size="lg" variant="light" color={statusColor(activeBatch.status)}>{activeBatch.status}</Badge>}
    </Group>

    <Paper withBorder radius="lg" p="sm">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Select
          label="Batch"
          placeholder={batches.isLoading?'Loading batches…':'No reconciliation batches yet'}
          data={batchOptions}
          value={activeBatchId}
          onChange={(value)=>setSelectedBatchId(value)}
          searchable
          clearable={false}
          w={{base:'100%',sm:420}}
        />
        {activeBatch&&<Group gap="xs" wrap="wrap">
          <Badge variant="light">{activeBatch.matched_row_count.toLocaleString()} matched</Badge>
          <Badge variant="light" color="orange">{activeBatch.pending_match_count.toLocaleString()} matches to confirm</Badge>
          <Badge variant="light" color="gray">{activeBatch.change_count.toLocaleString()} field proposals</Badge>
        </Group>}
      </Group>
    </Paper>

    {message&&<Alert color={message.kind==='error'?'red':message.kind==='success'?'green':'blue'}>{message.text}</Alert>}

    {activeBatchId&&safeQueueRows.length>0&&<Paper withBorder radius="lg" p="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <div>
          <Group gap="xs">
            <Text fw={800}>High-confidence safe queue</Text>
            <Badge color="green" variant="light">{safeQueueRows.length.toLocaleString()} volunteers</Badge>
          </Group>
          <Text size="sm" c="dimmed" mt={3}>
            Exact email + mobile + normalized name · no warnings · all remaining pending destination fields are blank.
          </Text>
          <Text size="xs" c="dimmed" mt={3}>
            Previously rejected or approved fields are left untouched.
          </Text>
        </div>
        <Group gap="xs">
          <Button size="xs" variant="default" disabled={busy} onClick={()=>setSelectedRowId(safeQueueRows[0].id)}>Review first</Button>
          {canWrite&&<Button size="xs" loading={busy} onClick={()=>void processSafeQueue()}>Process safe queue</Button>}
        </Group>
      </Group>
      {safeProgress&&<Stack gap={4} mt="sm">
        <Progress value={safeProgress.total?(safeProgress.done/safeProgress.total)*100:0}/>
        <Text size="xs" c="dimmed">{safeProgress.done.toLocaleString()} of {safeProgress.total.toLocaleString()} volunteers processed</Text>
      </Stack>}
    </Paper>}

    {activeBatchId&&<Paper withBorder radius="lg" p={0} style={{overflow:'visible'}}>
      {!rows.isLoading&&!activeRow&&<Text c="dimmed" p="lg">This batch has no matched MakLom volunteers to review.</Text>}
      {activeRow&&<>
        <Group
          justify="space-between"
          align="center"
          wrap="wrap"
          p="md"
          style={{position:'sticky',top:0,zIndex:20,background:'var(--mantine-color-body)',borderBottom:'1px solid var(--mantine-color-default-border)'}}
        >
          <div>
            <Group gap="xs">
              <Title order={4}>{rowLabel(activeRow)}</Title>
              <Badge variant="light" color={statusColor(activeRow.match_status)}>{activeRow.match_status.replaceAll('_',' ')}</Badge>
              <Badge key={reviewStreak} className="recon-streak" variant="outline">{reviewStreak.toLocaleString()} actions</Badge>
            </Group>
            <Text size="sm" c="dimmed">Matched to {activeRow.target_volunteer_code} · {selectedIndex+1} of {rows.data?.length||0}</Text>
          </div>
          <Group gap="xs">
            <Button variant="default" size="xs" disabled={selectedIndex===0||busy} onClick={goPrevious}>Previous</Button>
            {nextUnresolved&&<Button variant="light" size="xs" disabled={busy} onClick={()=>setSelectedRowId(nextUnresolved.id)}>Next unresolved</Button>}
            <Button size="xs" disabled={selectedIndex>=(rows.data?.length||1)-1||busy} onClick={goNext}>Next</Button>
          </Group>
        </Group>

        <Progress size={3} radius={0} value={rows.data?.length?((selectedIndex+1)/rows.data.length)*100:0}/>

        <Grid>
          <Grid.Col span={{base:12,md:4,lg:3}}>
            <Stack
              gap="sm"
              p="md"
              style={{position:'sticky',top:76,alignSelf:'start',maxHeight:'calc(100vh - 100px)',overflowY:'auto'}}
            >
              <Paper withBorder radius="md" p="sm">
                <Text fw={700} size="sm" mb={6}>Spreadsheet source</Text>
                <CompareLine label="Excel row" value={String(activeRow.source_row_number)}/>
                <CompareLine label="Legacy code" value={display(activeRow.source_volunteer_code)}/>
                <CompareLine label="Name" value={display(activeRow.source_name)}/>
                <CompareLine label="Email" value={display(activeRow.source_email)}/>
                <CompareLine label="Mobile" value={display(activeRow.source_mobile)}/>
              </Paper>

              <Paper withBorder radius="md" p="sm">
                <Text fw={700} size="sm" mb={6}>Existing MakLom</Text>
                <CompareLine label="KEL ID" value={activeRow.target_volunteer_code}/>
                <CompareLine label="Name" value={activeRow.target_name_at_stage}/>
                <CompareLine label="Email" value={display(activeRow.target_email_at_stage)}/>
                <CompareLine label="Mobile" value={display(activeRow.target_mobile_at_stage)}/>
              </Paper>

              <Paper withBorder radius="md" p="sm">
                <Text size="xs" c="dimmed">Match evidence</Text>
                <Text size="sm" fw={600}>{activeRow.match_reason}</Text>
                <Text size="xs" c="dimmed" mt={4}>{activeRow.match_method.replaceAll('_',' + ')}</Text>
                {!!activeRow.source_warnings?.length&&<Stack gap={3} mt="xs">
                  {activeRow.source_warnings.map((warning)=><Text key={warning} size="xs" c="orange">• {warning}</Text>)}
                </Stack>}
              </Paper>

              {activeRow.match_status==='needs_confirmation'&&canWrite&&<Stack gap="xs">
                <Button size="xs" onClick={()=>void reviewMatch(activeRow,'confirmed')} loading={busy}>Confirm this volunteer</Button>
                <Button size="xs" color="red" variant="light" onClick={()=>void reviewMatch(activeRow,'rejected')} loading={busy}>Reject row match</Button>
              </Stack>}
              {activeRow.match_status==='rejected'&&<Alert color="red" p="sm">This source row was rejected.</Alert>}

              <Text size="xs" c="dimmed">
                Position saved in this browser session. Batch staged {activeBatch?safeDateTime(activeBatch.created_at):'—'}.
              </Text>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{base:12,md:8,lg:9}} style={{borderLeft:'1px solid var(--mantine-color-default-border)'}}>
            <Stack gap={0}>
              <Group
                justify="space-between"
                align="center"
                p="sm"
                style={{position:'sticky',top:76,zIndex:15,background:'var(--mantine-color-body)',borderBottom:'1px solid var(--mantine-color-default-border)'}}
              >
                <div>
                  <Text fw={700}>Fields to review</Text>
                  <Text size="xs" c="dimmed">{resolvedChanges} of {totalChanges} resolved · {pendingChanges.length} pending</Text>
                </div>
                <Group gap="xs">
                  {canAcceptAllEmpty&&<Button size="xs" loading={busy} onClick={()=>void acceptAllEmptyFields(activeRow)}>
                    {rejectedChanges.length?'Accept remaining empty fields':'Accept all empty fields'}
                  </Button>}
                  {activeRow.match_status!=='confirmed'&&<Badge color="orange" variant="light">Confirm match first</Badge>}
                </Group>
              </Group>

              <ScrollArea h="calc(100vh - 220px)" type="auto" offsetScrollbars>
                <Table stickyHeader striped verticalSpacing="xs" horizontalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{width:'24%'}}>Field / source</Table.Th>
                      <Table.Th style={{width:'25%'}}>Current MakLom</Table.Th>
                      <Table.Th>Proposed</Table.Th>
                      <Table.Th style={{width:150}}>Action</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {activeRow.maklom_profile_reconciliation_changes.map((change)=><Table.Tr
                      key={change.id}
                      className={lastAction?.changeId===change.id?(lastAction.decision==='approved'?'recon-row-approved':'recon-row-rejected'):undefined}
                    >
                      <Table.Td>
                        <Text fw={700} size="sm">{fieldLabel(change.field_name)}</Text>
                        <Text size="xs" c="dimmed">{change.target_scope==='private_details'?'Private details':'MakLom profile'} · {change.source_label}</Text>
                        {change.source_value&&change.source_value!==change.proposed_value&&<Text size="xs" mt={2}>{change.source_value}</Text>}
                      </Table.Td>
                      <Table.Td><Text size="sm">{display(change.old_value)}</Text></Table.Td>
                      <Table.Td>
                        <Text fw={600} size="sm">{change.proposed_value}</Text>
                        {change.transformation&&<Text size="xs" c="dimmed" mt={2}>{change.transformation}</Text>}
                      </Table.Td>
                      <Table.Td>
                        {change.status==='pending'&&canWrite?<Group gap={4} wrap="nowrap">
                          <Button size="compact-xs" variant="light" color="red" disabled={activeRow.match_status!=='confirmed'||busy} onClick={()=>void reviewChange(change,'rejected')}>Reject</Button>
                          <Button size="compact-xs" disabled={activeRow.match_status!=='confirmed'||busy} onClick={()=>void reviewChange(change,'approved')}>Approve</Button>
                        </Group>:<Badge variant="light" color={statusColor(change.status)}>{change.status}</Badge>}
                      </Table.Td>
                    </Table.Tr>)}
                  </Table.Tbody>
                </Table>
                {!activeRow.maklom_profile_reconciliation_changes.length&&<Text c="dimmed" ta="center" p="xl">No relevant values differ from MakLom for this row.</Text>}
              </ScrollArea>
            </Stack>
          </Grid.Col>
        </Grid>
      </>}
    </Paper>}

    <Paper withBorder radius="lg" p="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <div>
          <Text fw={700} size="sm">Stage another workbook</Text>
          <Text c="dimmed" size="xs">Only approved columns are extracted; rows outside the existing MakLom roster are excluded.</Text>
        </div>
        {canWrite?<FileButton accept=".xlsx,.xls" onChange={(next)=>void chooseFile(next)}>
          {(props)=><Button {...props} size="xs" variant="default" loading={busy}>Choose workbook</Button>}
        </FileButton>:<Text size="sm" c="dimmed">Read-only access.</Text>}
      </Group>

      {preview&&<Stack mt="md" gap="sm">
        <SimpleGrid cols={{base:2,md:4}}>
          <Stat label="Source rows" value={preview.sourceRows}/>
          <Stat label="Possible existing matches" value={preview.candidateRows}/>
          <Stat label="No roster match" value={preview.prefilteredUnmatched}/>
          <Stat label="New volunteers" value={0}/>
        </SimpleGrid>
        <Alert color="orange">Staging creates review records only. It does not alter volunteer profiles.</Alert>
        <Group justify="flex-end">
          <Button size="xs" variant="default" onClick={()=>{setFile(null);setPreview(null);setMessage(null);}} disabled={busy}>Cancel</Button>
          <Button size="xs" onClick={()=>void stage()} loading={busy}>Stage for review</Button>
        </Group>
      </Stack>}
    </Paper>
  </Stack>
  </>;
}

function Stat({label,value}:{label:string;value:number}){
  return <Paper withBorder radius="md" p="sm"><Text size="xs" c="dimmed">{label}</Text><Text fw={800} fz="lg">{value.toLocaleString()}</Text></Paper>;
}

function CompareLine({label,value}:{label:string;value:string}){
  return <Group justify="space-between" gap="sm" wrap="nowrap" py={2}><Text size="xs" c="dimmed">{label}</Text><Text size="xs" ta="right" style={{wordBreak:'break-word'}}>{value}</Text></Group>;
}
