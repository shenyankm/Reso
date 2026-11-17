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
  CONSTRAINT "pk_agent_tool_calls" PRIMARY KEY ("id"),
  CONSTRAINT "ck_tool_ordinal" CHECK (ordinal > 0),
  CONSTRAINT "ck_tool_schemas" CHECK (input_schema_version = 2 AND log_schema_version = 1),
  CONSTRAINT "ck_tool_status" CHECK (status IN ('requested','running','succeeded','failed','blocked','stale')),
  CONSTRAINT "ck_tool_time" CHECK (finished_at IS NULL OR (started_at IS NOT NULL AND finished_at >= started_at)),
  CONSTRAINT "ck_tool_json" CHECK (jsonb_typeof(input) = 'object' AND jsonb_typeof(authorization_manifest) = 'object' AND (result_summary IS NULL OR jsonb_typeof(result_summary) = 'object'))
);

ALTER TABLE public."messages" ADD COLUMN "conversation_id" uuid;
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

ALTER TABLE public."policy_versions" ADD CONSTRAINT "uq_policy_versions_1" UNIQUE ("policy_key", "version");
ALTER TABLE public."file_objects" ADD CONSTRAINT "uq_file_objects_1" UNIQUE ("storage_key");
ALTER TABLE public."conversations" ADD CONSTRAINT "uq_conversations_1" UNIQUE ("event_id", "id");
ALTER TABLE public."conversations" ADD CONSTRAINT "uq_conversations_2" UNIQUE ("application_id", "id");
ALTER TABLE public."conversations" ADD CONSTRAINT "uq_conversation_owner_identity" UNIQUE ("id", "owner_user_id");
ALTER TABLE public."agent_policy_rules" ADD CONSTRAINT "uq_agent_policy_rules_1" UNIQUE ("policy_version_id", "rule_code");
ALTER TABLE public."agent_policy_rules" ADD CONSTRAINT "uq_agent_policy_rules_2" UNIQUE ("policy_version_id", "id");
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "uq_agent_decisions_1" UNIQUE ("run_id", "ordinal");
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "uq_agent_decisions_2" UNIQUE ("conversation_id", "id");
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "uq_agent_decisions_3" UNIQUE ("run_id", "id");
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "uq_agent_decisions_4" UNIQUE ("id", "policy_version_id");
ALTER TABLE public."agent_decision_rule_matches" ADD CONSTRAINT "uq_agent_decision_rule_matches_1" UNIQUE ("decision_id", "ordinal");
ALTER TABLE public."agent_tool_calls" ADD CONSTRAINT "uq_agent_tool_calls_1" UNIQUE ("run_id", "ordinal");
ALTER TABLE public."agent_tool_calls" ADD CONSTRAINT "uq_agent_tool_calls_2" UNIQUE ("run_id", "id");
ALTER TABLE public."messages" ADD CONSTRAINT "uq_messages_1" UNIQUE ("conversation_id", "id");
ALTER TABLE public."messages" ADD CONSTRAINT "uq_messages_2" UNIQUE ("event_id", "id");
ALTER TABLE public."agent_runs" ADD CONSTRAINT "uq_agent_runs_1" UNIQUE ("conversation_id", "trigger_message_id", "context_version", "attempt_no");
ALTER TABLE public."agent_runs" ADD CONSTRAINT "uq_agent_runs_2" UNIQUE ("conversation_id", "id");
ALTER TABLE public."agent_runs" ADD CONSTRAINT "uq_agent_runs_3" UNIQUE ("id", "agent_policy_version_id");
ALTER TABLE public."applications" ADD CONSTRAINT "uq_applications_1" UNIQUE ("id", "event_id", "applicant_id");

ALTER TABLE public."policy_versions" ADD CONSTRAINT "fk_policy_versions_reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."policy_versions" ADD CONSTRAINT "fk_policy_versions_review_evidence_file_id" FOREIGN KEY ("review_evidence_file_id") REFERENCES public."file_objects" ("id") ON DELETE RESTRICT;
ALTER TABLE public."policy_versions" ADD CONSTRAINT "fk_policy_versions_created_by" FOREIGN KEY ("created_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."file_objects" ADD CONSTRAINT "fk_file_objects_owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."file_objects" ADD CONSTRAINT "fk_file_objects_retention_policy_version_id" FOREIGN KEY ("retention_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."conversations" ADD CONSTRAINT "fk_conversations_event_id" FOREIGN KEY ("event_id") REFERENCES public."events" ("id") ON DELETE RESTRICT;
ALTER TABLE public."conversations" ADD CONSTRAINT "fk_conversations_owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_policy_rules" ADD CONSTRAINT "fk_agent_policy_rules_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_policy_rules" ADD CONSTRAINT "fk_agent_policy_rules_created_by" FOREIGN KEY ("created_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;
ALTER TABLE public."conversation_states" ADD CONSTRAINT "fk_conversation_states_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."conversation_states" ADD CONSTRAINT "fk_conversation_states_stage_policy_version_id" FOREIGN KEY ("stage_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "fk_agent_decisions_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_decisions" ADD CONSTRAINT "fk_agent_decisions_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_decision_rule_matches" ADD CONSTRAINT "fk_agent_decision_rule_matches_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_decision_rule_matches" ADD CONSTRAINT "fk_agent_decision_rule_matches_policy_version_id" FOREIGN KEY ("policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_tool_calls" ADD CONSTRAINT "fk_agent_tool_calls_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE public."agent_runs" ADD CONSTRAINT "fk_agent_runs_agent_policy_version_id" FOREIGN KEY ("agent_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;
ALTER TABLE public."messages" ADD CONSTRAINT "fk_message_conversation" FOREIGN KEY ("event_id", "conversation_id") REFERENCES public."conversations" ("event_id", "id") ON DELETE RESTRICT;
ALTER TABLE public."messages" ADD CONSTRAINT "fk_message_reply" FOREIGN KEY ("conversation_id", "in_reply_to") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;
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

ALTER TABLE public.agent_runs ADD CONSTRAINT ck_run_json CHECK (jsonb_typeof(consent_epochs) = 'object' AND (input_manifest IS NULL OR jsonb_typeof(input_manifest) = 'object'));
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
ALTER TABLE public."file_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."file_objects" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."conversations" FORCE ROW LEVEL SECURITY;
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

ALTER TABLE public."file_objects" ADD CONSTRAINT "uq_file_content_identity" UNIQUE ("id", "sha256");



COMMIT;
