# Struct Inference API

Worker-facing commands:

- `python3 tools/data_conversion/struct_infer/api/status.py --repo-root <repo_root> --json`
- `python3 tools/data_conversion/struct_infer/api/infer.py --repo-root <repo_root> --function <symbol> --ptr-reg <rN> --json`

Use `--name` to choose the emitted struct name and `--verbose` to include every
observed access in stderr.
