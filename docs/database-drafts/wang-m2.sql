-- REVIEW DRAFT ONLY. Not registered with server/migrations; do not apply before the documented gates.
-- Expand only: no backfill, application cutover, policy seeds, role grants, or old-column removal.
-- Strict JSON validation, policy freeze/approval and current authorization remain application/transaction gates.
BEGIN;

CREATE TABLE public."policy_versions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "policy_key" text NOT NULL,
  "version" integer NOT NULL,
  "category" text NOT NULL,
  "locale" text NOT NULL DEFAULT 'zh-CN',
  "region_scope" jsonb NOT NULL,
  "content" jsonb NOT NULL,
  "content_sha256" char(64) NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'draft',
  "effective_at" timestamptz,
  "expires_at" timestamptz,
  "reviewed_by" text,
  "reviewed_at" timestamptz,
  "review_evidence_file_id" uuid,
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "rules_sha256" char(64),
  CONSTRAINT "pk_policy_versions" PRIMARY KEY ("id"),
  CONSTRAINT "ck_policy_version" CHECK (version > 0),
  CONSTRAINT "ck_policy_category" CHECK (category IN ('terms','privacy','age','processing','screening','safety','agent','retention','research')),
  CONSTRAINT "ck_policy_status" CHECK (status IN ('draft','approved','published','retired')),
  CONSTRAINT "ck_policy_schema" CHECK (schema_version = 1),
  CONSTRAINT "ck_policy_time" CHECK (expires_at IS NULL OR (effective_at IS NOT NULL AND expires_at > effective_at)),
  CONSTRAINT "ck_policy_review" CHECK (status NOT IN ('approved','published') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND (category <> 'agent' OR rules_sha256 IS NOT NULL))),
  CONSTRAINT "ck_policy_publication" CHECK (status <> 'published' OR effective_at IS NOT NULL),
  CONSTRAINT "ck_policy_rule_hash" CHECK (category = 'agent' OR rules_sha256 IS NULL),
  CONSTRAINT "ck_policy_content_hash" CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_policy_rules_hash" CHECK (rules_sha256 IS NULL OR rules_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_policy_json" CHECK (jsonb_typeof(content) = 'object' AND jsonb_typeof(region_scope) = 'array')
);

CREATE TABLE public."guardian_links" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "subject_user_id" text NOT NULL,
  "guardian_user_id" text NOT NULL,
  "relationship_code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "policy_version_id" uuid NOT NULL,
  "evidence_file_id" uuid,
  "verified_by" text,
  "verified_at" timestamptz,
  "expires_at" timestamptz,
  "revoked_by" text,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_guardian_links" PRIMARY KEY ("id"),
  CONSTRAINT "ck_guardian_status" CHECK (status IN ('pending','verified','rejected','revoked','expired')),
  CONSTRAINT "ck_guardian_subject" CHECK (subject_user_id <> guardian_user_id),
  CONSTRAINT "ck_guardian_verifier" CHECK (verified_by IS NULL OR (verified_by <> subject_user_id AND verified_by <> guardian_user_id)),
  CONSTRAINT "ck_guardian_evidence" CHECK (status <> 'verified' OR (evidence_file_id IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT "ck_guardian_withdrawal" CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE TABLE public."consent_grants" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "subject_user_id" text,
  "purpose_code" text NOT NULL,
  "scope_kind" text NOT NULL,
  "scope_event_id" uuid,
  "policy_version_id" uuid NOT NULL,
  "decision_source" text NOT NULL,
  "decided_by_user_id" text,
  "recorded_by_user_id" text NOT NULL,
  "guardian_link_id" uuid,
  "evidence_file_id" uuid,
  "verification_status" text NOT NULL DEFAULT 'recorded',
  "verified_by_user_id" text,
  "verified_at" timestamptz,
  "granted_at" timestamptz NOT NULL,
  "expires_at" timestamptz,
  "withdrawn_at" timestamptz,
  "withdrawn_by_user_id" text,
  "withdrawal_reason_code" text,
  "supersedes_grant_id" uuid,
  "superseded_at" timestamptz,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_consent_grants" PRIMARY KEY ("id"),
  CONSTRAINT "ck_consent_m1_scope" CHECK (subject_user_id IS NOT NULL AND ((scope_kind = 'account' AND scope_event_id IS NULL) OR (scope_kind = 'event' AND scope_event_id IS NOT NULL))),
  CONSTRAINT "ck_consent_source" CHECK (decision_source IN ('in_app','verified_document')),
  CONSTRAINT "ck_consent_in_app" CHECK (decision_source <> 'in_app' OR decided_by_user_id IS NOT NULL),
  CONSTRAINT "ck_consent_document" CHECK (decision_source <> 'verified_document' OR evidence_file_id IS NOT NULL),
  CONSTRAINT "ck_consent_verification" CHECK (verification_status IN ('recorded','verified','rejected') AND (verification_status <> 'verified' OR (verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL))),
  CONSTRAINT "ck_consent_expiry" CHECK (expires_at IS NULL OR expires_at > granted_at),
  CONSTRAINT "ck_consent_withdrawal" CHECK ((withdrawn_at IS NULL) = (withdrawn_by_user_id IS NULL)),
  CONSTRAINT "ck_consent_withdrawal_time" CHECK (withdrawn_at IS NULL OR withdrawn_at >= granted_at),
  CONSTRAINT "ck_consent_supersedes" CHECK (supersedes_grant_id IS NULL OR supersedes_grant_id <> id)
);

CREATE TABLE public."conversations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "owner_user_id" text,
  "application_id" uuid,
  "title" text,
  "status" text NOT NULL DEFAULT 'active',
  "revision" bigint NOT NULL DEFAULT 0,
  "permission_epoch" bigint NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_conversations" PRIMARY KEY ("id"),
  CONSTRAINT "ck_conversation_kind" CHECK ((kind = 'room' AND owner_user_id IS NULL AND application_id IS NULL) OR (kind IN ('intake','private') AND owner_user_id IS NOT NULL AND application_id IS NULL) OR (kind = 'professional' AND owner_user_id IS NOT NULL AND application_id IS NOT NULL)),
  CONSTRAINT "ck_conversation_status" CHECK (status IN ('active','paused','closed','erasure_pending')),
  CONSTRAINT "ck_conversation_versions" CHECK (revision >= 0 AND permission_epoch >= 0)
);

CREATE TABLE public."record_versions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL,
  "understanding_id" uuid,
  "version" integer NOT NULL,
  "payload_schema_version" integer NOT NULL DEFAULT 1,
  "content" jsonb NOT NULL,
  "provenance" text NOT NULL,
  "created_by" text,
  "confirmation_scope" jsonb NOT NULL,
  "professional_client_visible" boolean NOT NULL DEFAULT false,
  "content_sha256" char(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "record_origin" text NOT NULL DEFAULT 'native',
  "producing_decision_id" uuid,
  "exercise_id" uuid,
  "signed_by_user_id" text,
  "signer_credential_id" uuid,
  "signed_at" timestamptz,
  CONSTRAINT "pk_record_versions" PRIMARY KEY ("id"),
  CONSTRAINT "ck_record_content_parent" CHECK (((content->>'type' = 'understanding' AND understanding_id IS NOT NULL) OR (content->>'type' IN ('narrative','nvc','roleplay') AND exercise_id IS NOT NULL)) IS TRUE),
  CONSTRAINT "ck_record_signature" CHECK (num_nonnulls(signed_by_user_id,signer_credential_id,signed_at) = 0),
  CONSTRAINT "ck_record_m2_parent" CHECK (num_nonnulls(understanding_id,exercise_id) = 1 AND NOT professional_client_visible),
  CONSTRAINT "ck_record_version" CHECK (version > 0 AND payload_schema_version = 1),
  CONSTRAINT "ck_record_origin" CHECK (record_origin IN ('native','legacy_import')),
  CONSTRAINT "ck_record_provenance" CHECK (provenance IN ('user_quoted','user_authored','model_inference','user_corrected','professional_authored','legacy_import')),
  CONSTRAINT "ck_record_producer" CHECK (record_origin <> 'native' OR provenance <> 'model_inference' OR producing_decision_id IS NOT NULL),
  CONSTRAINT "ck_record_hash" CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_record_versions_containers" CHECK (jsonb_typeof("content") = 'object' AND jsonb_typeof("confirmation_scope") = 'object')
);

CREATE TABLE public."record_sources" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "target_conversation_id" uuid NOT NULL,
  "target_record_version_id" uuid,
  "target_agent_decision_id" uuid,
  "source_message_id" bigint,
  "source_snapshot_id" uuid,
  "source_grant_id" uuid,
  "target_path" text,
  "source_start" integer,
  "source_end" integer,
  "source_role" text NOT NULL,
  "source_sha256" char(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "source_record_version_id" uuid,
  "source_access_basis" text NOT NULL DEFAULT 'same_conversation',
  "source_conversation_id" uuid,
  "source_path" text,
  "source_assessment_submission_id" uuid,
  CONSTRAINT "pk_record_sources" PRIMARY KEY ("id"),
  CONSTRAINT "ck_source_target" CHECK (num_nonnulls(target_record_version_id,target_agent_decision_id) = 1),
  CONSTRAINT "ck_source_origin" CHECK (num_nonnulls(source_message_id,source_assessment_submission_id,source_record_version_id,source_snapshot_id) = 1),
  CONSTRAINT "ck_source_access" CHECK ((source_access_basis = 'same_conversation' AND source_snapshot_id IS NULL AND source_conversation_id = target_conversation_id AND source_conversation_id IS NOT NULL AND source_grant_id IS NULL) OR (source_access_basis = 'authorized_room' AND source_message_id IS NOT NULL AND source_conversation_id IS NOT NULL AND source_grant_id IS NULL) OR (source_access_basis = 'snapshot_grant' AND source_snapshot_id IS NOT NULL AND source_grant_id IS NOT NULL AND source_conversation_id IS NULL)),
  CONSTRAINT "ck_source_offsets" CHECK ((source_start IS NULL AND source_end IS NULL) OR (source_start IS NOT NULL AND source_end IS NOT NULL AND source_start >= 0 AND source_end > source_start)),
  CONSTRAINT "ck_source_m1_role" CHECK (source_role IN ('fact','quote','score','hypothesis','user_confirmed_summary')),
  CONSTRAINT "ck_source_hash" CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_source_no_self" CHECK (source_record_version_id IS NULL OR target_record_version_id IS NULL OR source_record_version_id <> target_record_version_id)
);

CREATE TABLE public."agent_policy_rules" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "policy_version_id" uuid NOT NULL,
  "rule_code" text NOT NULL,
  "source_rule_code" text,
  "source_type" text NOT NULL,
  "source_reference" text NOT NULL,
  "priority_group" text NOT NULL,
  "priority" integer NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 2,
  "conditions" jsonb NOT NULL,
  "stage_codes" text[] NOT NULL,
  "route_code" text NOT NULL,
  "skill_code" text NOT NULL,
  "skill_codes" text[] NOT NULL,
  "allowed_tools" text[] NOT NULL,
  "forbidden_actions" text[] NOT NULL,
  "required_confirmations" text[] NOT NULL,
  "response_requirements" jsonb NOT NULL,
  "content_sha256" char(64) NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_agent_policy_rules" PRIMARY KEY ("id"),
  CONSTRAINT "ck_rule_priority" CHECK (priority >= 0),
  CONSTRAINT "ck_rule_source" CHECK (source_type IN ('provided_material','engineering_supplement')),
  CONSTRAINT "ck_rule_group" CHECK (priority_group IN ('safety','authorization','willingness','stage','method','style')),
  CONSTRAINT "ck_rule_schema" CHECK (schema_version = 2),
  CONSTRAINT "ck_rule_skill_plan" CHECK (cardinality(skill_codes) BETWEEN 1 AND 8 AND array_ndims(skill_codes) = 1 AND array_lower(skill_codes,1) = 1 AND array_position(skill_codes,NULL) IS NULL AND skill_codes[1] = skill_code),
  CONSTRAINT "ck_rule_hash" CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_rule_json" CHECK (jsonb_typeof(conditions) = 'object' AND jsonb_typeof(response_requirements) = 'object')
);

CREATE TABLE public."conversation_states" (
  "conversation_id" uuid NOT NULL,
  "revision" bigint NOT NULL DEFAULT 0,
  "stage_code" text,
  "stage_policy_version_id" uuid NOT NULL,
  "stage_entered_at" timestamptz NOT NULL DEFAULT now(),
  "readiness" text NOT NULL DEFAULT 'unknown',
  "current_goal" text,
  "state_schema_version" integer NOT NULL DEFAULT 2,
  "state_data" jsonb NOT NULL,
  "safety_state" text NOT NULL DEFAULT 'unassessed',
  "blocked_capabilities" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "last_decision_id" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "context_version" bigint NOT NULL DEFAULT 0,
  "last_interaction_id" uuid,
  CONSTRAINT "pk_conversation_states" PRIMARY KEY ("conversation_id"),
  CONSTRAINT "ck_state_versions" CHECK (revision >= 0 AND context_version >= 0),
  CONSTRAINT "ck_state_schema" CHECK (state_schema_version = 2),
  CONSTRAINT "ck_state_readiness" CHECK (readiness IN ('unknown','listening','exploring','willing','declined','paused')),
  CONSTRAINT "ck_state_safety" CHECK (safety_state IN ('unassessed','clear','review_required','blocked')),
  CONSTRAINT "ck_state_json" CHECK (jsonb_typeof(state_data) = 'object')
);

