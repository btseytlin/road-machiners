with ordered as (
  select issue, step, col, cards."at", at_ms, line, flow from cards where issue is not null and at_ms >= $now - 180 * 86400000::bigint
),
stepped as (
  select *, lag(step) over w as prev_step, lag(col) over w as prev_col from ordered window w as (partition by issue order by at_ms, line)
),
deduped as (
  select * from stepped where step is distinct from prev_step or col is distinct from prev_col
),
kinds as (
  select issue, bool_and(flow is null) as feature from deduped group by issue
),
tagged as (
  select d.*, k.feature, d.at_ms > $now - $days * 86400000::bigint and d.at_ms <= $now as inside from deduped d join kinds k using (issue)
),
latest as (
  select g.gate, g.decision, t.issue, row_number() over (partition by g.gate, t.issue order by t.at_ms desc, t.line desc) as rank
  from tagged t join gate_steps g on g.step = t.step where t.feature and t.inside
)
select gates.gate,
  (count(l.gate) filter (where l.rank = 1))::integer as decided,
  (count(l.gate) filter (where l.rank = 1 and l.decision = 'reject'))::integer as rejected
from (select gate, min(ord) as ord from gate_steps group by gate) gates left join latest l on l.gate = gates.gate
group by gates.gate, gates.ord order by gates.ord;
