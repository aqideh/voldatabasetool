import {useQuery} from '@tanstack/react-query';
import {Paper,SimpleGrid,Stack,Text,Title} from '@mantine/core';
import {supabase} from '../../lib/supabase';
export function AggregateReportingView(){
 const query=useQuery({queryKey:['maklom-aggregate-report'],queryFn:async()=>{
   const {data,error}=await supabase.rpc('maklom_reporting_overview');
   if(error)throw error;
   return data as Record<string,number>;
 }});
 const fields:[string,string][]=[['volunteers','Volunteers'],['events','Legacy events'],['attendance_rows','Attendance rows'],['attended_rows','Attended'],['leads','Leads'],['credited_hours','Credited hours']];
 return <Stack><Title order={2}>Reporting overview</Title><Text c="dimmed" size="sm">Aggregate statistics only; no identifiable volunteer records.</Text>
 {query.error&&<Text c="red">{(query.error as Error).message}</Text>}
 <SimpleGrid cols={{base:2,md:3}}>{fields.map(([key,label])=><Paper p="lg" radius="lg" withBorder key={key}>
 <Text c="dimmed" size="xs">{label}</Text><Title order={3}>{query.isLoading?'…':Number(query.data?.[key]||0).toLocaleString()}</Title>
 </Paper>)}</SimpleGrid></Stack>;
}
