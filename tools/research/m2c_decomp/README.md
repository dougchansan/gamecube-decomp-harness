# m2c Decomp Tool Suite

This suite exposes the reference harness `decomp.py` wrapper around its
vendored m2c fork. The output can help a worker understand control flow,
temporary variables, and data movement before writing natural source.

Do not paste m2c output into reviewable code. Use it as a reading aid, then
recover names, types, fields, and structure from local source evidence.

License note: the harness-vendored m2c fork is GPL-3.0. The orchestrator tool
suite calls it as an external reference tool and does not vendor its code.
