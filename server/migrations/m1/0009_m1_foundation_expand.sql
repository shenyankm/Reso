-- Explicit opt-in M1 batch. Default API/Worker remain on 0001-0007.
-- Transaction and checksum ledger are owned by server/migrations.ts.

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
  "signed_by_user_id" text,
  "signer_credential_id" uuid,
  "signed_at" timestamptz,
  CONSTRAINT "pk_record_versions" PRIMARY KEY ("id"),
  CONSTRAINT "ck_record_content_parent" CHECK (((content->>'type' = 'understanding' AND understanding_id IS NOT NULL)) IS TRUE),
  CONSTRAINT "ck_record_signature" CHECK (num_nonnulls(signed_by_user_id,signer_credential_id,signed_at) = 0),
  CONSTRAINT "ck_record_m1_parent" CHECK (understanding_id IS NOT NULL AND NOT professional_client_visible),
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
  CONSTRAINT "pk_record_sources" PRIMARY KEY ("id"),
  CONSTRAINT "ck_source_target" CHECK (num_nonnulls(target_record_version_id,target_agent_decision_id) = 1),
  CONSTRAINT "ck_source_origin" CHECK (num_nonnulls(source_message_id,source_record_version_id,source_snapshot_id) = 1),
  CONSTRAINT "ck_source_access" CHECK ((source_access_basis = 'same_conversation' AND source_snapshot_id IS NULL AND source_conversation_id = target_conversation_id AND source_conversation_id IS NOT NULL AND source_grant_id IS NULL) OR (source_access_basis = 'authorized_room' AND source_message_id IS NOT NULL AND source_conversation_id IS NOT NULL AND source_grant_id IS NULL) OR (source_access_basis = 'snapshot_grant' AND source_snapshot_id IS NOT NULL AND source_grant_id IS NOT NULL AND source_conversation_id IS NULL)),
  CONSTRAINT "ck_source_offsets" CHECK ((source_start IS NULL AND source_end IS NULL) OR (source_start IS NOT NULL AND source_end IS NOT NULL AND source_start >= 0 AND source_end > source_start)),
  CONSTRAINT "ck_source_m1_role" CHECK (source_role IN ('fact','quote','hypothesis','user_confirmed_summary')),
  CONSTRAINT "ck_source_hash" CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_source_no_self" CHECK (source_record_version_id IS NULL OR target_record_version_id IS NULL OR source_record_version_id <> target_record_version_id)
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
  CONSTRAINT "pk_data_requests" PRIMARY KEY ("id"),
  CONSTRAINT "ck_request_scope_kind" CHECK (scope_kind IN ('account','event','conversation','understanding','record_version','message')),
  CONSTRAINT "ck_request_type" CHECK (request_type IN ('export','erase','rectify','restrict')),
  CONSTRAINT "ck_request_status" CHECK (status IN ('requested','identity_verified','processing','completed','partial','rejected','failed')),
  CONSTRAINT "ck_request_kind" CHECK (requester_kind IN ('user','verified_representative')),
  CONSTRAINT "ck_request_actor" CHECK (target_erased_at IS NOT NULL OR requester_kind <> 'user' OR requester_user_id IS NOT NULL),
  CONSTRAINT "ck_request_m1_scope" CHECK ((target_erased_at IS NOT NULL AND num_nonnulls(subject_user_id,event_id,conversation_id,understanding_id,record_version_id,message_id) = 0 AND status IN ('partial','completed')) OR (target_erased_at IS NULL AND ((scope_kind = 'account' AND subject_user_id IS NOT NULL AND num_nonnulls(event_id,conversation_id,understanding_id,record_version_id,message_id) = 0) OR (scope_kind = 'event' AND event_id IS NOT NULL AND num_nonnulls(conversation_id,understanding_id,record_version_id,message_id) = 0) OR (scope_kind = 'conversation' AND conversation_id IS NOT NULL AND num_nonnulls(understanding_id,record_version_id,message_id) = 0) OR (scope_kind = 'understanding' AND understanding_id IS NOT NULL AND conversation_id IS NOT NULL AND num_nonnulls(record_version_id,message_id) = 0) OR (scope_kind = 'record_version' AND record_version_id IS NOT NULL AND conversation_id IS NOT NULL AND num_nonnulls(understanding_id,message_id) = 0) OR (scope_kind = 'message' AND message_id IS NOT NULL AND conversation_id IS NOT NULL AND num_nonnulls(understanding_id,record_version_id) = 0)))),
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