CREATE TABLE public."agent_decisions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "assessment_schema_version" integer NOT NULL DEFAULT 2,
  "assessment" jsonb NOT NULL,
  "risk_code" text NOT NULL DEFAULT 'unknown',
  "strategy_code" text NOT NULL,
  "stage_before" text,
  "stage_after" text,
  "confidence" numeric(5,4),
  "reason_summary" text NOT NULL,
  "gate_results" jsonb NOT NULL,
  "requires_confirmation" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "policy_version_id" uuid NOT NULL,
  "skill_code" text NOT NULL,
  "route_schema_version" integer NOT NULL DEFAULT 2,
  "route_decision" jsonb NOT NULL,
  "gate_schema_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "pk_agent_decisions" PRIMARY KEY ("id"),
  CONSTRAINT "ck_decision_ordinal" CHECK (ordinal > 0),
  CONSTRAINT "ck_decision_confidence" CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT "ck_decision_schemas" CHECK (assessment_schema_version = 2 AND route_schema_version = 2 AND gate_schema_version = 1),
  CONSTRAINT "ck_decision_json" CHECK (jsonb_typeof(assessment) = 'object' AND jsonb_typeof(route_decision) = 'object' AND jsonb_typeof(gate_results) = 'array')
);

CREATE TABLE public."agent_decision_rule_matches" (
  "conversation_id" uuid NOT NULL,
  "decision_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL,
  "rule_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "outcome" text NOT NULL,
  "reason_summary" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_agent_decision_rule_matches" PRIMARY KEY ("decision_id", "rule_id"),
  CONSTRAINT "ck_match_ordinal" CHECK (ordinal > 0),
  CONSTRAINT "ck_match_outcome" CHECK (outcome IN ('matched','selected','blocked','suppressed'))
);

CREATE TABLE public."agent_tool_calls" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "tool_name" text NOT NULL,
  "tool_schema_version" text NOT NULL,
  "input" jsonb NOT NULL,
  "status" text NOT NULL,
  "result_summary" jsonb,
  "authorization_manifest" jsonb NOT NULL,
  "error_code" text,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "decision_id" uuid NOT NULL,
  "input_schema_version" integer NOT NULL DEFAULT 2,
  "log_schema_version" integer NOT NULL DEFAULT 1,
  "request_id" uuid,
  "interaction_event_id" uuid,
  CONSTRAINT "pk_agent_tool_calls" PRIMARY KEY ("id"),
  CONSTRAINT "ck_tool_ordinal" CHECK (ordinal > 0),
  CONSTRAINT "ck_tool_schemas" CHECK (input_schema_version = 2 AND log_schema_version = 1),
  CONSTRAINT "ck_tool_status" CHECK (status IN ('requested','running','succeeded','failed','blocked','stale')),
  CONSTRAINT "ck_tool_time" CHECK (finished_at IS NULL OR (started_at IS NOT NULL AND finished_at >= started_at)),
  CONSTRAINT "ck_tool_json" CHECK (jsonb_typeof(input) = 'object' AND jsonb_typeof(authorization_manifest) = 'object' AND (result_summary IS NULL OR jsonb_typeof(result_summary) = 'object'))
);

CREATE TABLE public."professional_credentials" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "subject_user_id" text NOT NULL,
  "credential_type" text NOT NULL,
  "issuer" text NOT NULL,
  "credential_reference_hash" text,
  "evidence_file_id" uuid NOT NULL,
  "valid_from" date,
  "valid_until" date,
  "status" text NOT NULL DEFAULT 'pending',
  "verified_by" text,
  "verified_at" timestamptz,
  "policy_version_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_professional_credentials" PRIMARY KEY ("id"),
  CONSTRAINT "ck_credential_status" CHECK (status IN ('pending','verified','rejected','revoked','expired')),
  CONSTRAINT "ck_credential_verifier" CHECK (verified_by IS NULL OR verified_by <> subject_user_id),
  CONSTRAINT "ck_credential_verified" CHECK (status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT "ck_credential_dates" CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from)
);

CREATE TABLE public."safety_cases" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL,
  "subject_user_id" text,
  "policy_version_id" uuid NOT NULL,
  "priority_code" text NOT NULL DEFAULT 'unknown',
  "status" text NOT NULL DEFAULT 'open',
  "blocked_capabilities" text[] NOT NULL,
  "source_message_id" bigint,
  "source_decision_id" uuid,
  "triage_summary" text,
  "assigned_user_id" text,
  "review_due_at" timestamptz,
  "resolution_code" text,
  "resolved_by" text,
  "resolved_at" timestamptz,
  "revision" integer NOT NULL DEFAULT 1,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_safety_cases" PRIMARY KEY ("id"),
  CONSTRAINT "ck_case_status" CHECK (status IN ('open','assigned','handling','followup','resolved','closed_unreachable')),
  CONSTRAINT "ck_case_revision" CHECK (revision > 0),
  CONSTRAINT "ck_case_assignment" CHECK (status NOT IN ('assigned','handling','followup') OR assigned_user_id IS NOT NULL),
  CONSTRAINT "ck_case_resolution" CHECK (status NOT IN ('resolved','closed_unreachable') OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution_code IS NOT NULL))
);

CREATE TABLE public."support_handoffs" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "safety_case_id" uuid,
  "conversation_id" uuid NOT NULL,
  "resource_id" uuid,
  "receiver_user_id" text,
  "scope_snapshot_id" uuid,
  "authorization_grant_id" uuid,
  "emergency_policy_version_id" uuid,
  "status" text NOT NULL DEFAULT 'requested',
  "requested_by" text,
  "request_id" uuid NOT NULL,
  "due_at" timestamptz,
  "acknowledged_at" timestamptz,
  "accepted_at" timestamptz,
  "closed_at" timestamptz,
  "outcome_code" text,
  "revision" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "acknowledgement_audit_event_id" uuid,
  "acceptance_audit_event_id" uuid,
  "closure_audit_event_id" uuid,
  CONSTRAINT "pk_support_handoffs" PRIMARY KEY ("id"),
  CONSTRAINT "ck_handoff_target" CHECK (num_nonnulls(resource_id,receiver_user_id) = 1),
  CONSTRAINT "ck_handoff_status" CHECK (status IN ('requested','acknowledged','accepted','declined','unreachable','completed','cancelled')),
  CONSTRAINT "ck_handoff_revision" CHECK (revision > 0),
  CONSTRAINT "ck_handoff_disclosure" CHECK ((scope_snapshot_id IS NULL AND authorization_grant_id IS NULL AND emergency_policy_version_id IS NULL) OR (scope_snapshot_id IS NOT NULL AND (authorization_grant_id IS NOT NULL OR emergency_policy_version_id IS NOT NULL))),
  CONSTRAINT "ck_handoff_grant_recipient" CHECK (authorization_grant_id IS NULL OR receiver_user_id IS NOT NULL),
  CONSTRAINT "ck_handoff_ack_pair" CHECK ((acknowledged_at IS NULL) = (acknowledgement_audit_event_id IS NULL)),
  CONSTRAINT "ck_handoff_accept_pair" CHECK ((accepted_at IS NULL) = (acceptance_audit_event_id IS NULL)),
  CONSTRAINT "ck_handoff_close_pair" CHECK ((closed_at IS NULL) = (closure_audit_event_id IS NULL)),
  CONSTRAINT "ck_handoff_acknowledged" CHECK (status <> 'acknowledged' OR acknowledged_at IS NOT NULL),
  CONSTRAINT "ck_handoff_accepted" CHECK (status NOT IN ('accepted','completed') OR accepted_at IS NOT NULL),
  CONSTRAINT "ck_handoff_closed" CHECK (status NOT IN ('declined','unreachable','completed','cancelled') OR closed_at IS NOT NULL),
  CONSTRAINT "ck_handoff_timeline" CHECK ((acknowledged_at IS NULL OR acknowledged_at >= created_at) AND (accepted_at IS NULL OR accepted_at >= created_at) AND (closed_at IS NULL OR closed_at >= created_at))
);

CREATE TABLE public."support_resources" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "resource_key" text NOT NULL,
  "version" integer NOT NULL,
  "resource_type" text NOT NULL,
  "name" text NOT NULL,
  "region_codes" text[] NOT NULL,
  "languages" text[] NOT NULL,
  "age_requirements" jsonb NOT NULL,
  "public_contacts" jsonb NOT NULL,
  "service_hours" jsonb NOT NULL,
  "timezone" text NOT NULL,
  "official_source_url" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "verified_by" text,
  "verified_at" timestamptz,
  "recheck_after" timestamptz,
  "evidence_file_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_support_resources" PRIMARY KEY ("id"),
  CONSTRAINT "ck_resource_version" CHECK (version > 0),
  CONSTRAINT "ck_resource_type" CHECK (resource_type IN ('campus','counseling','medical','crisis','community')),
  CONSTRAINT "ck_resource_status" CHECK (status IN ('pending','verified','withdrawn','stale')),
  CONSTRAINT "ck_resource_verified" CHECK (status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND recheck_after IS NOT NULL)),
  CONSTRAINT "ck_resource_recheck" CHECK (recheck_after IS NULL OR verified_at IS NULL OR recheck_after > verified_at),
  CONSTRAINT "ck_support_resources_containers" CHECK (jsonb_typeof("age_requirements") = 'object' AND jsonb_typeof("public_contacts") = 'array' AND jsonb_typeof("service_hours") = 'object')
);

CREATE TABLE public."staff_assignments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "role_code" text NOT NULL,
  "region_codes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "credential_id" uuid,
  "granted_by" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_until" timestamptz,
  "revoked_by" text,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_staff_assignments" PRIMARY KEY ("id"),
  CONSTRAINT "ck_staff_roles" CHECK (role_code IN ('operator','safety_responder','method_reviewer','data_reviewer','service_verifier')),
  CONSTRAINT "ck_staff_grant" CHECK (granted_by <> user_id),
  CONSTRAINT "ck_staff_interval" CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT "ck_staff_revocation" CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE TABLE public."audit_events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" text,
  "actor_kind" text NOT NULL,
  "actor_role_code" text,
  "subject_user_id" text,
  "conversation_id" uuid,
  "action_code" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_reference" text NOT NULL,
  "purpose_code" text NOT NULL,
  "reason_code" text NOT NULL,
  "outcome" text NOT NULL,
  "policy_version_id" uuid,
  "request_id" uuid,
  "metadata" jsonb NOT NULL,
  "retention_until" timestamptz,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_audit_events" PRIMARY KEY ("id"),
  CONSTRAINT "ck_audit_actor" CHECK (actor_kind IN ('user','service','external_receiver')),
  CONSTRAINT "ck_audit_user" CHECK (actor_kind <> 'user' OR actor_user_id IS NOT NULL),
  CONSTRAINT "ck_audit_outcome" CHECK (outcome IN ('allowed','denied','succeeded','failed')),
  CONSTRAINT "ck_audit_events_containers" CHECK (jsonb_typeof("metadata") = 'object')
);

CREATE TABLE public."data_requests" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "requester_user_id" text,
  "subject_user_id" text,
  "request_type" text NOT NULL,
  "scope_kind" text NOT NULL,
  "event_id" uuid,
  "conversation_id" uuid,
  "status" text NOT NULL DEFAULT 'requested',
  "request_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL,
  "due_at" timestamptz,
  "result_file_id" uuid,
  "result_summary" jsonb NOT NULL,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "understanding_id" uuid,
  "record_version_id" uuid,
  "message_id" bigint,
  "recorded_by" text,
  "requester_kind" text NOT NULL DEFAULT 'user',
  "verification_evidence_sha256" char(64),
  "request_payload_schema_version" integer NOT NULL DEFAULT 2,
  "requested_changes" jsonb NOT NULL,
  "target_manifest" jsonb,
  "target_erased_at" timestamptz,
  "assessment_session_id" uuid,
  "exercise_id" uuid,
  CONSTRAINT "pk_data_requests" PRIMARY KEY ("id"),
  CONSTRAINT "ck_request_scope_kind" CHECK (scope_kind IN ('account','event','conversation','understanding','record_version','message','assessment_session','exercise')),
  CONSTRAINT "ck_request_type" CHECK (request_type IN ('export','erase','rectify','restrict')),
  CONSTRAINT "ck_request_status" CHECK (status IN ('requested','identity_verified','processing','completed','partial','rejected','failed')),
  CONSTRAINT "ck_request_kind" CHECK (requester_kind IN ('user','verified_representative')),
  CONSTRAINT "ck_request_actor" CHECK (target_erased_at IS NOT NULL OR requester_kind <> 'user' OR requester_user_id IS NOT NULL),
  CONSTRAINT "ck_request_m2_scope" CHECK ((target_erased_at IS NOT NULL AND num_nonnulls(subject_user_id,event_id,conversation_id,assessment_session_id,exercise_id,understanding_id,record_version_id,message_id) = 0 AND status IN ('partial','completed')) OR (target_erased_at IS NULL AND ((scope_kind = 'account' AND subject_user_id IS NOT NULL AND num_nonnulls(event_id,conversation_id,assessment_session_id,exercise_id,understanding_id,record_version_id,message_id) = 0) OR (scope_kind = 'event' AND event_id IS NOT NULL AND num_nonnulls(conversation_id,assessment_session_id,exercise_id,understanding_id,record_version_id,message_id) = 0) OR (scope_kind = 'conversation' AND conversation_id IS NOT NULL AND num_nonnulls(assessment_session_id,exercise_id,understanding_id,record_version_id,message_id) = 0) OR (scope_kind = 'assessment_session' AND assessment_session_id IS NOT NULL AND conversation_id IS NOT NULL AND num_nonnulls(exercise_id,understanding_id,record_version_id,message_id) = 0) OR (scope_kind = 'exercise' AND exercise_id IS NOT NULL AND conversation_id IS NOT NULL AND num_nonnulls(assessment_session_id,understanding_id,record_version_id,message_id) = 0) OR (scope_kind = 'understanding' AND understanding_id IS NOT NULL AND conversation_id IS NOT NULL AND num_nonnulls(assessment_session_id,exercise_id,record_version_id,message_id) = 0) OR (scope_kind = 'record_version' AND record_version_id IS NOT NULL AND conversation_id IS NOT NULL AND num_nonnulls(assessment_session_id,exercise_id,understanding_id,message_id) = 0) OR (scope_kind = 'message' AND message_id IS NOT NULL AND conversation_id IS NOT NULL AND num_nonnulls(assessment_session_id,exercise_id,understanding_id,record_version_id) = 0)))),
  CONSTRAINT "ck_request_schema" CHECK (request_payload_schema_version = 2),
  CONSTRAINT "ck_request_manifest" CHECK (status NOT IN ('processing','completed','partial') OR target_manifest IS NOT NULL),
  CONSTRAINT "ck_request_payload_type" CHECK (requested_changes->>'type' = request_type),
  CONSTRAINT "ck_data_requests_containers" CHECK (jsonb_typeof("result_summary") = 'object' AND jsonb_typeof("requested_changes") = 'object' AND ("target_manifest" IS NULL OR jsonb_typeof("target_manifest") = 'object'))
);

