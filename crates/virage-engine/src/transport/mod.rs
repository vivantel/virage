use async_trait::async_trait;

use crate::chunkers::walk::ArtifactSet;

// ─── WorkItem ─────────────────────────────────────────────────────────────────

/// A single file to be processed by the pipeline.
#[derive(Debug, Clone)]
pub struct WorkItem {
    /// Unique message ID assigned by the transport (used for ack/nack).
    pub msg_id: String,
    /// File path (relative to source root).
    pub path: String,
    /// Stable content revision token (git blob SHA or content hash).
    pub revision: String,
    /// Labels applied by the index-time label pipeline.
    pub labels: Vec<String>,
}

// ─── WorkResult ───────────────────────────────────────────────────────────────

/// Chunks produced by a worker for a single `WorkItem`.
#[derive(Debug)]
pub struct WorkResult {
    pub msg_id: String,
    pub path: String,
    pub chunks: Vec<EmbeddedChunk>,
}

// ─── EmbeddedChunk ────────────────────────────────────────────────────────────

/// An `ArtifactSet` with its dense embedding vector attached.
pub struct EmbeddedChunk {
    pub artifact: ArtifactSet,
    pub dense_vector: Vec<f32>,
}

impl std::fmt::Debug for EmbeddedChunk {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EmbeddedChunk")
            .field("dense_text_hash", &self.artifact.dense_text_hash)
            .field("dims", &self.dense_vector.len())
            .finish()
    }
}

// ─── Transport trait ─────────────────────────────────────────────────────────

/// Extension point for work distribution in the Virage pipeline.
///
/// CE uses `LocalTransport` (in-process mpsc channels).
/// EE plugins implement this via a C vtable loaded at runtime (Phase 8b).
#[async_trait]
pub trait Transport: Send + Sync + 'static {
    /// Push a work item onto the work queue.
    async fn push_work(&self, item: WorkItem) -> anyhow::Result<()>;
    /// Pull the next work item (returns `None` when the queue is closed).
    async fn pull_work(&self) -> anyhow::Result<Option<WorkItem>>;
    /// Push a result from a worker back to the coordinator.
    async fn push_result(&self, result: WorkResult) -> anyhow::Result<()>;
    /// Pull the next result from the result queue.
    async fn pull_result(&self) -> anyhow::Result<Option<WorkResult>>;
    /// Acknowledge successful processing of a message.
    async fn ack(&self, msg_id: &str) -> anyhow::Result<()>;
    /// Negative-acknowledge a message (will be retried or dead-lettered).
    async fn nack(&self, msg_id: &str) -> anyhow::Result<()>;
}

pub mod local;
