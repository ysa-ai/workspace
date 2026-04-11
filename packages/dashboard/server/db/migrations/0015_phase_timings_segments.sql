-- Migrate phase_timings to segments format: { phase: { segments: [{started_at, elapsed_ms}] } }
-- Handles all legacy formats:
--   { started_at, finished_at }  → compute elapsed_ms from diff
--   { started_at, elapsed_ms }   → keep elapsed_ms
--   { started_at }               → open segment (elapsed_ms = null)
-- Rows already in segments format are left untouched.
UPDATE tasks
SET phase_timings = (
  SELECT jsonb_object_agg(k, jsonb_build_object('segments', jsonb_build_array(
    CASE
      WHEN v->>'elapsed_ms' IS NOT NULL
      THEN jsonb_build_object('started_at', v->>'started_at', 'elapsed_ms', (v->>'elapsed_ms')::float)
      WHEN v->>'started_at' IS NOT NULL AND v->>'finished_at' IS NOT NULL
      THEN jsonb_build_object(
        'started_at', v->>'started_at',
        'elapsed_ms', EXTRACT(EPOCH FROM (
          (v->>'finished_at')::timestamptz - (v->>'started_at')::timestamptz
        )) * 1000
      )
      ELSE jsonb_build_object('started_at', COALESCE(v->>'started_at', '1970-01-01T00:00:00Z'), 'elapsed_ms', NULL)
    END
  )))
  FROM jsonb_each(phase_timings::jsonb) AS t(k, v)
)::text
WHERE phase_timings IS NOT NULL
  AND NOT (phase_timings::jsonb -> (SELECT k FROM jsonb_object_keys(phase_timings::jsonb) AS k LIMIT 1)) ? 'segments';
