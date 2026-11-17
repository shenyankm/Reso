import type {AgentAction} from './agent'
export type Domain = 'private' | 'room'
export type User = { id: string; name: string; email: string }
export type InvitationPreview = { title:string;has_summary:boolean;inviter_name?:string;member_names?:string[] }
export type SavedRecord = { id:string;event_id:string;event_title:string;kind:'story'|'nvc'|'roleplay'|'followup';updated_at:string }
export type SavedRecordPage = { records:SavedRecord[];nextOffset:number|null }
export type EventRecord = { id: string; owner_id: string; title: string; room_title: string; room_updated_at: string; summary: string; summary_version: number; private_version: number; room_version: number; initial_summary: string; created_at: string; updated_at: string; is_owner?: boolean }
export type ChatMessage = { id: string; event_id: string; author_id: string | null; author_name: string; domain: Domain; role: 'user' | 'assistant'; content: string; status: 'complete' | 'error'; client_id: string | null; in_reply_to: string | null; created_at: string; card_type: 'safety' | null;understanding_kind?:'summary'|'inference'|null;reasoning_content?:string|null;agent_actions?:AgentAction[] }
export type Exercise = { act: number; paused: boolean; notes: Record<string, string>; story: string; saved: boolean; version: number; practice_notes: Record<string,Record<string,string>> }
export type Questionnaire = { version: string; answers: (number | null)[]; scores: Record<string, number> | null; discovery: string; state: 'draft' | 'unconfirmed' | 'accepted' | 'rejected'; confirmed_summary: string; revision: number }
export type Member = { user_id: string; name: string; shared: boolean }
export type Perspective = { user_id: string; name: string; text: string; confirmed: boolean; version: number }
export type Consultant = { id: string; name: string; approach: string; qualifications: string; price: string; test_only: boolean; specialties:string[];service_modes:string[];availability:string;recommendation_reason:string }
export type Application = { id: string; event_id: string; consultant_id: string; consultant_name: string; applicant_name: string; status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'proposed' | 'scheduled' | 'completed'; shared_summary: string | null; scheduled_at: string | null; proposed_at:string|null; schedule_version:number;rejection_reason:string;created_at: string;note_content?:string|null;note_version?:number|null;note_visible?:boolean;note_shares?:{recipient_id:string;source_version:number}[] }
export type Understanding = {id:string;event_id:string;domain:Domain;author_id:string;source_message_id:string;source_author_id:string|null;source_author_name:string;content:string;provenance:'user_quoted'|'model_inference'|'user_corrected';version:number;status:'unconfirmed'|'disputed'|'participant_confirmed'|'jointly_confirmed';confirmations:{user_id:string;agreed:boolean;confirmed_at:string}[]}
export type Followup = {id:string;event_id:string;event_title?:string;reflection:string;next_step:string;review_at:string|null;reviewed_at:string|null;created_at:string}
export type EventDetail = { event: EventRecord; messages: ChatMessage[]; hasMore: boolean; exercise: Exercise | null; questionnaire: Questionnaire | null; members: Member[]; snapshots: { user_id: string; content: string; version: number; granted_at:string }[]; perspectives: Perspective[]; invites: { id: string; status: string; expires_at: string; recipient_name: string | null; has_summary: boolean;shared_content:string|null;source_version:number|null;created_at:string }[]; applications: Application[];understandings:Understanding[];followups:Followup[];shared_notes:{application_id:string;content:string;source_version:number}[];reply_state:'pending'|'running'|'complete'|'error'|'silent' }

export type MessagePage=Pick<EventDetail,'messages'|'hasMore'>

export type PersonConnection={user_id:string;name:string;event_id:string;event_title:string;last_interaction_at?:string}
export type SupportOverview=Pick<Application,'id'|'event_id'|'consultant_name'|'status'>&{event_title:string;test_only:boolean}
