# objdiff Score Tool Suite

This suite scores an already-built candidate object against the target object
for one function. It is useful after direct MWCC compilation, permutation, or a
custom candidate build has produced a `.o` file and the worker needs objdiff's
own score breakdown.

For normal source-edit validation, use checkdiff first. Use this suite when the
candidate object path is already known.
