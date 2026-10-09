select
  case when bool_or(reported) then sum(case when reported then duration * waits else 0 end) end::double as waiting_ms,
  coalesce(sum(case when reported then duration else 0 end), 0)::double as span_ms,
  count(*) filter (where gap) as gaps
from (
  select s.*, (select count(*) from scheduler_waits w where w.line = s.line) as waits
  from wait_spans($now, $days, $budget_ms) s
)
