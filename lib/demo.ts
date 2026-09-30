import type {Submission} from './types';
export function demoSubmission(i:number,eventId='demo'):Submission{return {id:`demo-${i}`,event_id:eventId,image_url:`/samples/sample-${(i%12)+1}.svg`,thumbnail_url:`/samples/sample-${(i%12)+1}.svg`,name:`Guest ${i+1}`,message:null,status:'approved',tile_index:i,created_at:new Date().toISOString(),approved_at:new Date().toISOString()}}
export function demoSubmissions(count:number,eventId='demo'){return Array.from({length:count},(_,i)=>demoSubmission(i,eventId))}
