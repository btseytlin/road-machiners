select
  coalesce((select sum(end_ms - start_ms) from range_jobs($now, $days)), 0)::double as worker_ms,
  (select sum(cost) from range_agents($now, $days)) as cost,
  sum(input) as input, sum(output) as output, sum(cache_read) as cache_read, sum(cache_write) as cache_write,
  (select sum(cost) from range_agents($now, $days) where wasted = 1) as wasted_cost,
  sum(input) filter (where wasted = 1) as wasted_input, sum(output) filter (where wasted = 1) as wasted_output,
  sum(cache_read) filter (where wasted = 1) as wasted_cache_read, sum(cache_write) filter (where wasted = 1) as wasted_cache_write
from range_models($now, $days)
