with agents_in as (select *, left(ended_at, case when $days = 1 then 13 else 10 end) as start from range_agents($now, $days)),
models_in as (select *, left(ended_at, case when $days = 1 then 13 else 10 end) as start, input + output + cache_read + cache_write as tokens from range_models($now, $days)),
segments as (
  select start, 'stage' as grouping, stage as key, cost, 0 as tokens from agents_in
  union all select start, 'stage', stage, 0, tokens from models_in
  union all select start, 'model', 'unattributed', cost, 0 from agents_in where model_rows = 0
  union all select start, 'model', model, cost, tokens from models_in
)
select start, grouping, key, sum(cost)::double as cost,
  case when start in (select start from models_in) then sum(tokens)::double end as tokens
from segments group by start, grouping, key order by start, grouping, key
