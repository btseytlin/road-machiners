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
)
select
  (select "at" from ordered order by at_ms, line limit 1) as since,
  (count(distinct issue) filter (where feature and inside))::integer as issues,
  (count(distinct issue) filter (where not feature and inside))::integer as excluded,
  (select count(*) from (
    select issue from tagged where feature group by issue
    having first(step order by at_ms, line) <> 'entered' and bool_or(inside)
  ))::integer as legacy,
  (select count(distinct issue) from tagged where feature and inside and step in (select step from loop_steps))::integer as looped
from tagged;
