create macro range_jobs(now_ms, days) as table
select * from jobs where end_ms >= now_ms - days * 86400000::bigint;

create macro range_agents(now_ms, days) as table
select a.line, a.idx, a.cost, a.model_rows, j.stage, j.ended_at, coalesce(o.wasted, 1) as wasted
from agents a join range_jobs(now_ms, days) j using (line) left join outcomes o on o.outcome = j.outcome;

create macro range_models(now_ms, days) as table
select m.*, a.stage, a.ended_at, a.wasted
from model_usage m join range_agents(now_ms, days) a using (line, idx);

create macro wait_spans(now_ms, days, budget_ms) as table
select line, reported, end_ms - at_ms > budget_ms as gap,
  greatest(0, least(end_ms, at_ms + budget_ms, now_ms) - greatest(at_ms, now_ms - days * 86400000::bigint)) as duration
from (
  select line, report is not null as reported, at_ms, coalesce(lead(at_ms) over (order by line), now_ms) as end_ms
  from scheduler where at_ms >= now_ms - 30 * 86400000::bigint
)
where end_ms >= now_ms - days * 86400000::bigint;
