select stage, case when stage in (select stage from private_stages) then null else issue end as issue,
  case when outcome = 'done' then 'finished' else outcome end as outcome, ended_at as at
from range_jobs($now, $days) order by ended_at desc, line desc
