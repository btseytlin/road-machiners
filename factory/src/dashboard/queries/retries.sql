select coalesce(previous.outcome, 'unknown') as outcome, count(*) as runs, sum(r.end_ms - r.start_ms)::double as worker_ms, sum(spend.cost) as cost
from range_jobs($now, $days) r
left join (select id, arg_min(outcome, line) as outcome from jobs group by id) previous on previous.id = r.retry_of
left join (select line, sum(cost) as cost from agents group by line) spend using (line)
where coalesce(r.retry_of, '') <> ''
group by 1 order by min(r.line)
