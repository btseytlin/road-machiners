select
  (select count(*) from lines where l is not null and trim(l) <> '' and not json_valid(l)) as unreadable,
  (select count(*) from ledger where time_ms is null) + (select count(*) from jobs where start_ms is null) as untimed,
  (select count(*) from agents where cost is null) + (select count(*) from model_usage where cost is null or input is null or output is null or cache_read is null or cache_write is null) as uncosted
