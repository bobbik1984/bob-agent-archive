//! Bob's single local domain kernel. No transport, provider or credential access.
pub mod outbox;
pub mod prewarm;

pub mod dispatch;
pub mod inbox;
pub mod wake;

mod deadline;
