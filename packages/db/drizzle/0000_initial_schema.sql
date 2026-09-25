-- Extensions are created by the migration, not only by the Docker init script.
-- That script runs once on first container boot and never runs on Neon or in CI, so
-- the migration is the one path every environment shares.
CREATE EXTENSION IF NOT EXISTS "vector";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('bidding_document', 'corrigendum', 'addendum', 'revised', 'prebid_minutes', 'boq');--> statement-breakpoint
CREATE TYPE "public"."extraction_method" AS ENUM('text_layer', 'ocr');--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"first_page" integer NOT NULL,
	"last_page" integer NOT NULL,
	"section_heading" text,
	"text" text NOT NULL,
	"token_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunks_first_page_positive" CHECK ("chunks"."first_page" >= 1),
	CONSTRAINT "chunks_page_range_ordered" CHECK ("chunks"."last_page" >= "chunks"."first_page")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"doc_type" "doc_type" NOT NULL,
	"version_label" text,
	"published_on" date NOT NULL,
	"source_url" text,
	"content_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"text" text,
	"extraction_method" "extraction_method",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_page_number_positive" CHECK ("pages"."page_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"agency" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_document_idx" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_tenant_sha_idx" ON "documents" USING btree ("tenant_id","content_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_tenant_path_idx" ON "documents" USING btree ("tenant_id","file_path");--> statement-breakpoint
CREATE INDEX "documents_tender_published_idx" ON "documents" USING btree ("tender_id","published_on");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_document_number_idx" ON "pages" USING btree ("document_id","page_number");--> statement-breakpoint
CREATE UNIQUE INDEX "tenders_tenant_reference_idx" ON "tenders" USING btree ("tenant_id","reference");