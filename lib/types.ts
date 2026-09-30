export type SubmissionStatus='pending'|'approved'|'rejected';
export type Submission={id:string;event_id:string;image_url:string;thumbnail_url:string;name?:string|null;message?:string|null;status:SubmissionStatus;tile_index:number|null;created_at:string;approved_at?:string|null};
export type Event={id:string;name:string;description:string;target_image_url:string|null;rows:number;columns:number;total_slots:number;approved_count:number;status:'draft'|'live'|'ended';created_at:string;updated_at:string;auto_approve?:boolean;final_message?:string;animation_speed?:number;background?:string;accent_color?:string;};
export type Tile={index:number;x:number;y:number;width:number;height:number;r:number;g:number;b:number;brightness:number;dominant:string};
