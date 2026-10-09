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
leads as (
  select issue,
    min(at_ms) filter (where step = 'accepted') as start_ms,
    last(col order by at_ms, line) = 'Done' as closed
  from tagged where feature group by issue
),
ends as (
  select l.issue, l.start_ms, l.closed, min(t.at_ms) as end_ms
  from leads l left join tagged t on t.issue = l.issue and t.feature and t.step = 'merged' and (l.start_ms is null or t.at_ms >= l.start_ms)
  group by l.issue, l.start_ms, l.closed
)
select
  (count(*) filter (where start_ms is not null and end_ms is null and not closed))::integer as open,
  (avg($now - start_ms) filter (where start_ms is not null and end_ms is null and not closed))::double as open_mean_ms,
  (count(*) filter (where start_ms is null and end_ms is not null and end_ms > $now - $days * 86400000::bigint and end_ms <= $now))::integer as missing_start
from ends;
