select stage, model, sum(input)::double as input, sum(output)::double as output, sum(cache_read)::double as cache_read,
  sum(cache_write)::double as cache_write, sum(cost)::double as cost
from range_models($now, $days) group by stage, model order by min(line), min(idx)