CREATE TABLE public."data_request_items" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "data_request_id" uuid NOT NULL,
  "system_code" text NOT NULL,
  "resource_category" text NOT NULL,
  "opaque_reference" text,
  "operation" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "not_before" timestamptz,
  "completed_at" timestamptz,
  "evidence" jsonb NOT NULL,
  "error_code" text,
  "resource_key" text NOT NULL,
  CONSTRAINT "pk_data_request_items" PRIMARY KEY ("id"),
  CONSTRAINT "ck_request_item_status" CHECK (status IN ('pending','processing','completed','restricted','expires_later','failed','unavailable')),
  CONSTRAINT "ck_request_item_attempts" CHECK (attempt_count >= 0),
  CONSTRAINT "ck_data_request_items_containers" CHECK (jsonb_typeof("evidence") = 'object')
);

CREATE TABLE public."file_objects" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" text,
  "classification" text NOT NULL,
  "purpose_code" text NOT NULL,
  "storage_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "byte_size" bigint NOT NULL,
  "sha256" char(64) NOT NULL,
  "encryption_key_reference" text,
  "status" text NOT NULL DEFAULT 'quarantined',
  "retention_policy_version_id" uuid,
  "retention_until" timestamptz,
  "verified_at" timestamptz,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_file_objects" PRIMARY KEY ("id"),
  CONSTRAINT "ck_file_size" CHECK (byte_size >= 0),
  CONSTRAINT "ck_file_hash" CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_file_classification" CHECK (classification IN ('private','research_raw','research_deidentified','licensed','public_asset','retained_archive')),
  CONSTRAINT "ck_file_status" CHECK (status IN ('quarantined','ready','deleting','deleted','failed'))
);

CREATE TABLE public."message_cards" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL,
  "message_id" bigint NOT NULL,
  "slot" smallint NOT NULL DEFAULT 0,
  "card_type" text NOT NULL,
  "template_version" text NOT NULL,
  "payload_schema_version" integer NOT NULL DEFAULT 2,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "revision" integer NOT NULL DEFAULT 1,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "assessment_session_id" uuid,
  "exercise_id" uuid,
  "understanding_id" uuid,
  "invite_id" uuid,
  "application_id" uuid,
  "followup_id" uuid,
  CONSTRAINT "pk_message_cards" PRIMARY KEY ("id"),
  CONSTRAINT "ck_card_slot" CHECK (slot >= 0),
  CONSTRAINT "ck_card_revision" CHECK (revision > 0),
  CONSTRAINT "ck_card_schema" CHECK (payload_schema_version = 2),
  CONSTRAINT "ck_card_status" CHECK (status IN ('pending','active','resolved','skipped','expired','invalidated')),
  CONSTRAINT "ck_card_payload_type" CHECK (((payload->>'type') = card_type) IS TRUE),
  CONSTRAINT "ck_card_typed_target" CHECK ((card_type = 'assessment' AND assessment_session_id IS NOT NULL AND num_nonnulls(exercise_id,understanding_id,invite_id,application_id,followup_id) = 0) OR (card_type = 'exercise' AND exercise_id IS NOT NULL AND num_nonnulls(assessment_session_id,understanding_id,invite_id,application_id,followup_id) = 0) OR (card_type = 'understanding' AND understanding_id IS NOT NULL AND num_nonnulls(assessment_session_id,exercise_id,invite_id,application_id,followup_id) = 0) OR (card_type = 'invite' AND invite_id IS NOT NULL AND num_nonnulls(assessment_session_id,exercise_id,understanding_id,application_id,followup_id) = 0) OR (card_type = 'followup' AND followup_id IS NOT NULL AND num_nonnulls(assessment_session_id,exercise_id,understanding_id,invite_id,application_id) = 0) OR (card_type = 'professional' AND num_nonnulls(assessment_session_id,exercise_id,understanding_id,invite_id,followup_id) = 0) OR (card_type IN ('practice_recommendation','safety','music') AND num_nonnulls(assessment_session_id,exercise_id,understanding_id,invite_id,application_id,followup_id) = 0)),
  CONSTRAINT "ck_message_cards_payload" CHECK (jsonb_typeof("payload") = 'object')
);

CREATE TABLE public."interaction_events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL,
  "actor_user_id" text NOT NULL,
  "card_id" uuid,
  "agent_run_id" uuid,
  "exercise_id" uuid,
  "action_code" text NOT NULL,
  "expected_revision" bigint NOT NULL,
  "payload" jsonb NOT NULL,
  "request_id" uuid NOT NULL,
  "result_revision" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "assessment_session_id" uuid,
  "payload_schema_version" integer NOT NULL DEFAULT 2,
  CONSTRAINT "pk_interaction_events" PRIMARY KEY ("id"),
  CONSTRAINT "ck_interaction_target" CHECK (num_nonnulls(card_id,agent_run_id,exercise_id,assessment_session_id) = 1),
  CONSTRAINT "ck_interaction_revision" CHECK (expected_revision >= 0 AND (result_revision IS NULL OR result_revision >= 0)),
  CONSTRAINT "ck_interaction_schema" CHECK (payload_schema_version = 2),
  CONSTRAINT "ck_interaction_events_payload" CHECK (jsonb_typeof("payload") = 'object')
);

CREATE TABLE public."assessment_versions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "instrument_code" text NOT NULL,
  "questionnaire_version" text NOT NULL,
  "scoring_version" text NOT NULL,
  "locale" text NOT NULL DEFAULT 'zh-CN',
  "items" jsonb NOT NULL,
  "scales" jsonb NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 1,
  "source_id" uuid,
  "policy_version_id" uuid NOT NULL,
  "content_sha256" char(64) NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "reviewed_by" text,
  "reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_assessment_versions" PRIMARY KEY ("id"),
  CONSTRAINT "ck_assessment_definition_schema" CHECK (schema_version = 1),
  CONSTRAINT "ck_assessment_definition_status" CHECK (status IN ('draft','research_only','approved','retired')),
  CONSTRAINT "ck_assessment_definition_review" CHECK (status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT "ck_assessment_definition_hash" CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_assessment_versions_items" CHECK (jsonb_typeof("items") = 'array'),
  CONSTRAINT "ck_assessment_versions_scales" CHECK (jsonb_typeof("scales") = 'array')
);

CREATE TABLE public."assessment_sessions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL,
  "subject_user_id" text NOT NULL,
  "assessment_version_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "draft_answers" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "revision" bigint NOT NULL DEFAULT 0,
  "replaces_session_id" uuid,
  "consent_grant_id" uuid,
  "started_at" timestamptz,
  "time_provenance" text NOT NULL DEFAULT 'observed',
  "submitted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "current_item_id" text,
  "paused_at" timestamptz,
  "resumed_at" timestamptz,
  "last_interaction_at" timestamptz,
  "answers_schema_version" integer NOT NULL DEFAULT 2,
  CONSTRAINT "ck_assessment_sessions_answers_schema" CHECK (answers_schema_version = 2),
  CONSTRAINT "pk_assessment_sessions" PRIMARY KEY ("id"),
  CONSTRAINT "ck_session_status" CHECK (status IN ('draft','paused','submitted','cancelled')),
  CONSTRAINT "ck_session_revision" CHECK (revision >= 0),
  CONSTRAINT "ck_session_provenance" CHECK (time_provenance IN ('observed','legacy_unknown')),
  CONSTRAINT "ck_session_submission_time" CHECK (status <> 'submitted' OR time_provenance = 'legacy_unknown' OR submitted_at IS NOT NULL),
  CONSTRAINT "ck_session_pause" CHECK (time_provenance = 'legacy_unknown' OR status <> 'paused' OR (paused_at IS NOT NULL AND (resumed_at IS NULL OR paused_at > resumed_at))),
  CONSTRAINT "ck_session_resume" CHECK (time_provenance = 'legacy_unknown' OR status <> 'draft' OR paused_at IS NULL OR (resumed_at IS NOT NULL AND resumed_at >= paused_at)),
  CONSTRAINT "ck_session_no_self" CHECK (replaces_session_id IS NULL OR replaces_session_id <> id),
  CONSTRAINT "ck_assessment_sessions_draft_answers" CHECK (jsonb_typeof("draft_answers") = 'object')
);

CREATE TABLE public."assessment_submissions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "assessment_version_id" uuid NOT NULL,
  "session_revision" bigint NOT NULL,
  "answers" jsonb NOT NULL,
  "scores" jsonb NOT NULL,
  "analysis_status" text NOT NULL DEFAULT 'pending',
  "insight_understanding_id" uuid,
  "analysis_error_code" text,
  "request_id" uuid NOT NULL,
  "submitted_at" timestamptz,
  "time_provenance" text NOT NULL DEFAULT 'observed',
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "answers_schema_version" integer NOT NULL DEFAULT 2,
  CONSTRAINT "ck_assessment_submissions_answers_schema" CHECK (answers_schema_version = 2),
  CONSTRAINT "pk_assessment_submissions" PRIMARY KEY ("id"),
  CONSTRAINT "ck_submission_revision" CHECK (session_revision >= 0),
  CONSTRAINT "ck_submission_status" CHECK (analysis_status IN ('pending','running','complete','error','needs_review')),
  CONSTRAINT "ck_submission_provenance" CHECK (time_provenance IN ('observed','legacy_unknown')),
  CONSTRAINT "ck_submission_time" CHECK (time_provenance = 'legacy_unknown' OR submitted_at IS NOT NULL),
  CONSTRAINT "ck_assessment_submissions_answers" CHECK (jsonb_typeof("answers") = 'object'),
  CONSTRAINT "ck_assessment_submissions_scores" CHECK (jsonb_typeof("scores") = 'array')
);