ALTER TABLE public."revisions" ADD COLUMN "conversation_id" uuid;

ALTER TABLE public."revisions" ADD COLUMN "entity_type" text;

ALTER TABLE public."revisions" ADD COLUMN "entity_reference" text;

ALTER TABLE public."revisions" ADD COLUMN "entity_version" bigint;

ALTER TABLE public."revisions" ADD COLUMN "request_id" uuid;

ALTER TABLE public."guardian_links" ADD CONSTRAINT "uq_guardian_links_1" UNIQUE ("subject_user_id", "id");

ALTER TABLE public."guardian_links" ADD CONSTRAINT "uq_guardian_links_2" UNIQUE ("subject_user_id", "guardian_user_id", "id");

ALTER TABLE public."consent_grants" ADD CONSTRAINT "uq_consent_grants_1" UNIQUE ("recorded_by_user_id", "request_id");

ALTER TABLE public."record_versions" ADD CONSTRAINT "uq_record_versions_1" UNIQUE ("understanding_id", "version");

ALTER TABLE public."record_versions" ADD CONSTRAINT "uq_record_versions_2" UNIQUE ("conversation_id", "id");

ALTER TABLE public."record_versions" ADD CONSTRAINT "uq_record_versions_3" UNIQUE ("conversation_id", "understanding_id", "id");

ALTER TABLE public."record_versions" ADD CONSTRAINT "uq_record_versions_4" UNIQUE ("understanding_id", "version", "id");

ALTER TABLE public."professional_credentials" ADD CONSTRAINT "uq_professional_credentials_1" UNIQUE ("subject_user_id", "id");

ALTER TABLE public."safety_cases" ADD CONSTRAINT "uq_safety_cases_1" UNIQUE ("conversation_id", "id");

ALTER TABLE public."support_handoffs" ADD CONSTRAINT "uq_support_handoffs_1" UNIQUE ("conversation_id", "request_id");

ALTER TABLE public."support_resources" ADD CONSTRAINT "uq_support_resources_1" UNIQUE ("resource_key", "version");

ALTER TABLE public."audit_events" ADD CONSTRAINT "uq_audit_events_1" UNIQUE ("conversation_id", "id");

ALTER TABLE public."data_requests" ADD CONSTRAINT "uq_data_requests_1" UNIQUE ("request_id");

ALTER TABLE public."data_request_items" ADD CONSTRAINT "uq_data_request_items_1" UNIQUE ("data_request_id", "system_code", "resource_key", "operation");

ALTER TABLE public."understandings" ADD CONSTRAINT "uq_understandings_1" UNIQUE ("conversation_id", "id");

ALTER TABLE public."share_grants" ADD CONSTRAINT "uq_share_grants_1" UNIQUE ("target_conversation_id", "id", "snapshot_id");

ALTER TABLE public."share_grants" ADD CONSTRAINT "uq_share_grants_2" UNIQUE ("id", "snapshot_id", "recipient_id");

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

ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_record_versions_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;

ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_record_versions_created_by" FOREIGN KEY ("created_by") REFERENCES public."user" ("id") ON DELETE RESTRICT;

ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_record_sources_target_conversation_id" FOREIGN KEY ("target_conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;

ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_record_sources_source_snapshot_id" FOREIGN KEY ("source_snapshot_id") REFERENCES public."share_snapshots" ("id") ON DELETE RESTRICT;

ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_record_sources_source_conversation_id" FOREIGN KEY ("source_conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;

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

