use crate::telemetry::{SessionStatus, TelemetrySession};

#[must_use]
pub fn build_short_report(session: &TelemetrySession) -> String {
    let last_frame = session.frames.last().cloned().unwrap_or_default();
    let frame_stats = frame_stats(session);
    let worker_stats = metric_stats(session, |frame| frame.worker_sim_ms);
    let patch_apply_stats = metric_stats(session, |frame| frame.patch_apply_ms);
    format!(
        "session={} status={:?} mode={} transport={} elapsed_ms={} frame_ms(p50/p95/max)={}/{}/{} worker_ms(p50/p95/max)={}/{}/{} patch_apply_ms(last/p95/max)={}/{}/{} stale_chunks={} queue_depth={} dropped={} coalesced={} snapshot_progress={}%",
        session.session_id,
        session.status,
        session.mode,
        session.transport,
        session.elapsed().as_millis(),
        frame_stats.0,
        frame_stats.1,
        frame_stats.2,
        worker_stats.0,
        worker_stats.1,
        worker_stats.2,
        last_frame.patch_apply_ms,
        patch_apply_stats.1,
        patch_apply_stats.2,
        last_frame.stale_chunks,
        last_frame.queue_depth,
        last_frame.dropped_superseded_patches,
        last_frame.coalesced_patches,
        last_frame.snapshot_progress_percent,
    )
}

#[must_use]
pub fn build_long_report(session: &TelemetrySession) -> String {
    let mut lines = vec![
        format!("Session: {}", session.session_id),
        format!("Build: {}", session.build_id),
        format!("Mode: {}", session.mode),
        format!("Transport: {}", session.transport),
        format!("Status: {:?}", session.status),
        format!("Elapsed: {} ms", session.elapsed().as_millis()),
        format!("Frames: {}", session.frames.len()),
    ];

    if let Some(last) = session.frames.last() {
        let frame_stats = frame_stats(session);
        let worker_stats = metric_stats(session, |frame| frame.worker_sim_ms);
        let patch_build_stats = metric_stats(session, |frame| frame.patch_build_ms);
        let patch_apply_stats = metric_stats(session, |frame| frame.patch_apply_ms);
        lines.push(String::from("Last Frame:"));
        lines.push(format!(
            "  frame_ms={} worker_sim_ms={} fov_ms={} patch_build_ms={} serialization_ms={} patch_apply_ms={}",
            last.frame_ms,
            last.worker_sim_ms,
            last.fov_ms,
            last.patch_build_ms,
            last.serialization_ms,
            last.patch_apply_ms
        ));
        lines.push(format!(
            "  queue_depth={} hot={} warm={} cold={} stale={}",
            last.queue_depth, last.hot_chunks, last.warm_chunks, last.cold_chunks, last.stale_chunks
        ));
        lines.push(format!(
            "  dropped_superseded_patches={} coalesced_patches={} snapshot_progress={}%",
            last.dropped_superseded_patches,
            last.coalesced_patches,
            last.snapshot_progress_percent
        ));
        lines.push(String::from("Frame Stats:"));
        lines.push(format!(
            "  frame_ms p50/p95/max = {}/{}/{}",
            frame_stats.0, frame_stats.1, frame_stats.2
        ));
        lines.push(format!(
            "  worker_sim_ms p50/p95/max = {}/{}/{}",
            worker_stats.0, worker_stats.1, worker_stats.2
        ));
        lines.push(format!(
            "  patch_build_ms p50/p95/max = {}/{}/{}",
            patch_build_stats.0, patch_build_stats.1, patch_build_stats.2
        ));
        lines.push(format!(
            "  patch_apply_ms p50/p95/max = {}/{}/{}",
            patch_apply_stats.0, patch_apply_stats.1, patch_apply_stats.2
        ));
    }

    if !session.warnings.is_empty() {
        lines.push(String::from("Warnings:"));
        for warning in &session.warnings {
            lines.push(format!("  - {}", warning));
        }
    }

    if !session.faults.is_empty() {
        lines.push(String::from("Faults:"));
        for fault in &session.faults {
            lines.push(format!("  - {}", fault));
        }
    }

    if matches!(session.status, SessionStatus::DesyncedResync) {
        lines.push(String::from("Status indicates a recent resync cycle."));
    }

    lines.join("\n")
}

fn frame_stats(session: &TelemetrySession) -> (u64, u64, u64) {
    metric_stats(session, |frame| frame.frame_ms)
}

fn metric_stats<F>(session: &TelemetrySession, mut extractor: F) -> (u64, u64, u64)
where
    F: FnMut(&crate::telemetry::TelemetryFrame) -> u64,
{
    let mut values: Vec<u64> = session.frames.iter().map(&mut extractor).collect();
    if values.is_empty() {
        return (0, 0, 0);
    }
    values.sort_unstable();
    let max = *values.last().expect("values should not be empty");
    let p50 = percentile_value(&values, 0.50);
    let p95 = percentile_value(&values, 0.95);
    (p50, p95, max)
}

fn percentile_value(values: &[u64], percentile: f64) -> u64 {
    if values.is_empty() {
        return 0;
    }
    let clamped = percentile.clamp(0.0, 1.0);
    let index = ((values.len() - 1) as f64 * clamped).round() as usize;
    values[index]
}
