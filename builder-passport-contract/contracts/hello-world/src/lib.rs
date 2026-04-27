#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, String,
};

#[contract]
pub struct StellarBuilderPassport;

#[contracttype]
#[derive(Clone)]
pub struct Badge {
    pub name: String,
    pub required_points: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Points(Address),
    Badge(u32),
    BadgeClaimed(Address, u32),
    DemoPointsClaimed(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PassportError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    BadgeAlreadyExists = 3,
    BadgeNotFound = 4,
    NotEnoughPoints = 5,
    BadgeAlreadyClaimed = 6,
    DemoPointsAlreadyClaimed = 7,
    Overflow = 8,
}

#[contractimpl]
impl StellarBuilderPassport {
    pub fn initialize(env: Env, admin: Address) -> Result<(), PassportError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(PassportError::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().persistent().set(&DataKey::Admin, &admin);

        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, PassportError> {
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(PassportError::NotInitialized)
    }

    pub fn create_badge(
        env: Env,
        badge_id: u32,
        name: String,
        required_points: u32,
    ) -> Result<(), PassportError> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(PassportError::NotInitialized)?;

        admin.require_auth();

        let key = DataKey::Badge(badge_id);

        if env.storage().persistent().has(&key) {
            return Err(PassportError::BadgeAlreadyExists);
        }

        let badge = Badge {
            name,
            required_points,
        };

        env.storage().persistent().set(&key, &badge);

        Ok(())
    }

    pub fn get_badge(env: Env, badge_id: u32) -> Result<Badge, PassportError> {
        env.storage()
            .persistent()
            .get(&DataKey::Badge(badge_id))
            .ok_or(PassportError::BadgeNotFound)
    }

    pub fn add_points(
        env: Env,
        builder: Address,
        amount: u32,
    ) -> Result<u32, PassportError> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(PassportError::NotInitialized)?;

        admin.require_auth();

        let key = DataKey::Points(builder);

        let current_points: u32 = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(0);

        let new_points = current_points
            .checked_add(amount)
            .ok_or(PassportError::Overflow)?;

        env.storage().persistent().set(&key, &new_points);

        Ok(new_points)
    }

    pub fn claim_demo_points(
        env: Env,
        builder: Address,
    ) -> Result<u32, PassportError> {
        builder.require_auth();

        let claimed_key = DataKey::DemoPointsClaimed(builder.clone());

        let already_claimed: bool = env
            .storage()
            .persistent()
            .get(&claimed_key)
            .unwrap_or(false);

        if already_claimed {
            return Err(PassportError::DemoPointsAlreadyClaimed);
        }

        let points_key = DataKey::Points(builder.clone());

        let current_points: u32 = env
            .storage()
            .persistent()
            .get(&points_key)
            .unwrap_or(0);

        let new_points = current_points
            .checked_add(60)
            .ok_or(PassportError::Overflow)?;

        env.storage().persistent().set(&points_key, &new_points);
        env.storage().persistent().set(&claimed_key, &true);

        Ok(new_points)
    }

    pub fn get_points(env: Env, builder: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Points(builder))
            .unwrap_or(0)
    }

    pub fn claim_badge(
        env: Env,
        builder: Address,
        badge_id: u32,
    ) -> Result<(), PassportError> {
        builder.require_auth();

        let badge: Badge = env
            .storage()
            .persistent()
            .get(&DataKey::Badge(badge_id))
            .ok_or(PassportError::BadgeNotFound)?;

        let claimed_key = DataKey::BadgeClaimed(builder.clone(), badge_id);

        let already_claimed: bool = env
            .storage()
            .persistent()
            .get(&claimed_key)
            .unwrap_or(false);

        if already_claimed {
            return Err(PassportError::BadgeAlreadyClaimed);
        }

        let current_points: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Points(builder))
            .unwrap_or(0);

        if current_points < badge.required_points {
            return Err(PassportError::NotEnoughPoints);
        }

        env.storage().persistent().set(&claimed_key, &true);

        Ok(())
    }

    pub fn has_badge(env: Env, builder: Address, badge_id: u32) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::BadgeClaimed(builder, badge_id))
            .unwrap_or(false)
    }
}