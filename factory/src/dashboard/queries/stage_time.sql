select stage, sum(end_ms - start_ms)::double as worker_ms
from range_jobs($now, $days) group by stage order by min(line)
