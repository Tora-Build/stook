//! Protocol administration: initialise, pause, set the treasury, hand over.

use anchor_lang::prelude::*;

use crate::error::SoothCoreError;
use crate::events::*;
use crate::state::{ProtocolConfig, PROTOCOL_CONFIG_SEED};

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(init, payer = authority, space = ProtocolConfig::SPACE, seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}

/// On mainnet only this key may initialise, so nobody can take the protocol
/// authority in the moment between the deploy and the first call. Set it to
/// the deployer before building with `--features mainnet`.
#[cfg(feature = "mainnet")]
pub const INITIALIZER: Pubkey = pubkey!("DMUtpDCXfmumuR5kKC5h17u1SVS632KgHVZMK4zbgRre");

pub fn initialize_handler(ctx: Context<InitializeProtocol>, treasury: Pubkey) -> Result<()> {
    require!(treasury != Pubkey::default(), SoothCoreError::Unauthorized);
    #[cfg(feature = "mainnet")]
    require_keys_eq!(ctx.accounts.authority.key(), INITIALIZER, SoothCoreError::Unauthorized);
    let c = &mut ctx.accounts.config;
    c.authority = ctx.accounts.authority.key();
    c.treasury = treasury;
    c.bump = ctx.bumps.config;
    emit!(ProtocolInitialized { authority: c.authority, treasury });
    Ok(())
}

/// Every setter below: the config, and its authority signing.
#[derive(Accounts)]
pub struct Administer<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SoothCoreError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,
    pub authority: Signer<'info>,
}

pub fn set_paused_handler(ctx: Context<Administer>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    emit!(ProtocolPausedEvent { authority: ctx.accounts.authority.key(), paused });
    Ok(())
}

pub fn set_treasury_handler(ctx: Context<Administer>, treasury: Pubkey) -> Result<()> {
    require!(treasury != Pubkey::default(), SoothCoreError::Unauthorized);
    ctx.accounts.config.treasury = treasury;
    emit!(TreasuryChanged { authority: ctx.accounts.authority.key(), treasury });
    Ok(())
}

/// Nominate. The default pubkey withdraws a pending nomination.
pub fn transfer_authority_handler(ctx: Context<Administer>, nominee: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_authority = nominee;
    emit!(AuthorityTransferStarted { authority: ctx.accounts.authority.key(), nominee });
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = config.bump,
        constraint = config.pending_authority != Pubkey::default() @ SoothCoreError::NoPendingAuthority,
        constraint = config.pending_authority == nominee.key() @ SoothCoreError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,
    pub nominee: Signer<'info>,
}

pub fn accept_authority_handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    let previous = c.authority;
    c.authority = c.pending_authority;
    c.pending_authority = Pubkey::default();
    emit!(AuthorityTransferAccepted { previous, authority: c.authority });
    Ok(())
}
