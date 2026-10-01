ALTER TABLE "chunks" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "embedding_model" text;--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);