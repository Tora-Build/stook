# cu-probe

Measures the compute cost of the N-band LMSR on real SBF, not in a host
simulation. Copies the three math files from the program crate, wraps them in
a bare entrypoint, and logs `sol_log_compute_units` before and after each
operation so a LiteSVM run can read the exact delta.

    cp ../../packages/programs-core/programs/sooth-core/src/math/{wad,lmsr,lmsr_n}.rs src/
    cargo build-sbf
    # then drive target/deploy/cuprobe.so from a LiteSVM script; see docs/feasibility.md §1

Instruction data: `[N, op, k]`. Ops: 0 reprice all, 1 buy full-recompute,
2 band buy over k, 3 path-integrated buy, 4 one-pass cost, 5 closed-form buy,
6 buy against a cached Σexp (logs a third mark after warming the cache).
