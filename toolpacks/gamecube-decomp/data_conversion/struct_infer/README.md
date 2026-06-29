# Struct Inference Tool Suite

This suite traces one pointer register through a function's generated assembly
and records loads/stores by offset, access size, and kind. It is useful when a
worker suspects a missing struct field or wrong pointer type and needs concrete
offset evidence before editing source.

The output is a candidate C struct skeleton plus optional verbose trace. Treat
it as layout evidence, not naming proof.