CREATE TABLE public."agent_method_refs" (
  "run_id" uuid NOT NULL,
  "tool_call_id" uuid NOT NULL,
  "knowledge_release_id" uuid NOT NULL,
  "method_version_id" uuid NOT NULL,
  "rank" integer NOT NULL,
  "retrieval_score" numeric(12,6),
  "used" boolean NOT NULL DEFAULT false,
  "selection_reason" text,
  "excerpt_sha256" char(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "decision_id" uuid NOT NULL,
  "applicability" text NOT NULL,
  "restriction_reason" text,
  CONSTRAINT "pk_agent_method_refs" PRIMARY KEY ("tool_call_id", "method_version_id"),
  CONSTRAINT "ck_method_ref_rank" CHECK (rank > 0),
  CONSTRAINT "ck_method_ref_applicability" CHECK (applicability IN ('eligible','blocked','needs_review')),
  CONSTRAINT "ck_method_ref_used" CHECK (NOT used OR applicability = 'eligible'),
  CONSTRAINT "ck_method_ref_restriction" CHECK (applicability = 'eligible' OR (restriction_reason IS NOT NULL AND length(restriction_reason) > 0)),
  CONSTRAINT "ck_method_ref_hash" CHECK (excerpt_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public."knowledge_sources" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "source_key" text NOT NULL,
  "version" integer NOT NULL,
  "source_kind" text NOT NULL,
  "title" text NOT NULL,
  "authors" jsonb NOT NULL,
  "edition" text,
  "source_url" text,
  "file_id" uuid,
  "content_sha256" char(64),
  "rights_status" text NOT NULL DEFAULT 'pending',
  "allowed_purposes" text[] NOT NULL,
  "quotation_limits" jsonb NOT NULL,
  "rights_evidence_file_id" uuid,
  "valid_until" timestamptz,
  "verified_by" text,
  "verified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_knowledge_sources" PRIMARY KEY ("id"),
  CONSTRAINT "ck_source_version" CHECK (version > 0),
  CONSTRAINT "ck_knowledge_source_kind" CHECK (source_kind IN ('book','paper','guideline','curriculum','curated_example')),
  CONSTRAINT "ck_source_rights_status" CHECK (rights_status IN ('pending','allowed','restricted','revoked','expired')),
  CONSTRAINT "ck_source_rights_review" CHECK (rights_status NOT IN ('allowed','restricted') OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT "ck_knowledge_source_hash" CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_knowledge_sources_authors" CHECK (jsonb_typeof("authors") = 'array'),
  CONSTRAINT "ck_knowledge_sources_quotation_limits" CHECK (jsonb_typeof("quotation_limits") = 'object')
);

CREATE TABLE public."method_versions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "method_key" text NOT NULL,
  "version" integer NOT NULL,
  "family_code" text NOT NULL,
  "title" text NOT NULL,
  "goal" text NOT NULL,
  "allowed_stages" text[] NOT NULL,
  "allowed_strategies" text[] NOT NULL,
  "age_requirements" jsonb NOT NULL,
  "trigger_signals" jsonb NOT NULL,
  "contraindications" jsonb NOT NULL,
  "entry_conditions" jsonb NOT NULL,
  "exit_conditions" jsonb NOT NULL,
  "steps" jsonb NOT NULL,
  "examples" jsonb NOT NULL,
  "refusal_handling" jsonb NOT NULL,
  "output_contract" jsonb NOT NULL,
  "evaluation_criteria" jsonb NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 1,
  "content_sha256" char(64) NOT NULL,
  "sources_sha256" char(64),
  "status" text NOT NULL DEFAULT 'draft',
  "reviewed_by" text,
  "reviewer_credential_id" uuid,
  "reviewed_at" timestamptz,
  "review_comment" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "practice_kind" text,
  "agent_policy_version_id" uuid NOT NULL,
  "allowed_skill_codes" text[] NOT NULL,
  CONSTRAINT "pk_method_versions" PRIMARY KEY ("id"),
  CONSTRAINT "ck_method_version" CHECK (version > 0),
  CONSTRAINT "ck_method_schema" CHECK (schema_version = 1),
  CONSTRAINT "ck_method_status" CHECK (status IN ('draft','in_review','approved','retired','withdrawn')),
  CONSTRAINT "ck_method_review" CHECK (status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewer_credential_id IS NOT NULL AND reviewed_at IS NOT NULL AND sources_sha256 IS NOT NULL)),
  CONSTRAINT "ck_method_practice_kind" CHECK (practice_kind IS NULL OR practice_kind IN ('narrative','nvc','roleplay')),
  CONSTRAINT "ck_method_hash" CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_method_sources_hash" CHECK (sources_sha256 IS NULL OR sources_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_method_versions_age_requirements" CHECK (jsonb_typeof("age_requirements") = 'object'),
  CONSTRAINT "ck_method_versions_trigger_signals" CHECK (jsonb_typeof("trigger_signals") = 'array'),
  CONSTRAINT "ck_method_versions_contraindications" CHECK (jsonb_typeof("contraindications") = 'array'),
  CONSTRAINT "ck_method_versions_entry_conditions" CHECK (jsonb_typeof("entry_conditions") = 'array'),
  CONSTRAINT "ck_method_versions_exit_conditions" CHECK (jsonb_typeof("exit_conditions") = 'array'),
  CONSTRAINT "ck_method_versions_steps" CHECK (jsonb_typeof("steps") = 'array'),
  CONSTRAINT "ck_method_versions_examples" CHECK (jsonb_typeof("examples") = 'array'),
  CONSTRAINT "ck_method_versions_refusal_handling" CHECK (jsonb_typeof("refusal_handling") = 'object'),
  CONSTRAINT "ck_method_versions_output_contract" CHECK (jsonb_typeof("output_contract") = 'object'),
  CONSTRAINT "ck_method_versions_evaluation_criteria" CHECK (jsonb_typeof("evaluation_criteria") = 'array')
);

CREATE TABLE public."method_sources" (
  "method_version_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "locator" text NOT NULL,
  "allowed_excerpt" text,
  "excerpt_sha256" char(64),
  CONSTRAINT "pk_method_sources" PRIMARY KEY ("method_version_id", "source_id", "locator"),
  CONSTRAINT "ck_method_source_locator" CHECK (length(locator) > 0),
  CONSTRAINT "ck_method_excerpt_hash" CHECK (excerpt_sha256 IS NULL OR excerpt_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public."knowledge_releases" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "release_key" text NOT NULL,
  "manifest_sha256" char(64) NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "approved_by" text,
  "published_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pk_knowledge_releases" PRIMARY KEY ("id"),
  CONSTRAINT "ck_knowledge_release_status" CHECK (status IN ('draft','published','retired','withdrawn')),
  CONSTRAINT "ck_knowledge_release_published" CHECK (status <> 'published' OR (approved_by IS NOT NULL AND published_at IS NOT NULL)),
  CONSTRAINT "ck_knowledge_manifest_hash" CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public."knowledge_release_items" (
  "knowledge_release_id" uuid NOT NULL,
  "method_version_id" uuid NOT NULL,
  CONSTRAINT "pk_knowledge_release_items" PRIMARY KEY ("knowledge_release_id", "method_version_id")
);

ALTER TABLE public."messages" ADD COLUMN "exercise_id" uuid;
ALTER TABLE public."agent_actions" ADD COLUMN "conversation_id" uuid;
ALTER TABLE public."agent_actions" ADD COLUMN "card_id" uuid;
ALTER TABLE public."agent_actions" ADD COLUMN "permission_epoch" bigint;
ALTER TABLE public."agent_actions" ADD COLUMN "subject_consent_epoch" bigint;
ALTER TABLE public."agent_actions" ADD COLUMN "proposal_schema_version" integer;
ALTER TABLE public."agent_actions" ADD COLUMN "applied_record_version_id" uuid;
ALTER TABLE public."agent_actions" ADD COLUMN "decision_id" uuid;
ALTER TABLE public."agent_actions" ADD COLUMN "method_version_id" uuid;
ALTER TABLE public."agent_actions" ADD COLUMN "resolution_interaction_id" uuid;
ALTER TABLE public."agent_actions" ADD COLUMN "started_exercise_id" uuid;
ALTER TABLE public."agent_actions" ADD COLUMN "method_tool_call_id" uuid;
ALTER TABLE public."exercises" ADD COLUMN "id" uuid;
ALTER TABLE public."exercises" ADD COLUMN "conversation_id" uuid;
ALTER TABLE public."exercises" ADD COLUMN "owner_user_id" text;
ALTER TABLE public."exercises" ADD COLUMN "kind" text;
ALTER TABLE public."exercises" ADD COLUMN "method_version_id" uuid;
ALTER TABLE public."exercises" ADD COLUMN "status" text;
ALTER TABLE public."exercises" ADD COLUMN "current_record_version_id" uuid;
ALTER TABLE public."exercises" ADD COLUMN "started_at" timestamptz;
ALTER TABLE public."exercises" ADD COLUMN "time_provenance" text;
ALTER TABLE public."exercises" ADD COLUMN "created_at" timestamptz;
ALTER TABLE public."exercises" ADD COLUMN "completed_at" timestamptz;
ALTER TABLE public."exercises" ADD COLUMN "revision" bigint NOT NULL DEFAULT 0;
ALTER TABLE public."invites" ADD COLUMN "created_by" text;
ALTER TABLE public."invites" ADD COLUMN "target_conversation_id" uuid;
ALTER TABLE public."invites" ADD COLUMN "intended_user_id" text;
ALTER TABLE public."invites" ADD COLUMN "accepted_membership_generation" bigint;
ALTER TABLE public."invites" ADD COLUMN "history_policy_version_id" uuid;
ALTER TABLE public."invites" ADD COLUMN "accepted_at" timestamptz;
ALTER TABLE public."invites" ADD COLUMN "request_id" uuid;
ALTER TABLE public."invites" ADD COLUMN "delivery_state" text;
ALTER TABLE public."agent_runs" ADD COLUMN "knowledge_release_id" uuid;
ALTER TABLE public."followups" ADD COLUMN "conversation_id" uuid;
ALTER TABLE public."followups" ADD COLUMN "exercise_id" uuid;
ALTER TABLE public."followups" ADD COLUMN "action_status" text NOT NULL DEFAULT 'unknown';
ALTER TABLE public."followups" ADD COLUMN "outcome" jsonb;
ALTER TABLE public."followups" ADD COLUMN "reminder_opt_in" boolean NOT NULL DEFAULT false;
ALTER TABLE public."followups" ADD COLUMN "reminder_consent_grant_id" uuid;
ALTER TABLE public."followups" ADD COLUMN "revision" integer NOT NULL DEFAULT 1;
ALTER TABLE public."followups" ADD COLUMN "action_occurred_at" timestamptz;
ALTER TABLE public."followups" ADD COLUMN "outcome_reported_at" timestamptz;
ALTER TABLE public."followups" ADD COLUMN "outcome_schema_version" integer NOT NULL DEFAULT 1;

ALTER TABLE public."profiles" ADD COLUMN "age_band_code" text;
ALTER TABLE public."profiles" ADD COLUMN "age_policy_version_id" uuid;
ALTER TABLE public."profiles" ADD COLUMN "age_basis" text;
ALTER TABLE public."profiles" ADD COLUMN "age_checked_at" timestamptz;
ALTER TABLE public."profiles" ADD COLUMN "age_valid_until" timestamptz;
ALTER TABLE public."profiles" ADD COLUMN "country_code" char(2);
ALTER TABLE public."profiles" ADD COLUMN "region_code" text;
ALTER TABLE public."profiles" ADD COLUMN "timezone" text;
ALTER TABLE public."profiles" ADD COLUMN "communication_preferences" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public."profiles" ADD COLUMN "preferences_schema_version" integer NOT NULL DEFAULT 1;
ALTER TABLE public."profiles" ADD COLUMN "consent_epoch" bigint NOT NULL DEFAULT 0;
ALTER TABLE public."profiles" ADD COLUMN "account_state" text NOT NULL DEFAULT 'active';
ALTER TABLE public."profiles" ADD COLUMN "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE public."events" ADD COLUMN "lifecycle_status" text NOT NULL DEFAULT 'active';
ALTER TABLE public."events" ADD COLUMN "lifecycle_version" bigint NOT NULL DEFAULT 0;
ALTER TABLE public."events" ADD COLUMN "closed_at" timestamptz;
ALTER TABLE public."events" ADD COLUMN "reopened_at" timestamptz;
ALTER TABLE public."events" ADD COLUMN "erasure_requested_at" timestamptz;
ALTER TABLE public."members" ADD COLUMN "membership_generation" bigint NOT NULL DEFAULT 1;
ALTER TABLE public."members" ADD COLUMN "participant_role" text NOT NULL DEFAULT 'participant';
ALTER TABLE public."members" ADD COLUMN "left_at" timestamptz;
ALTER TABLE public."members" ADD COLUMN "history_policy_version_id" uuid;
ALTER TABLE public."members" ADD COLUMN "history_mode" text;
ALTER TABLE public."members" ADD COLUMN "history_from_message_id" bigint;
ALTER TABLE public."messages" ADD COLUMN "conversation_id" uuid;
ALTER TABLE public."messages" ADD COLUMN "content_kind" text NOT NULL DEFAULT 'text';
ALTER TABLE public."messages" ADD COLUMN "hypothetical" boolean;
ALTER TABLE public."messages" ADD COLUMN "redacted_at" timestamptz;
ALTER TABLE public."messages" ADD COLUMN "message_purpose" text NOT NULL DEFAULT 'chat';
ALTER TABLE public."messages" ADD COLUMN "context_room_conversation_id" uuid;
ALTER TABLE public."messages" ADD COLUMN "context_room_message_id" bigint;
ALTER TABLE public."understandings" ADD COLUMN "conversation_id" uuid;
ALTER TABLE public."understandings" ADD COLUMN "kind" text;
ALTER TABLE public."understandings" ADD COLUMN "current_record_version_id" uuid;
ALTER TABLE public."understandings" ADD COLUMN "record_state" text NOT NULL DEFAULT 'active';
ALTER TABLE public."understandings" ADD COLUMN "supersedes_id" uuid;
ALTER TABLE public."understandings" ADD COLUMN "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE public."understandings" ADD COLUMN "request_id" uuid;
ALTER TABLE public."understanding_confirmations" ADD COLUMN "record_version_id" uuid;
ALTER TABLE public."understanding_confirmations" ADD COLUMN "membership_generation" bigint;
ALTER TABLE public."understanding_confirmations" ADD COLUMN "request_id" uuid;
ALTER TABLE public."understanding_confirmations" ADD COLUMN "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE public."share_snapshots" ADD COLUMN "source_conversation_id" uuid;
ALTER TABLE public."share_snapshots" ADD COLUMN "source_record_version_id" uuid;
ALTER TABLE public."share_snapshots" ADD COLUMN "snapshot_kind" text;
ALTER TABLE public."share_snapshots" ADD COLUMN "payload" jsonb;
ALTER TABLE public."share_snapshots" ADD COLUMN "payload_schema_version" integer NOT NULL DEFAULT 1;
ALTER TABLE public."share_snapshots" ADD COLUMN "content_sha256" char(64);
ALTER TABLE public."share_snapshots" ADD COLUMN "state" text NOT NULL DEFAULT 'available';
ALTER TABLE public."share_grants" ADD COLUMN "target_event_id" uuid;
ALTER TABLE public."share_grants" ADD COLUMN "target_conversation_id" uuid;
ALTER TABLE public."share_grants" ADD COLUMN "purpose_code" text;
ALTER TABLE public."share_grants" ADD COLUMN "permissions" text[];
ALTER TABLE public."share_grants" ADD COLUMN "membership_generation" bigint;
ALTER TABLE public."share_grants" ADD COLUMN "application_id" uuid;
ALTER TABLE public."share_grants" ADD COLUMN "consent_grant_id" uuid;
ALTER TABLE public."share_grants" ADD COLUMN "expires_at" timestamptz;
ALTER TABLE public."agent_runs" ADD COLUMN "conversation_id" uuid;
ALTER TABLE public."agent_runs" ADD COLUMN "logical_turn_id" uuid;
ALTER TABLE public."agent_runs" ADD COLUMN "attempt_no" integer;
ALTER TABLE public."agent_runs" ADD COLUMN "state_revision" bigint;
ALTER TABLE public."agent_runs" ADD COLUMN "permission_epoch" bigint;
ALTER TABLE public."agent_runs" ADD COLUMN "consent_epochs" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public."agent_runs" ADD COLUMN "agent_policy_version_id" uuid;
ALTER TABLE public."agent_runs" ADD COLUMN "input_manifest" jsonb;
ALTER TABLE public."agent_runs" ADD COLUMN "final_decision_id" uuid;
ALTER TABLE public."agent_runs" ADD COLUMN "input_tokens" bigint;
ALTER TABLE public."agent_runs" ADD COLUMN "output_tokens" bigint;
ALTER TABLE public."agent_runs" ADD COLUMN "reasoning_tokens" bigint;
ALTER TABLE public."agent_runs" ADD COLUMN "estimated_cost_minor" bigint;
ALTER TABLE public."agent_runs" ADD COLUMN "cost_currency" char(3);
ALTER TABLE public."agent_runs" ADD COLUMN "latency_ms" integer;
ALTER TABLE public."agent_runs" ADD COLUMN "retention_until" timestamptz;
ALTER TABLE public."agent_runs" ADD COLUMN "invalidated_at" timestamptz;
ALTER TABLE public."revisions" ADD COLUMN "conversation_id" uuid;
ALTER TABLE public."revisions" ADD COLUMN "entity_type" text;
ALTER TABLE public."revisions" ADD COLUMN "entity_reference" text;
ALTER TABLE public."revisions" ADD COLUMN "entity_version" bigint;
ALTER TABLE public."revisions" ADD COLUMN "request_id" uuid;

ALTER TABLE public."policy_versions" ADD CONSTRAINT "uq_policy_versions_1" UNIQUE ("policy_key", "version");
ALTER TABLE public."guardian_links" ADD CONSTRAINT "uq_guardian_links_1" UNIQUE ("subject_user_id", "id");
ALTER TABLE public."guardian_links" ADD CONSTRAINT "uq_guardian_links_2" UNIQUE ("subject_user_id", "guardian_user_id", "id");
ALTER TABLE public."consent_grants" ADD CONSTRAINT "uq_consent_grants_1" UNIQUE ("recorded_by_user_id", "request_id");
ALTER TABLE public."conversations" ADD CONSTRAINT "uq_conversations_1" UNIQUE ("event_id", "id");
ALTER TABLE public."conversations" ADD CONSTRAINT "uq_conversations_2" UNIQUE ("application_id", "id");
ALTER TABLE public."conversations" ADD CONSTRAINT "uq_conversation_owner_identity" UNIQUE ("id", "owner_user_id");
ALTER TABLE public."record_versions" ADD CONSTRAINT "uq_record_versions_1" UNIQUE ("understanding_id", "version");
ALTER TABLE public."record_versions" ADD CONSTRAINT "uq_record_versions_2" UNIQUE ("conversation_id", "id");
ALTER TABLE public."record_versions" ADD CONSTRAINT "uq_record_versions_3" UNIQUE ("conversation_id", "understanding_id", "id");
ALTER TABLE public."record_versions" ADD CONSTRAINT "uq_record_versions_4" UNIQUE ("understanding_id", "version", "id");
ALTER TABLE public."agent_policy_rules" ADD CONSTRAINT "uq_agent_policy_rules_1" UNIQUE ("policy_version_id", "rule_code");
ALTER TABLE public."agent_policy_rules" ADD CONSTRAINT "uq_agent_policy_rules_2" UNIQUE ("policy_version_id", "id");
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "uq_agent_decisions_1" UNIQUE ("run_id", "ordinal");
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "uq_agent_decisions_2" UNIQUE ("conversation_id", "id");
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "uq_agent_decisions_3" UNIQUE ("run_id", "id");
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "uq_agent_decisions_4" UNIQUE ("id", "policy_version_id");
ALTER TABLE public."agent_decision_rule_matches" ADD CONSTRAINT "uq_agent_decision_rule_matches_1" UNIQUE ("decision_id", "ordinal");
ALTER TABLE public."agent_tool_calls" ADD CONSTRAINT "uq_agent_tool_calls_1" UNIQUE ("run_id", "ordinal");
ALTER TABLE public."agent_tool_calls" ADD CONSTRAINT "uq_agent_tool_calls_2" UNIQUE ("run_id", "id");
ALTER TABLE public."professional_credentials" ADD CONSTRAINT "uq_professional_credentials_1" UNIQUE ("subject_user_id", "id");
ALTER TABLE public."safety_cases" ADD CONSTRAINT "uq_safety_cases_1" UNIQUE ("conversation_id", "id");
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "uq_support_handoffs_1" UNIQUE ("conversation_id", "request_id");
ALTER TABLE public."support_resources" ADD CONSTRAINT "uq_support_resources_1" UNIQUE ("resource_key", "version");
ALTER TABLE public."audit_events" ADD CONSTRAINT "uq_audit_events_1" UNIQUE ("conversation_id", "id");
ALTER TABLE public."data_requests" ADD CONSTRAINT "uq_data_requests_1" UNIQUE ("request_id");
ALTER TABLE public."data_request_items" ADD CONSTRAINT "uq_data_request_items_1" UNIQUE ("data_request_id", "system_code", "resource_key", "operation");
ALTER TABLE public."file_objects" ADD CONSTRAINT "uq_file_objects_1" UNIQUE ("storage_key");
ALTER TABLE public."messages" ADD CONSTRAINT "uq_messages_1" UNIQUE ("conversation_id", "id");
ALTER TABLE public."messages" ADD CONSTRAINT "uq_messages_2" UNIQUE ("event_id", "id");
ALTER TABLE public."understandings" ADD CONSTRAINT "uq_understandings_1" UNIQUE ("conversation_id", "id");
ALTER TABLE public."share_grants" ADD CONSTRAINT "uq_share_grants_1" UNIQUE ("target_conversation_id", "id", "snapshot_id");
ALTER TABLE public."share_grants" ADD CONSTRAINT "uq_share_grants_2" UNIQUE ("id", "snapshot_id", "recipient_id");
ALTER TABLE public."agent_runs" ADD CONSTRAINT "uq_agent_runs_1" UNIQUE ("conversation_id", "trigger_message_id", "context_version", "attempt_no");
ALTER TABLE public."agent_runs" ADD CONSTRAINT "uq_agent_runs_2" UNIQUE ("conversation_id", "id");
ALTER TABLE public."agent_runs" ADD CONSTRAINT "uq_agent_runs_3" UNIQUE ("id", "agent_policy_version_id");
ALTER TABLE public."applications" ADD CONSTRAINT "uq_applications_1" UNIQUE ("id", "event_id", "applicant_id");

ALTER TABLE public."policy_versions" ADD CONSTRAINT "fk_policy_versions_reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."policy_versions" ADD CONSTRAINT "fk_policy_versions_review_evidence_file_id" FOREIGN KEY ("review_evidence_file_id") REFERENCES public."file_objects" ("id") ON DELETE RESTRICT;
ALTER TABLE public."policy_versions" ADD CONSTRAINT "fk_policy_versions_created_by" FOREIGN KEY ("created_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."guardian_links" ADD CONSTRAINT "fk_guardian_links_subject_user_id" FOREIGN KEY ("subject_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."guardian_links" ADD CONSTRAINT "fk_guardian_links_guardian_user_id" FOREIGN KEY ("guardian_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."guardian_links" ADD CONSTRAINT "fk_guardian_links_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."guardian_links" ADD CONSTRAINT "fk_guardian_links_evidence_file_id" FOREIGN KEY ("evidence_file_id") REFERENCES public."file_objects" ("id") ON DELETE RESTRICT;
ALTER TABLE public."guardian_links" ADD CONSTRAINT "fk_guardian_links_verified_by" FOREIGN KEY ("verified_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."guardian_links" ADD CONSTRAINT "fk_guardian_links_revoked_by" FOREIGN KEY ("revoked_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."consent_grants" ADD CONSTRAINT "fk_consent_grants_subject_user_id" FOREIGN KEY ("subject_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."consent_grants" ADD CONSTRAINT "fk_consent_grants_scope_event_id" FOREIGN KEY ("scope_event_id") REFERENCES public."events" ("id") ON DELETE RESTRICT;
ALTER TABLE public."consent_grants" ADD CONSTRAINT "fk_consent_grants_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."consent_grants" ADD CONSTRAINT "fk_consent_grants_decided_by_user_id" FOREIGN KEY ("decided_by_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."consent_grants" ADD CONSTRAINT "fk_consent_grants_recorded_by_user_id" FOREIGN KEY ("recorded_by_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."consent_grants" ADD CONSTRAINT "fk_consent_grants_evidence_file_id" FOREIGN KEY ("evidence_file_id") REFERENCES public."file_objects" ("id") ON DELETE RESTRICT;
ALTER TABLE public."consent_grants" ADD CONSTRAINT "fk_consent_grants_verified_by_user_id" FOREIGN KEY ("verified_by_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."consent_grants" ADD CONSTRAINT "fk_consent_grants_withdrawn_by_user_id" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."consent_grants" ADD CONSTRAINT "fk_consent_grants_supersedes_grant_id" FOREIGN KEY ("supersedes_grant_id") REFERENCES public."consent_grants" ("id") ON DELETE RESTRICT;
ALTER TABLE public."conversations" ADD CONSTRAINT "fk_conversations_event_id" FOREIGN KEY ("event_id") REFERENCES public."events" ("id") ON DELETE RESTRICT;
ALTER TABLE public."conversations" ADD CONSTRAINT "fk_conversations_owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_record_versions_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_record_versions_created_by" FOREIGN KEY ("created_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_record_sources_target_conversation_id" FOREIGN KEY ("target_conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_record_sources_source_snapshot_id" FOREIGN KEY ("source_snapshot_id") REFERENCES public."share_snapshots" ("id") ON DELETE RESTRICT;
ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_record_sources_source_conversation_id" FOREIGN KEY ("source_conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_policy_rules" ADD CONSTRAINT "fk_agent_policy_rules_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_policy_rules" ADD CONSTRAINT "fk_agent_policy_rules_created_by" FOREIGN KEY ("created_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."conversation_states" ADD CONSTRAINT "fk_conversation_states_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."conversation_states" ADD CONSTRAINT "fk_conversation_states_stage_policy_version_id" FOREIGN KEY ("stage_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "fk_agent_decisions_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "fk_agent_decisions_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_decision_rule_matches" ADD CONSTRAINT "fk_agent_decision_rule_matches_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_decision_rule_matches" ADD CONSTRAINT "fk_agent_decision_rule_matches_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_tool_calls" ADD CONSTRAINT "fk_agent_tool_calls_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."professional_credentials" ADD CONSTRAINT "fk_professional_credentials_subject_user_id" FOREIGN KEY ("subject_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."professional_credentials" ADD CONSTRAINT "fk_professional_credentials_evidence_file_id" FOREIGN KEY ("evidence_file_id") REFERENCES public."file_objects" ("id") ON DELETE RESTRICT;
ALTER TABLE public."professional_credentials" ADD CONSTRAINT "fk_professional_credentials_verified_by" FOREIGN KEY ("verified_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."professional_credentials" ADD CONSTRAINT "fk_professional_credentials_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."safety_cases" ADD CONSTRAINT "fk_safety_cases_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."safety_cases" ADD CONSTRAINT "fk_safety_cases_subject_user_id" FOREIGN KEY ("subject_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."safety_cases" ADD CONSTRAINT "fk_safety_cases_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."safety_cases" ADD CONSTRAINT "fk_safety_cases_assigned_user_id" FOREIGN KEY ("assigned_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."safety_cases" ADD CONSTRAINT "fk_safety_cases_resolved_by" FOREIGN KEY ("resolved_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "fk_support_handoffs_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "fk_support_handoffs_resource_id" FOREIGN KEY ("resource_id") REFERENCES public."support_resources" ("id") ON DELETE RESTRICT;
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "fk_support_handoffs_receiver_user_id" FOREIGN KEY ("receiver_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "fk_support_handoffs_scope_snapshot_id" FOREIGN KEY ("scope_snapshot_id") REFERENCES public."share_snapshots" ("id") ON DELETE RESTRICT;
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "fk_support_handoffs_emergency_policy_version_id" FOREIGN KEY ("emergency_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "fk_support_handoffs_requested_by" FOREIGN KEY ("requested_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."support_resources" ADD CONSTRAINT "fk_support_resources_verified_by" FOREIGN KEY ("verified_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."support_resources" ADD CONSTRAINT "fk_support_resources_evidence_file_id" FOREIGN KEY ("evidence_file_id") REFERENCES public."file_objects" ("id") ON DELETE RESTRICT;
ALTER TABLE public."staff_assignments" ADD CONSTRAINT "fk_staff_assignments_user_id" FOREIGN KEY ("user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."staff_assignments" ADD CONSTRAINT "fk_staff_assignments_granted_by" FOREIGN KEY ("granted_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."staff_assignments" ADD CONSTRAINT "fk_staff_assignments_revoked_by" FOREIGN KEY ("revoked_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."audit_events" ADD CONSTRAINT "fk_audit_events_actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."audit_events" ADD CONSTRAINT "fk_audit_events_subject_user_id" FOREIGN KEY ("subject_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."audit_events" ADD CONSTRAINT "fk_audit_events_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."audit_events" ADD CONSTRAINT "fk_audit_events_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_data_requests_requester_user_id" FOREIGN KEY ("requester_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_data_requests_subject_user_id" FOREIGN KEY ("subject_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_data_requests_event_id" FOREIGN KEY ("event_id") REFERENCES public."events" ("id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_data_requests_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_data_requests_result_file_id" FOREIGN KEY ("result_file_id") REFERENCES public."file_objects" ("id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_data_requests_recorded_by" FOREIGN KEY ("recorded_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."data_request_items" ADD CONSTRAINT "fk_data_request_items_data_request_id" FOREIGN KEY ("data_request_id") REFERENCES public."data_requests" ("id") ON DELETE RESTRICT;
ALTER TABLE public."file_objects" ADD CONSTRAINT "fk_file_objects_owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."file_objects" ADD CONSTRAINT "fk_file_objects_retention_policy_version_id" FOREIGN KEY ("retention_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."profiles" ADD CONSTRAINT "fk_profiles_age_policy_version_id" FOREIGN KEY ("age_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."members" ADD CONSTRAINT "fk_members_history_policy_version_id" FOREIGN KEY ("history_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."messages" ADD CONSTRAINT "fk_messages_context_room_conversation_id" FOREIGN KEY ("context_room_conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."understandings" ADD CONSTRAINT "fk_understandings_supersedes_id" FOREIGN KEY ("supersedes_id") REFERENCES public."understandings" ("id") ON DELETE RESTRICT;
ALTER TABLE public."share_grants" ADD CONSTRAINT "fk_share_grants_target_event_id" FOREIGN KEY ("target_event_id") REFERENCES public."events" ("id") ON DELETE RESTRICT;
ALTER TABLE public."share_grants" ADD CONSTRAINT "fk_share_grants_application_id" FOREIGN KEY ("application_id") REFERENCES public."applications" ("id") ON DELETE RESTRICT;
ALTER TABLE public."share_grants" ADD CONSTRAINT "fk_share_grants_consent_grant_id" FOREIGN KEY ("consent_grant_id") REFERENCES public."consent_grants" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_runs" ADD CONSTRAINT "fk_agent_runs_agent_policy_version_id" FOREIGN KEY ("agent_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."messages" ADD CONSTRAINT "fk_message_conversation" FOREIGN KEY ("event_id", "conversation_id") REFERENCES public."conversations" ("event_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."messages" ADD CONSTRAINT "fk_message_reply" FOREIGN KEY ("conversation_id", "in_reply_to") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."messages" ADD CONSTRAINT "fk_private_hint_context" FOREIGN KEY ("context_room_conversation_id", "context_room_message_id") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_source_target_version" FOREIGN KEY ("target_conversation_id", "target_record_version_id") REFERENCES public."record_versions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_source_target_decision" FOREIGN KEY ("target_conversation_id", "target_agent_decision_id") REFERENCES public."agent_decisions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_source_message" FOREIGN KEY ("source_conversation_id", "source_message_id") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_source_saved_version" FOREIGN KEY ("source_conversation_id", "source_record_version_id") REFERENCES public."record_versions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_source_granted_snapshot" FOREIGN KEY ("target_conversation_id", "source_grant_id", "source_snapshot_id") REFERENCES public."share_grants" ("target_conversation_id", "id", "snapshot_id") ON DELETE RESTRICT;
ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_version_producer" FOREIGN KEY ("conversation_id", "producing_decision_id") REFERENCES public."agent_decisions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_version_parent_understanding_id" FOREIGN KEY ("conversation_id", "understanding_id") REFERENCES public."understandings" ("conversation_id", "id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."understandings" ADD CONSTRAINT "fk_current_understanding_id" FOREIGN KEY ("conversation_id", "id", "current_record_version_id") REFERENCES public."record_versions" ("conversation_id", "understanding_id", "id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "fk_decision_run" FOREIGN KEY ("conversation_id", "run_id") REFERENCES public."agent_runs" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_runs" ADD CONSTRAINT "fk_run_final_decision" FOREIGN KEY ("id", "final_decision_id") REFERENCES public."agent_decisions" ("run_id", "id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."conversation_states" ADD CONSTRAINT "fk_state_last_decision" FOREIGN KEY ("conversation_id", "last_decision_id") REFERENCES public."agent_decisions" ("conversation_id", "id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "fk_decision_policy_run" FOREIGN KEY ("run_id", "policy_version_id") REFERENCES public."agent_runs" ("id", "agent_policy_version_id") ON DELETE RESTRICT;
ALTER TABLE public."agent_decision_rule_matches" ADD CONSTRAINT "fk_match_conversation_decision" FOREIGN KEY ("conversation_id", "decision_id") REFERENCES public."agent_decisions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_decision_rule_matches" ADD CONSTRAINT "fk_match_decision_policy" FOREIGN KEY ("decision_id", "policy_version_id") REFERENCES public."agent_decisions" ("id", "policy_version_id") ON DELETE RESTRICT;
ALTER TABLE public."agent_decision_rule_matches" ADD CONSTRAINT "fk_match_policy_rule" FOREIGN KEY ("policy_version_id", "rule_id") REFERENCES public."agent_policy_rules" ("policy_version_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_tool_calls" ADD CONSTRAINT "fk_tool_decision_run" FOREIGN KEY ("run_id", "decision_id") REFERENCES public."agent_decisions" ("run_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_tool_calls" ADD CONSTRAINT "fk_tool_conversation_run" FOREIGN KEY ("conversation_id", "run_id") REFERENCES public."agent_runs" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."conversations" ADD CONSTRAINT "fk_conversation_application" FOREIGN KEY ("application_id", "event_id", "owner_user_id") REFERENCES public."applications" ("id", "event_id", "applicant_id") ON DELETE RESTRICT;
ALTER TABLE public."agent_runs" ADD CONSTRAINT "fk_run_conversation" FOREIGN KEY ("event_id", "conversation_id") REFERENCES public."conversations" ("event_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_runs" ADD CONSTRAINT "fk_run_trigger_message" FOREIGN KEY ("conversation_id", "trigger_message_id") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_runs" ADD CONSTRAINT "fk_run_response_message" FOREIGN KEY ("conversation_id", "response_message_id") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."staff_assignments" ADD CONSTRAINT "fk_staff_credential_subject" FOREIGN KEY ("user_id", "credential_id") REFERENCES public."professional_credentials" ("subject_user_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."consent_grants" ADD CONSTRAINT "fk_consent_guardian_subject" FOREIGN KEY ("subject_user_id", "guardian_link_id") REFERENCES public."guardian_links" ("subject_user_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."consent_grants" ADD CONSTRAINT "fk_consent_guardian_decider" FOREIGN KEY ("subject_user_id", "decided_by_user_id", "guardian_link_id") REFERENCES public."guardian_links" ("subject_user_id", "guardian_user_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."safety_cases" ADD CONSTRAINT "fk_safety_source_message" FOREIGN KEY ("conversation_id", "source_message_id") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."safety_cases" ADD CONSTRAINT "fk_safety_source_decision" FOREIGN KEY ("conversation_id", "source_decision_id") REFERENCES public."agent_decisions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "fk_handoff_case_conversation" FOREIGN KEY ("conversation_id", "safety_case_id") REFERENCES public."safety_cases" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "fk_handoff_disclosure_recipient" FOREIGN KEY ("authorization_grant_id", "scope_snapshot_id", "receiver_user_id") REFERENCES public."share_grants" ("id", "snapshot_id", "recipient_id") ON DELETE RESTRICT;
ALTER TABLE public."members" ADD CONSTRAINT "fk_member_history_event" FOREIGN KEY ("event_id", "history_from_message_id") REFERENCES public."messages" ("event_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."revisions" ADD CONSTRAINT "fk_revision_conversation" FOREIGN KEY ("event_id", "conversation_id") REFERENCES public."conversations" ("event_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."understandings" ADD CONSTRAINT "fk_understanding_conversation" FOREIGN KEY ("event_id", "conversation_id") REFERENCES public."conversations" ("event_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."share_snapshots" ADD CONSTRAINT "fk_snapshot_source_conversation" FOREIGN KEY ("event_id", "source_conversation_id") REFERENCES public."conversations" ("event_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."share_snapshots" ADD CONSTRAINT "fk_snapshot_source_version" FOREIGN KEY ("source_conversation_id", "source_record_version_id") REFERENCES public."record_versions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."understanding_confirmations" ADD CONSTRAINT "fk_confirmation_record_version" FOREIGN KEY ("understanding_id", "version", "record_version_id") REFERENCES public."record_versions" ("understanding_id", "version", "id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_request_conversation_event" FOREIGN KEY ("event_id", "conversation_id") REFERENCES public."conversations" ("event_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_request_understanding_scope" FOREIGN KEY ("conversation_id", "understanding_id") REFERENCES public."understandings" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_request_record_scope" FOREIGN KEY ("conversation_id", "record_version_id") REFERENCES public."record_versions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_request_message_scope" FOREIGN KEY ("conversation_id", "message_id") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."share_grants" ADD CONSTRAINT "fk_grant_target_conversation" FOREIGN KEY ("target_event_id", "target_conversation_id") REFERENCES public."conversations" ("event_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."share_grants" ADD CONSTRAINT "fk_grant_application_conversation" FOREIGN KEY ("application_id", "target_conversation_id") REFERENCES public."conversations" ("application_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "fk_handoff_acknowledgement" FOREIGN KEY ("conversation_id", "acknowledgement_audit_event_id") REFERENCES public."audit_events" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "fk_handoff_acceptance" FOREIGN KEY ("conversation_id", "acceptance_audit_event_id") REFERENCES public."audit_events" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "fk_handoff_closure" FOREIGN KEY ("conversation_id", "closure_audit_event_id") REFERENCES public."audit_events" ("conversation_id", "id") ON DELETE RESTRICT;

ALTER TABLE public.agent_runs ADD CONSTRAINT ck_run_attempt CHECK (attempt_no IS NULL OR attempt_no > 0);
ALTER TABLE public.agent_runs ADD CONSTRAINT ck_run_logical_pair CHECK ((logical_turn_id IS NULL) = (attempt_no IS NULL));
ALTER TABLE public.agent_runs ADD CONSTRAINT ck_run_versions CHECK ((state_revision IS NULL OR state_revision >= 0) AND (permission_epoch IS NULL OR permission_epoch >= 0));
ALTER TABLE public.agent_runs ADD CONSTRAINT ck_run_cost CHECK ((input_tokens IS NULL OR input_tokens >= 0) AND (output_tokens IS NULL OR output_tokens >= 0) AND (reasoning_tokens IS NULL OR reasoning_tokens >= 0) AND (estimated_cost_minor IS NULL OR estimated_cost_minor >= 0) AND (latency_ms IS NULL OR latency_ms >= 0));

CREATE UNIQUE INDEX "uq_conversation_room" ON public."conversations" (event_id) WHERE kind = 'room';
CREATE UNIQUE INDEX "uq_conversation_private" ON public."conversations" (event_id, kind, owner_user_id) WHERE kind IN ('private','intake');
CREATE UNIQUE INDEX "uq_conversation_application" ON public."conversations" (application_id) WHERE kind = 'professional';
CREATE UNIQUE INDEX "uq_decision_selected_rule" ON public."agent_decision_rule_matches" (decision_id) WHERE outcome = 'selected';
CREATE UNIQUE INDEX "uq_tool_request" ON public."agent_tool_calls" (conversation_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX "ix_policy_active" ON public."policy_versions" (policy_key, status, effective_at DESC);
CREATE INDEX "ix_file_owner" ON public."file_objects" (owner_user_id, created_at DESC);
CREATE INDEX "ix_file_retention" ON public."file_objects" (status, retention_until);
CREATE INDEX "ix_conversation_owner" ON public."conversations" (owner_user_id, kind, updated_at DESC, id);
CREATE INDEX "ix_conversation_event" ON public."conversations" (event_id, kind);
CREATE INDEX "ix_rule_priority" ON public."agent_policy_rules" (policy_version_id, priority_group, priority, rule_code);
CREATE INDEX "ix_decision_conversation" ON public."agent_decisions" (conversation_id, created_at DESC, id);
CREATE INDEX "ix_match_conversation" ON public."agent_decision_rule_matches" (conversation_id, decision_id);
CREATE INDEX "ix_match_policy_rule" ON public."agent_decision_rule_matches" (policy_version_id, rule_id, outcome);
CREATE INDEX "ix_tool_decision" ON public."agent_tool_calls" (run_id, decision_id);
CREATE INDEX "ix_tool_status" ON public."agent_tool_calls" (tool_name, status, started_at);
CREATE INDEX "ix_run_conversation" ON public."agent_runs" (conversation_id, created_at DESC, id);
CREATE INDEX "ix_run_trigger" ON public."agent_runs" (conversation_id, trigger_message_id);
CREATE INDEX "ix_run_response" ON public."agent_runs" (conversation_id, response_message_id);

-- New tables stay inaccessible to runtime roles. Native writes need reviewed role policies and gates.
ALTER TABLE public."policy_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."policy_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."guardian_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."guardian_links" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."consent_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."consent_grants" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."conversations" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."record_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."record_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."record_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."record_sources" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."agent_policy_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."agent_policy_rules" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."conversation_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."conversation_states" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."agent_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."agent_decisions" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."agent_decision_rule_matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."agent_decision_rule_matches" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."agent_tool_calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."agent_tool_calls" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."professional_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."professional_credentials" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."safety_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."safety_cases" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."support_handoffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."support_handoffs" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."support_resources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."support_resources" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."staff_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."staff_assignments" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."audit_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."data_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."data_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."data_request_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."data_request_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."file_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."file_objects" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."profiles" ADD CONSTRAINT "ck_profiles_containers" CHECK (jsonb_typeof("communication_preferences") = 'object');
ALTER TABLE public."share_snapshots" ADD CONSTRAINT "ck_share_snapshots_containers" CHECK (("payload" IS NULL OR jsonb_typeof("payload") = 'object'));
ALTER TABLE public."agent_runs" ADD CONSTRAINT "ck_agent_runs_containers" CHECK (jsonb_typeof("consent_epochs") = 'object' AND ("input_manifest" IS NULL OR jsonb_typeof("input_manifest") = 'object'));
ALTER TABLE public.profiles ADD CONSTRAINT ck_profile_consent_epoch CHECK (consent_epoch >= 0);
ALTER TABLE public.events ADD CONSTRAINT ck_event_lifecycle_revision CHECK (lifecycle_version >= 0);
ALTER TABLE public.members ADD CONSTRAINT ck_member_generation CHECK (membership_generation > 0);
ALTER TABLE public.messages ADD CONSTRAINT ck_private_hint_shape CHECK ((message_purpose = 'private_hint' AND context_room_conversation_id IS NOT NULL AND context_room_message_id IS NOT NULL AND role = 'assistant') OR (message_purpose <> 'private_hint' AND context_room_conversation_id IS NULL AND context_room_message_id IS NULL));
ALTER TABLE public.share_snapshots ADD CONSTRAINT ck_snapshot_native_pair CHECK ((source_conversation_id IS NULL) = (source_record_version_id IS NULL));
CREATE UNIQUE INDEX "uq_guardian_unclosed" ON public."guardian_links" (subject_user_id, guardian_user_id) WHERE status IN ('pending','verified');
CREATE UNIQUE INDEX "uq_safety_unclosed" ON public."safety_cases" (conversation_id, subject_user_id) NULLS NOT DISTINCT WHERE status IN ('open','assigned','handling','followup');
CREATE INDEX "ix_consent_active" ON public."consent_grants" (subject_user_id, purpose_code, policy_version_id, scope_event_id, granted_at DESC) WHERE withdrawn_at IS NULL;
CREATE INDEX "ix_credential_subject" ON public."professional_credentials" (subject_user_id, status, valid_until);
CREATE INDEX "ix_case_due" ON public."safety_cases" (status, priority_code, review_due_at);
CREATE INDEX "ix_case_assignee" ON public."safety_cases" (assigned_user_id, status);
CREATE INDEX "ix_handoff_due" ON public."support_handoffs" (status, due_at);
CREATE INDEX "ix_handoff_case" ON public."support_handoffs" (safety_case_id, created_at DESC);
CREATE INDEX "ix_staff_role" ON public."staff_assignments" (user_id, role_code) WHERE revoked_at IS NULL;
CREATE INDEX "ix_audit_conversation" ON public."audit_events" (conversation_id, occurred_at DESC);
CREATE INDEX "ix_record_history" ON public."record_versions" (conversation_id, created_at DESC, id);
CREATE INDEX "ix_source_record_target" ON public."record_sources" (target_record_version_id) WHERE target_record_version_id IS NOT NULL;
CREATE INDEX "ix_source_decision_target" ON public."record_sources" (target_agent_decision_id) WHERE target_agent_decision_id IS NOT NULL;
CREATE INDEX "ix_source_message" ON public."record_sources" (source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX "ix_source_saved" ON public."record_sources" (source_record_version_id) WHERE source_record_version_id IS NOT NULL;
CREATE INDEX "ix_source_grant" ON public."record_sources" (source_grant_id) WHERE source_grant_id IS NOT NULL;
CREATE INDEX "ix_request_due" ON public."data_requests" (status, due_at);
CREATE INDEX "ix_request_item_due" ON public."data_request_items" (status, not_before);


-- M2 completion: additive structure only; all transaction and cutover gates remain closed.
ALTER TABLE public."message_cards" ADD CONSTRAINT "uq_message_cards_m2_2" UNIQUE ("message_id", "slot");
ALTER TABLE public."message_cards" ADD CONSTRAINT "uq_message_cards_m2_3" UNIQUE ("conversation_id", "id");
ALTER TABLE public."message_cards" ADD CONSTRAINT "uq_message_cards_m2_4" UNIQUE ("message_id", "id");
ALTER TABLE public."interaction_events" ADD CONSTRAINT "uq_interaction_events_m2_2" UNIQUE ("actor_user_id", "request_id");
ALTER TABLE public."interaction_events" ADD CONSTRAINT "uq_interaction_events_m2_3" UNIQUE ("conversation_id", "id");
ALTER TABLE public."assessment_versions" ADD CONSTRAINT "uq_assessment_versions_m2_2" UNIQUE ("instrument_code", "questionnaire_version", "scoring_version", "locale");
ALTER TABLE public."assessment_sessions" ADD CONSTRAINT "uq_assessment_sessions_m2_2" UNIQUE ("id", "assessment_version_id", "conversation_id");
ALTER TABLE public."assessment_sessions" ADD CONSTRAINT "uq_assessment_sessions_m2_3" UNIQUE ("conversation_id", "id");
ALTER TABLE public."assessment_submissions" ADD CONSTRAINT "uq_assessment_submissions_m2_2" UNIQUE ("session_id");
ALTER TABLE public."assessment_submissions" ADD CONSTRAINT "uq_assessment_submissions_m2_3" UNIQUE ("conversation_id", "id");
ALTER TABLE public."record_versions" ADD CONSTRAINT "uq_record_versions_m2_6" UNIQUE ("exercise_id", "version");
ALTER TABLE public."record_versions" ADD CONSTRAINT "uq_record_versions_m2_7" UNIQUE ("conversation_id", "exercise_id", "id");
ALTER TABLE public."knowledge_sources" ADD CONSTRAINT "uq_knowledge_sources_m2_2" UNIQUE ("source_key", "version");
ALTER TABLE public."method_versions" ADD CONSTRAINT "uq_method_versions_m2_2" UNIQUE ("method_key", "version");
ALTER TABLE public."knowledge_releases" ADD CONSTRAINT "uq_knowledge_releases_m2_2" UNIQUE ("release_key");
ALTER TABLE public."exercises" ADD CONSTRAINT "uq_exercises_m2_1" UNIQUE ("id");
ALTER TABLE public."exercises" ADD CONSTRAINT "uq_exercises_m2_2" UNIQUE ("conversation_id", "id");
ALTER TABLE public."agent_runs" ADD CONSTRAINT "uq_agent_runs_m2_4" UNIQUE ("id", "knowledge_release_id");
ALTER TABLE public."followups" ADD CONSTRAINT "uq_followups_m2_1" UNIQUE ("conversation_id", "id");
ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_source_submission" FOREIGN KEY ("source_conversation_id", "source_assessment_submission_id") REFERENCES public."assessment_submissions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_version_parent_exercise_id" FOREIGN KEY ("conversation_id", "exercise_id") REFERENCES public."exercises" ("conversation_id", "id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."exercises" ADD CONSTRAINT "fk_current_exercise_id" FOREIGN KEY ("conversation_id", "id", "current_record_version_id") REFERENCES public."record_versions" ("conversation_id", "exercise_id", "id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."assessment_submissions" ADD CONSTRAINT "fk_assessment_submission_session" FOREIGN KEY ("session_id", "assessment_version_id", "conversation_id") REFERENCES public."assessment_sessions" ("id", "assessment_version_id", "conversation_id") ON DELETE RESTRICT;
ALTER TABLE public."message_cards" ADD CONSTRAINT "fk_card_message" FOREIGN KEY ("conversation_id", "message_id") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."message_cards" ADD CONSTRAINT "fk_card_assessment_session_id" FOREIGN KEY ("conversation_id", "assessment_session_id") REFERENCES public."assessment_sessions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."message_cards" ADD CONSTRAINT "fk_card_exercise_id" FOREIGN KEY ("conversation_id", "exercise_id") REFERENCES public."exercises" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."message_cards" ADD CONSTRAINT "fk_card_understanding_id" FOREIGN KEY ("conversation_id", "understanding_id") REFERENCES public."understandings" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."message_cards" ADD CONSTRAINT "fk_card_followup_id" FOREIGN KEY ("conversation_id", "followup_id") REFERENCES public."followups" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."interaction_events" ADD CONSTRAINT "fk_interaction_card_id" FOREIGN KEY ("conversation_id", "card_id") REFERENCES public."message_cards" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."interaction_events" ADD CONSTRAINT "fk_interaction_agent_run_id" FOREIGN KEY ("conversation_id", "agent_run_id") REFERENCES public."agent_runs" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."interaction_events" ADD CONSTRAINT "fk_interaction_exercise_id" FOREIGN KEY ("conversation_id", "exercise_id") REFERENCES public."exercises" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."interaction_events" ADD CONSTRAINT "fk_interaction_assessment_session_id" FOREIGN KEY ("conversation_id", "assessment_session_id") REFERENCES public."assessment_sessions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_tool_calls" ADD CONSTRAINT "fk_tool_interaction" FOREIGN KEY ("conversation_id", "interaction_event_id") REFERENCES public."interaction_events" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_method_refs" ADD CONSTRAINT "fk_method_ref_decision" FOREIGN KEY ("run_id", "decision_id") REFERENCES public."agent_decisions" ("run_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."conversation_states" ADD CONSTRAINT "fk_state_interaction" FOREIGN KEY ("conversation_id", "last_interaction_id") REFERENCES public."interaction_events" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_action_resolution" FOREIGN KEY ("conversation_id", "resolution_interaction_id") REFERENCES public."interaction_events" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_action_started_practice" FOREIGN KEY ("conversation_id", "started_exercise_id") REFERENCES public."exercises" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_action_decision" FOREIGN KEY ("run_id", "decision_id") REFERENCES public."agent_decisions" ("run_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_action_run" FOREIGN KEY ("conversation_id", "run_id") REFERENCES public."agent_runs" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_action_message" FOREIGN KEY ("conversation_id", "message_id") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_action_card" FOREIGN KEY ("conversation_id", "card_id") REFERENCES public."message_cards" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_method_refs" ADD CONSTRAINT "fk_method_ref_tool" FOREIGN KEY ("run_id", "tool_call_id") REFERENCES public."agent_tool_calls" ("run_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_method_refs" ADD CONSTRAINT "fk_method_ref_release_item" FOREIGN KEY ("knowledge_release_id", "method_version_id") REFERENCES public."knowledge_release_items" ("knowledge_release_id", "method_version_id") ON DELETE RESTRICT;
ALTER TABLE public."agent_method_refs" ADD CONSTRAINT "fk_method_ref_run_release" FOREIGN KEY ("run_id", "knowledge_release_id") REFERENCES public."agent_runs" ("id", "knowledge_release_id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_action_method_tool_run" FOREIGN KEY ("run_id", "method_tool_call_id") REFERENCES public."agent_tool_calls" ("run_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_action_method_retrieval" FOREIGN KEY ("method_tool_call_id", "method_version_id") REFERENCES public."agent_method_refs" ("tool_call_id", "method_version_id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_action_card_message" FOREIGN KEY ("message_id", "card_id") REFERENCES public."message_cards" ("message_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."exercises" ADD CONSTRAINT "fk_exercise_event" FOREIGN KEY ("event_id", "conversation_id") REFERENCES public."conversations" ("event_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."exercises" ADD CONSTRAINT "fk_exercise_owner" FOREIGN KEY ("conversation_id", "owner_user_id") REFERENCES public."conversations" ("id", "owner_user_id") ON DELETE RESTRICT;
ALTER TABLE public."followups" ADD CONSTRAINT "fk_followup_event" FOREIGN KEY ("event_id", "conversation_id") REFERENCES public."conversations" ("event_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."followups" ADD CONSTRAINT "fk_followup_owner" FOREIGN KEY ("conversation_id", "user_id") REFERENCES public."conversations" ("id", "owner_user_id") ON DELETE RESTRICT;
ALTER TABLE public."followups" ADD CONSTRAINT "fk_followup_exercise" FOREIGN KEY ("conversation_id", "exercise_id") REFERENCES public."exercises" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."assessment_sessions" ADD CONSTRAINT "fk_assessment_subject" FOREIGN KEY ("conversation_id", "subject_user_id") REFERENCES public."conversations" ("id", "owner_user_id") ON DELETE RESTRICT;
ALTER TABLE public."assessment_sessions" ADD CONSTRAINT "fk_assessment_replaces" FOREIGN KEY ("conversation_id", "replaces_session_id") REFERENCES public."assessment_sessions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."assessment_submissions" ADD CONSTRAINT "fk_submission_insight" FOREIGN KEY ("conversation_id", "insight_understanding_id") REFERENCES public."understandings" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."messages" ADD CONSTRAINT "fk_message_exercise" FOREIGN KEY ("conversation_id", "exercise_id") REFERENCES public."exercises" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_action_applied_version" FOREIGN KEY ("conversation_id", "applied_record_version_id") REFERENCES public."record_versions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."method_versions" ADD CONSTRAINT "fk_method_reviewer_subject" FOREIGN KEY ("reviewed_by", "reviewer_credential_id") REFERENCES public."professional_credentials" ("subject_user_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."message_cards" ADD CONSTRAINT "fk_message_cards_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."message_cards" ADD CONSTRAINT "fk_message_cards_invite_id" FOREIGN KEY ("invite_id") REFERENCES public."invites" ("id") ON DELETE RESTRICT;
ALTER TABLE public."message_cards" ADD CONSTRAINT "fk_message_cards_application_id" FOREIGN KEY ("application_id") REFERENCES public."applications" ("id") ON DELETE RESTRICT;
ALTER TABLE public."interaction_events" ADD CONSTRAINT "fk_interaction_events_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."interaction_events" ADD CONSTRAINT "fk_interaction_events_actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."assessment_versions" ADD CONSTRAINT "fk_assessment_versions_source_id" FOREIGN KEY ("source_id") REFERENCES public."knowledge_sources" ("id") ON DELETE RESTRICT;
ALTER TABLE public."assessment_versions" ADD CONSTRAINT "fk_assessment_versions_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."assessment_versions" ADD CONSTRAINT "fk_assessment_versions_reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."assessment_sessions" ADD CONSTRAINT "fk_assessment_sessions_subject_user_id" FOREIGN KEY ("subject_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."assessment_sessions" ADD CONSTRAINT "fk_assessment_sessions_assessment_version_id" FOREIGN KEY ("assessment_version_id") REFERENCES public."assessment_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."assessment_sessions" ADD CONSTRAINT "fk_assessment_sessions_consent_grant_id" FOREIGN KEY ("consent_grant_id") REFERENCES public."consent_grants" ("id") ON DELETE RESTRICT;
ALTER TABLE public."assessment_submissions" ADD CONSTRAINT "fk_assessment_submissions_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."assessment_submissions" ADD CONSTRAINT "fk_assessment_submissions_assessment_version_id" FOREIGN KEY ("assessment_version_id") REFERENCES public."assessment_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_method_refs" ADD CONSTRAINT "fk_agent_method_refs_knowledge_release_id" FOREIGN KEY ("knowledge_release_id") REFERENCES public."knowledge_releases" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_method_refs" ADD CONSTRAINT "fk_agent_method_refs_method_version_id" FOREIGN KEY ("method_version_id") REFERENCES public."method_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."knowledge_sources" ADD CONSTRAINT "fk_knowledge_sources_file_id" FOREIGN KEY ("file_id") REFERENCES public."file_objects" ("id") ON DELETE RESTRICT;
ALTER TABLE public."knowledge_sources" ADD CONSTRAINT "fk_knowledge_sources_rights_evidence_file_id" FOREIGN KEY ("rights_evidence_file_id") REFERENCES public."file_objects" ("id") ON DELETE RESTRICT;
ALTER TABLE public."knowledge_sources" ADD CONSTRAINT "fk_knowledge_sources_verified_by" FOREIGN KEY ("verified_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."method_versions" ADD CONSTRAINT "fk_method_versions_reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."method_versions" ADD CONSTRAINT "fk_method_versions_agent_policy_version_id" FOREIGN KEY ("agent_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."method_sources" ADD CONSTRAINT "fk_method_sources_method_version_id" FOREIGN KEY ("method_version_id") REFERENCES public."method_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."method_sources" ADD CONSTRAINT "fk_method_sources_source_id" FOREIGN KEY ("source_id") REFERENCES public."knowledge_sources" ("id") ON DELETE RESTRICT;
ALTER TABLE public."knowledge_releases" ADD CONSTRAINT "fk_knowledge_releases_approved_by" FOREIGN KEY ("approved_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."knowledge_release_items" ADD CONSTRAINT "fk_knowledge_release_items_knowledge_release_id" FOREIGN KEY ("knowledge_release_id") REFERENCES public."knowledge_releases" ("id") ON DELETE RESTRICT;
ALTER TABLE public."knowledge_release_items" ADD CONSTRAINT "fk_knowledge_release_items_method_version_id" FOREIGN KEY ("method_version_id") REFERENCES public."method_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_data_requests_assessment_session_id" FOREIGN KEY ("assessment_session_id") REFERENCES public."assessment_sessions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."data_requests" ADD CONSTRAINT "fk_data_requests_exercise_id" FOREIGN KEY ("exercise_id") REFERENCES public."exercises" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_agent_actions_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "fk_agent_actions_method_version_id" FOREIGN KEY ("method_version_id") REFERENCES public."method_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."exercises" ADD CONSTRAINT "fk_exercises_owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."exercises" ADD CONSTRAINT "fk_exercises_method_version_id" FOREIGN KEY ("method_version_id") REFERENCES public."method_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."invites" ADD CONSTRAINT "fk_invites_created_by" FOREIGN KEY ("created_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."invites" ADD CONSTRAINT "fk_invites_target_conversation_id" FOREIGN KEY ("target_conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."invites" ADD CONSTRAINT "fk_invites_intended_user_id" FOREIGN KEY ("intended_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."invites" ADD CONSTRAINT "fk_invites_history_policy_version_id" FOREIGN KEY ("history_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_runs" ADD CONSTRAINT "fk_agent_runs_knowledge_release_id" FOREIGN KEY ("knowledge_release_id") REFERENCES public."knowledge_releases" ("id") ON DELETE RESTRICT;
ALTER TABLE public."followups" ADD CONSTRAINT "fk_followups_reminder_consent_grant_id" FOREIGN KEY ("reminder_consent_grant_id") REFERENCES public."consent_grants" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_actions" ADD CONSTRAINT "ck_action_native_schema" CHECK (conversation_id IS NULL OR (proposal_schema_version IS NOT NULL AND proposal_schema_version = 2 AND decision_id IS NOT NULL AND ((proposal->>'kind') IN ('method','summary','nvc','followup')) IS TRUE));
ALTER TABLE public."agent_actions" ADD CONSTRAINT "ck_action_native_method" CHECK (conversation_id IS NULL OR ((((proposal->>'kind') = 'method') IS TRUE AND method_version_id IS NOT NULL AND method_tool_call_id IS NOT NULL AND applied_record_version_id IS NULL) OR (((proposal->>'kind') <> 'method') IS TRUE AND method_version_id IS NULL AND method_tool_call_id IS NULL AND started_exercise_id IS NULL)));
ALTER TABLE public."agent_actions" ADD CONSTRAINT "ck_action_native_resolution" CHECK (conversation_id IS NULL OR ((status = 'pending' AND resolution_interaction_id IS NULL AND applied_record_version_id IS NULL AND started_exercise_id IS NULL) OR (status = 'dismissed' AND resolution_interaction_id IS NOT NULL AND resolved_at IS NOT NULL AND applied_record_version_id IS NULL AND started_exercise_id IS NULL) OR (status = 'applied' AND resolution_interaction_id IS NOT NULL AND resolved_at IS NOT NULL AND ((((proposal->>'kind') = 'method') IS TRUE AND started_exercise_id IS NOT NULL) OR (((proposal->>'kind') <> 'method') IS TRUE AND applied_record_version_id IS NOT NULL)))));
ALTER TABLE public."exercises" ADD CONSTRAINT "ck_exercise_native_owner" CHECK (conversation_id IS NULL OR (id IS NOT NULL AND owner_user_id IS NOT NULL));
ALTER TABLE public."exercises" ADD CONSTRAINT "ck_exercise_kind" CHECK (kind IS NULL OR kind IN ('narrative','nvc','roleplay'));
ALTER TABLE public."exercises" ADD CONSTRAINT "ck_exercise_status" CHECK (status IS NULL OR status IN ('proposed','active','paused','completed','abandoned'));
ALTER TABLE public."exercises" ADD CONSTRAINT "ck_exercise_provenance" CHECK (time_provenance IS NULL OR time_provenance IN ('observed','legacy_unknown'));
ALTER TABLE public."exercises" ADD CONSTRAINT "ck_exercise_revision" CHECK (revision >= 0);
ALTER TABLE public."invites" ADD CONSTRAINT "ck_invite_delivery" CHECK (delivery_state IS NULL OR delivery_state IN ('not_sent','queued','sent','failed'));
ALTER TABLE public."invites" ADD CONSTRAINT "ck_invite_generation" CHECK (accepted_membership_generation IS NULL OR accepted_membership_generation > 0);
ALTER TABLE public."followups" ADD CONSTRAINT "ck_followup_status" CHECK (action_status IN ('unknown','planned','attempted','not_attempted','declined'));
ALTER TABLE public."followups" ADD CONSTRAINT "ck_followup_outcome_pair" CHECK ((outcome IS NULL) = (outcome_reported_at IS NULL));
ALTER TABLE public."followups" ADD CONSTRAINT "ck_followup_schema" CHECK (outcome_schema_version = 1);
ALTER TABLE public."followups" ADD CONSTRAINT "ck_followup_revision" CHECK (revision > 0);
ALTER TABLE public."followups" ADD CONSTRAINT "ck_followup_reminder_consent" CHECK (NOT reminder_opt_in OR reminder_consent_grant_id IS NOT NULL);
ALTER TABLE public."followups" ADD CONSTRAINT "ck_followups_outcome" CHECK ("outcome" IS NULL OR jsonb_typeof("outcome") = 'object');
CREATE INDEX "ix_card_pending" ON public."message_cards" (conversation_id,status,created_at DESC);
CREATE INDEX "ix_interaction_history" ON public."interaction_events" (conversation_id,created_at DESC,id);
CREATE INDEX "ix_assessment_version" ON public."assessment_versions" (instrument_code,status,locale);
CREATE INDEX "ix_assessment_subject" ON public."assessment_sessions" (subject_user_id,assessment_version_id,started_at DESC,id);
CREATE INDEX "ix_assessment_progress" ON public."assessment_sessions" (conversation_id,status);
CREATE INDEX "ix_submission_history" ON public."assessment_submissions" (conversation_id,submitted_at DESC);
CREATE INDEX "ix_submission_analysis" ON public."assessment_submissions" (analysis_status,recorded_at) WHERE analysis_status IN ('pending','error');
CREATE INDEX "ix_exercise_history" ON public."exercises" (conversation_id,kind,updated_at DESC,id);
CREATE INDEX "ix_exercise_owner" ON public."exercises" (owner_user_id,status,updated_at DESC);
CREATE INDEX "ix_action_pending" ON public."agent_actions" (conversation_id,status,created_at DESC);
CREATE UNIQUE INDEX "uq_invite_request" ON public."invites" (created_by,request_id) WHERE created_by IS NOT NULL AND request_id IS NOT NULL;
CREATE INDEX "ix_method_ref_used" ON public."agent_method_refs" (run_id,used);
CREATE INDEX "ix_method_ref_version" ON public."agent_method_refs" (method_version_id);
CREATE INDEX "ix_knowledge_rights" ON public."knowledge_sources" (rights_status,valid_until);
CREATE INDEX "ix_method_status" ON public."method_versions" (status,method_key,version DESC);
CREATE INDEX "ix_method_source" ON public."method_sources" (source_id,method_version_id);
CREATE INDEX "ix_knowledge_release" ON public."knowledge_releases" (status,published_at DESC);
CREATE INDEX "ix_release_method" ON public."knowledge_release_items" (method_version_id,knowledge_release_id);
CREATE INDEX "ix_followup_reminder" ON public."followups" (review_at) WHERE reviewed_at IS NULL AND reminder_opt_in;
CREATE INDEX "ix_source_submission" ON public."record_sources" (source_assessment_submission_id) WHERE source_assessment_submission_id IS NOT NULL;
CREATE INDEX "ix_method_versions_allowed_stages" ON public."method_versions" USING gin ("allowed_stages");
CREATE INDEX "ix_method_versions_allowed_strategies" ON public."method_versions" USING gin ("allowed_strategies");
ALTER TABLE public."message_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."message_cards" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."interaction_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."interaction_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."assessment_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."assessment_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."assessment_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."assessment_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."assessment_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."assessment_submissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."agent_method_refs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."agent_method_refs" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."knowledge_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."knowledge_sources" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."method_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."method_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."method_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."method_sources" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."knowledge_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."knowledge_releases" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."knowledge_release_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."knowledge_release_items" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."support_handoffs" ADD CONSTRAINT "uq_support_handoffs_m3_parent_2" UNIQUE ("id", "resource_id");
ALTER TABLE public."support_handoffs" ADD CONSTRAINT "uq_support_handoffs_m3_parent_3" UNIQUE ("id", "receiver_user_id");

ALTER TABLE public."support_handoffs" ADD CONSTRAINT "uq_support_handoffs_m3_parent_1" UNIQUE ("conversation_id", "id");
ALTER TABLE public."data_requests" ADD CONSTRAINT "uq_data_requests_m3_parent_1" UNIQUE ("conversation_id", "id");

ALTER TABLE public."file_objects" ADD CONSTRAINT "uq_file_content_identity" UNIQUE ("id", "sha256");

ALTER TABLE public."followups" ADD COLUMN "source_record_version_id" uuid;
ALTER TABLE public."followups" ADD COLUMN "source_snapshot_id" uuid;
ALTER TABLE public."followups" ADD COLUMN "source_grant_id" uuid;
ALTER TABLE public."followups" ADD COLUMN "source_invalidated_at" timestamptz;
ALTER TABLE public."followups" ADD CONSTRAINT "ck_followup_source" CHECK (((source_record_version_id IS NULL AND source_snapshot_id IS NULL AND source_grant_id IS NULL) OR (source_record_version_id IS NOT NULL AND source_snapshot_id IS NULL AND source_grant_id IS NULL) OR (source_record_version_id IS NULL AND source_snapshot_id IS NOT NULL AND source_grant_id IS NOT NULL)) AND (exercise_id IS NULL OR source_record_version_id IS NOT NULL) AND (num_nonnulls(source_record_version_id,source_snapshot_id,source_grant_id) = 0 OR conversation_id IS NOT NULL));
ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_record_signer_credential" FOREIGN KEY ("signed_by_user_id", "signer_credential_id") REFERENCES public."professional_credentials" ("subject_user_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_record_signed_by" FOREIGN KEY ("signed_by_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."followups" ADD CONSTRAINT "fk_followup_source_version" FOREIGN KEY ("conversation_id", "source_record_version_id") REFERENCES public."record_versions" ("conversation_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."followups" ADD CONSTRAINT "fk_followup_exercise_version" FOREIGN KEY ("conversation_id", "exercise_id", "source_record_version_id") REFERENCES public."record_versions" ("conversation_id", "exercise_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."followups" ADD CONSTRAINT "fk_followup_source_grant" FOREIGN KEY ("conversation_id", "source_grant_id", "source_snapshot_id") REFERENCES public."share_grants" ("target_conversation_id", "id", "snapshot_id") ON DELETE RESTRICT;
ALTER TABLE public."followups" ADD CONSTRAINT "fk_followup_source_recipient" FOREIGN KEY ("source_grant_id", "source_snapshot_id", "user_id") REFERENCES public."share_grants" ("id", "snapshot_id", "recipient_id") ON DELETE RESTRICT;
ALTER TABLE public."followups" ADD CONSTRAINT "fk_followup_source_snapshot" FOREIGN KEY ("source_snapshot_id") REFERENCES public."share_snapshots" ("id") ON DELETE RESTRICT;
CREATE INDEX "ix_followup_source_version" ON public."followups" (source_record_version_id) WHERE source_record_version_id IS NOT NULL;
CREATE INDEX "ix_followup_source_snapshot" ON public."followups" (source_snapshot_id,source_grant_id) WHERE source_snapshot_id IS NOT NULL;

ALTER TABLE public."share_grants" ADD CONSTRAINT "ck_share_grant_purpose" CHECK (purpose_code IS NULL OR purpose_code IN ('personal_context','room_discussion','professional_service','action_followup'));

COMMIT;
