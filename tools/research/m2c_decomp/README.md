# m2c Decomp Tool Suite

This suite exposes the tool-local `decomp.py` wrapper around the vendored m2c
fork under `tools/_impl/melee/m2c`. The output can help a worker understand control flow,
temporary variables, and data movement before writing natural source.

Do not paste m2c output into reviewable code. Use it as a reading aid, then
recover names, types, fields, and structure from local source evidence.

License note: the vendored m2c fork is GPL-3.0 and is checked in with the
tool implementation.