ALTER TABLE public."profiles" ADD CONSTRAINT "fk_profiles_age_policy_version_id" FOREIGN KEY ("age_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;

ALTER TABLE public."members" ADD CONSTRAINT "fk_members_history_policy_version_id" FOREIGN KEY ("history_policy_version_id") REFERENCES public."policy_versions" ("id") ON DELETE RESTRICT;

ALTER TABLE public."messages" ADD CONSTRAINT "fk_messages_context_room_conversation_id" FOREIGN KEY ("context_room_conversation_id") REFERENCES public."conversations" ("id") ON DELETE RESTRICT;

ALTER TABLE public."understandings" ADD CONSTRAINT "fk_understandings_supersedes_id" FOREIGN KEY ("supersedes_id") REFERENCES public."understandings" ("id") ON DELETE RESTRICT;

ALTER TABLE public."share_grants" ADD CONSTRAINT "fk_share_grants_target_event_id" FOREIGN KEY ("target_event_id") REFERENCES public."events" ("id") ON DELETE RESTRICT;

ALTER TABLE public."share_grants" ADD CONSTRAINT "fk_share_grants_application_id" FOREIGN KEY ("application_id") REFERENCES public."applications" ("id") ON DELETE RESTRICT;

ALTER TABLE public."share_grants" ADD CONSTRAINT "fk_share_grants_consent_grant_id" FOREIGN KEY ("consent_grant_id") REFERENCES public."consent_grants" ("id") ON DELETE RESTRICT;

ALTER TABLE public."messages" ADD CONSTRAINT "fk_private_hint_context" FOREIGN KEY ("context_room_conversation_id", "context_room_message_id") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;

ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_source_target_version" FOREIGN KEY ("target_conversation_id", "target_record_version_id") REFERENCES public."record_versions" ("conversation_id", "id") ON DELETE RESTRICT;

ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_source_target_decision" FOREIGN KEY ("target_conversation_id", "target_agent_decision_id") REFERENCES public."agent_decisions" ("conversation_id", "id") ON DELETE RESTRICT;

ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_source_message" FOREIGN KEY ("source_conversation_id", "source_message_id") REFERENCES public."messages" ("conversation_id", "id") ON DELETE RESTRICT;

ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_source_saved_version" FOREIGN KEY ("source_conversation_id", "source_record_version_id") REFERENCES public."record_versions" ("conversation_id", "id") ON DELETE RESTRICT;

ALTER TABLE public."record_sources" ADD CONSTRAINT "fk_source_granted_snapshot" FOREIGN KEY ("target_conversation_id", "source_grant_id", "source_snapshot_id") REFERENCES public."share_grants" ("target_conversation_id", "id", "snapshot_id") ON DELETE RESTRICT;

ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_version_producer" FOREIGN KEY ("conversation_id", "producing_decision_id") REFERENCES public."agent_decisions" ("conversation_id", "id") ON DELETE RESTRICT;

ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_version_parent_understanding_id" FOREIGN KEY ("conversation_id", "understanding_id") REFERENCES public."understandings" ("conversation_id", "id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public."understandings" ADD CONSTRAINT "fk_current_understanding_id" FOREIGN KEY ("conversation_id", "id", "current_record_version_id") REFERENCES public."record_versions" ("conversation_id", "understanding_id", "id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

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

ALTER TABLE public."guardian_links" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."guardian_links" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."consent_grants" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."consent_grants" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."record_versions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."record_versions" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."record_sources" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."record_sources" FORCE ROW LEVEL SECURITY;

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

ALTER TABLE public."profiles" ADD CONSTRAINT "ck_profiles_containers" CHECK (jsonb_typeof("communication_preferences") = 'object');

ALTER TABLE public."share_snapshots" ADD CONSTRAINT "ck_share_snapshots_containers" CHECK (("payload" IS NULL OR jsonb_typeof("payload") = 'object'));

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

ALTER TABLE public."support_handoffs" ADD CONSTRAINT "uq_support_handoffs_m3_parent_2" UNIQUE ("id", "resource_id");

ALTER TABLE public."support_handoffs" ADD CONSTRAINT "uq_support_handoffs_m3_parent_3" UNIQUE ("id", "receiver_user_id");

ALTER TABLE public."support_handoffs" ADD CONSTRAINT "uq_support_handoffs_m3_parent_1" UNIQUE ("conversation_id", "id");

ALTER TABLE public."data_requests" ADD CONSTRAINT "uq_data_requests_m3_parent_1" UNIQUE ("conversation_id", "id");

ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_record_signer_credential" FOREIGN KEY ("signed_by_user_id", "signer_credential_id") REFERENCES public."professional_credentials" ("subject_user_id", "id") ON DELETE RESTRICT;

ALTER TABLE public."record_versions" ADD CONSTRAINT "fk_record_signed_by" FOREIGN KEY ("signed_by_user_id") REFERENCES public."user" ("id") ON DELETE RESTRICT;

ALTER TABLE public."share_grants" ADD CONSTRAINT "ck_share_grant_purpose" CHECK (purpose_code IS NULL OR purpose_code IN ('personal_context','room_discussion','professional_service','action_followup'));
