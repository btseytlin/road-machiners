select w.stage, sum(s.duration)::double as waiting_ms
from wait_spans($now, $days, $budget_ms) s join scheduler_waits w using (line)
where s.reported group by w.stage order by min(s.line)
