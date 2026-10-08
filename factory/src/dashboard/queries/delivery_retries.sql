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
)
select r.stage, (count(j.stage))::integer as runs, (count(distinct j.issue))::integer as issues
from retry_stages r left join (
  select jobs.* from jobs join outcomes o on o.outcome = jobs.outcome and o.retried = 1
  where jobs.issue is not null and jobs.issue not in (select issue from kinds where not feature)
    and jobs.end_ms > $now - $days * 86400000::bigint and jobs.end_ms <= $now
) j on j.stage = r.stage
group by r.stage, r.ord order by r.ord;
