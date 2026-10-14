/** Preserve sub-minute source precision when a minute-resolution input is unchanged. */
export function singaporeMinuteInput(value:string|null|undefined):string {
  if(!value)return '';
  const timestamp=Date.parse(value);
  if(!Number.isFinite(timestamp))throw new Error('The stored timestamp is invalid. Review this record before saving.');
  return new Date(timestamp+8*60*60*1000).toISOString().slice(0,16);
}

export function timestampFromSingaporeInput(value:string,original:string|null|undefined):string|null {
  if(!value)return null;
  if(original&&value===singaporeMinuteInput(original))return original;
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(value)||Number(value.slice(0,4))<1){
    throw new Error('Enter a valid date and time in Singapore time.');
  }
  const timestamp=value+':00+08:00';
  if(!Number.isFinite(Date.parse(timestamp))||singaporeMinuteInput(timestamp)!==value){
    throw new Error('Enter a valid calendar date and time in Singapore time.');
  }
  return timestamp;
}

/** For existing minute-only clients, preserve a field only against its versioned original. */
export function retainTimestampPrecision(value:string|null,original:string|null|undefined):string|null {
  if(value===null)return null;
  if(!Number.isFinite(Date.parse(value)))throw new Error('An attendance timestamp is invalid.');
  if(original&&/T[0-9]{2}:[0-9]{2}:00(?:\.0+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)
    &&singaporeMinuteInput(value)===singaporeMinuteInput(original))return original;
  return value;
}

function textField(value:unknown,key:string):string|undefined {
  if(!value||typeof value!=='object')return undefined;
  const text=(value as Record<string,unknown>)[key];
  return typeof text==='string'&&text.trim()?text:undefined;
}

export class ApiRequestError extends Error {
  readonly code:string|undefined;
  readonly details:string|undefined;
  readonly hint:string|undefined;
  constructor(value:unknown,defaultMessage='The request could not be completed.') {
    super(textField(value,'message')||(typeof value==='string'&&value.trim()?value:defaultMessage));
    this.name='ApiRequestError';
    this.code=textField(value,'code');
    this.details=textField(value,'details');
    this.hint=textField(value,'hint');
  }
}

export function asApiError(value:unknown):Error {
  return value instanceof Error?value:new ApiRequestError(value);
}

/** Keep errors as errors, including explicit RPC conflict envelopes. Never retry writes here. */
export async function runApiRequest<T>(operation:()=>Promise<T>):Promise<T> {
  try {
    const result=await operation();
    if(result&&typeof result==='object'&&!Array.isArray(result)&&'ok' in result&&result.ok===false){
      const failed=result as Record<string,unknown>;
      throw new ApiRequestError(failed.error??failed);
    }
    return result;
  } catch(error) {
    throw asApiError(error);
  }
}

export function withApiErrors<A extends unknown[],R>(operation:(...args:A)=>Promise<R>):(...args:A)=>Promise<R> {
  return (...args)=>runApiRequest(()=>operation(...args));
}
