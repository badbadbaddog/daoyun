use infrastructure::Database;
use std::sync::{Arc, Mutex, OnceLock};
use time::{Date, OffsetDateTime};
use tokio::sync::mpsc;
use uuid::Uuid;
// A bounded FIFO serializes day completion; capture never blocks a business request.
pub(crate) struct ActivityRecorder {
    queue: OnceLock<mpsc::Sender<(Uuid, Date)>>,
    gap: Mutex<(Option<Date>, u64)>,
}
impl Default for ActivityRecorder {
    fn default() -> Self {
        Self {
            queue: OnceLock::new(),
            gap: Mutex::new((Some(OffsetDateTime::now_utc().date()), 0)),
        }
    }
}
impl ActivityRecorder {
    fn mark_gap(&self, day: Date) {
        let mut gap = self.gap.lock().unwrap_or_else(|e| e.into_inner());
        gap.0 = Some(gap.0.map_or(day, |old| old.min(day)));
        gap.1 = gap.1.wrapping_add(1)
    }
    pub(crate) fn pending_gap(&self) -> bool {
        self.gap
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .0
            .is_some()
    }
    pub(crate) fn capture(self: &Arc<Self>, db: &Database, user: Uuid) {
        let day = OffsetDateTime::now_utc().date();
        let sender = self.queue.get_or_init(|| {
            let (sender, mut receiver) = mpsc::channel::<(Uuid, Date)>(128);
            let weak = Arc::downgrade(self);
            let db = db.clone();
            tokio::spawn(async move {
                let mut recovered = false;
                while let Some((user, day)) = receiver.recv().await {
                    let Some(recorder) = weak.upgrade() else {
                        break;
                    };
                    let snapshot = *recorder.gap.lock().unwrap_or_else(|e| e.into_inner());
                    let result =
                        tokio::time::timeout(std::time::Duration::from_millis(500), async {
                            if !recovered {
                                db.recover_analytics_capture(day).await?;
                                recovered = true;
                            }
                            if let Some(from) = snapshot.0 {
                                db.mark_analytics_gap(from, day).await?;
                            }
                            db.record_analytics_activity(user, day).await
                        })
                        .await;
                    if matches!(result, Ok(Ok(()))) {
                        let mut gap = recorder.gap.lock().unwrap_or_else(|e| e.into_inner());
                        if gap.1 == snapshot.1 {
                            gap.0 = None
                        }
                    } else {
                        recorder.mark_gap(day);
                        tracing::warn!("Community activity capture incomplete");
                    }
                }
            });
            sender
        });
        if sender.try_send((user, day)).is_err() {
            self.mark_gap(day)
        }
    }
}
