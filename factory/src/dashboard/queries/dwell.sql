with ordered as (
  select issue, step, col, cards."at", at_ms, line, flow from cards where issue is not null and at_ms >= $now - 180 * 86400000::bigint
),
stepped as (
  select *, lag(step) over w as prev_step, lag(col) over w as prev_col from ordered window w as (partition by issue order by at_ms, line)
),
deduped as (
  select * from stepped where step is distinct from prev_step or col is distinct from prev_col
),
kinds as (
  select issue, bool_and(flow is null) as feature from deduped group by issue
),
tagged as (
  select d.*, k.feature, d.at_ms > $now - $days * 86400000::bigint and d.at_ms <= $now as inside from deduped d join kinds k using (issue)
),
columns as (
  select issue, step, col, at_ms, line, lag(col) over (partition by issue order by at_ms, line) as prev_col from tagged where feature
),
moves as (
  select issue, step, col, at_ms, lead(at_ms) over (partition by issue order by at_ms, line) as end_ms
  from (select * from columns where prev_col is null or col <> prev_col)
),
visits as (
  select m.issue, coalesce(o.stage, d.stage) as stage, m.at_ms as start_ms, m.end_ms
  from moves m join column_stages d on d.col = m.col and d.step is null left join column_stages o on o.col = m.col and o.step = m.step
  where coalesce(o.stage, d.stage) is not null
)
select s.stage,
  (count(*) filter (where v.end_ms > $now - $days * 86400000::bigint and v.end_ms <= $now))::integer as count,
  (avg(v.end_ms - v.start_ms) filter (where v.end_ms > $now - $days * 86400000::bigint and v.end_ms <= $now))::double as mean_ms,
  (median(v.end_ms - v.start_ms) filter (where v.end_ms > $now - $days * 86400000::bigint and v.end_ms <= $now))::double as median_ms,
  (count(*) filter (where v.stage is not null and v.end_ms is null))::integer as open,
  (avg($now - v.start_ms) filter (where v.stage is not null and v.end_ms is null))::double as open_mean_ms
from delivery_stages s left join visits v on v.stage = s.stage
group by s.stage, s.ord order by s.ord;
