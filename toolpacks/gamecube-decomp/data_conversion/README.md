# Data Conversion Tool Suites

Data conversion suites turn assembly evidence into source-edit hypotheses. Their
outputs are previews and should be verified against ownership, section
placement, and local build evidence before editing.

| Tool | What it does | Best trigger |
| --- | --- | --- |
| `struct_infer` | Infers candidate field offsets from a function and pointer register. | A known pointer register needs layout evidence. |
| `item_state_table` | Previews C `ItemStateTable` definitions from asm labels. | An item state table data label needs conversion. |
