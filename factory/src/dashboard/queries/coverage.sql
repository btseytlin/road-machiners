select
  (select json_extract_string(j, case when kind = 'job' then '$.endedAt' else '$.at' end) from ledger order by line limit 1) as since,
  (select count(*) from range_jobs($now, $days) where agent_count = 0 and stage in (select stage from agent_stages))
    + (select count(*) from range_agents($now, $days) where model_rows = 0) as missing_usage
