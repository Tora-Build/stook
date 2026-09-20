pub mod wad; pub mod lmsr; pub mod lmsr_n; pub mod lean;
use solana_program::{account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey, log::sol_log_compute_units};
use crate::wad::WAD;
entrypoint!(process);
// data[0] = N ticks, data[1] = op: 0 prices, 1 cost_delta on one tick, 2 buy-band across k ticks (data[2]=k), 3 path-integrated buy 32 steps
fn process(_p: &Pubkey, _a: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let n = data[0] as usize; let op = data[1];
    let mut q = [0i128; 64];
    for i in 0..n { q[i] = ((i as i128) * 7 - 20) * WAD; }
    let b = 5_000 * WAD;
    sol_log_compute_units();
    match op {
        0 => { let mut out=[0i128;64]; lmsr_n::prices_n(&q[..n], b, &mut out[..n]).unwrap(); }
        1 => { let mut d=[0i128;64]; d[n/2]=10*WAD; lmsr_n::cost_delta_n(&q[..n], b, &d[..n]).unwrap(); }
        2 => { let k=data[2] as usize; let mut d=[0i128;64]; for i in 0..k { d[n/2+i]=10*WAD; } lmsr_n::cost_delta_n(&q[..n], b, &d[..n]).unwrap(); }
        3 => { let mut d=[0i128;64]; let step=WAD; for _ in 0..32 { d[n/2]=step; let c=lmsr_n::cost_delta_n(&q[..n], b, &d[..n]).unwrap(); q[n/2]+=step; let _=c; } }
        4 => { let _ = lean::cost_lean(&q[..n], b).unwrap(); }
        5 => { lean::buy_lean(&mut q[..n], b, n/2, 10*WAD).unwrap(); }
        6 => { // incremental: pretend cache is warm (e_i for the touched tick), sum precomputed
               let mut e=[0i128;64]; let mut sum=0i128;
               for i in 0..n { e[i]=lmsr::exp_wad(wad::wad_div(q[i],b).unwrap()).unwrap(); sum+=e[i]; }
               sol_log_compute_units();
               let mut c=[e[n/2]]; let mut qi=q[n/2];
               let _ = lean::buy_incremental(&mut c, &mut sum, b, &mut qi, 10*WAD).unwrap(); }
        _ => {}
    }
    sol_log_compute_units();
    Ok(())
}
