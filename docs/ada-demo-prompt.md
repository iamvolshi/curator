# Ada demo prompt — for transparency

This is the exact seed story used in the live Curator demo at
https://volshi-curator.web.app/demo.html (Step 1 — Seed the story),
as updated on 3 November 2026. It is published here so anyone judging
or reviewing the demo can see exactly what was seeded, and what the
demo does with it — no hidden prompt, no hidden record.

Ada Okafor is a demo persona, not a real customer. Her story is seeded.

## The prompt, verbatim

Ada Okafor grew up in Ibadan, the eldest of three children, and learned bookkeeping from her mother, who ran a market stall. In 2019 she joined the Lagos records office as a junior clerk, filing paper invoices by hand. By 2022 she was records lead in Lagos, after her predecessor retired, and she moved the office from Ikeja to Victoria Island. In 2024 she earned a records management certificate, paid for by the office, and began training two junior clerks. On Monday, Ada, records lead in Lagos, approved a $12,000 invoice for office supplies. On Tuesday, her manager Priya Nair said Ada had moved to head of records, and that invoice approvals over $10,000 now need Priya's sign-off. On Wednesday, Ada approved a second invoice for $11,500, and the supplier, Delta Office, delivered the goods the same day. On Thursday, the finance team asked: was Ada authorized on Wednesday, and what did the agent believe at the time? Her brother Tunde, who works at Delta Office, had recommended Delta to Ada in 2023, which the finance team noted as a conflict to check. Ada's certificate course in 2024 had covered exactly this case: approvals after a rule change need the new sign-off, not the old one. On Friday, Priya signed off the Wednesday invoice herself, and the audit closed with a note: the record, not Ada's memory, settled what was believed on each day. Ada grew up in Ibadan with her two younger siblings. Ada's mother ran a market stall in Ibadan for many years. Ada learned bookkeeping at her mother's market stall in Ibadan. Ada was the eldest of three children in Ibadan. Ada's mother taught her eldest child to keep market accounts. Tunde, Ada's brother, grew up in Ibadan with her. Ada kept the Lagos filing cabinets in order as a junior clerk, and her hand-written logs were checked every Friday. As records lead, Ada signed the weekly filing report herself. Priya told the team on Tuesday that Ada was now head of records, and Ada chaired the records meeting that same week. Ada's new title, head of records, appeared on the office noticeboard on Wednesday. The Lagos records office had worked from Ikeja for years before the move. Victoria Island gave the office a larger filing room than Ikeja had. Staff in Lagos still filed paper invoices by hand in the Victoria Island office in 2023. Ada's records management certificate covered filing, retention, and audit trails. The certificate course included training for new clerks. Ada's training sessions for junior clerks ran every week in 2024. The office paid for Ada's certificate training in 2024. Ada's certificate training covered sign-off rules for large invoices. Priya's sign-off rule applied to every approval over $10,000. No approval over $10,000 could go ahead without Priya's sign-off after Tuesday. Ada asked Priya about the sign-off rule on Tuesday. The new sign-off rule was written into the office handbook on Tuesday. Priya signed off large approvals herself after the rule change. Ada filed the $12,000 Monday invoice in the Victoria Island office. The $11,500 Wednesday invoice was filed with Delta Office's delivery note. Ada approved invoices for office supplies every week in Lagos. Paper invoices from 2019 were still in the Lagos filing cabinets in 2022. Delta Office supplied paper, folders, and ink to the Lagos office. Delta Office delivered goods to Victoria Island on Wednesday. Tunde works at Delta Office and knows its delivery team. Ada's brother Tunde recommended Delta Office in 2023. The supplier, Delta Office, sent a delivery note with Wednesday's goods. Delta Office had supplied the Lagos office since 2023. The finance team asked Ada about the Wednesday invoice on Thursday. The finance team checked the audit trail for Monday and Wednesday. The audit closed on Friday with a note from the finance team. The finance team noted the audit result in the record on Friday.
 Ada ran training for junior clerks in the Victoria Island office.

## What the demo counts from this prompt — measured, not claimed

The demo splits the story into sentences and counts, for each chapter,
how many independent supporting sentences mention it. One supporting
sentence moves a chapter one shade darker on a 0–9 greyscale.
Shades 8–9 are the black band: a chapter gets filed. Below that, it
stays grey.

The story above has 49 sentences. Measured shades on 3 November 2026:

| Chapter | Shade | Status |
| --- | --- | --- |
| Where she comes from | 9/9 | Filed |
| The career | 9/9 | Filed |
| The office moves | 9/9 | Filed |
| The certificate | 8/9 | Filed |
| The new rule | 9/9 | Filed |
| The invoices | 9/9 | Filed |
| The supplier | 9/9 | Filed |
| The audit | 8/9 | Filed |
| The Wednesday question | 2/9 | Grey — open question |
| The conflict, unresolved | 1/9 | Grey — open question |
| The predecessor | 1/9 | Grey — open question |

So 8 chapters file, and 3 stay grey on purpose: they are the open
questions the record has not answered yet. The ready update prompt in
the demo ("Priya confirms the Wednesday invoice was covered by the old
rule on Thursday, before the new sign-off rule took effect") adds
support to the Wednesday chapter as a new entry, without editing the
old uncertainty underneath it. It does not jump that chapter to filed.

## What this prompt is not

- It is not the engine record. The full K-record underneath the demo
  is a separate file: 13 entries (12 facts, 1 question), generated by
  the Curator engine. Do not conflate 49 sentences in this prompt
  with 13 entries in that record, or 11 chapters with either number.
- It is not a live model run. Model calls and judge/panel were not
  run in this demo — the engine refuses an unready plug, so nothing
  was sent or recorded by a model here. The demo chat answers by
  retrieving from the chapters and story sentences in this prompt,
  and says plainly when something is not in the record, rather than
  guessing.
- It is not a claim that every chapter is certain. Grey means grey:
  weak support, not filed, not certain.

## How to check it

Paste the prompt above into the demo's Step 1 story box, press
"Pull it apart into chapters", then "Show life chapters". The shades
and the filed/grey split above are what the demo should show.
