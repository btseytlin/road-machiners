create or replace table ledger as
select line, j, json_extract_string(j, '$.kind') as kind,
  epoch_ms(try_cast(json_extract_string(j, case when json_extract_string(j, '$.kind') = 'job' then '$.endedAt' else '$.at' end) as timestamptz)) as time_ms
from (select line, l::JSON as j from lines where json_valid(l) and json_type(l::JSON) = 'OBJECT');

create or replace table jobs as
select line, json_extract_string(j, '$.id') as id, json_extract_string(j, '$.stage') as stage,
  try_cast(json_extract_string(j, '$.issue') as bigint) as issue, json_extract_string(j, '$.outcome') as outcome,
  json_extract_string(j, '$.retryOf') as retry_of, json_extract_string(j, '$.endedAt') as ended_at,
  epoch_ms(try_cast(json_extract_string(j, '$.startedAt') as timestamptz)) as start_ms, time_ms as end_ms,
  coalesce(json_array_length(json_extract(j, '$.agents')), 0) as agent_count
from ledger where kind = 'job';

create or replace table agents as
select line, idx, a, try_cast(json_extract_string(a, '$.costUsd') as double) as cost,
  coalesce(json_array_length(json_extract(a, '$.modelUsage')), 0) as model_rows
from (
  select line, unnest(from_json(json_extract(j, '$.agents'), '["JSON"]')) as a, generate_subscripts(from_json(json_extract(j, '$.agents'), '["JSON"]'), 1) as idx
  from ledger where kind = 'job'
);

create or replace table model_usage as
select line, idx, json_extract_string(m, '$.model') as model,
  try_cast(json_extract_string(m, '$.input') as double) as input, try_cast(json_extract_string(m, '$.output') as double) as output,
  try_cast(json_extract_string(m, '$.cacheRead') as double) as cache_read, try_cast(json_extract_string(m, '$.cacheWrite') as double) as cache_write,
  try_cast(json_extract_string(m, '$.cost') as double) as cost
from (select line, idx, unnest(from_json(json_extract(a, '$.modelUsage'), '["JSON"]')) as m from agents);

create or replace table cards as
select line, try_cast(json_extract_string(j, '$.issue') as bigint) as issue, json_extract_string(j, '$.step') as step,
  json_extract_string(j, '$.to') as col, json_extract_string(j, '$.at') as at, time_ms as at_ms, json_extract_string(j, '$.flow') as flow
from ledger where kind = 'card';

create or replace table scheduler as
select line, time_ms as at_ms, case when json_type(json_extract(j, '$.data.report')) = 'OBJECT' then json_extract(j, '$.data.report') end as report
from ledger where kind = 'observation' and json_extract_string(j, '$.data.type') = 'scheduler';

create or replace table scheduler_waits as
select distinct line, json_extract_string(d, '$.stage') as stage, json_extract_string(d, '$.issue') as issue
from (select line, unnest(from_json(json_extract(report, '$.decisions'), '["JSON"]')) as d from scheduler where report is not null)
where json_array_length(json_extract(d, '$.reasons')) > 0 and not list_contains(from_json(json_extract(d, '$.reasons'), '["VARCHAR"]'), 'issue-running');
